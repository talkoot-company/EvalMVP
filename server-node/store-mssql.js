// SQL Server data store (mssql/tedious). Opt-in backend (DB_BACKEND=mssql).
// Reads/writes the prefixed temp tables (default temp_Brian_*) in dev-golfcarts.
// Same method surface as store-sqlite.js, but every method is async.
import sql from "mssql";

const BOOL_COLS = { criteria: ["active"], generations: ["is_valid"] };
const DATE_COLS = { criteria: ["created_at", "updated_at"], eval_results: ["run_at"] };
const PK = {
  criteria: ["id"],
  generations: ["generation_id"],
  eval_results: ["id"],
  type_mapping: ["criteria_content_type", "generation_type"],
};

const GEN_LIST_COLS =
  "generation_id, model, created_at, system_prompt, last_user_message, " +
  "few_shot_count, temperature, max_tokens, response_content, prompt_tokens, " +
  "completion_tokens, total_tokens, finish_reason, is_valid";

// SQL Server dialect of the type-classification query (CHARINDEX instead of instr).
const COUNTS_BY_TYPE_SQL = (tbl) => `
  SELECT type, COUNT(*) AS cnt FROM (
    SELECT CASE
      WHEN CHARINDEX('bullet', LOWER(system_prompt)) > 0 THEN 'Bullets'
      WHEN CHARINDEX('sustainab', LOWER(system_prompt)) > 0 THEN 'Sustainability'
      WHEN CHARINDEX('extract', LOWER(system_prompt)) > 0
        OR CHARINDEX('lookup', LOWER(system_prompt)) > 0
        OR CHARINDEX('identify', LOWER(system_prompt)) > 0 THEN 'Extraction'
      WHEN CHARINDEX('title', LOWER(system_prompt)) > 0
        OR CHARINDEX('subhead', LOWER(system_prompt)) > 0
        OR CHARINDEX('naming', LOWER(system_prompt)) > 0 THEN 'Title'
      WHEN CHARINDEX('description', LOWER(system_prompt)) > 0
        OR CHARINDEX('copywriter', LOWER(system_prompt)) > 0
        OR CHARINDEX('copy', LOWER(system_prompt)) > 0 THEN 'Description'
      ELSE 'Other'
    END AS type
    FROM ${tbl} WHERE system_prompt IS NOT NULL
  ) t
  GROUP BY type
`;

export function parseAdonet(adonet) {
  const parts = {};
  for (const seg of adonet.split(";")) {
    const s = seg.trim();
    if (!s) continue;
    const i = s.indexOf("=");
    parts[s.slice(0, i).trim().toLowerCase()] = s.slice(i + 1).trim();
  }
  return parts;
}

export function normalizeServerEndpoint(rawServer) {
  let server = String(rawServer || "").trim();
  let port = undefined;
  if (server.toLowerCase().startsWith("tcp:")) server = server.slice(4);

  const commaPort = /^(.+),(\d+)$/.exec(server);
  if (commaPort) {
    server = commaPort[1];
    port = Number(commaPort[2]);
  }

  return { server, port };
}

function coerceWrite(base, obj) {
  const out = { ...obj };
  for (const c of BOOL_COLS[base] || []) {
    if (c in out && out[c] != null) out[c] = !!out[c];
  }
  for (const c of DATE_COLS[base] || []) {
    if (c in out && out[c] != null && !(out[c] instanceof Date)) out[c] = new Date(out[c]);
  }
  return out;
}

// generations.created_at is BIGINT; normalize to a JS number for the API.
function fixGeneration(row) {
  if (row && row.created_at != null) row.created_at = Number(row.created_at);
  return row;
}

