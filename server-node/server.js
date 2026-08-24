// EvalMVP API server (Express). Data access goes through a pluggable `store`
// (server-node/store-sqlite.js or store-mssql.js) so the same routes work
// against local SQLite or the SQL Server temp_Brian_* tables.
//
//   - Dev:        node server-node/index.js   — API only; Vite serves the UI and proxies /api
//   - Production: startServer({ ..., staticDir }) — one Node process serves the built UI + API
//
// Full route parity with the original FastAPI server (server/main.py).

import path from "node:path";
import fs from "node:fs";
import { randomUUID } from "node:crypto";
import express from "express";
import cors from "cors";
import multer from "multer";
import {
  runSingleEval, buildEvalMessages, llmModel, chatText,
  heuristicProductFields, aiExtractProductFields, productDataFromFields, formatProductSection,
} from "./eval-runner.js";
import { exportZipBuffer, importZipBuffer, KINDS } from "./data-transfer.js";
import {
  renderTemplate, defaultTemplate, DEFAULT_PROMPTS,
  DEFAULT_REWRITE_ORCHESTRATION_PROMPT, REWRITE_ORCHESTRATION_PLACEHOLDERS,
} from "./prompt-templates.js";
import { AVAILABLE_MODELS, DEFAULT_MODEL, pickModel } from "./models.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const nowIso = () => new Date().toISOString();

// Workflow step modes: assess only, rewrite once, or rewrite up to 3× until all pass.
const WORKFLOW_STEP_MODES = new Set(["assess_only", "rewrite_once", "rewrite_until_pass"]);
function sanitizeWorkflowSteps(steps) {
  if (!Array.isArray(steps)) return [];
  return steps
    .filter((s) => s && s.suite_id)
    .map((s) => ({
      suite_id: String(s.suite_id),
      mode: WORKFLOW_STEP_MODES.has(s.mode) ? s.mode : "assess_only",
    }));
}

function slugify(text) {
  return text
    .toLowerCase()
    .trim()
    .replace(/[^\w\s-]/g, "")
    .replace(/[\s_]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80);
}

// Normalizes a raw criteria row from either backend (eval_definition/custom_tags
// are JSON text in both; active is int in SQLite / bool in SQL Server).
function rowToCriterion(row) {
  const d = { ...row };
  d.eval_definition = typeof d.eval_definition === "string" ? JSON.parse(d.eval_definition) : (d.eval_definition || {});
  d.custom_tags = typeof d.custom_tags === "string" ? JSON.parse(d.custom_tags || "{}") : (d.custom_tags || {});
  d.active = Boolean(d.active);
  return d;
}

// Normalizes a raw suite row (active is int in SQLite / bool in SQL Server).
function rowToSuite(row) {
  const d = { ...row };
  d.active = Boolean(d.active);
  return d;
}

// Normalizes a raw prompt-template row (placeholders is JSON text in both
// backends) and attaches the built-in default template so the UI can offer a
// "reset to default" that stages into the editor before saving.
function rowToPromptTemplate(row) {
  const d = { ...row };
  d.placeholders = typeof d.placeholders === "string" ? JSON.parse(d.placeholders || "[]") : (d.placeholders || []);
  const def = DEFAULT_PROMPTS.find((p) => p.id === d.id);
  d.default_template = def ? def.template : d.template;
  return d;
}

function rowToGeneration(row, includeRaw = false) {
  const d = { ...row };
  for (const field of ["req_json", "resp_json"]) {
    const raw = d[field];
    delete d[field];
    if (includeRaw && raw) {
      try {
        d[field] = typeof raw === "string" ? JSON.parse(raw) : raw;
      } catch {
        d[field] = raw;
      }
    }
  }
  d.is_valid = d.is_valid === null || d.is_valid === undefined ? null : Boolean(d.is_valid);
  // `has_product_data` is a computed 0/1 flag from listGenerations; coerce to bool.
  if ("has_product_data" in d) d.has_product_data = Boolean(d.has_product_data);
  return d;
}

const NO_PRODUCT_DATA_WARNING =
  "No valid product data could be extracted for this generation — it was evaluated against the creative brief only, without a product record to ground claims.";

// Resolve the product data used to ground an eval. Prefers the persisted
// `product_json` column; if the generation was never processed, extracts it now
// (heuristic, then optional AI fallback) and persists the result. Returns the
// productData shape consumed by the eval pipeline plus a warning when no usable
// product fields are available.
async function resolveProductDataForGeneration(store, genRow, requestMessages, { allowAi = false, persist = true, extractionTemplate } = {}) {
  const warnIfEmpty = (productData) => ({
    productData,
    extractionWarning: productData.hasProductJson ? null : NO_PRODUCT_DATA_WARNING,
  });

  // Already processed → use the stored record (no LLM).
  if (genRow.product_json != null) {
    let fields = {};
    try {
      fields = typeof genRow.product_json === "string" ? JSON.parse(genRow.product_json) : genRow.product_json;
    } catch {
      fields = {};
    }
    return warnIfEmpty(productDataFromFields(fields, requestMessages));
  }

  // Never processed → extract: heuristic first, then AI fallback if allowed.
  let fields = heuristicProductFields(requestMessages);
  if ((!fields || !Object.keys(fields).length) && allowAi) {
    try {
      fields = await aiExtractProductFields(requestMessages, extractionTemplate);
    } catch (err) {
      console.error(`AI product extraction failed for ${genRow.generation_id}: ${err.message || err}`);
      fields = null;
    }
  }
  const normalized = fields && Object.keys(fields).length ? fields : {};
  if (persist) {
    try {
      await store.setProductJson(genRow.generation_id, JSON.stringify(normalized));
    } catch (err) {
      console.error(`Could not persist product_json for ${genRow.generation_id}: ${err.message || err}`);
    }
  }
  return warnIfEmpty(productDataFromFields(normalized, requestMessages));
}

class HttpError extends Error {
  constructor(status, detail) {
    super(detail);
    this.status = status;
    this.detail = detail;
  }
}

// Wraps async handlers so thrown HttpErrors become FastAPI-style {detail} responses.
const route = (fn) => async (req, res) => {
  try {
    await fn(req, res);
  } catch (err) {
    const status = err instanceof HttpError ? err.status : 500;
    const detail = err instanceof HttpError ? err.detail : String(err.message || err);
    if (status === 500) console.error(err);
    res.status(status).json({ detail });
  }
};

// ---------------------------------------------------------------------------
// App factory
// ---------------------------------------------------------------------------

const CRITERIA_COLUMNS = [
  "context", "content_type", "criteria_category", "criteria_name",
  "criteria_definition", "criteria_type", "eval_definition",
  "weight", "active", "marketplace_tag", "brand_tag", "industry_tag",
  "customer", "brand", "custom_tags", "notes",
];

const SUITE_COLUMNS = ["name", "description", "active", "rewrite_orchestration_prompt", "eval_model", "rewrite_model"];
const PROMPT_TEMPLATE_COLUMNS = ["name", "description", "template"];

const GENERATION_TYPES = ["Title", "Description", "Bullets", "Sustainability", "Extraction", "Other"];
const CRITERIA_CONTENT_TYPES = ["Title", "Description", "Bullets/Specs", "Meta Description"];

function buildMapping(rows) {
  const result = Object.fromEntries(CRITERIA_CONTENT_TYPES.map((ct) => [ct, []]));
  for (const r of rows) {
    if (r.criteria_content_type in result) result[r.criteria_content_type].push(r.generation_type);
  }
  return result;
}

// The grounding block for a rewrite/eval. Prefers the persisted extracted record
// (product_json) when present, falling back to the generation's raw last user
// message for generations that have no stored product record.
function groundingSection(genRow) {
  if (genRow.product_json != null) {
    let fields = {};
    try {
      fields = typeof genRow.product_json === "string" ? JSON.parse(genRow.product_json) : genRow.product_json;
    } catch {
      fields = {};
    }
    if (fields && typeof fields === "object" && Object.keys(fields).length) {
      return formatProductSection(productDataFromFields(fields, []));
    }
  }
  return genRow.last_user_message || "";
}

// The exact prompt sent to the LLM to rewrite (post-edit) a piece of copy.
// `template` overrides the stored/edited post_edit template (built-in default otherwise).
function buildPostEditPrompt({ systemPrompt, productSection, originalContent, criterion_name, score, desired_score, rationale, evidence }, template) {
  let evidenceBlock = "";
  if (Array.isArray(evidence) && evidence.length) {
    evidenceBlock = "\nSpecific passages flagged:\n" +
      evidence.filter(Boolean).map((e) => `  - "${e}"`).join("\n");
  }
  return renderTemplate(template ?? defaultTemplate("post_edit"), {
    system_prompt: systemPrompt,
    product_data: productSection,
    original_copy: originalContent,
    criterion_name,
    score,
    desired_score,
    rationale,
    evidence: evidenceBlock,
  });
}

