// Port of server/eval_runner.py — single-criterion eval via Azure OpenAI.
import { AzureOpenAI } from "openai";
import { renderTemplate, defaultTemplate } from "./prompt-templates.js";
import { isAnthropicModel } from "./models.js";

// Credentials come from .env.local (gitignored). See README note in index.js.
function makeClient() {
  const endpoint = process.env.AZURE_OPENAI_ENDPOINT;
  const apiKey = process.env.AZURE_OPENAI_API_KEY;
  const apiVersion = process.env.AZURE_OPENAI_API_VERSION || "2024-12-01-preview";
  if (!endpoint || !apiKey) {
    throw new Error("AZURE_OPENAI_ENDPOINT / AZURE_OPENAI_API_KEY not set (add them to .env.local)");
  }
  return new AzureOpenAI({ endpoint, apiKey, apiVersion });
}

let _client = null;
export function aiClient() {
  if (!_client) _client = makeClient();
  return _client;
}

// Read at call time, not import time, so Electron can load config first.
export const llmModel = () => process.env.AZURE_OPENAI_DEPLOYMENT || "gpt-5";

// Derive the Foundry inference host (services.ai.azure.com) — which serves the
// native Anthropic Messages API — from the Azure OpenAI endpoint's resource name,
// unless explicitly overridden via AZURE_ANTHROPIC_ENDPOINT.
function anthropicEndpoint() {
  const override = process.env.AZURE_ANTHROPIC_ENDPOINT;
  if (override) return override.replace(/\/+$/, "");
  const base = process.env.AZURE_OPENAI_ENDPOINT || "";
  const m = base.match(/^https?:\/\/([^.]+)\./);
  if (!m) throw new Error("Cannot derive Anthropic endpoint from AZURE_OPENAI_ENDPOINT (set AZURE_ANTHROPIC_ENDPOINT)");
  return `https://${m[1]}.services.ai.azure.com`;
}

const ANTHROPIC_MAX_TOKENS = Number(process.env.AZURE_ANTHROPIC_MAX_TOKENS || 8192);

// Call a Claude deployment via the native Anthropic Messages API. Adapts the
// OpenAI-style message array (system pulled out as a top-level field) and returns
// the concatenated text blocks (thinking blocks are ignored).
async function anthropicComplete(messages, model) {
  const apiKey = process.env.AZURE_OPENAI_API_KEY;
  if (!apiKey) throw new Error("AZURE_OPENAI_API_KEY not set");
  const system = messages.filter((m) => m.role === "system").map((m) => m.content).join("\n\n") || undefined;
  const turns = messages.filter((m) => m.role !== "system").map((m) => ({ role: m.role, content: m.content }));
  const res = await fetch(`${anthropicEndpoint()}/anthropic/v1/messages`, {
    method: "POST",
    headers: {
      "x-api-key": apiKey,
      "anthropic-version": "2023-06-01",
      "content-type": "application/json",
    },
    body: JSON.stringify({ model, system, max_tokens: ANTHROPIC_MAX_TOKENS, messages: turns }),
  });
  if (!res.ok) {
    const t = await res.text().catch(() => "");
    throw new Error(`Anthropic API ${res.status}: ${t.slice(0, 300)}`);
  }
  const data = await res.json();
  return (data.content || []).filter((b) => b.type === "text").map((b) => b.text).join("").trim();
}

// Unified text completion. Routes Anthropic-format deployments to the Anthropic
// Messages API and everything else to the Azure OpenAI chat-completions client.
export async function chatText({ model, messages }) {
  const resolved = model || llmModel();
  if (isAnthropicModel(resolved)) return anthropicComplete(messages, resolved);
  const response = await aiClient().chat.completions.create({ model: resolved, messages });
  return response.choices[0]?.message?.content || "";
}

async function callLlm(messages, model) {
  const raw = await chatText({ model, messages });
  const cleaned = raw.replaceAll("```json", "").replaceAll("```", "").trim();
  try {
    return JSON.parse(cleaned);
  } catch {
    return raw;
  }
}