export async function createMssqlStore({ adonet, database, prefix }) {
  const parts = parseAdonet(adonet);
  const endpoint = normalizeServerEndpoint(parts["server"] || parts["data source"]);
  const config = {
    server: endpoint.server,
    database: database || parts["database"] || parts["initial catalog"],
    user: parts["user id"] || parts["uid"],
    password: parts["password"] || parts["pwd"],
    options: { encrypt: true, trustServerCertificate: true },
    pool: { max: 10, min: 0, idleTimeoutMillis: 30000 },
    requestTimeout: 120000,
  };
  if (endpoint.port) config.port = endpoint.port;
  if (!config.server || !config.user || !config.password) {
    throw new Error("mssql: connstring missing Server/Data Source, User Id/UID, or Password/PWD");
  }
  if (config.server.includes("your-server.database.windows.net")) {
    throw new Error("mssql: SQL_SERVER_CONNSTRING is still using the example placeholder server");
  }
  const pool = await new sql.ConnectionPool(config).connect();
  const tbl = (base) => `[dbo].[${prefix}${base}]`;

  // Run a query with positional params bound as @p0, @p1, ...
  const q = async (text, params = []) => {
    const req = pool.request();
    params.forEach((v, i) => req.input(`p${i}`, v));
    const r = await req.query(text);
    return r.recordset || [];
  };
  const one = async (text, params = []) => (await q(text, params))[0] || null;

  const insertRow = async (base, obj) => {
    const o = coerceWrite(base, obj);
    const cols = Object.keys(o);
    const collist = cols.map((c) => `[${c}]`).join(",");
    const vals = cols.map((_, i) => `@p${i}`).join(",");
    await q(`INSERT INTO ${tbl(base)} (${collist}) VALUES (${vals})`, cols.map((c) => o[c]));
  };
  const updateRow = async (base, pkCol, pkVal, obj) => {
    const o = coerceWrite(base, obj);
    const cols = Object.keys(o);
    const set = cols.map((c, i) => `[${c}]=@p${i}`).join(",");
    await q(`UPDATE ${tbl(base)} SET ${set} WHERE [${pkCol}]=@p${cols.length}`,
      [...cols.map((c) => o[c]), pkVal]);
  };

  return {
    backend: "mssql",

    // criteria
    listCriteria: () =>
      q(`SELECT * FROM ${tbl("criteria")} ORDER BY context, content_type, criteria_category, criteria_name`),
    getCriterion: (id) => one(`SELECT * FROM ${tbl("criteria")} WHERE id=@p0`, [id]),
    insertCriterion: (obj) => insertRow("criteria", obj),
    updateCriterion: (id, obj) => updateRow("criteria", "id", id, obj),
    deleteCriterion: (id) => q(`DELETE FROM ${tbl("criteria")} WHERE id=@p0`, [id]),
    getActiveEvalCriteria: () =>
      q(`SELECT id, criteria_name, criteria_definition, criteria_type, criteria_category
         FROM ${tbl("criteria")} WHERE active=1 ORDER BY context, content_type, criteria_name`),
    findCriterionByName: (name) =>
      one(`SELECT * FROM ${tbl("criteria")} WHERE LOWER(criteria_name)=LOWER(@p0)`, [name]),

    // generations
    listGenerations: async ({ search, model, limit, offset }) => {
      const cond = [], params = [];
      if (search) {
        const p = params.length;
        cond.push(`(last_user_message LIKE @p${p} OR response_content LIKE @p${p + 1} OR system_prompt LIKE @p${p + 2})`);
        const l = `%${search}%`;
        params.push(l, l, l);
      }
      if (model) { cond.push(`model=@p${params.length}`); params.push(model); }
      const where = cond.length ? `WHERE ${cond.join(" AND ")}` : "";
      const totalRow = await one(`SELECT COUNT(*) AS n FROM ${tbl("generations")} ${where}`, params);
      const rows = await q(
        `SELECT ${GEN_LIST_COLS} FROM ${tbl("generations")} ${where}
         ORDER BY CASE WHEN created_at IS NULL THEN 1 ELSE 0 END, created_at DESC
         OFFSET @p${params.length} ROWS FETCH NEXT @p${params.length + 1} ROWS ONLY`,
        [...params, offset, limit]
      );
      return { total: totalRow.n, rows: rows.map(fixGeneration) };
    },
    countGenerationsByType: () => q(COUNTS_BY_TYPE_SQL(tbl("generations"))),
    listGenerationModels: async () =>
      (await q(`SELECT DISTINCT model FROM ${tbl("generations")} WHERE model IS NOT NULL ORDER BY model`))
        .map((r) => r.model),
    getGeneration: async (id) =>
      fixGeneration(await one(`SELECT * FROM ${tbl("generations")} WHERE generation_id=@p0`, [id])),

    // mapping
    getRawMapping: () => q(`SELECT criteria_content_type, generation_type FROM ${tbl("type_mapping")}`),
    replaceMapping: async (pairs) => {
      const tx = new sql.Transaction(pool);
      await tx.begin();
      try {
        await new sql.Request(tx).query(`DELETE FROM ${tbl("type_mapping")}`);
        for (const [ct, gt] of pairs) {
          const r = new sql.Request(tx);
          r.input("a", ct); r.input("b", gt);
          await r.query(`INSERT INTO ${tbl("type_mapping")} (criteria_content_type, generation_type) VALUES (@a,@b)`);
        }
        await tx.commit();
      } catch (e) {
        await tx.rollback();
        throw e;
      }
    },

    // eval results
    insertEvalResult: (obj) => insertRow("eval_results", obj),
    getEvalResults: (genId) =>
      q(`SELECT * FROM ${tbl("eval_results")} WHERE generation_id=@p0 ORDER BY run_at DESC`, [genId]),

    // generic (export only; import is gated to sqlite at the route)
    allRows: (base) => q(`SELECT * FROM ${tbl(base)}`),
    countRows: async (base) => (await one(`SELECT COUNT(*) AS n FROM ${tbl(base)}`)).n,
    chunkRows: (base, limit, offset) => {
      const order = PK[base].map((c) => `[${c}]`).join(",");
      return q(`SELECT * FROM ${tbl(base)} ORDER BY ${order} OFFSET @p0 ROWS FETCH NEXT @p1 ROWS ONLY`,
        [offset, limit]);
    },
    upsertRows: () => {
      throw new Error("import into SQL Server is not supported from the app; load via db/setup_temp_tables.py");
    },

    close: () => pool.close(),
  };
}
