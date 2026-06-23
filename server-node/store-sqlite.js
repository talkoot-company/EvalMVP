// SQLite data store (better-sqlite3). Default backend.
// Exposes the same method surface as store-mssql.js; methods return plain
// values (route handlers `await` them uniformly, which works on non-promises).
import path from "node:path";
import fs from "node:fs";
import Database from "better-sqlite3";

const BASE_SCHEMA = `
  CREATE TABLE IF NOT EXISTS criteria (
    id              TEXT PRIMARY KEY,
    context         TEXT NOT NULL,
    content_type    TEXT NOT NULL,
    criteria_category TEXT,
    criteria_name   TEXT NOT NULL,
    criteria_definition TEXT,
    criteria_type   TEXT NOT NULL,
    eval_definition TEXT NOT NULL,
    weight          REAL NOT NULL DEFAULT 1.0,
    active          INTEGER NOT NULL DEFAULT 1,
    marketplace_tag TEXT,
    brand_tag       TEXT,
    industry_tag    TEXT,
    customer        TEXT,
    brand           TEXT,
    custom_tags     TEXT,
    notes           TEXT,
    created_at      TEXT NOT NULL,
    updated_at      TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS generations (
    generation_id       TEXT PRIMARY KEY,
    model               TEXT,
    created_at          INTEGER,
    system_prompt       TEXT,
    last_user_message   TEXT,
    few_shot_count      INTEGER,
    temperature         REAL,
    max_tokens          INTEGER,
    response_content    TEXT,
    prompt_tokens       INTEGER,
    completion_tokens   INTEGER,
    total_tokens        INTEGER,
    finish_reason       TEXT,
    is_valid            INTEGER,
    req_json            TEXT,
    resp_json           TEXT
  );
  CREATE TABLE IF NOT EXISTS eval_results (
    id TEXT PRIMARY KEY, generation_id TEXT NOT NULL,
    criterion_id TEXT NOT NULL, criterion_name TEXT,
    desired_score TEXT, score TEXT, rationale TEXT,
    evidence TEXT, product_name TEXT, run_at TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS type_mapping (
    criteria_content_type TEXT NOT NULL,
    generation_type       TEXT NOT NULL,
    PRIMARY KEY (criteria_content_type, generation_type)
  );
  CREATE INDEX IF NOT EXISTS idx_generations_created_at ON generations (created_at DESC);
  CREATE INDEX IF NOT EXISTS idx_generations_model ON generations (model);
`;

const BOOL_COLS = { criteria: ["active"], generations: ["is_valid"] };
const DATE_COLS = { criteria: ["created_at", "updated_at"], eval_results: ["run_at"] };

const COUNTS_BY_TYPE_SQL = `
  SELECT
    CASE
      WHEN instr(lower(system_prompt), 'bullet') > 0 THEN 'Bullets'
      WHEN instr(lower(system_prompt), 'sustainab') > 0 THEN 'Sustainability'
      WHEN instr(lower(system_prompt), 'extract') > 0
        OR instr(lower(system_prompt), 'lookup') > 0
        OR instr(lower(system_prompt), 'identify') > 0 THEN 'Extraction'
      WHEN instr(lower(system_prompt), 'title') > 0
        OR instr(lower(system_prompt), 'subhead') > 0
        OR instr(lower(system_prompt), 'naming') > 0 THEN 'Title'
      WHEN instr(lower(system_prompt), 'description') > 0
        OR instr(lower(system_prompt), 'copywriter') > 0
        OR instr(lower(system_prompt), 'copy') > 0 THEN 'Description'
      ELSE 'Other'
    END AS type,
    COUNT(*) AS cnt
  FROM generations
  WHERE system_prompt IS NOT NULL
  GROUP BY type
`;

const GEN_LIST_COLS =
  "generation_id, model, created_at, system_prompt, last_user_message, " +
  "few_shot_count, temperature, max_tokens, response_content, prompt_tokens, " +
  "completion_tokens, total_tokens, finish_reason, is_valid";

function coerceWrite(base, obj) {
  const out = { ...obj };
  for (const c of BOOL_COLS[base] || []) {
    if (c in out && out[c] != null) out[c] = out[c] ? 1 : 0;
  }
  for (const c of DATE_COLS[base] || []) {
    if (c in out && out[c] instanceof Date) out[c] = out[c].toISOString();
  }
  return out;
}

