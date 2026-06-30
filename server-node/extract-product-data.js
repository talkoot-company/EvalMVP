// Bulk-extract per-generation product data into the generations.product_json
// column. Heuristic-first (free, brace-balanced JSON parse); AI fallback only
// when --ai is passed. Resumable: only touches rows that are NULL (or '{}' with
// --retry-empty), so it's safe to stop and re-run, and to run incrementally.
//
//   node server-node/extract-product-data.js [--ai] [--limit N] [--batch N]
//                                            [--concurrency N] [--retry-empty] [--dry-run]
//
//   (no flags)      heuristic-only pass over all unprocessed generations (free)
//   --ai            enable the LLM fallback for rows the heuristic can't parse
//   --limit N       process at most N generations this run
//   --batch N       rows fetched per DB page (default 200)
//   --concurrency N max concurrent AI calls (default 5)
//   --retry-empty   target rows already marked '{}' (re-attempt with AI)
//   --dry-run       extract + log, but don't write to the DB
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import dotenv from "dotenv";
import { heuristicProductFields, aiExtractProductFields } from "./eval-runner.js";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
dotenv.config({ path: path.join(ROOT, ".env") });
dotenv.config({ path: path.join(ROOT, ".env.local"), override: true });
dotenv.config({ path: path.join(ROOT, ".env.docker"), override: true });

// Mirrors index.js: read SQL_SERVER_CONNSTRING raw from the env file (password
// contains '#'/'$$' which dotenv/compose corrupt).
function rawConnstring() {
  for (const name of [".env.docker", ".env.local", ".env"]) {
    const envPath = path.join(ROOT, name);
    if (!fs.existsSync(envPath)) continue;
    const m = /^\s*SQL_SERVER_CONNSTRING\s*=\s*(.+)$/m.exec(fs.readFileSync(envPath, "utf-8"));
    if (m) return m[1].trim().replace(/^["']|["']$/g, "");
  }
  return process.env.SQL_SERVER_CONNSTRING || null;
}

async function createStore() {
  const backend = (process.env.DB_BACKEND || "mssql").toLowerCase();
  if (backend === "mssql") {
    const adonet = rawConnstring();
    if (!adonet) throw new Error("SQL_SERVER_CONNSTRING is not set");
    const prefix = process.env.MSSQL_TABLE_PREFIX || "temp_Brian_";
    const database = process.env.MSSQL_DATABASE || "dev-golfcarts";
    const { createMssqlStore } = await import("./store-mssql.js");
    return createMssqlStore({ adonet, database, prefix });
  }
  const dbPath = process.env.EVALS_DB_PATH || path.join(ROOT, "db", "evals.db");
  const { createSqliteStore } = await import("./store-sqlite.js");
  return createSqliteStore(dbPath);
}

function parseArgs(argv) {
  const args = { ai: false, limit: Infinity, batch: 200, concurrency: 5, retryEmpty: false, dryRun: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--ai") args.ai = true;
    else if (a === "--retry-empty") args.retryEmpty = true;
    else if (a === "--dry-run") args.dryRun = true;
    else if (a === "--limit") args.limit = Number(argv[++i]);
    else if (a === "--batch") args.batch = Number(argv[++i]);
    else if (a === "--concurrency") args.concurrency = Number(argv[++i]);
  }
  return args;
}

function messagesOf(reqJson) {
  let req = {};
  try {
    req = typeof reqJson === "string" ? JSON.parse(reqJson) : (reqJson || {});
  } catch {
    req = {};
  }
  return req.messages || [];
}

// Run async tasks with bounded concurrency.
async function pool(items, limit, worker) {
  const queue = [...items.entries()];
  const runners = Array.from({ length: Math.max(1, limit) }, async () => {
    for (;;) {
      const next = queue.shift();
      if (!next) return;
      const [, item] = next;
      await worker(item);
    }
  });
  await Promise.all(runners);
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const mode = args.retryEmpty ? "empty" : "unprocessed";
  const store = await createStore();
  console.log(`[extract] backend=${store.backend} mode=${mode} ai=${args.ai} dryRun=${args.dryRun}`);

  let pending = Infinity;
  try {
    pending = await store.countGenerationsForExtraction(mode);
    console.log(`[extract] ${pending} generation(s) ${mode === "empty" ? "marked empty" : "unprocessed"}`);
  } catch { /* count is best-effort */ }

  const tally = { heuristic: 0, ai: 0, none: 0, processed: 0 };
  // Keyset cursor by generation_id. In --retry-empty mode irrecoverable rows
  // stay '{}' and would otherwise be re-fetched forever; advancing past the last
  // id each batch guarantees we visit every target row exactly once and stop.
  let afterId = "";

  while (tally.processed < args.limit) {
    const remaining = args.limit - tally.processed;
    const fetch = Math.min(args.batch, remaining);
    const rows = await store.getGenerationsForExtraction(mode, fetch, afterId);
    if (!rows.length) break;
    afterId = rows[rows.length - 1].generation_id;

    // Tier 1: heuristic (free, synchronous) for the whole batch.
    const aiCandidates = [];
    for (const row of rows) {
      const fields = heuristicProductFields(messagesOf(row.req_json));
      if (fields && Object.keys(fields).length) {
        row.__fields = fields;
        row.__source = "heuristic";
      } else {
        aiCandidates.push(row);
      }
    }

    // Tier 2: AI fallback (bounded concurrency) only if enabled.
    if (args.ai && aiCandidates.length) {
      await pool(aiCandidates, args.concurrency, async (row) => {
        try {
          const fields = await aiExtractProductFields(messagesOf(row.req_json));
          row.__fields = fields && Object.keys(fields).length ? fields : {};
          row.__source = row.__fields && Object.keys(row.__fields).length ? "ai" : "none";
        } catch (err) {
          console.error(`[extract] AI failed for ${row.generation_id}: ${err.message || err}`);
          row.__fields = {};
          row.__source = "none";
        }
      });
    } else {
      for (const row of aiCandidates) { row.__fields = {}; row.__source = "none"; }
    }

    // Persist (heuristic-miss rows without --ai stay '{}' so we don't reprocess
    // them on a plain re-run; --retry-empty + --ai revisits them later).
    for (const row of rows) {
      tally[row.__source]++;
      tally.processed++;
      if (!args.dryRun) {
        await store.setProductJson(row.generation_id, JSON.stringify(row.__fields || {}));
      }
    }
    console.log(`[extract] processed ${tally.processed} (heuristic=${tally.heuristic} ai=${tally.ai} none=${tally.none})`);
  }

  console.log(`[extract] DONE — ${JSON.stringify(tally)}`);
  if (store.close) await store.close();
}

main().catch((err) => {
  console.error("[extract] fatal:", err.message || err);
  process.exit(1);
});