// Formats the aggregated per-criterion feedback into the human-readable blocks
// shared by the rewrite prompt and the rewrite-orchestration prompt.
function formatFeedbackBlocks(feedback) {
  const items = Array.isArray(feedback) ? feedback : [];
  return items.map((f, i) => {
    const passed = String(f.score) === String(f.desired_score);
    const label = passed
      ? "PASS — keep this strength"
      : `NEEDS IMPROVEMENT (target ${f.desired_score})`;
    let evidenceBlock = "";
    if (Array.isArray(f.evidence) && f.evidence.length) {
      evidenceBlock = "\n   Flagged passages:\n" +
        f.evidence.filter(Boolean).map((e) => `     - "${e}"`).join("\n");
    }
    return `${i + 1}. ${f.criterion_name} — ${label} (score ${f.score})\n   Feedback: ${f.rationale}${evidenceBlock}`;
  }).join("\n\n");
}

// The rewrite-orchestration prompt: runs BEFORE the aggregate rewrite and turns
// the full feedback + current copy into a single coherence thesis. `template` is
// the suite's stored prompt (or the built-in default when the suite has none).
function buildOrchestrationPrompt({ systemPrompt, productSection, originalContent, feedback }, template) {
  return renderTemplate(template || DEFAULT_REWRITE_ORCHESTRATION_PROMPT, {
    system_prompt: systemPrompt,
    product_data: productSection,
    original_copy: originalContent,
    feedback: formatFeedbackBlocks(feedback),
  });
}

// The exact prompt sent to the LLM to rewrite copy using the AGGREGATED feedback
// from every criterion the generation was evaluated against. Passing criteria are
// flagged as strengths to preserve; failing ones as the changes to make. `thesis`
// is the coherence thesis produced by the orchestration step (may be empty).
function buildRewritePrompt({ systemPrompt, productSection, originalContent, feedback, thesis }, template) {
  const items = Array.isArray(feedback) ? feedback : [];
  const tmpl = template ?? defaultTemplate("rewrite_aggregate");
  let rendered = renderTemplate(tmpl, {
    system_prompt: systemPrompt,
    product_data: productSection,
    original_copy: originalContent,
    criteria_count: `${items.length} criteri${items.length === 1 ? "on" : "a"}`,
    feedback: formatFeedbackBlocks(feedback),
    thesis: thesis || "",
  });
  // If the effective template has no {thesis} slot (a legacy-seeded or
  // user-customized rewrite_aggregate), append the orchestration thesis so it
  // still reaches the rewrite instead of being silently dropped.
  if (thesis && !tmpl.includes("{thesis}")) {
    rendered += `\n\n--- REWRITE THESIS & DRAFTING INSTRUCTIONS ---\n${thesis}\n\nBuild the copy around the single customer-use proposition and drafting instructions above — develop one coherent idea rather than addressing the feedback one item at a time.`;
  }
  return rendered;
}

// Resolve the rewrite-orchestration prompt for a rewrite: the suite's own prompt
// if it has one, otherwise the built-in default (which also covers rewrites with
// no suite context and suites that never set a prompt).
async function resolveOrchestrationPrompt(store, suiteId) {
  if (suiteId) {
    const suite = await store.getSuite(suiteId);
    const prompt = suite && suite.rewrite_orchestration_prompt;
    if (typeof prompt === "string" && prompt.trim()) return prompt;
  }
  return DEFAULT_REWRITE_ORCHESTRATION_PROMPT;
}

