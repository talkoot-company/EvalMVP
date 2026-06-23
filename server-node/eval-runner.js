// Port of server/eval_runner.py — single-criterion eval via Azure OpenAI.
import { AzureOpenAI } from "openai";

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

async function callLlm(messages) {
  const response = await aiClient().chat.completions.create({ model: llmModel(), messages });
  const raw = response.choices[0]?.message?.content || "";
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

function extractLastUserMessage(requestMessages) {
  for (let i = requestMessages.length - 1; i >= 0; i--) {
    if (requestMessages[i]?.role === "user") return requestMessages[i].content || "";
  }
  return "";
}

function parseProductJson(text) {
  const match = /\{[^{}]+\}/.exec(text);
  if (!match) return {};
  try {
    return JSON.parse(match[0]);
  } catch {
    return {};
  }
}

export function extractProductData(requestMessages) {
  const raw = parseProductJson(extractLastUserMessage(requestMessages));
  const splitSemi = (value) => (value || "").split(";").map((v) => v.trim()).filter(Boolean);
  return {
    product_name: raw["Model Name"] || raw["Title"] || "Unknown Product",
    keywords: splitSemi(raw["Keywords"]),
    lcm_claims: splitSemi(raw["LCM Claims"]),
    optiva_claims: splitSemi(raw["Optiva Claims"]),
  };
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

function formatProductSection(productData) {
  const lines = [`PRODUCT NAME: ${productData.product_name || ""}`];
  if (productData.keywords?.length) lines.push("KEYWORDS: " + productData.keywords.join(", "));
  if (productData.lcm_claims?.length) {
    lines.push("APPROVED LCM CLAIMS:");
    for (const c of productData.lcm_claims) lines.push(`  - ${c}`);
  }
  if (productData.optiva_claims?.length) {
    lines.push("APPROVED OPTIVA CLAIMS:");
    for (const c of productData.optiva_claims) lines.push(`  - ${c}`);
  }
  return lines.join("\n");
}

export function buildEvalPrompt(criterion, copyText, productData) {
  const name = criterion.criteria_name || "Unknown";
  const description = criterion.criteria_definition || "";
  const criteriaType = criterion.criteria_type || "numerical-scale";
  const evalDefinition = criterion.eval_definition || {};

  const rubric = buildRubricText(criteriaType, evalDefinition);
  const productSection = formatProductSection(productData);

  let scoreInstruction;
  if (criteriaType === "yes-no") scoreInstruction = 'score: "Yes" or "No"';
  else if (criteriaType === "numerical-scale") scoreInstruction = "score: a number from 1 to 4";
  else scoreInstruction = "score: the count bucket (e.g. 0, 1, 2, 3+)";

  return `You are an expert evaluator of ecommerce product copy. Evaluate the copy below against the provided criterion and return a JSON object.

CRITERION: ${name}
DESCRIPTION: ${description}

${rubric}

PRODUCT DATA:
${productSection}

COPY TO EVALUATE:
${copyText}

Return ONLY a JSON object with these exact fields:
- "score": ${scoreInstruction}
- "rationale": 1-3 sentences explaining the score with reference to the rubric
- "evidence": a list of 1-3 short quoted phrases from the copy that support your score

Example: {"score": 3, "rationale": "The copy speaks directly to the reader.", "evidence": ["Fuel your moments", "feel good about your choice"]}`;
}

// ---------------------------------------------------------------------------
// Main eval entry point
// ---------------------------------------------------------------------------

export async function runSingleEval(copyText, requestMessages, criterion) {
  const productData = extractProductData(requestMessages);
  const criteriaType = criterion.criteria_type || "numerical-scale";
  const evalDefinition = criterion.eval_definition || {};

  const prompt = buildEvalPrompt(criterion, copyText, productData);
  const result = await callLlm([{ role: "user", content: prompt }]);

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