export function createSqliteStore(dbPath) {
  fs.mkdirSync(path.dirname(dbPath), { recursive: true });
  const db = new Database(dbPath);
  db.pragma("journal_mode = WAL");
  db.exec(BASE_SCHEMA);
  try {
    db.exec("ALTER TABLE criteria ADD COLUMN notes TEXT");
  } catch {
    /* column already exists */
  }
  if (db.prepare("SELECT COUNT(*) AS n FROM type_mapping").get().n === 0) {
    const ins = db.prepare("INSERT OR IGNORE INTO type_mapping VALUES (?,?)");
    for (const [ct, gt] of [
      ["Title", "Title"], ["Description", "Description"],
      ["Bullets/Specs", "Bullets"], ["Meta Description", "Description"],
    ]) ins.run(ct, gt);
  }

  const insertRow = (base, obj) => {
    const o = coerceWrite(base, obj);
    const cols = Object.keys(o);
    db.prepare(`INSERT INTO ${base} (${cols.join(",")}) VALUES (${cols.map(() => "?").join(",")})`)
      .run(...cols.map((c) => o[c]));
  };
  const updateRow = (base, pkCol, pkVal, obj) => {
    const o = coerceWrite(base, obj);
    const cols = Object.keys(o);
    db.prepare(`UPDATE ${base} SET ${cols.map((c) => `${c}=?`).join(",")} WHERE ${pkCol}=?`)
      .run(...cols.map((c) => o[c]), pkVal);
  };

  return {
    backend: "sqlite",

    // criteria
    listCriteria: () =>
      db.prepare("SELECT * FROM criteria ORDER BY context, content_type, criteria_category, criteria_name").all(),
    getCriterion: (id) => db.prepare("SELECT * FROM criteria WHERE id=?").get(id) || null,
    insertCriterion: (obj) => insertRow("criteria", obj),
    updateCriterion: (id, obj) => updateRow("criteria", "id", id, obj),
    deleteCriterion: (id) => db.prepare("DELETE FROM criteria WHERE id=?").run(id),
    getActiveEvalCriteria: () =>
      db.prepare(
        "SELECT id, criteria_name, criteria_definition, criteria_type, criteria_category " +
        "FROM criteria WHERE active=1 ORDER BY context, content_type, criteria_name"
      ).all(),
    findCriterionByName: (name) =>
      db.prepare("SELECT * FROM criteria WHERE LOWER(criteria_name)=LOWER(?)").get(name) || null,

    // generations
    listGenerations: ({ search, model, limit, offset }) => {
      const cond = [], params = [];
      if (search) {
        cond.push("(last_user_message LIKE ? OR response_content LIKE ? OR system_prompt LIKE ?)");
        const l = `%${search}%`;
        params.push(l, l, l);
      }
      if (model) { cond.push("model=?"); params.push(model); }
      const where = cond.length ? `WHERE ${cond.join(" AND ")}` : "";
      const total = db.prepare(`SELECT COUNT(*) AS n FROM generations ${where}`).get(...params).n;
      const rows = db.prepare(
        `SELECT ${GEN_LIST_COLS} FROM generations ${where} ORDER BY created_at DESC NULLS LAST LIMIT ? OFFSET ?`
      ).all(...params, limit, offset);
      return { total, rows };
    },
    countGenerationsByType: () => db.prepare(COUNTS_BY_TYPE_SQL).all(),
    listGenerationModels: () =>
      db.prepare("SELECT DISTINCT model FROM generations WHERE model IS NOT NULL ORDER BY model").all().map((r) => r.model),
    getGeneration: (id) => db.prepare("SELECT * FROM generations WHERE generation_id=?").get(id) || null,

    // mapping
    getRawMapping: () => db.prepare("SELECT criteria_content_type, generation_type FROM type_mapping").all(),
    replaceMapping: (pairs) => {
      db.transaction(() => {
        db.prepare("DELETE FROM type_mapping").run();
        const ins = db.prepare("INSERT OR IGNORE INTO type_mapping VALUES (?,?)");
        for (const [ct, gt] of pairs) ins.run(ct, gt);
      })();
    },

    // eval results
    insertEvalResult: (obj) => insertRow("eval_results", obj),
    getEvalResults: (genId) =>
      db.prepare("SELECT * FROM eval_results WHERE generation_id=? ORDER BY run_at DESC").all(genId),

    // generic (data import/export)
    allRows: (base) => db.prepare(`SELECT * FROM ${base}`).all(),
    countRows: (base) => db.prepare(`SELECT COUNT(*) AS n FROM ${base}`).get().n,
    chunkRows: (base, limit, offset) => db.prepare(`SELECT * FROM ${base} LIMIT ? OFFSET ?`).all(limit, offset),
    tableColumns: (base) => db.prepare(`PRAGMA table_info(${base})`).all().map((c) => c.name),
    upsertRows: (base, rows) => {
      const cols = new Set(db.prepare(`PRAGMA table_info(${base})`).all().map((c) => c.name));
      const stmtCache = new Map();
      db.transaction(() => {
        for (const row of rows) {
          const keys = Object.keys(row).filter((k) => cols.has(k));
          const cacheKey = keys.join(",");
          let stmt = stmtCache.get(cacheKey);
          if (!stmt) {
            stmt = db.prepare(
              `INSERT OR REPLACE INTO ${base} (${keys.join(",")}) VALUES (${keys.map(() => "?").join(",")})`
            );
            stmtCache.set(cacheKey, stmt);
          }
          stmt.run(...keys.map((k) => row[k]));
        }
      })();
      return rows.length;
    },

    close: () => db.close(),
  };
}