export function createApp({ store, resultsDir, staticDir = null }) {
  const app = express();
  app.use(cors({ origin: ["http://localhost:8080", "http://localhost:5173", "http://localhost:3000"] }));
  app.use(express.json({ limit: "10mb" }));

  app.get("/api/health", (req, res) => {
    res.json({ ok: true, backend: store.backend });
  });

  // Load the current (possibly edited) template text for a prompt id. Returns
  // undefined so the builder falls back to its built-in default if the row is
  // missing/blank. Templates are seeded on connect, so normally a row exists.
  const loadTemplate = async (id) => {
    try {
      const row = await store.getPromptTemplate(id);
      return row && row.template ? row.template : undefined;
    } catch {
      return undefined;
    }
  };

  // ----- Criteria routes -----

  app.get("/api/criteria", route(async (req, res) => {
    const rows = await store.listCriteria();
    res.json(rows.map(rowToCriterion));
  }));

  // Bulk upsert criteria from an uploaded JSON file. Validates the whole file
  // first (applies nothing on any error), tags each row with the upload source +
  // date, and records the raw upload for traceability. Literal route — must be
  // registered before GET /api/criteria/:id.
  app.post("/api/criteria/bulk-upload", route(async (req, res) => {
    const body = req.body || {};
    const raw = typeof body.raw === "string" ? body.raw : "";
    if (!raw.trim()) throw new HttpError(422, "raw (the uploaded JSON file content) is required");

    let parsed;
    try { parsed = JSON.parse(raw); }
    catch (e) { throw new HttpError(422, `Invalid JSON: ${e.message || e}`); }

    const list = Array.isArray(parsed) ? parsed
      : (parsed && Array.isArray(parsed.criteria)) ? parsed.criteria : null;
    if (!list) throw new HttpError(422, "Expected an object with a 'criteria' array (or a bare array of criteria).");
    if (list.length === 0) throw new HttpError(422, "No criteria in the upload.");

    const VALID_TYPES = new Set(["yes-no", "numerical-scale", "numerical-count"]);
    const errors = [];
    list.forEach((c, i) => {
      if (!c || typeof c !== "object") { errors.push({ index: i, message: "not an object" }); return; }
      if (!c.criteria_name) errors.push({ index: i, message: "criteria_name is required" });
      if (!c.content_type) errors.push({ index: i, message: "content_type is required" });
      if (!c.criteria_type) errors.push({ index: i, message: "criteria_type is required" });
      else if (!VALID_TYPES.has(c.criteria_type)) errors.push({ index: i, message: `criteria_type must be one of: ${[...VALID_TYPES].join(", ")}` });
    });
    if (errors.length) {
      res.status(422).json({ detail: `${errors.length} invalid criteri${errors.length === 1 ? "on" : "a"} — nothing was applied`, errors });
      return;
    }

    const source = (body.source && String(body.source).trim())
      || (parsed && !Array.isArray(parsed) && parsed.source)
      || body.filename || "upload";
    const uploadedAt = nowIso();
    let created = 0, updated = 0;
    const affected = [];

    for (const c of list) {
      const cid = c.id || `${slugify(c.criteria_name)}-${slugify(c.content_type)}`;
      const existing = await store.getCriterion(cid);
      if (existing) {
        const merged = { ...rowToCriterion(existing) };
        for (const col of CRITERIA_COLUMNS) { if (col in c) merged[col] = c[col]; }
        await store.updateCriterion(cid, {
          context: merged.context, content_type: merged.content_type,
          criteria_category: merged.criteria_category, criteria_name: merged.criteria_name,
          criteria_definition: merged.criteria_definition ?? "", criteria_type: merged.criteria_type,
          eval_definition: JSON.stringify(merged.eval_definition ?? {}),
          weight: merged.weight, active: merged.active,
          marketplace_tag: merged.marketplace_tag, brand_tag: merged.brand_tag, industry_tag: merged.industry_tag,
          customer: merged.customer, brand: merged.brand,
          custom_tags: JSON.stringify(merged.custom_tags ?? {}), notes: merged.notes ?? null,
          upload_source: source, uploaded_at: uploadedAt, updated_at: uploadedAt,
        });
        updated++;
      } else {
        await store.insertCriterion({
          id: cid,
          context: c.context ?? "", content_type: c.content_type,
          criteria_category: c.criteria_category ?? null, criteria_name: c.criteria_name,
          criteria_definition: c.criteria_definition ?? "", criteria_type: c.criteria_type,
          eval_definition: JSON.stringify(c.eval_definition ?? {}),
          weight: c.weight ?? 1.0, active: c.active === false ? false : true,
          marketplace_tag: c.marketplace_tag ?? null, brand_tag: c.brand_tag ?? null, industry_tag: c.industry_tag ?? null,
          customer: c.customer ?? null, brand: c.brand ?? null,
          custom_tags: JSON.stringify(c.custom_tags ?? {}), notes: c.notes ?? null,
          upload_source: source, uploaded_at: uploadedAt,
          created_at: uploadedAt, updated_at: uploadedAt,
        });
        created++;
      }
      affected.push(cid);
    }

    const uploadId = randomUUID();
    await store.insertCriteriaUpload({
      id: uploadId,
      filename: body.filename ?? null,
      source,
      uploaded_at: uploadedAt,
      criteria_count: list.length,
      created_count: created,
      updated_count: updated,
      criterion_ids: JSON.stringify(affected),
      raw_json: raw,
    });

    res.json({ upload_id: uploadId, source, uploaded_at: uploadedAt, total: list.length, created, updated, criterion_ids: affected });
  }));

  // Upload history (metadata only; raw JSON kept in the DB for traceability).
  app.get("/api/criteria/uploads", route(async (req, res) => {
    const rows = await store.listCriteriaUploads();
    res.json(rows.map((r) => ({
      ...r,
      criterion_ids: typeof r.criterion_ids === "string" ? JSON.parse(r.criterion_ids || "[]") : (r.criterion_ids || []),
    })));
  }));

  app.get("/api/criteria/:id", route(async (req, res) => {
    const row = await store.getCriterion(req.params.id);
    if (!row) throw new HttpError(404, "Criterion not found");
    res.json(rowToCriterion(row));
  }));

  app.post("/api/criteria", route(async (req, res) => {
    const body = req.body || {};
    if (!body.criteria_name || !body.content_type || !body.criteria_type) {
      throw new HttpError(422, "criteria_name, content_type and criteria_type are required");
    }
    const now = nowIso();
    const cid = body.id || `${slugify(body.criteria_name)}-${slugify(body.content_type)}`;
    if (await store.getCriterion(cid)) {
      throw new HttpError(409, `Criterion '${cid}' already exists`);
    }
    await store.insertCriterion({
      id: cid,
      context: body.context ?? "",
      content_type: body.content_type,
      criteria_category: body.criteria_category ?? null,
      criteria_name: body.criteria_name,
      criteria_definition: body.criteria_definition ?? "",
      criteria_type: body.criteria_type,
      eval_definition: JSON.stringify(body.eval_definition ?? {}),
      weight: body.weight ?? 1.0,
      active: body.active === false ? false : true,
      marketplace_tag: body.marketplace_tag ?? null,
      brand_tag: body.brand_tag ?? null,
      industry_tag: body.industry_tag ?? null,
      customer: body.customer ?? null,
      brand: body.brand ?? null,
      custom_tags: JSON.stringify(body.custom_tags ?? {}),
      notes: body.notes ?? null,
      created_at: now,
      updated_at: now,
    });
    res.status(201).json(rowToCriterion(await store.getCriterion(cid)));
  }));

  app.put("/api/criteria/:id", route(async (req, res) => {
    const existing = await store.getCriterion(req.params.id);
    if (!existing) throw new HttpError(404, "Criterion not found");

    // Merge patch over existing row: accepts both full bodies and partial edits
    // (the inline editors on the detail page send single-field patches).
    const body = req.body || {};
    const merged = { ...rowToCriterion(existing) };
    for (const col of CRITERIA_COLUMNS) {
      if (col in body) merged[col] = body[col];
    }

    await store.updateCriterion(req.params.id, {
      context: merged.context,
      content_type: merged.content_type,
      criteria_category: merged.criteria_category,
      criteria_name: merged.criteria_name,
      criteria_definition: merged.criteria_definition ?? "",
      criteria_type: merged.criteria_type,
      eval_definition: JSON.stringify(merged.eval_definition ?? {}),
      weight: merged.weight,
      active: merged.active,
      marketplace_tag: merged.marketplace_tag,
      brand_tag: merged.brand_tag,
      industry_tag: merged.industry_tag,
      customer: merged.customer,
      brand: merged.brand,
      custom_tags: JSON.stringify(merged.custom_tags ?? {}),
      notes: merged.notes ?? null,
      updated_at: nowIso(),
    });
    res.json(rowToCriterion(await store.getCriterion(req.params.id)));
  }));

  app.delete("/api/criteria/:id", route(async (req, res) => {
    const existing = await store.getCriterion(req.params.id);
    if (!existing) throw new HttpError(404, "Criterion not found");
    await store.deleteCriterion(req.params.id);
    res.status(204).end();
  }));

  app.put("/api/criteria/:id/toggle-active", route(async (req, res) => {
    const row = await store.getCriterion(req.params.id);
    if (!row) throw new HttpError(404, "Criterion not found");
    await store.updateCriterion(req.params.id, { active: row.active ? false : true, updated_at: nowIso() });
    res.json(rowToCriterion(await store.getCriterion(req.params.id)));
  }));

  // ----- Suites routes (a suite = name + description + associated criteria) -----

  app.get("/api/suites", route(async (req, res) => {
    const [rows, junction] = await Promise.all([store.listSuites(), store.listAllSuiteCriteria()]);
    const bySuite = new Map();
    for (const { suite_id, criterion_id } of junction) {
      if (!bySuite.has(suite_id)) bySuite.set(suite_id, []);
      bySuite.get(suite_id).push(criterion_id);
    }
    res.json(rows.map((r) => ({ ...rowToSuite(r), criteria_ids: bySuite.get(r.id) ?? [] })));
  }));

  app.post("/api/suites", route(async (req, res) => {
    const body = req.body || {};
    if (!body.name || !String(body.name).trim()) throw new HttpError(422, "name is required");
    const sid = body.id || slugify(body.name);
    if (!sid) throw new HttpError(422, "name must contain at least one letter or number");
    if (await store.getSuite(sid)) throw new HttpError(409, `Suite '${sid}' already exists`);
    const now = nowIso();
    await store.insertSuite({
      id: sid,
      name: String(body.name).trim(),
      description: body.description ?? null,
      active: body.active === false ? false : true,
      // Left null on create → the rewrite falls back to the default orchestration
      // prompt until the suite sets its own.
      rewrite_orchestration_prompt: body.rewrite_orchestration_prompt ?? null,
      // null → eval/rewrite fall back to the default deployment (gpt-5).
      eval_model: body.eval_model ?? null,
      rewrite_model: body.rewrite_model ?? null,
      created_at: now,
      updated_at: now,
    });
    res.status(201).json({ ...rowToSuite(await store.getSuite(sid)), criteria_ids: [] });
  }));

  app.get("/api/suites/:id", route(async (req, res) => {
    const row = await store.getSuite(req.params.id);
    if (!row) throw new HttpError(404, "Suite not found");
    res.json({ ...rowToSuite(row), criteria_ids: await store.getSuiteCriterionIds(req.params.id) });
  }));

  app.put("/api/suites/:id", route(async (req, res) => {
    const existing = await store.getSuite(req.params.id);
    if (!existing) throw new HttpError(404, "Suite not found");
    const body = req.body || {};
    const merged = { ...rowToSuite(existing) };
    for (const col of SUITE_COLUMNS) { if (col in body) merged[col] = body[col]; }
    await store.updateSuite(req.params.id, {
      name: merged.name,
      description: merged.description ?? null,
      active: merged.active,
      rewrite_orchestration_prompt: merged.rewrite_orchestration_prompt ?? null,
      eval_model: merged.eval_model ?? null,
      rewrite_model: merged.rewrite_model ?? null,
      updated_at: nowIso(),
    });
    res.json({ ...rowToSuite(await store.getSuite(req.params.id)), criteria_ids: await store.getSuiteCriterionIds(req.params.id) });
  }));

  app.delete("/api/suites/:id", route(async (req, res) => {
    if (!(await store.getSuite(req.params.id))) throw new HttpError(404, "Suite not found");
    await store.deleteSuite(req.params.id);
    res.status(204).end();
  }));

  app.put("/api/suites/:id/toggle-active", route(async (req, res) => {
    const row = await store.getSuite(req.params.id);
    if (!row) throw new HttpError(404, "Suite not found");
    await store.updateSuite(req.params.id, { active: row.active ? false : true, updated_at: nowIso() });
    res.json({ ...rowToSuite(await store.getSuite(req.params.id)), criteria_ids: await store.getSuiteCriterionIds(req.params.id) });
  }));

  app.post("/api/suites/:id/criteria", route(async (req, res) => {
    if (!(await store.getSuite(req.params.id))) throw new HttpError(404, "Suite not found");
    const criterionId = (req.body || {}).criterion_id;
    if (!criterionId) throw new HttpError(422, "criterion_id is required");
    await store.addSuiteCriterion(req.params.id, String(criterionId));
    await store.updateSuite(req.params.id, { updated_at: nowIso() });
    res.status(204).end();
  }));

  app.delete("/api/suites/:id/criteria/:criterionId", route(async (req, res) => {
    if (!(await store.getSuite(req.params.id))) throw new HttpError(404, "Suite not found");
    await store.removeSuiteCriterion(req.params.id, req.params.criterionId);
    await store.updateSuite(req.params.id, { updated_at: nowIso() });
    res.status(204).end();
  }));

  // ----- Suite workflows routes (standalone list; placeholder editor for now) -----

  app.get("/api/suite-workflows", route(async (req, res) => {
    res.json(await store.listSuiteWorkflows());
  }));

  app.post("/api/suite-workflows", route(async (req, res) => {
    const body = req.body || {};
    if (!body.name || !String(body.name).trim()) throw new HttpError(422, "name is required");
    const now = nowIso();
    const id = randomUUID();
    await store.insertSuiteWorkflow({
      id,
      name: String(body.name).trim(),
      description: body.description ?? null,
      steps: sanitizeWorkflowSteps(body.steps),
      created_at: now,
      updated_at: now,
    });
    res.status(201).json(await store.getSuiteWorkflow(id));
  }));

  app.get("/api/suite-workflows/:id", route(async (req, res) => {
    const row = await store.getSuiteWorkflow(req.params.id);
    if (!row) throw new HttpError(404, "Suite workflow not found");
    res.json(row);
  }));

  app.put("/api/suite-workflows/:id", route(async (req, res) => {
    const existing = await store.getSuiteWorkflow(req.params.id);
    if (!existing) throw new HttpError(404, "Suite workflow not found");
    const body = req.body || {};
    const patch = { updated_at: nowIso() };
    if ("name" in body) patch.name = String(body.name).trim();
    if ("description" in body) patch.description = body.description ?? null;
    if ("steps" in body) patch.steps = sanitizeWorkflowSteps(body.steps);
    await store.updateSuiteWorkflow(req.params.id, patch);
    res.json(await store.getSuiteWorkflow(req.params.id));
  }));

  app.delete("/api/suite-workflows/:id", route(async (req, res) => {
    if (!(await store.getSuiteWorkflow(req.params.id))) throw new HttpError(404, "Suite workflow not found");
    await store.deleteSuiteWorkflow(req.params.id);
    res.status(204).end();
  }));

  // ----- Suite workflow runs (one run = one workflow × one generation) -----

  app.get("/api/suite-workflows/:id/runs", route(async (req, res) => {
    if (!(await store.getSuiteWorkflow(req.params.id))) throw new HttpError(404, "Suite workflow not found");
    res.json(await store.listSuiteWorkflowRuns(req.params.id));
  }));

  // Create a generation from an inline payload (chat chain and/or copy). Shared by
  // POST /generations and the inline workflow-invoke endpoint. Returns the new
  // generation_id. Throws HttpError(422) if there's nothing to store.
  async function createGenerationFromInput(body) {
    const messages = Array.isArray(body.messages) ? body.messages.filter((m) => m && typeof m === "object") : [];

    // The copy to eval/rewrite: explicit response_content, else the last assistant turn.
    let responseContent = typeof body.response_content === "string" ? body.response_content : "";
    if (!responseContent) {
      const lastAssistant = [...messages].reverse().find((m) => m.role === "assistant");
      if (lastAssistant) responseContent = String(lastAssistant.content ?? "");
    }
    if (!responseContent.trim() && !messages.length) {
      throw new HttpError(422, "Provide `messages` (a chat chain) and/or `response_content`.");
    }

    const systemFromChain = messages.find((m) => m.role === "system");
    const userMessages = messages.filter((m) => m.role === "user");
    const assistantCount = messages.filter((m) => m.role === "assistant").length;
    const systemPrompt = typeof body.system_prompt === "string"
      ? body.system_prompt
      : (systemFromChain ? String(systemFromChain.content ?? "") : "");
    const lastUser = userMessages.length ? String(userMessages[userMessages.length - 1].content ?? "") : "";

    const hasProductJson = body.product_json !== undefined && body.product_json !== null;
    const id = randomUUID();
    await store.insertGeneration({
      generation_id: id,
      model: body.model ?? null,
      created_at: Math.floor(Date.now() / 1000),
      system_prompt: systemPrompt || null,
      last_user_message: lastUser || null,
      few_shot_count: assistantCount,
      response_content: responseContent || null,
      is_valid: 1,
      req_json: JSON.stringify({ messages }),
      resp_json: null,
      product_json: hasProductJson ? JSON.stringify(body.product_json) : null,
      dataset: body.dataset ?? "api-upload",
    });

    if (!hasProductJson && body.extract_product_data !== false) {
      const genRow = await store.getGeneration(id);
      try {
        await resolveProductDataForGeneration(store, genRow, messages, {
          allowAi: true, extractionTemplate: await loadTemplate("product_extraction"),
        });
      } catch (err) {
        console.error(`[generations] product extraction failed for ${id}: ${err.message || err}`);
      }
    }
    return id;
  }

  // Server-side workflow execution (the port of src/lib/runWorkflow.ts). Runs the
  // ordered chain in the background, persisting the run row after every stage so
  // pollers see progress. Used by the invoke endpoint; the browser-driven flow
  // (client executes + PUTs) is unaffected because those runs aren't invoked here.
  async function executeWorkflowRun(runId) {
    const WF_MAX_ITERS = { assess_only: 0, rewrite_once: 1, rewrite_until_pass: 3 };
    const isPass = (g) => String(g.score) === String(g.desired_score);
    const resolveModel = (override, suiteModel) => override ?? suiteModel ?? DEFAULT_MODEL;

    const run = await store.getSuiteWorkflowRun(runId);
    if (!run) return;
    const workflow = await store.getSuiteWorkflow(run.workflow_id);
    const genRow = await store.getGeneration(run.generation_id);
    if (!workflow || !genRow) {
      await store.updateSuiteWorkflowRun(runId, { status: "error", data: { ...run.data, stages: run.data?.stages ?? [] } });
      return;
    }

    const data = run.data || {};
    const steps = workflow.steps || [];
    const evalOverride = data.eval_model ?? null;
    const rewriteOverride = data.rewrite_model ?? null;
    const originalCopy = data.original_copy ?? (genRow.response_content || "");

    // Grounding + templates, resolved once for the whole run.
    let reqData = {};
    try { reqData = typeof genRow.req_json === "string" ? JSON.parse(genRow.req_json) : (genRow.req_json || {}); } catch { reqData = {}; }
    const requestMessages = reqData.messages || [];
    const { productData } = await resolveProductDataForGeneration(
      store, genRow, requestMessages, { allowAi: true, extractionTemplate: await loadTemplate("product_extraction") },
    );
    const systemPrompt = genRow.system_prompt || "";
    const productSection = groundingSection(genRow);
    const evalTemplate = await loadTemplate("eval_grading");
    const rewriteTemplate = await loadTemplate("rewrite_aggregate");

    const stages = [];
    let inputCopy = originalCopy;
    const persist = (status) =>
      store.updateSuiteWorkflowRun(runId, {
        status,
        data: { ...data, generation_id: run.generation_id, original_copy: originalCopy, stages },
      });

    const assess = async (content, stepCriteria, model) => {
      const grades = [];
      for (const crit of stepCriteria) {
        const r = await runSingleEval(content, productData, crit, evalTemplate, model);
        grades.push({
          criterion_id: r.criterion_id, criterion_name: r.criterion_name,
          score: r.score, desired_score: r.desired_score, rationale: r.rationale, evidence: r.evidence,
        });
      }
      return grades;
    };

    const rewriteOnce = async (base, feedback, suite, model) => {
      const orchestrationPrompt = (suite && typeof suite.rewrite_orchestration_prompt === "string" && suite.rewrite_orchestration_prompt.trim())
        ? suite.rewrite_orchestration_prompt : DEFAULT_REWRITE_ORCHESTRATION_PROMPT;
      let thesis = "";
      try {
        const orchPrompt = buildOrchestrationPrompt({ systemPrompt, productSection, originalContent: base, feedback }, orchestrationPrompt);
        thesis = (await chatText({ model, messages: [{ role: "user", content: orchPrompt }] })).trim();
      } catch (err) {
        console.error(`[workflow-run ${runId}] orchestration failed, continuing without thesis: ${err.message || err}`);
      }
      const rewritePrompt = buildRewritePrompt({ systemPrompt, productSection, originalContent: base, feedback, thesis }, rewriteTemplate);
      const improved = (await chatText({ model, messages: [{ role: "user", content: rewritePrompt }] })).trim();
      return { improved_content: improved, thesis };
    };

    try {
      for (let position = 0; position < steps.length; position++) {
        const step = steps[position];
        const suite = await store.getSuite(step.suite_id);
        const critIds = await store.getSuiteCriterionIds(step.suite_id);
        const stepCriteria = [];
        for (const cid of critIds) { const c = await store.getCriterion(cid); if (c) stepCriteria.push(rowToCriterion(c)); }

        const stageEval = resolveModel(evalOverride, suite?.eval_model);
        const stageRewrite = resolveModel(rewriteOverride, suite?.rewrite_model);
        const stage = {
          position, suite_id: step.suite_id, suite_name: suite?.name ?? step.suite_id, mode: step.mode,
          input_copy: inputCopy, initial_grades: [], iterations: [], output_copy: inputCopy,
          status: "running", eval_model: stageEval, rewrite_model: stageRewrite,
        };
        stages.push(stage);
        await persist("running");

        // 1) Assess the incoming copy.
        stage.initial_grades = await assess(inputCopy, stepCriteria, stageEval);
        await persist("running");

        // 2) Rewrite per mode, feeding each rewrite forward and re-grading.
        const maxIters = WF_MAX_ITERS[step.mode] ?? 0;
        let base = inputCopy;
        let feedback = stage.initial_grades;
        for (let i = 0; i < maxIters; i++) {
          const { improved_content, thesis } = await rewriteOnce(base, feedback, suite, stageRewrite);
          const grades = await assess(improved_content, stepCriteria, stageEval);
          stage.iterations.push({ content: improved_content, thesis, grades, created_at: new Date().toISOString() });
          stage.output_copy = improved_content;
          await persist("running");
          base = improved_content;
          feedback = grades;
          if (step.mode === "rewrite_until_pass" && grades.length > 0 && grades.every(isPass)) break;
        }

        stage.status = "done";
        inputCopy = stage.output_copy;
        await persist("running");
      }
      await persist("done");
    } catch (err) {
      console.error(`[workflow-run ${runId}] failed: ${err.message || err}`);
      if (stages.length) { stages[stages.length - 1].status = "error"; stages[stages.length - 1].error = String(err.message || err); }
      await persist("error").catch(() => {});
    }
  }

  app.post("/api/suite-workflows/:id/runs", route(async (req, res) => {
    if (!(await store.getSuiteWorkflow(req.params.id))) throw new HttpError(404, "Suite workflow not found");
    const body = req.body || {};
    if (!body.generation_id) throw new HttpError(422, "generation_id is required");
    const id = randomUUID();
    await store.createSuiteWorkflowRun({
      id,
      workflow_id: req.params.id,
      generation_id: String(body.generation_id),
      status: body.status ?? "running",
      data: body.data ?? {},
    });
    res.status(201).json(await store.getSuiteWorkflowRun(id));
  }));

  // Invoke: create a run AND execute the whole pipeline server-side (background),
  // then poll GET /api/suite-workflow-runs/:runId until status is done/error.
  // Body: { generation_id, eval_model?, rewrite_model? } (models are run-level
  // overrides; omit to use each step-suite's configured model). Returns 202 + run.
  app.post("/api/suite-workflows/:id/runs/invoke", route(async (req, res) => {
    const workflow = await store.getSuiteWorkflow(req.params.id);
    if (!workflow) throw new HttpError(404, "Suite workflow not found");
    const body = req.body || {};
    if (!body.generation_id) throw new HttpError(422, "generation_id is required");
    if (!(workflow.steps || []).length) throw new HttpError(422, "Workflow has no steps");
    const genRow = await store.getGeneration(String(body.generation_id));
    if (!genRow) throw new HttpError(404, "Generation not found");

    const id = randomUUID();
    await store.createSuiteWorkflowRun({
      id,
      workflow_id: req.params.id,
      generation_id: String(body.generation_id),
      status: "running",
      data: {
        generation_id: String(body.generation_id),
        original_copy: genRow.response_content || "",
        stages: [],
        eval_model: pickModel(body.eval_model),      // validated override or null
        rewrite_model: pickModel(body.rewrite_model),
        executor: "server",
      },
    });
    // Fire-and-forget: the run persists progress to its row as it goes.
    executeWorkflowRun(id).catch((err) => console.error(`[workflow-run ${id}] crashed: ${err.message || err}`));
    res.status(202).json(await store.getSuiteWorkflowRun(id));
  }));

  // Convenience: create a generation from inline copy AND run the workflow on it in
  // one call (does the /generations upload behind the scenes, then invokes). Body is
  // the /generations payload { messages?, response_content?, system_prompt?,
  // product_json?, model?, dataset?, extract_product_data? } plus optional run-level
  // { eval_model?, rewrite_model? }. Returns 202 + the run (run.generation_id is the
  // generation that was created). Poll GET /suite-workflow-runs/:runId as usual.
  app.post("/api/suite-workflows/:id/runs/invoke-inline", route(async (req, res) => {
    const workflow = await store.getSuiteWorkflow(req.params.id);
    if (!workflow) throw new HttpError(404, "Suite workflow not found");
    if (!(workflow.steps || []).length) throw new HttpError(422, "Workflow has no steps");
    const body = req.body || {};

    const generationId = await createGenerationFromInput(body); // throws 422 if no copy/chain
    const genRow = await store.getGeneration(generationId);

    const runId = randomUUID();
    await store.createSuiteWorkflowRun({
      id: runId,
      workflow_id: req.params.id,
      generation_id: generationId,
      status: "running",
      data: {
        generation_id: generationId,
        original_copy: genRow.response_content || "",
        stages: [],
        eval_model: pickModel(body.eval_model),
        rewrite_model: pickModel(body.rewrite_model),
        executor: "server",
      },
    });
    executeWorkflowRun(runId).catch((err) => console.error(`[workflow-run ${runId}] crashed: ${err.message || err}`));
    res.status(202).json(await store.getSuiteWorkflowRun(runId));
  }));

  app.get("/api/suite-workflow-runs/:runId", route(async (req, res) => {
    const run = await store.getSuiteWorkflowRun(req.params.runId);
    if (!run) throw new HttpError(404, "Run not found");
    res.json(run);
  }));

  app.put("/api/suite-workflow-runs/:runId", route(async (req, res) => {
    if (!(await store.getSuiteWorkflowRun(req.params.runId))) throw new HttpError(404, "Run not found");
    const body = req.body || {};
    await store.updateSuiteWorkflowRun(req.params.runId, { status: body.status, data: body.data });
    res.json(await store.getSuiteWorkflowRun(req.params.runId));
  }));

  app.delete("/api/suite-workflow-runs/:runId", route(async (req, res) => {
    if (!(await store.getSuiteWorkflowRun(req.params.runId))) throw new HttpError(404, "Run not found");
    await store.deleteSuiteWorkflowRun(req.params.runId);
    res.status(204).end();
  }));

  // ----- Generations routes (literal routes must register before /:id) -----

  // Create ("upload") a generation from a chat chain so it can be run through a
  // suite workflow or evaluated directly. Body:
  //   { messages?: [{role,content}], response_content?, system_prompt?,
  //     product_json?, model?, dataset?, extract_product_data? (default true) }
  // At least one of `messages` or `response_content` is required. system_prompt and
  // last_user_message are derived from `messages` when not given; product_json is
  // extracted from `messages` (heuristic + AI) unless supplied or disabled. Returns
  // the created generation (use its generation_id with the workflow invoke endpoint).
  app.post("/api/generations", route(async (req, res) => {
    const id = await createGenerationFromInput(req.body || {});
    res.status(201).json(rowToGeneration(await store.getGeneration(id), true));
  }));

  app.get("/api/generations", route(async (req, res) => {
    const search = req.query.search || "";
    const model = req.query.model || "";
    const dataset = req.query.dataset || "";
    const limit = Number(req.query.limit ?? 100);
    const offset = Number(req.query.offset ?? 0);
    const validProductData = req.query.valid_product_data === "1" || req.query.valid_product_data === "true";
    const genTypes = req.query.gen_types
      ? String(req.query.gen_types).split(",").map((s) => s.trim()).filter(Boolean)
      : undefined;
    const minLen = req.query.min_len != null && req.query.min_len !== "" ? Number(req.query.min_len) : null;
    const maxLen = req.query.max_len != null && req.query.max_len !== "" ? Number(req.query.max_len) : null;
    const { total, rows } = await store.listGenerations({ search, model, dataset, limit, offset, validProductData, genTypes, minLen, maxLen });
    res.json({ total, limit, offset, items: rows.map((r) => rowToGeneration(r)) });
  }));

  // Response-length percentiles (chars) over the given types (default
  // Description+Title), optionally scoped to a dataset — seeds the length filter bands.
  app.get("/api/generations/length-percentiles", route(async (req, res) => {
    const dataset = req.query.dataset || "";
    const genTypes = req.query.gen_types
      ? String(req.query.gen_types).split(",").map((s) => s.trim()).filter(Boolean)
      : undefined;
    res.json(await store.getLengthPercentiles({ dataset, genTypes }));
  }));

  app.get("/api/generations/counts-by-type", route(async (req, res) => {
    const rows = await store.countGenerationsByType();
    res.json(Object.fromEntries(rows.map((r) => [r.type, r.cnt])));
  }));

  app.get("/api/generations/models", route(async (req, res) => {
    res.json(await store.listGenerationModels());
  }));

  app.get("/api/generations/datasets", route(async (req, res) => {
    res.json(await store.listGenerationDatasets());
  }));

  app.get("/api/generations/:id", route(async (req, res) => {
    const row = await store.getGeneration(req.params.id);
    if (!row) throw new HttpError(404, "Generation not found");
    res.json(rowToGeneration(row, true));
  }));

  app.delete("/api/generations/:id", route(async (req, res) => {
    if (!(await store.getGeneration(req.params.id))) throw new HttpError(404, "Generation not found");
    await store.deleteGeneration(req.params.id);
    res.status(204).end();
  }));

  // ----- Type-mapping routes -----

  app.get("/api/mapping", route(async (req, res) => res.json(buildMapping(await store.getRawMapping()))));

  app.put("/api/mapping", route(async (req, res) => {
    const body = req.body || {};
    const pairs = [];
    for (const [ct, genTypes] of Object.entries(body)) {
      for (const gt of genTypes) pairs.push([ct, gt]);
    }
    await store.replaceMapping(pairs);
    res.json(buildMapping(await store.getRawMapping()));
  }));

  app.get("/api/mapping/generation-types", route((req, res) => res.json(GENERATION_TYPES)));

  // ----- Eval routes -----

  app.get("/api/eval/criteria", route(async (req, res) => {
    const rows = await store.getActiveEvalCriteria();
    res.json(rows.map((r) => ({
      criteriaId: r.id,
      criteriaCode: r.id,
      criteriaName: r.criteria_name,
      criteriaDefinition: r.criteria_definition || "",
    })));
  }));

  // Available LLM deployments for eval/rewrite model selection (+ the default).
  app.get("/api/models", route(async (_req, res) => {
    res.json({ default: DEFAULT_MODEL, models: AVAILABLE_MODELS });
  }));

  app.post("/api/eval/run", route(async (req, res) => {
    const body = req.body || {};
    const criterionId = body.criterion_id !== null && body.criterion_id !== undefined ? String(body.criterion_id) : null;
    const criterionName = body.criterion_name || null;
    if (!criterionId && !criterionName) {
      throw new HttpError(422, "Either criterion_id or criterion_name is required");
    }

    const genRow = await store.getGeneration(body.generation_id);
    if (!genRow) throw new HttpError(404, "Generation not found");

    const copyText = genRow.response_content || "";
    let reqData = {};
    try {
      reqData = typeof genRow.req_json === "string" ? JSON.parse(genRow.req_json) : (genRow.req_json || {});
    } catch {
      reqData = {};
    }
    const requestMessages = reqData.messages || [];

    const critRow = criterionId
      ? await store.getCriterion(criterionId)
      : await store.findCriterionByName(criterionName);
    if (!critRow) {
      throw new HttpError(404, `Criterion not found: id=${JSON.stringify(criterionId)}, name=${JSON.stringify(criterionName)}`);
    }
    const criterion = rowToCriterion(critRow);

    // Resolve grounding product data (stored column → heuristic → AI fallback,
    // persisting the result so future runs and the filter can use it).
    const { productData, extractionWarning } = await resolveProductDataForGeneration(
      store, genRow, requestMessages, { allowAi: true, extractionTemplate: await loadTemplate("product_extraction") },
    );

    // Model: explicit request override → suite's configured eval model → default.
    const evalSuite = body.suite_id ? await store.getSuite(body.suite_id) : null;
    const evalModel = pickModel(body.model, evalSuite?.eval_model) || llmModel();

    let result;
    try {
      result = await runSingleEval(copyText, productData, criterion, await loadTemplate("eval_grading"), evalModel);
    } catch (err) {
      throw new HttpError(500, `Eval failed: ${err.message || err}`);
    }

    const now = nowIso();
    const resultId = randomUUID();
    await store.insertEvalResult({
      id: resultId,
      generation_id: body.generation_id,
      criterion_id: result.criterion_id,
      criterion_name: result.criterion_name,
      desired_score: result.desired_score ?? "",
      score: result.score,
      rationale: result.rationale,
      evidence: JSON.stringify(result.evidence),
      product_name: result.product_name ?? "",
      run_at: now,
    });

    let htmlPath = null;
    try {
      htmlPath = saveHtmlResult(resultsDir, { ...result, generation_id: body.generation_id, run_at: now });
    } catch (err) {
      console.error(`Warning: could not save HTML report: ${err.message || err}`);
    }

    res.json({
      result_id: resultId,
      generation_id: body.generation_id,
      criterion_id: result.criterion_id,
      criterion_name: result.criterion_name,
      desired_score: result.desired_score ?? "",
      score: result.score,
      rationale: result.rationale,
      evidence: result.evidence,
      product_name: result.product_name ?? "",
      run_at: now,
      html_report: htmlPath,
      extraction_warning: extractionWarning,
    });
  }));

  // Re-grade arbitrary copy (e.g. AI post-edited text) against a criterion,
  // reusing the original generation's request messages so the evaluator still
  // sees the product data (keywords, approved claims) needed for grounding /
  // hallucination checks. Not persisted — it's a what-if vs the stored eval.
  app.post("/api/eval/regrade", route(async (req, res) => {
    const body = req.body || {};
    const content = typeof body.content === "string" ? body.content : "";
    if (!content.trim()) throw new HttpError(422, "content is required");
    const criterionId = body.criterion_id !== null && body.criterion_id !== undefined ? String(body.criterion_id) : null;
    const criterionName = body.criterion_name || null;
    if (!criterionId && !criterionName) {
      throw new HttpError(422, "Either criterion_id or criterion_name is required");
    }

    const genRow = await store.getGeneration(body.generation_id);
    if (!genRow) throw new HttpError(404, "Generation not found");

    // Reconstruct the original request chain so product data flows into the eval.
    let reqData = {};
    try {
      reqData = typeof genRow.req_json === "string" ? JSON.parse(genRow.req_json) : (genRow.req_json || {});
    } catch {
      reqData = {};
    }
    const requestMessages = reqData.messages || [];

    const critRow = criterionId
      ? await store.getCriterion(criterionId)
      : await store.findCriterionByName(criterionName);
    if (!critRow) {
      throw new HttpError(404, `Criterion not found: id=${JSON.stringify(criterionId)}, name=${JSON.stringify(criterionName)}`);
    }
    const criterion = rowToCriterion(critRow);

    const { productData, extractionWarning } = await resolveProductDataForGeneration(
      store, genRow, requestMessages, { allowAi: true, extractionTemplate: await loadTemplate("product_extraction") },
    );

    // Model: explicit request override → suite's configured eval model → default.
    const regradeSuite = body.suite_id ? await store.getSuite(body.suite_id) : null;
    const regradeModel = pickModel(body.model, regradeSuite?.eval_model) || llmModel();

    let result;
    try {
      result = await runSingleEval(content, productData, criterion, await loadTemplate("eval_grading"), regradeModel);
    } catch (err) {
      throw new HttpError(500, `Re-grade failed: ${err.message || err}`);
    }

    res.json({
      generation_id: body.generation_id,
      criterion_id: result.criterion_id,
      criterion_name: result.criterion_name,
      desired_score: result.desired_score ?? "",
      score: result.score,
      rationale: result.rationale,
      evidence: result.evidence,
      product_name: result.product_name ?? "",
      extraction_warning: extractionWarning,
    });
  }));

  app.get("/api/eval/results/:generationId", route(async (req, res) => {
    const rows = await store.getEvalResults(req.params.generationId);
    res.json(rows.map((r) => {
      const d = { ...r };
      try {
        d.evidence = typeof d.evidence === "string" ? JSON.parse(d.evidence || "[]") : (d.evidence || []);
      } catch {
        d.evidence = [];
      }
      return d;
    }));
  }));

  // ----- Refinement chains (saved post-edit / re-grade history) -----

  app.get("/api/eval/chain", route(async (req, res) => {
    const { criterion_id, generation_id } = req.query;
    if (!criterion_id || !generation_id) throw new HttpError(422, "criterion_id and generation_id are required");
    res.json(await store.getChain(String(criterion_id), String(generation_id))); // null when none saved
  }));

  app.put("/api/eval/chain", route(async (req, res) => {
    const body = req.body || {};
    if (!body.criterion_id || !body.generation_id || !body.data) {
      throw new HttpError(422, "criterion_id, generation_id and data are required");
    }
    await store.saveChain(String(body.criterion_id), String(body.generation_id), body.criterion_name ?? null, body.data);
    res.json(await store.getChain(String(body.criterion_id), String(body.generation_id)));
  }));

  app.delete("/api/eval/chain", route(async (req, res) => {
    const { criterion_id, generation_id } = req.query;
    if (!criterion_id || !generation_id) throw new HttpError(422, "criterion_id and generation_id are required");
    await store.deleteChain(String(criterion_id), String(generation_id));
    res.status(204).end();
  }));

  // Which generations have a saved chain for a criterion (for the list indicator).
  app.get("/api/eval/chains", route(async (req, res) => {
    const { criterion_id } = req.query;
    if (!criterion_id) throw new HttpError(422, "criterion_id is required");
    res.json(await store.listChainGenerationIds(String(criterion_id)));
  }));

  // ----- Suite rewrite chains (aggregate-rewrite iterations per suite+generation) -----

  // All rewrite chains for a suite, as { generation_id, data }[] (panel loads once).
  app.get("/api/suite/rewrite-chains", route(async (req, res) => {
    const { suite_id } = req.query;
    if (!suite_id) throw new HttpError(422, "suite_id is required");
    res.json(await store.listSuiteRewriteChains(String(suite_id)));
  }));

  app.put("/api/suite/rewrite-chain", route(async (req, res) => {
    const body = req.body || {};
    if (!body.suite_id || !body.generation_id || !body.data) {
      throw new HttpError(422, "suite_id, generation_id and data are required");
    }
    await store.saveSuiteRewriteChain(String(body.suite_id), String(body.generation_id), body.data);
    res.json(await store.getSuiteRewriteChain(String(body.suite_id), String(body.generation_id)));
  }));

  app.delete("/api/suite/rewrite-chain", route(async (req, res) => {
    const { suite_id, generation_id } = req.query;
    if (!suite_id || !generation_id) throw new HttpError(422, "suite_id and generation_id are required");
    await store.deleteSuiteRewriteChain(String(suite_id), String(generation_id));
    res.status(204).end();
  }));

  // ----- Post-edit route -----

  app.post("/api/post-edit", route(async (req, res) => {
    const body = req.body || {};
    const genRow = await store.getGeneration(body.generation_id);
    if (!genRow) throw new HttpError(404, "Generation not found");

    const systemPrompt = genRow.system_prompt || "";
    // Ground the rewrite in the persisted extracted product record when present,
    // else the generation's raw last user message.
    const productSection = groundingSection(genRow);
    // The copy to improve: the supplied content (e.g. a prior post-edit, for
    // iterative refinement) or the generation's original output. The system
    // prompt + product data above always come from the generation so each
    // round stays grounded.
    const originalContent = (typeof body.content === "string" && body.content.trim())
      ? body.content
      : (genRow.response_content || "");

    const postEditPrompt = buildPostEditPrompt({
      systemPrompt,
      productSection,
      originalContent,
      criterion_name: body.criterion_name,
      score: body.score,
      desired_score: body.desired_score,
      rationale: body.rationale,
      evidence: body.evidence,
    }, await loadTemplate("post_edit"));

    let improved;
    try {
      improved = await chatText({
        model: pickModel(body.model) || llmModel(),
        messages: [{ role: "user", content: postEditPrompt }],
      });
    } catch (err) {
      throw new HttpError(500, `Post-edit failed: ${err.message || err}`);
    }

    res.json({ improved_content: improved.trim() });
  }));

  // ----- Rewrite route (aggregate feedback across all evaluated criteria) -----

  app.post("/api/rewrite", route(async (req, res) => {
    const body = req.body || {};
    const genRow = await store.getGeneration(body.generation_id);
    if (!genRow) throw new HttpError(404, "Generation not found");

    const systemPrompt = genRow.system_prompt || "";
    const productSection = groundingSection(genRow);
    const originalContent = (typeof body.content === "string" && body.content.trim())
      ? body.content
      : (genRow.response_content || "");

    // Model: explicit request override → suite's configured rewrite model → default.
    const rewriteSuite = body.suite_id ? await store.getSuite(body.suite_id) : null;
    const rewriteModel = pickModel(body.model, rewriteSuite?.rewrite_model) || llmModel();

    // Orchestration step: turn the full feedback + current copy into a single
    // coherence thesis before drafting. Uses the suite's prompt (or the default).
    const orchestrationPrompt = await resolveOrchestrationPrompt(store, body.suite_id);
    let thesis = "";
    try {
      const orchPrompt = buildOrchestrationPrompt({
        systemPrompt, productSection, originalContent, feedback: body.feedback,
      }, orchestrationPrompt);
      thesis = (await chatText({
        model: rewriteModel,
        messages: [{ role: "user", content: orchPrompt }],
      })).trim();
    } catch (err) {
      // Don't fail the whole rewrite if orchestration fails — fall back to a
      // thesis-less rewrite so the feature degrades gracefully.
      console.error(`[rewrite] orchestration step failed, continuing without thesis: ${err.message || err}`);
    }

    const rewritePrompt = buildRewritePrompt({
      systemPrompt,
      productSection,
      originalContent,
      feedback: body.feedback,
      thesis,
    }, await loadTemplate("rewrite_aggregate"));

    let improved;
    try {
      improved = await chatText({
        model: rewriteModel,
        messages: [{ role: "user", content: rewritePrompt }],
      });
    } catch (err) {
      throw new HttpError(500, `Rewrite failed: ${err.message || err}`);
    }

    res.json({ improved_content: improved.trim(), thesis });
  }));

  // The built-in default rewrite-orchestration prompt + its available parameters,
  // so the suite editor can prefill (when a suite has none) and show the legend.
  app.get("/api/rewrite-orchestration/default", route(async (req, res) => {
    res.json({
      template: DEFAULT_REWRITE_ORCHESTRATION_PROMPT,
      placeholders: REWRITE_ORCHESTRATION_PLACEHOLDERS,
    });
  }));

  // Reconstruct (without calling the LLM) the exact chat chain that was/would be
  // sent for an eval or a post-edit, so the UI can show it in a "view chat" modal.
  app.post("/api/eval/messages", route(async (req, res) => {
    const body = req.body || {};
    const mode = body.mode === "postedit" ? "postedit" : body.mode === "rewrite" ? "rewrite" : "eval";

    const genRow = await store.getGeneration(body.generation_id);
    if (!genRow) throw new HttpError(404, "Generation not found");

    if (mode === "rewrite") {
      const systemPrompt = genRow.system_prompt || "";
      const productSection = groundingSection(genRow);
      const originalContent = (typeof body.content === "string" && body.content.trim())
        ? body.content
        : (genRow.response_content || "");
      // Reconstruct the full two-step chain: the orchestration prompt (resolved
      // from the suite or default), the thesis it produced (stored per iteration,
      // passed back here), then the rewrite prompt that develops that thesis.
      const orchestrationPrompt = await resolveOrchestrationPrompt(store, body.suite_id);
      const orchPrompt = buildOrchestrationPrompt({
        systemPrompt, productSection, originalContent, feedback: body.feedback,
      }, orchestrationPrompt);
      const thesis = typeof body.thesis === "string" ? body.thesis : "";
      const rewritePrompt = buildRewritePrompt({
        systemPrompt, productSection, originalContent, feedback: body.feedback, thesis,
      }, await loadTemplate("rewrite_aggregate"));
      res.json({
        mode,
        messages: [
          { role: "user", content: orchPrompt },
          { role: "assistant", content: thesis || "(the orchestration thesis is generated at run time)" },
          { role: "user", content: rewritePrompt },
        ],
      });
      return;
    }

    if (mode === "postedit") {
      const systemPrompt = genRow.system_prompt || "";
      const productSection = groundingSection(genRow);
      const originalContent = (typeof body.content === "string" && body.content.trim())
        ? body.content
        : (genRow.response_content || "");
      const prompt = buildPostEditPrompt({
        systemPrompt,
        productSection,
        originalContent,
        criterion_name: body.criterion_name,
        score: body.score,
        desired_score: body.desired_score,
        rationale: body.rationale,
        evidence: body.evidence,
      }, await loadTemplate("post_edit"));
      res.json({ mode, messages: [{ role: "user", content: prompt }] });
      return;
    }

    // mode === "eval"
    const criterionId = body.criterion_id !== null && body.criterion_id !== undefined ? String(body.criterion_id) : null;
    const criterionName = body.criterion_name || null;
    if (!criterionId && !criterionName) {
      throw new HttpError(422, "Either criterion_id or criterion_name is required");
    }

    let reqData = {};
    try {
      reqData = typeof genRow.req_json === "string" ? JSON.parse(genRow.req_json) : (genRow.req_json || {});
    } catch {
      reqData = {};
    }
    const requestMessages = reqData.messages || [];

    const critRow = criterionId
      ? await store.getCriterion(criterionId)
      : await store.findCriterionByName(criterionName);
    if (!critRow) {
      throw new HttpError(404, `Criterion not found: id=${JSON.stringify(criterionId)}, name=${JSON.stringify(criterionName)}`);
    }
    const criterion = rowToCriterion(critRow);

    const content = (typeof body.content === "string" && body.content.trim())
      ? body.content
      : (genRow.response_content || "");

    // Preview only: resolve from the stored column or heuristic — never trigger
    // an AI extraction or persist as a side-effect of opening the modal.
    const { productData } = await resolveProductDataForGeneration(
      store, genRow, requestMessages, { allowAi: false, persist: false },
    );

    res.json({ mode, messages: buildEvalMessages(content, productData, criterion, await loadTemplate("eval_grading")) });
  }));

  // ----- Prompt template routes (editable eval / rewrite / extraction prompts) -----

  app.get("/api/prompts", route(async (req, res) => {
    const rows = await store.listPromptTemplates();
    res.json(rows.map(rowToPromptTemplate));
  }));

  app.get("/api/prompts/:id", route(async (req, res) => {
    const row = await store.getPromptTemplate(req.params.id);
    if (!row) throw new HttpError(404, "Prompt template not found");
    res.json(rowToPromptTemplate(row));
  }));

  app.put("/api/prompts/:id", route(async (req, res) => {
    const existing = await store.getPromptTemplate(req.params.id);
    if (!existing) throw new HttpError(404, "Prompt template not found");
    const body = req.body || {};
    const merged = { ...rowToPromptTemplate(existing) };
    for (const col of PROMPT_TEMPLATE_COLUMNS) { if (col in body) merged[col] = body[col]; }
    // Lenient: never rejects for missing placeholders — the UI warns instead.
    await store.updatePromptTemplate(req.params.id, {
      name: merged.name,
      description: merged.description ?? null,
      template: merged.template ?? "",
      updated_at: nowIso(),
    });
    res.json(rowToPromptTemplate(await store.getPromptTemplate(req.params.id)));
  }));

  // Reset a prompt back to its built-in default (from DEFAULT_PROMPTS).
  app.post("/api/prompts/:id/reset", route(async (req, res) => {
    const existing = await store.getPromptTemplate(req.params.id);
    if (!existing) throw new HttpError(404, "Prompt template not found");
    const def = DEFAULT_PROMPTS.find((p) => p.id === req.params.id);
    if (!def) throw new HttpError(404, `No built-in default for '${req.params.id}'`);
    await store.updatePromptTemplate(req.params.id, {
      name: def.name,
      description: def.description ?? null,
      category: def.category ?? null,
      template: def.template,
      placeholders: JSON.stringify(def.placeholders ?? []),
      updated_at: nowIso(),
    });
    res.json(rowToPromptTemplate(await store.getPromptTemplate(req.params.id)));
  }));

  // ----- Data import/export -----

  const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 1024 * 1024 * 1024 } });

  app.get("/api/admin/export", route(async (req, res) => {
    const kind = KINDS.includes(req.query.kind) ? req.query.kind : "all";
    const buffer = await exportZipBuffer(store, kind);
    const stamp = new Date().toISOString().slice(0, 10);
    const label = kind === "all" ? "data" : kind;
    res.set({
      "Content-Type": "application/zip",
      "Content-Disposition": `attachment; filename="evalmvp-${label}-${stamp}.zip"`,
    });
    res.send(buffer);
  }));

  app.post("/api/admin/import", upload.single("file"), route(async (req, res) => {
    if (!req.file) throw new HttpError(422, "No file uploaded (multipart field name: 'file')");
    if (store.backend !== "sqlite") {
      throw new HttpError(400,
        "Import is only available with the SQLite backend. The SQL Server tables are loaded via db/setup_temp_tables.py.");
    }
    // The Data page sends a 'kind' field (criteria|generations) so we can reject
    // a file dropped in the wrong slot. Absent/other → no slot validation.
    const expectKind = ["criteria", "generations"].includes(req.body.kind) ? req.body.kind : null;
    let result;
    try {
      result = await importZipBuffer(store, req.file.buffer, expectKind);
    } catch (err) {
      throw new HttpError(400, `${err.message || err}`);
    }
    res.json(result);
  }));

  // ----- Static frontend (packaged app) -----

  if (staticDir) {
    app.use(express.static(staticDir));
    // SPA fallback: any non-API GET serves index.html for client-side routing
    app.get("*", (req, res, next) => {
      if (req.path.startsWith("/api/")) return next();
      res.sendFile(path.join(staticDir, "index.html"));
    });
  }

  return app;
}

