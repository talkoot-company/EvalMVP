// CLI entry: runs the EvalMVP API for local development (and simple single-process
// production via startServer's optional staticDir).
//
// Backend is selected with DB_BACKEND:
//   sqlite (default) — local file db/evals.db
//   mssql            — SQL Server temp tables in dev-golfcarts
//                      (uses SQL_SERVER_CONNSTRING from env/.env; prefix via
//                       MSSQL_TABLE_PREFIX, default temp_Brian_)
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import dotenv from "dotenv";
import { startServer } from "./server.js";
// Stores are imported lazily so the packaged app only loads the selected
// database driver at startup.

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
dotenv.config({ path: path.join(ROOT, ".env") });
dotenv.config({ path: path.join(ROOT, ".env.local"), override: true });
// .env.docker is the file mounted into the container (carries Azure creds etc.).
dotenv.config({ path: path.join(ROOT, ".env.docker"), override: true });

// Read SQL_SERVER_CONNSTRING raw from a local env file FIRST, then fall back to
// the process env. The password can contain '#' (dotenv truncates at it) and
// '$$' (Docker Compose interpolation collapses to '$'), so a value that arrived
// via env vars may be corrupted — reading the file bytes is always correct.
function rawConnstring() {
  for (const name of [".env.docker", ".env.local", ".env"]) {
    const envPath = path.join(ROOT, name);
    if (!fs.existsSync(envPath)) continue;
    const m = /^\s*SQL_SERVER_CONNSTRING\s*=\s*(.+)$/m.exec(fs.readFileSync(envPath, "utf-8"));
    if (m) return m[1].trim().replace(/^["']|["']$/g, "");
  }
  return process.env.SQL_SERVER_CONNSTRING || null;
}

// Use a dedicated API_PORT (not the generic PORT) so a stray ambient PORT env
// can't silently move the dev API off 8000 and break Vite's /api proxy.
// Must stay in lockstep with the proxy target in vite.config.ts.
const IS_PRODUCTION = process.env.NODE_ENV === "production";
const PORT = Number(process.env.API_PORT || (IS_PRODUCTION ? process.env.PORT : undefined) || 8000);
const HOST = process.env.HOST || (IS_PRODUCTION ? "0.0.0.0" : "127.0.0.1");
const BACKEND = (process.env.DB_BACKEND || "sqlite").toLowerCase();
const RESULTS_DIR = path.join(ROOT, "server", "results");
const SERVE_STATIC = process.env.SERVE_STATIC === "true" || IS_PRODUCTION;
const STATIC_DIR = SERVE_STATIC ? path.join(ROOT, "dist") : null;

async function createStore() {
  if (BACKEND === "mssql") {
    const adonet = rawConnstring();
    if (!adonet) throw new Error("SQL_SERVER_CONNSTRING is not set");
    const prefix = process.env.MSSQL_TABLE_PREFIX || "temp_Brian_";
    const database = process.env.MSSQL_DATABASE || "dev-golfcarts";
    console.log("[api] loading SQL Server driver (first start can take ~15s)…");
    const { createMssqlStore } = await import("./store-mssql.js");
    const store = await createMssqlStore({ adonet, database, prefix });
    return { store, descriptor: `mssql ${database} (prefix ${prefix})` };
  }
  const dbPath = process.env.EVALS_DB_PATH || path.join(ROOT, "db", "evals.db");
  const { createSqliteStore } = await import("./store-sqlite.js");
  return { store: createSqliteStore(dbPath), descriptor: `sqlite ${dbPath}` };
}

// Clear, actionable startup errors instead of a raw stack trace. Because the
// dev script no longer uses --kill-others, the API exiting here leaves the Vite
// dev server (http://localhost:8080) running, so the UI still loads.
try {
  if (STATIC_DIR && !fs.existsSync(path.join(STATIC_DIR, "index.html"))) {
    throw new Error(`frontend build not found at ${STATIC_DIR}; run npm run build first`);
  }
  const { store, descriptor } = await createStore();
  const { port } = await startServer({ store, port: PORT, host: HOST, resultsDir: RESULTS_DIR, staticDir: STATIC_DIR });
  const staticMsg = STATIC_DIR ? `, serving frontend from ${STATIC_DIR}` : "";
  console.log(`EvalMVP listening on http://${HOST}:${port} (backend: ${descriptor}${staticMsg})`);
} catch (err) {
  console.error("");
  if (err.code === "EADDRINUSE") {
    console.error(`ERROR: port ${PORT} is already in use — another dev server is probably still running.`);
    console.error(`  Stop that process (or free port ${PORT}) and try again,`);
    console.error(`  or run on a different port:  API_PORT=8001 npm run dev  (the Vite proxy follows API_PORT).`);
  } else if (BACKEND === "mssql") {
    console.error(`ERROR: could not connect to the SQL Server backend (DB_BACKEND=mssql).`);
    console.error(`  ${err.message || err}`);
    console.error(`  - Check VPN / network access to Azure SQL and the credentials in .env.`);
    console.error(`  - To use the local SQLite database instead, clear DB_BACKEND:`);
    console.error(`      PowerShell:  $env:DB_BACKEND = ''      (or just open a new terminal)`);
  } else {
    console.error(`ERROR: failed to start the API.`);
    console.error(`  ${err.message || err}`);
  }
  console.error(`Vite (http://localhost:8080) stays up, but data won't load until the API is running.\n`);
  process.exit(1);
}
