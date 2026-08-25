#!/usr/bin/env node
/**
 * Import a representative sample of PUMA AI generations into the shared SQL Server
 * `generations` table, tagged `dataset='puma'`, alongside the existing Coca-Cola data.
 *
 * Why Node (not the Python pattern used by db/setup_temp_tables.py): this environment
 * has the `mssql`/`tedious` driver installed (the same one the app uses) but not
 * pyodbc + an ODBC driver. The field mapping is ported verbatim from
 * db/import_cocacola.py; the connection reuses server-node/store-mssql.js helpers.
 *
 * Behaviour (append-only, idempotent — never deletes):
 *   1. Ensure the `dataset` column exists on <prefix>generations (ALTER ADD if missing).
 *   2. One-time backfill: existing rows with NULL dataset -> 'cocacola'.
 *   3. Scan data/puma_generations/*_ai{Request,Response}.json, pair by UUID,
 *      apply the English filter, classify task type (same keyword logic as the app),
 *      and take a stratified sample across types up to --limit.
 *   4. Skip generation_ids already present; bulk-insert the rest with dataset='puma'.
 *
 * Usage:
 *   node db/import_puma.mjs --dry-run            # report the sample plan, write nothing
 *   node db/import_puma.mjs --limit 3000         # load ~3000 rows (default)
 *   node db/import_puma.mjs --prefix temp_Brian_ --dataset puma
 *
 * product_json and gen_type are left NULL; fill them afterwards with:
 *   DB_BACKEND=mssql node server-node/extract-product-data.js --ai
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import sql from "mssql";
import { parseAdonet, normalizeServerEndpoint } from "../server-node/store-mssql.js";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
// ---------------------------------------------------------------------------
// CLI args
// ---------------------------------------------------------------------------
function parseArgs(argv) {
  const out = { limit: 3000, dataset: "puma", dataDir: "data/puma_generations", dryRun: false, prefix: process.env.TABLE_PREFIX || "temp_Brian_", database: process.env.MSSQL_DATABASE || "dev-golfcarts" };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--dry-run") out.dryRun = true;
    else if (a === "--limit") out.limit = Number(argv[++i]);
    else if (a === "--dataset") out.dataset = argv[++i];
    else if (a === "--data-dir") out.dataDir = argv[++i];
    else if (a === "--prefix") out.prefix = argv[++i];
    else if (a === "--database") out.database = argv[++i];
    else { console.error(`Unknown arg: ${a}`); process.exit(2); }
  }
  if (!Number.isFinite(out.limit) || out.limit <= 0) { console.error("--limit must be a positive number"); process.exit(2); }
  return out;
}
const args = parseArgs(process.argv.slice(2));
const DATA_DIR = path.isAbsolute(args.dataDir) ? args.dataDir : path.join(ROOT, args.dataDir);

// ---------------------------------------------------------------------------
// Connection string (raw file read — handles '#' / '$$' in the password)
// ---------------------------------------------------------------------------
function rawConnstring() {
  for (const name of [".env.docker", ".env.local", ".env"]) {
    const p = path.join(ROOT, name);
    if (!fs.existsSync(p)) continue;
    const m = /^\s*SQL_SERVER_CONNSTRING\s*=\s*(.+)$/m.exec(fs.readFileSync(p, "utf-8"));
    if (m) return m[1].trim().replace(/^["']|["']$/g, "");
  }
  return process.env.SQL_SERVER_CONNSTRING || null;
}

// ---------------------------------------------------------------------------
// Field mapping — ported from db/import_cocacola.py
// ---------------------------------------------------------------------------
function loadJson(p) {
  try { return JSON.parse(fs.readFileSync(p, "utf-8")); }
  catch { try { return JSON.parse(fs.readFileSync(p, "latin1")); } catch { return null; } }
}

function extractMessages(req) {
  const messages = req?.messages || [];
  let systemPrompt = "";
  const userMessages = [];
  let assistantCount = 0;
  for (const m of messages) {
    const role = m?.role || "";
    const content = m?.content ?? "";
    if (role === "system" && !systemPrompt) systemPrompt = content;
    else if (role === "user") userMessages.push(content);
    else if (role === "assistant") assistantCount += 1;
  }
  const lastUser = userMessages.length ? userMessages[userMessages.length - 1] : "";
  return { systemPrompt: String(systemPrompt || ""), lastUser: String(lastUser || ""), fewShot: Math.max(0, assistantCount) };
}

function extractResponse(resp) {
  const choices = resp?.Choices || resp?.choices || [];
  if (!choices.length) return null;
  const choice = choices[0];
  const msg = choice?.Message || choice?.message || {};
  const content = msg?.content || msg?.Content || "";
  const finish = choice?.finish_reason || choice?.FinishReason || "";
  const usage = resp?.Usage || resp?.usage || {};
  return {
    generation_id: String(resp?.GenerationID || resp?.Id || ""),
    model: resp?.Model || resp?.model || "",
    created_at: resp?.Created ?? resp?.created ?? null,
    response_content: String(content || ""),
    finish_reason: String(finish || ""),
    prompt_tokens: usage?.prompt_tokens ?? usage?.PromptTokens ?? null,
    completion_tokens: usage?.completion_tokens ?? usage?.CompletionTokens ?? null,
    total_tokens: usage?.total_tokens ?? usage?.TotalTokens ?? null,
    is_valid: resp?.IsValid,
  };
}

const NON_ENGLISH_MARKERS = [
  "en français", "in french", "french language", "en-fr", "fr-ca", "rédiger en", "rédigez en", "écrire en français",
  "in spanish", "en español", "spanish language", "es-mx", "es-us", "mexican spanish", "español", "castellano",
  "in portuguese", "em português", "portuguese language", "pt-br", "português",
  "in italian", "in italiano", "write in german", "auf deutsch",
];
const NON_ENGLISH_RESPONSE_PATTERNS = [
  /\b(boisson|saveur|canette|bouteille|litre|sucre|zéro|agrumes)\b/i,
  /\b(sabor|lata|botella|bebida|azúcar|litro|agua|refresco)\b/i,
  /\b(sabor|lata|garrafa|bebida|açúcar|litro|água)\b/i,
];
function isEnglish(systemPrompt, lastUserMsg, responseContent) {
  const checkText = (systemPrompt + " " + lastUserMsg.slice(0, 500)).toLowerCase();
  for (const marker of NON_ENGLISH_MARKERS) if (checkText.includes(marker)) return false;
  for (const pat of NON_ENGLISH_RESPONSE_PATTERNS) if (pat.test(responseContent)) return false;
  if (responseContent) {
    let nonAscii = 0;
    for (const c of responseContent) if (c.codePointAt(0) > 127) nonAscii += 1;
    if (nonAscii / responseContent.length > 0.08) return false;
  }
  return true;
}

// Same keyword logic as TYPE_CASE_SQL / the frontend inferType.
function classifyType(systemPrompt) {
  const sp = (systemPrompt || "").toLowerCase();
  if (sp.includes("bullet")) return "Bullets";
  if (sp.includes("sustainab")) return "Sustainability";
  if (sp.includes("extract") || sp.includes("lookup") || sp.includes("identify")) return "Extraction";
  if (sp.includes("title") || sp.includes("subhead") || sp.includes("naming")) return "Title";
  if (sp.includes("description") || sp.includes("copywriter") || sp.includes("copy")) return "Description";
  return "Other";
}
const TYPES = ["Title", "Description", "Bullets", "Sustainability", "Extraction", "Other"];

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------
async function main() {
  if (!fs.existsSync(DATA_DIR)) { console.error(`ERROR: ${DATA_DIR} does not exist`); process.exit(1); }
  const adonet = rawConnstring();
  if (!adonet) { console.error("ERROR: SQL_SERVER_CONNSTRING not found in .env.local/.env.docker/.env"); process.exit(1); }

  const parts = parseAdonet(adonet);
  const endpoint = normalizeServerEndpoint(parts["server"] || parts["data source"]);
  const config = {
    server: endpoint.server,
    database: args.database || parts["database"] || parts["initial catalog"],
    user: parts["user id"] || parts["uid"],
    password: parts["password"] || parts["pwd"],
    options: { encrypt: true, trustServerCertificate: true },
    pool: { max: 4, min: 0, idleTimeoutMillis: 30000 },
    requestTimeout: 300000,
    connectionTimeout: 30000,
  };
  if (endpoint.port) config.port = endpoint.port;

  const tbl = `[dbo].[${args.prefix}generations]`;
  console.log("=".repeat(70));
  console.log(`Generation import — dataset '${args.dataset}' from ${args.dataDir}`);
  console.log(`  Server   : ${config.server}${config.port ? ":" + config.port : ""}`);
  console.log(`  Database : ${config.database}`);
  console.log(`  Table    : ${args.prefix}generations`);
  console.log(`  Dataset  : ${args.dataset}`);
  console.log(`  Limit    : ${args.limit}   Dry run: ${args.dryRun}`);
  console.log("=".repeat(70));

  const pool = await new sql.ConnectionPool(config).connect();
  try {
    // 1. Ensure dataset column + 2. backfill existing rows -> 'cocacola'
    if (!args.dryRun) {
      await pool.request().query(
        `IF COL_LENGTH(N'${tbl}', N'dataset') IS NULL ALTER TABLE ${tbl} ADD dataset NVARCHAR(50) NULL;`
      );
      const backfill = await pool.request().query(
        `UPDATE ${tbl} SET dataset='cocacola' WHERE dataset IS NULL;`
      );
      console.log(`[backfill] tagged ${backfill.rowsAffected[0]} existing NULL-dataset rows as 'cocacola'`);
    }

    // Existing generation_ids (skip these). If the column doesn't exist yet in dry-run, that's fine.
    const existing = new Set();
    const existingRows = await pool.request().query(`SELECT generation_id FROM ${tbl}`);
    for (const r of existingRows.recordset) existing.add(r.generation_id);
    console.log(`[scan] ${existing.size} generations already in the table`);

    // 3. Scan + stratified sample
    const names = fs.readdirSync(DATA_DIR);
    const respStems = [];
    const reqSet = new Set();
    for (const n of names) {
      if (n.endsWith("_aiResponse.json")) respStems.push(n.slice(0, -"_aiResponse.json".length));
      else if (n.endsWith("_aiRequest.json")) reqSet.add(n.slice(0, -"_aiRequest.json".length));
    }
    respStems.sort();
    console.log(`[scan] ${respStems.length} response files, ${reqSet.size} request files`);

    const perTypeTarget = Math.ceil(args.limit / TYPES.length);
    const buckets = Object.fromEntries(TYPES.map((t) => [t, []]));
    const overflow = [];
    const seen = new Set();
    let accepted = 0;
    const skip = { noReq: 0, nonEnglish: 0, parseErr: 0, dupe: 0, existing: 0 };

    for (const uuid of respStems) {
      if (accepted >= args.limit) break;
      const resp = loadJson(path.join(DATA_DIR, `${uuid}_aiResponse.json`));
      if (!resp) { skip.parseErr++; continue; }
      const info = extractResponse(resp);
      if (!info || !info.generation_id) { skip.parseErr++; continue; }
      const genId = info.generation_id;
      if (seen.has(genId)) { skip.dupe++; continue; }
      seen.add(genId);
      if (existing.has(genId)) { skip.existing++; continue; }

      if (!reqSet.has(uuid)) { skip.noReq++; continue; }
      const req = loadJson(path.join(DATA_DIR, `${uuid}_aiRequest.json`));
      if (!req) { skip.parseErr++; continue; }
      const { systemPrompt, lastUser, fewShot } = extractMessages(req);

      if (!isEnglish(systemPrompt, lastUser, info.response_content)) { skip.nonEnglish++; continue; }

      const type = classifyType(systemPrompt);
      const row = {
        generation_id: genId,
        model: info.model || null,
        created_at: info.created_at != null ? Number(info.created_at) : null,
        system_prompt: systemPrompt || null,
        last_user_message: lastUser || null,
        few_shot_count: fewShot,
        temperature: req.temperature ?? null,
        max_tokens: req.max_tokens ?? req.max_completion_tokens ?? null,
        response_content: info.response_content || null,
        prompt_tokens: info.prompt_tokens ?? null,
        completion_tokens: info.completion_tokens ?? null,
        total_tokens: info.total_tokens ?? null,
        finish_reason: info.finish_reason || null,
        is_valid: info.is_valid ? 1 : 0,
        req_json: JSON.stringify(req),
        resp_json: JSON.stringify(resp),
        dataset: args.dataset,
      };
      if (buckets[type].length < perTypeTarget) { buckets[type].push(row); accepted++; }
      else if (overflow.length < args.limit) overflow.push(row);
    }

    // Fill remaining quota from overflow (types that exceeded their even share)
    let sample = TYPES.flatMap((t) => buckets[t]);
    if (sample.length < args.limit) {
      sample = sample.concat(overflow.slice(0, args.limit - sample.length));
    }

    console.log("\n[sample] selected by task type:");
    for (const t of TYPES) console.log(`    ${t.padEnd(16)} ${buckets[t].length}`);
    if (sample.length > TYPES.reduce((a, t) => a + buckets[t].length, 0)) {
      console.log(`    (+${sample.length - TYPES.reduce((a, t) => a + buckets[t].length, 0)} from overflow)`);
    }
    console.log(`    ${"TOTAL".padEnd(16)} ${sample.length}`);
    console.log(`[skip] existing=${skip.existing} non-English=${skip.nonEnglish} no-request=${skip.noReq} dupe=${skip.dupe} parse-err=${skip.parseErr}`);

    if (args.dryRun) { console.log("\n[dry-run] no rows written."); return; }
    if (!sample.length) { console.log("\nNothing to insert."); return; }

    // 4. Bulk insert — chunked so large req/resp JSON blobs stay under the
    //    request timeout and progress is visible (each chunk is its own commit).
    const CHUNK = 250;
    const makeTable = () => {
      const t = new sql.Table(`${args.prefix}generations`);
      t.create = false;
      t.columns.add("generation_id", sql.NVarChar(64), { nullable: false });
      t.columns.add("model", sql.NVarChar(100), { nullable: true });
      t.columns.add("created_at", sql.BigInt, { nullable: true });
      t.columns.add("system_prompt", sql.NVarChar(sql.MAX), { nullable: true });
      t.columns.add("last_user_message", sql.NVarChar(sql.MAX), { nullable: true });
      t.columns.add("few_shot_count", sql.Int, { nullable: true });
      t.columns.add("temperature", sql.Float, { nullable: true });
      t.columns.add("max_tokens", sql.Int, { nullable: true });
      t.columns.add("response_content", sql.NVarChar(sql.MAX), { nullable: true });
      t.columns.add("prompt_tokens", sql.Int, { nullable: true });
      t.columns.add("completion_tokens", sql.Int, { nullable: true });
      t.columns.add("total_tokens", sql.Int, { nullable: true });
      t.columns.add("finish_reason", sql.NVarChar(50), { nullable: true });
      t.columns.add("is_valid", sql.Bit, { nullable: true });
      t.columns.add("req_json", sql.NVarChar(sql.MAX), { nullable: true });
      t.columns.add("resp_json", sql.NVarChar(sql.MAX), { nullable: true });
      t.columns.add("dataset", sql.NVarChar(50), { nullable: true });
      return t;
    };
    console.log(`\n[insert] bulk-loading ${sample.length} rows in chunks of ${CHUNK}…`);
    let loaded = 0;
    for (let i = 0; i < sample.length; i += CHUNK) {
      const chunk = sample.slice(i, i + CHUNK);
      const table = makeTable();
      for (const r of chunk) {
        table.rows.add(
          r.generation_id, r.model, r.created_at, r.system_prompt, r.last_user_message,
          r.few_shot_count, r.temperature, r.max_tokens, r.response_content, r.prompt_tokens,
          r.completion_tokens, r.total_tokens, r.finish_reason, r.is_valid, r.req_json, r.resp_json, r.dataset,
        );
      }
      const result = await pool.request().bulk(table);
      loaded += result.rowsAffected;
      console.log(`    ${loaded}/${sample.length}`);
    }
    console.log(`[insert] committed ${loaded} rows.`);

    // Verify
    const counts = await pool.request().query(
      `SELECT dataset, COUNT(*) AS n FROM ${tbl} GROUP BY dataset ORDER BY dataset`
    );
    console.log("\n[verify] rows by dataset:");
    for (const r of counts.recordset) console.log(`    ${String(r.dataset ?? "(null)").padEnd(12)} ${r.n}`);
    console.log("\nDone.");
  } finally {
    await pool.close();
  }
}

main().catch((e) => { console.error(e); process.exit(1); });