// ---------------------------------------------------------------------------
// HTML report
// ---------------------------------------------------------------------------

function escapeHtml(s) {
  return String(s)
    .replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;").replaceAll("'", "&#x27;");
}

function saveHtmlResult(resultsDir, result) {
  fs.mkdirSync(resultsDir, { recursive: true });
  const timestamp = new Date().toISOString().replace(/[-:T]/g, "").slice(0, 15).replace(".", "_");
  const outPath = path.join(resultsDir, `eval_${result.generation_id.slice(0, 8)}_${timestamp}.html`);

  const e = escapeHtml;
  const row = result;
  const evidenceHtml = (row.evidence || []).filter(Boolean)
    .map((q) => `&ldquo;${e(q)}&rdquo;`).join(" &nbsp;|&nbsp; ");
  const scoreLabel = row.desired_score
    ? `${e(String(row.score))} / ${e(String(row.desired_score))}`
    : e(String(row.score ?? ""));
  let passFail = "";
  if (row.desired_score) passFail = String(row.score) === String(row.desired_score) ? "pass" : "fail";

  const htmlDoc = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <title>Eval — ${e(row.product_name || "")} — ${e(row.criterion_name || "")}</title>
  <style>
    body { font-family: system-ui, sans-serif; max-width: 800px; margin: 40px auto; padding: 0 16px; color: #1a1a2e; }
    h1 { font-size: 1.4rem; margin-bottom: 4px; }
    .meta { color: #666; font-size: 0.8rem; margin-bottom: 24px; }
    .label { font-size: 0.7rem; font-weight: 700; letter-spacing: .08em; text-transform: uppercase; color: #888; margin-bottom: 6px; }
    .box { background: #f8f9fb; border-left: 3px solid #6c63ff; border-radius: 4px; padding: 14px 16px; font-size: 0.9rem; line-height: 1.6; white-space: pre-wrap; margin-bottom: 20px; }
    .score { display: inline-block; font-weight: 700; padding: 4px 12px; border-radius: 4px; font-size: 1.1rem; margin-bottom: 20px; }
    .pass { background: #d4edda; color: #155724; }
    .fail { background: #f8d7da; color: #721c24; }
    .neutral { background: #e2e3e5; color: #383d41; }
    .evidence { color: #555; font-style: italic; font-size: 0.85rem; }
  </style>
</head>
<body>
  <h1>${e(row.product_name || "Unknown product")}</h1>
  <div class="meta">
    Generation ${e(result.generation_id)} &nbsp;|&nbsp;
    Criterion: ${e(row.criterion_name || "")} &nbsp;|&nbsp;
    Run at ${e(row.run_at || "")}
  </div>
  <div class="label">Score</div>
  <div class="score ${passFail || "neutral"}">${scoreLabel}</div>
  <div class="label">Rationale</div>
  <div class="box">${e(row.rationale || "")}</div>
  <div class="label">Evidence</div>
  <p class="evidence">${evidenceHtml || "—"}</p>
</body>
</html>`;

  fs.writeFileSync(outPath, htmlDoc, "utf-8");
  return outPath;
}

// ---------------------------------------------------------------------------
// Server lifecycle
// ---------------------------------------------------------------------------

export function startServer({
  store, port = 0, host = "127.0.0.1", staticDir = null, resultsDir,
  retries = 5, retryDelayMs = 1000,
}) {
  const app = createApp({ store, resultsDir, staticDir });
  return new Promise((resolve, reject) => {
    let attempt = 0;
    const tryListen = () => {
      const server = app.listen(port, host);
      server.once("listening", () => {
        resolve({
          port: server.address().port,
          close: async () => {
            await new Promise((r) => server.close(r));
            await store.close();
          },
        });
      });
      // A just-killed previous server can still hold the port for a moment.
      // Retry a few times before giving up so a quick restart doesn't fail.
      server.once("error", (err) => {
        if (err.code === "EADDRINUSE" && port !== 0 && attempt < retries) {
          attempt += 1;
          console.error(`[api] port ${port} busy, retrying in ${retryDelayMs}ms (${attempt}/${retries})…`);
          setTimeout(tryListen, retryDelayMs);
        } else {
          reject(err);
        }
      });
    };
    tryListen();
  });
}
