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
import { runSingleEval, aiClient, llmModel } from "./eval-runner.js";
import { exportZipBuffer, importZipBuffer, KINDS } from "./data-transfer.js";

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
  return d;
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

const GENERATION_TYPES = ["Title", "Description", "Bullets", "Sustainability", "Extraction", "Other"];
const CRITERIA_CONTENT_TYPES = ["Title", "Description", "Bullets/Specs", "Meta Description"];

function buildMapping(rows) {
  const result = Object.fromEntries(CRITERIA_CONTENT_TYPES.map((ct) => [ct, []]));
  for (const r of rows) {
    if (r.criteria_content_type in result) result[r.criteria_content_type].push(r.generation_type);
  }
  return result;
}

export function createApp({ store, resultsDir, staticDir = null }) {
  const app = express();
  app.use(cors({ origin: ["http://localhost:8080", "http://localhost:5173", "http://localhost:3000"] }));
  app.use(express.json({ limit: "10mb" }));

  app.get("/api/health", (req, res) => {
    res.json({ ok: true, backend: store.backend });
  });

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

  // ----- Generations routes (literal routes must register before /:id) -----

  app.get("/api/generations", route(async (req, res) => {
    const search = req.query.search || "";
    const model = req.query.model || "";
    const limit = Number(req.query.limit ?? 100);
    const offset = Number(req.query.offset ?? 0);
    const { total, rows } = await store.listGenerations({ search, model, limit, offset });
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

    let result;
    try {
      result = await runSingleEval(copyText, requestMessages, criterion);
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

  // ----- Post-edit route -----

  app.post("/api/post-edit", route(async (req, res) => {
    const body = req.body || {};
    const genRow = await store.getGeneration(body.generation_id);
    if (!genRow) throw new HttpError(404, "Generation not found");

    const systemPrompt = genRow.system_prompt || "";
    const userMessage = genRow.last_user_message || "";
    const originalContent = genRow.response_content || "";

    let evidenceBlock = "";
    if (Array.isArray(body.evidence) && body.evidence.length) {
      evidenceBlock =
        "\nSpecific passages flagged:\n" +
        body.evidence.filter(Boolean).map((e) => `  - "${e}"`).join("\n");
    }

    const postEditPrompt = `You are an expert product copy editor. Your task is to improve a piece of product copy based on evaluation feedback.

--- ORIGINAL TASK ---
${systemPrompt}

--- PRODUCT DATA ---
${userMessage}

--- ORIGINAL COPY ---
${originalContent}

--- EVALUATION FEEDBACK ---
Criterion: ${body.criterion_name}
Score: ${body.score} (target: ${body.desired_score})
Feedback: ${body.rationale}${evidenceBlock}

--- INSTRUCTIONS ---
Rewrite the copy to address the evaluation feedback and achieve the target score.
- Keep the same format and approximate length as the original.
- Only change what is needed to address the specific feedback.
- Do not add commentary or explanations — output only the improved copy.
`;

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
