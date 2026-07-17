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
  runSingleEval, buildEvalMessages, aiClient, llmModel,
  heuristicProductFields, aiExtractProductFields, productDataFromFields, formatProductSection,
} from "./eval-runner.js";
import { exportZipBuffer, importZipBuffer, KINDS } from "./data-transfer.js";
import { renderTemplate, defaultTemplate, DEFAULT_PROMPTS } from "./prompt-templates.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const nowIso = () => new Date().toISOString();

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

const SUITE_COLUMNS = ["name", "description", "active"];
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

// The exact prompt sent to the LLM to rewrite copy using the AGGREGATED feedback
// from every criterion the generation was evaluated against. Passing criteria are
// flagged as strengths to preserve; failing ones as the changes to make.
function buildRewritePrompt({ systemPrompt, productSection, originalContent, feedback }, template) {
  const items = Array.isArray(feedback) ? feedback : [];
  const feedbackBlocks = items.map((f, i) => {
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

  return renderTemplate(template ?? defaultTemplate("rewrite_aggregate"), {
    system_prompt: systemPrompt,
    product_data: productSection,
    original_copy: originalContent,
    criteria_count: `${items.length} criteri${items.length === 1 ? "on" : "a"}`,
    feedback: feedbackBlocks,
  });
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

  // ----- Generations routes (literal routes must register before /:id) -----

  app.get("/api/generations", route(async (req, res) => {
    const search = req.query.search || "";
    const model = req.query.model || "";
    const limit = Number(req.query.limit ?? 100);
    const offset = Number(req.query.offset ?? 0);
    const validProductData = req.query.valid_product_data === "1" || req.query.valid_product_data === "true";
    const genTypes = req.query.gen_types
      ? String(req.query.gen_types).split(",").map((s) => s.trim()).filter(Boolean)
      : undefined;
    const { total, rows } = await store.listGenerations({ search, model, limit, offset, validProductData, genTypes });
    res.json({ total, limit, offset, items: rows.map((r) => rowToGeneration(r)) });
  }));

  app.get("/api/generations/counts-by-type", route(async (req, res) => {
    const rows = await store.countGenerationsByType();
    res.json(Object.fromEntries(rows.map((r) => [r.type, r.cnt])));
  }));

  app.get("/api/generations/models", route(async (req, res) => {
    res.json(await store.listGenerationModels());
  }));

  app.get("/api/generations/:id", route(async (req, res) => {
    const row = await store.getGeneration(req.params.id);
    if (!row) throw new HttpError(404, "Generation not found");
    res.json(rowToGeneration(row, true));
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

    let result;
    try {
      result = await runSingleEval(copyText, productData, criterion, await loadTemplate("eval_grading"));
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

    let result;
    try {
      result = await runSingleEval(content, productData, criterion, await loadTemplate("eval_grading"));
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
      const response = await aiClient().chat.completions.create({
        model: llmModel(),
        messages: [{ role: "user", content: postEditPrompt }],
      });
      improved = response.choices[0]?.message?.content || "";
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

    const rewritePrompt = buildRewritePrompt({
      systemPrompt,
      productSection,
      originalContent,
      feedback: body.feedback,
    }, await loadTemplate("rewrite_aggregate"));

    let improved;
    try {
      const response = await aiClient().chat.completions.create({
        model: llmModel(),
        messages: [{ role: "user", content: rewritePrompt }],
      });
      improved = response.choices[0]?.message?.content || "";
    } catch (err) {
      throw new HttpError(500, `Rewrite failed: ${err.message || err}`);
    }

    res.json({ improved_content: improved.trim() });
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
      const prompt = buildRewritePrompt({
        systemPrompt,
        productSection,
        originalContent,
        feedback: body.feedback,
      }, await loadTemplate("rewrite_aggregate"));
      res.json({ mode, messages: [{ role: "user", content: prompt }] });
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