// ---------------------------------------------------------------------------
// Product data extraction
// ---------------------------------------------------------------------------

// Return every user message's text, oldest → newest. Generations are often
// multi-turn (few-shot briefs), so the product record may not be in the last one.
function userMessages(requestMessages) {
  return requestMessages.filter((m) => m?.role === "user").map((m) => m.content || "");
}

// Extract the first brace-balanced JSON object from `text`. The old flat regex
// (/\{[^{}]+\}/) broke on any nested braces and only captured up to the first
// '}', so it silently truncated or missed real product records.
function extractBalancedJson(text) {
  const start = text.indexOf("{");
  if (start < 0) return null;
  let depth = 0;
  let inStr = false;
  let escaped = false;
  for (let i = start; i < text.length; i++) {
    const ch = text[i];
    if (inStr) {
      if (escaped) escaped = false;
      else if (ch === "\\") escaped = true;
      else if (ch === '"') inStr = false;
      continue;
    }
    if (ch === '"') inStr = true;
    else if (ch === "{") depth++;
    else if (ch === "}") {
      depth--;
      if (depth === 0) return text.slice(start, i + 1);
    }
  }
  return null;
}

// Many generations (esp. Bullets/Description rewrites) name the product inline as
// free text rather than a JSON blob — e.g. "…to match this product Diet Coke
// Bottles, 1 Liter, 4 Pack." or "Using this product: Sprite Zero Cans, 355 mL".
// Pull the product title out of those phrasings.
const INLINE_PRODUCT_INTRO =
  /(?:to match|for|using|modify[^.]*?to match)\s+(?:this|the)\s+product\s*:?\s*|(?:this|the)\s+product\s+is\s*:?\s*/i;
// Words that begin the next instruction/sentence and so mark the end of the name.
const INLINE_PRODUCT_STOP =
  /\s(?:Take|Update|Create|Write|Make|Generate|Reply|Return|Do|Don't|Only|Keep|Focus|Ensure|Maintain|You|Here|Please|Use|Follow|Avoid|Include|Based|Given)\b/;

function inlineProductFields(text) {
  const m = INLINE_PRODUCT_INTRO.exec(text);
  if (!m) return null;
  let rest = text.slice(m.index + m[0].length).split(/\r?\n/)[0];
  const dot = rest.search(/\.\s|\.$/);
  if (dot >= 0) rest = rest.slice(0, dot);
  const stop = INLINE_PRODUCT_STOP.exec(rest);
  if (stop) rest = rest.slice(0, stop.index);
  const name = rest.trim().replace(/^[:\-\s]+|[.;:,\s]+$/g, "");
  if (name.length >= 3 && name.length <= 160 && /[a-z]/i.test(name)) return { Title: name };
  return null;
}

// TIER 1 (heuristic, free): recover the product data embedded in the request.
// First looks for a JSON product object (scanning user messages newest → oldest);
// failing that, falls back to the inline "to match this product X" phrasing.
// Returns a non-empty object or null.
export function heuristicProductFields(requestMessages) {
  const msgs = userMessages(requestMessages);
  for (let i = msgs.length - 1; i >= 0; i--) {
    const blob = extractBalancedJson(msgs[i]);
    if (!blob) continue;
    try {
      const obj = JSON.parse(blob);
      if (obj && typeof obj === "object" && !Array.isArray(obj) && Object.keys(obj).length) {
        return obj;
      }
    } catch {
      // not JSON — keep scanning
    }
  }
  for (let i = msgs.length - 1; i >= 0; i--) {
    const fields = inlineProductFields(msgs[i]);
    if (fields) return fields;
  }
  return null;
}

// TIER 2 (AI, costs an LLM call): extract product attributes regardless of the
// key names used. Returns a flat object, or {} when the content has no concrete
// product data (only generic writing/voice instructions). Throws on API error.
export async function aiExtractProductFields(requestMessages, template) {
  const content = userMessages(requestMessages).join("\n\n---\n\n").trim();
  if (!content) return {};
  const prompt = renderTemplate(template ?? defaultTemplate("product_extraction"), { content });
  const response = await aiClient().chat.completions.create({
    model: llmModel(),
    messages: [{ role: "user", content: prompt }],
  });
  const raw = response.choices[0]?.message?.content || "";
  const cleaned = raw.replaceAll("```json", "").replaceAll("```", "").trim();
  try {
    const obj = JSON.parse(cleaned);
    if (obj && typeof obj === "object" && !Array.isArray(obj)) return obj;
  } catch {
    // unparseable → treat as no data
  }
  return {};
}

const NAME_KEYS = ["Title", "Model Name", "Product Name", "Brand Name"];
export function deriveProductName(fields) {
  if (!fields || typeof fields !== "object") return "Unknown Product";
  const key = NAME_KEYS.find((k) => fields[k] != null && String(fields[k]).trim());
  return (key ? String(fields[key]).trim() : "") || "Unknown Product";
}

// Build the productData shape consumed by the eval pipeline from a (possibly
// empty) product fields object. The dataset has a varied schema, so we pass the
// whole record through rather than cherry-picking fixed fields. When there are no
// fields (e.g. a multi-turn creative brief), fall back to the free-text user
// instructions so the evaluator still has brand/voice context to grade against.
export function productDataFromFields(fields, requestMessages) {
  const hasFields = fields && typeof fields === "object" && Object.keys(fields).length > 0;
  return {
    product_name: hasFields ? deriveProductName(fields) : "Unknown Product",
    fields: hasFields ? fields : {},
    briefs: hasFields ? [] : userMessages(requestMessages).map((s) => s.trim()).filter(Boolean),
    hasProductJson: !!hasFields,
  };
}

// Resolve product data using only the cheap heuristic (no LLM). Routes that may
// fall back to AI / a stored column build productData themselves.
export function extractProductData(requestMessages) {
  return productDataFromFields(heuristicProductFields(requestMessages), requestMessages);
}

// ---------------------------------------------------------------------------
// Rubric building from local eval_definition
// ---------------------------------------------------------------------------

function buildRubricText(criteriaType, evalDefinition) {
  const lines = ["Scoring rubric:"];

  if (criteriaType === "yes-no") {
    const yesDef = evalDefinition.definition_yes || "";
    const noDef = evalDefinition.definition_no || "";
    const yesEx = (evalDefinition.yes_examples || []).filter(Boolean);
    const noEx = (evalDefinition.no_examples || []).filter(Boolean);
    if (yesDef) {
      lines.push(`  Yes: ${yesDef}`);
      for (const ex of yesEx) lines.push(`    Example: "${ex}"`);
    }
    if (noDef) {
      lines.push(`  No: ${noDef}`);
      for (const ex of noEx) lines.push(`    Example: "${ex}"`);
    }
  } else if (criteriaType === "numerical-scale") {
    for (const n of [1, 2, 3, 4]) {
      const row = evalDefinition[`score_${n}`] || {};
      let label = `Score ${n}`;
      if (row.title) label += ` — ${row.title}`;
      if (row.definition) label += `: ${row.definition}`;
      lines.push(`  ${label}`);
      for (const ex of [row.example_1, row.example_2]) {
        if (ex) lines.push(`    Example: "${ex}"`);
      }
    }
  } else {
    // count
    const buckets = evalDefinition.buckets?.length ? evalDefinition.buckets : ["0", "1", "2", "3+"];
    const titles = evalDefinition.bucket_titles || {};
    const definitions = evalDefinition.bucket_definitions || {};
    const examples = evalDefinition.bucket_examples || {};
    for (const b of buckets) {
      let label = `  Count ${b}`;
      if (titles[b]) label += ` — ${titles[b]}`;
      if (definitions[b]) label += `: ${definitions[b]}`;
      lines.push(label);
      for (const ex of examples[b] || []) {
        if (ex) lines.push(`    Example: "${ex}"`);
      }
    }
  }

  return lines.join("\n");
}

function desiredScore(criteriaType, evalDefinition) {
  if (criteriaType === "yes-no") return "Yes";
  if (criteriaType === "numerical-scale") return "4";
  const buckets = evalDefinition.buckets?.length ? evalDefinition.buckets : ["0", "1", "2", "3+"];
  return buckets.length ? String(buckets[buckets.length - 1]) : "";
}

// ---------------------------------------------------------------------------
// Prompt construction
// ---------------------------------------------------------------------------

export function formatProductSection(productData) {
  // Pass the full product record through so the evaluator can ground its
  // judgement (and catch hallucinated claims) against every available field.
  if (productData.hasProductJson) {
    const lines = [];
    for (const [key, value] of Object.entries(productData.fields)) {
      if (value == null) continue;
      const val = Array.isArray(value) ? value.join(", ") : String(value).trim();
      if (val) lines.push(`${key}: ${val}`);
    }
    return lines.length ? lines.join("\n") : "(No product data available.)";
  }

  // No structured record (e.g. a multi-turn creative brief) — give the judge
  // the instructions that produced the copy as the only available context.
  if (productData.briefs?.length) {
    return [
      "No structured product record was attached to this generation.",
      "Creative brief / instructions provided:",
      ...productData.briefs.map((b) => `  - ${b}`),
    ].join("\n");
  }

  return "(No product data available.)";
}

export function buildEvalPrompt(criterion, copyText, productData, template) {
  const criteriaType = criterion.criteria_type || "numerical-scale";
  const evalDefinition = criterion.eval_definition || {};

  let scoreInstruction;
  if (criteriaType === "yes-no") scoreInstruction = 'score: "Yes" or "No"';
  else if (criteriaType === "numerical-scale") scoreInstruction = "score: a number from 1 to 4";
  else scoreInstruction = "score: the count bucket (e.g. 0, 1, 2, 3+)";

  return renderTemplate(template ?? defaultTemplate("eval_grading"), {
    criterion_name: criterion.criteria_name || "Unknown",
    criterion_description: criterion.criteria_definition || "",
    rubric: buildRubricText(criteriaType, evalDefinition),
    product_data: formatProductSection(productData),
    copy: copyText,
    score_instruction: scoreInstruction,
  });
}

// The exact chat chain sent to the LLM to grade `copyText`. `productData` is the
// resolved product record (from the stored column, heuristic, or AI) embedded in
// the prompt. `template` overrides the stored/edited eval-grading template (falls
// back to the built-in default). Used by the eval and to preview the chain.
export function buildEvalMessages(copyText, productData, criterion, template) {
  const prompt = buildEvalPrompt(criterion, copyText, productData, template);
  return [{ role: "user", content: prompt }];
}

// ---------------------------------------------------------------------------
// Main eval entry point
// ---------------------------------------------------------------------------

export async function runSingleEval(copyText, productData, criterion, template, model) {
  const criteriaType = criterion.criteria_type || "numerical-scale";
  const evalDefinition = criterion.eval_definition || {};

  const messages = buildEvalMessages(copyText, productData, criterion, template);
  const result = await callLlm(messages, model);

  let score = "", rationale = "", evidence = [];
  if (result && typeof result === "object") {
    score = result.score ?? "";
    rationale = result.rationale ?? "";
    evidence = result.evidence ?? [];
  } else {
    rationale = String(result);
  }

  return {
    criterion_id: criterion.id || "",
    criterion_name: criterion.criteria_name || "",
    desired_score: desiredScore(criteriaType, evalDefinition),
    score: String(score),
    rationale,
    evidence: Array.isArray(evidence) ? evidence : [String(evidence)],
    product_name: productData.product_name,
  };
}
