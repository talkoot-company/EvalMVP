// SQL Server data store (mssql/tedious). Opt-in backend (DB_BACKEND=mssql).
// Reads/writes the prefixed temp tables (default temp_Brian_*) in dev-golfcarts.
// Same method surface as store-sqlite.js, but every method is async.
import sql from "mssql";
import { DEFAULT_PROMPTS } from "./prompt-templates.js";

const BOOL_COLS = { criteria: ["active"], generations: ["is_valid"], suites: ["active"] };
const DATE_COLS = { criteria: ["created_at", "updated_at", "uploaded_at"], eval_results: ["run_at"], suites: ["created_at", "updated_at"], suite_workflows: ["created_at", "updated_at"], suite_workflow_runs: ["created_at", "updated_at"], prompt_templates: ["created_at", "updated_at"], criteria_uploads: ["uploaded_at"] };
const PK = {
  criteria: ["id"],
  generations: ["generation_id"],
  eval_results: ["id"],
  type_mapping: ["criteria_content_type", "generation_type"],
  suites: ["id"],
  suite_criteria: ["suite_id", "criterion_id"],
  prompt_templates: ["id"],
  criteria_uploads: ["id"],
};

const GEN_LIST_COLS =
  "generation_id, model, created_at, system_prompt, last_user_message, " +
  "few_shot_count, temperature, max_tokens, response_content, prompt_tokens, " +
  "completion_tokens, total_tokens, finish_reason, is_valid, dataset, " +
  "CASE WHEN product_json IS NOT NULL AND product_json <> '{}' THEN 1 ELSE 0 END AS has_product_data";

// SQL predicate identifying generations with valid (non-empty) stored product data.
const HAS_PRODUCT_DATA_SQL = "product_json IS NOT NULL AND product_json <> '{}'";

// Generation-type classification (CHARINDEX dialect; mirrors store-sqlite's
// TYPE_CASE_SQL and the frontend inferType). Used for by-type counts AND filtering.
const TYPE_CASE_SQL = `CASE
      WHEN CHARINDEX('bullet', LOWER(system_prompt)) > 0 THEN 'Bullets'
      WHEN CHARINDEX('sustainab', LOWER(system_prompt)) > 0 THEN 'Sustainability'
      WHEN CHARINDEX('extract', LOWER(system_prompt)) > 0
        OR CHARINDEX('lookup', LOWER(system_prompt)) > 0
        OR CHARINDEX('identify', LOWER(system_prompt)) > 0 THEN 'Extraction'
      WHEN CHARINDEX('title', LOWER(system_prompt)) > 0
        OR CHARINDEX('subhead', LOWER(system_prompt)) > 0
        OR CHARINDEX('headline', LOWER(system_prompt)) > 0
        OR CHARINDEX('naming', LOWER(system_prompt)) > 0 THEN 'Title'
      WHEN CHARINDEX('description', LOWER(system_prompt)) > 0
        OR CHARINDEX('copywriter', LOWER(system_prompt)) > 0
        OR CHARINDEX('copy', LOWER(system_prompt)) > 0 THEN 'Description'
      ELSE 'Other'
    END`;

// SQL Server dialect of the type-classification query (CHARINDEX instead of instr).
const COUNTS_BY_TYPE_SQL = (tbl) => `
  SELECT type, COUNT(*) AS cnt FROM (
    SELECT ${TYPE_CASE_SQL} AS type
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

// suite_workflows.steps is stored as a JSON string; (de)serialize around row helpers.
function parseWorkflowSteps(row) {
  if (!row) return row;
  let steps = [];
  try { steps = row.steps ? JSON.parse(row.steps) : []; } catch { steps = []; }
  return { ...row, steps: Array.isArray(steps) ? steps : [] };
}
function serializeWorkflowSteps(obj) {
  if (obj && "steps" in obj) return { ...obj, steps: JSON.stringify(obj.steps ?? []) };
  return obj;
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

  // Self-provision the refinement_chains table — it isn't created by
  // db/setup_temp_tables.py, so create it on connect if absent.
  await q(
    `IF OBJECT_ID(N'[dbo].[${prefix}refinement_chains]', N'U') IS NULL
     CREATE TABLE [dbo].[${prefix}refinement_chains] (
       id             NVARCHAR(300) NOT NULL PRIMARY KEY,
       generation_id  NVARCHAR(64)  NOT NULL,
       criterion_id   NVARCHAR(200) NOT NULL,
       criterion_name NVARCHAR(500) NULL,
       data           NVARCHAR(MAX) NOT NULL,
       created_at     DATETIME2(7)  NOT NULL,
       updated_at     DATETIME2(7)  NOT NULL
     );`
  );

  // Self-provision the suite_rewrite_chains table (aggregate-rewrite iterations
  // per suite+generation). Keyed by "<suite_id>::<generation_id>".
  await q(
    `IF OBJECT_ID(N'[dbo].[${prefix}suite_rewrite_chains]', N'U') IS NULL
     CREATE TABLE [dbo].[${prefix}suite_rewrite_chains] (
       id             NVARCHAR(300) NOT NULL PRIMARY KEY,
       suite_id       NVARCHAR(200) NOT NULL,
       generation_id  NVARCHAR(64)  NOT NULL,
       data           NVARCHAR(MAX) NOT NULL,
       created_at     DATETIME2(7)  NOT NULL,
       updated_at     DATETIME2(7)  NOT NULL
     );`
  );
  await q(
    `IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = N'idx_${prefix}suite_rewrite_suite')
     CREATE INDEX [idx_${prefix}suite_rewrite_suite] ON [dbo].[${prefix}suite_rewrite_chains](suite_id);`
  );

  // Self-provision the generations.product_json column (persisted extracted
  // product record). db/setup_temp_tables.py doesn't create it.
  await q(
    `IF COL_LENGTH(N'[dbo].[${prefix}generations]', N'product_json') IS NULL
     ALTER TABLE [dbo].[${prefix}generations] ADD product_json NVARCHAR(MAX) NULL;`
  );
  // Persisted (keyword-derived) generation type + supporting index, so type
  // filtering is an indexed lookup instead of a per-query CHARINDEX scan.
  await q(
    `IF COL_LENGTH(N'[dbo].[${prefix}generations]', N'gen_type') IS NULL
     ALTER TABLE [dbo].[${prefix}generations] ADD gen_type NVARCHAR(20) NULL;`
  );
  // Dataset discriminator (e.g. 'cocacola' / 'puma') so the UI can scope
  // generations by dataset. Populated/backfilled by db/import_puma.py.
  await q(
    `IF COL_LENGTH(N'[dbo].[${prefix}generations]', N'dataset') IS NULL
     ALTER TABLE [dbo].[${prefix}generations] ADD dataset NVARCHAR(50) NULL;`
  );
  // Provenance columns for bulk-uploaded criteria.
  await q(
    `IF COL_LENGTH(N'[dbo].[${prefix}criteria]', N'upload_source') IS NULL
     ALTER TABLE [dbo].[${prefix}criteria] ADD upload_source NVARCHAR(500) NULL;`
  );
  await q(
    `IF COL_LENGTH(N'[dbo].[${prefix}criteria]', N'uploaded_at') IS NULL
     ALTER TABLE [dbo].[${prefix}criteria] ADD uploaded_at DATETIME2(7) NULL;`
  );
  await q(
    `IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = N'idx_${prefix}generations_gen_type')
     CREATE INDEX [idx_${prefix}generations_gen_type] ON [dbo].[${prefix}generations](gen_type);`
  );
  await q(
    `IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = N'idx_${prefix}generations_dataset')
     CREATE INDEX [idx_${prefix}generations_dataset] ON [dbo].[${prefix}generations](dataset);`
  );

  // Self-provision the suites + suite_criteria (junction) tables. Also created by
  // db/setup_temp_tables.py, but self-provisioning keeps the app working anywhere.
  await q(
    `IF OBJECT_ID(N'[dbo].[${prefix}suites]', N'U') IS NULL
     CREATE TABLE [dbo].[${prefix}suites] (
       id           NVARCHAR(200)  NOT NULL PRIMARY KEY,
       name         NVARCHAR(500)  NOT NULL,
       description  NVARCHAR(MAX)  NULL,
       active       BIT            NOT NULL,
       rewrite_orchestration_prompt NVARCHAR(MAX) NULL,
       eval_model    NVARCHAR(200) NULL,
       rewrite_model NVARCHAR(200) NULL,
       created_at   DATETIME2(7)   NOT NULL,
       updated_at   DATETIME2(7)   NOT NULL
     );`
  );
  // Self-provision the per-suite rewrite orchestration prompt column on existing
  // tables (the CREATE above only covers fresh installs).
  await q(
    `IF COL_LENGTH(N'[dbo].[${prefix}suites]', N'rewrite_orchestration_prompt') IS NULL
     ALTER TABLE [dbo].[${prefix}suites] ADD rewrite_orchestration_prompt NVARCHAR(MAX) NULL;`
  );
  // Self-provision the per-suite eval/rewrite model columns on existing tables.
  await q(
    `IF COL_LENGTH(N'[dbo].[${prefix}suites]', N'eval_model') IS NULL
     ALTER TABLE [dbo].[${prefix}suites] ADD eval_model NVARCHAR(200) NULL;`
  );
  await q(
    `IF COL_LENGTH(N'[dbo].[${prefix}suites]', N'rewrite_model') IS NULL
     ALTER TABLE [dbo].[${prefix}suites] ADD rewrite_model NVARCHAR(200) NULL;`
  );
  await q(
    `IF OBJECT_ID(N'[dbo].[${prefix}suite_criteria]', N'U') IS NULL
     CREATE TABLE [dbo].[${prefix}suite_criteria] (
       suite_id     NVARCHAR(200) NOT NULL,
       criterion_id NVARCHAR(200) NOT NULL,
       CONSTRAINT [PK_${prefix}suite_criteria] PRIMARY KEY (suite_id, criterion_id)
     );`
  );
  // Self-provision suite_workflows (ordered chain of suites; `steps` is JSON).
  await q(
    `IF OBJECT_ID(N'[dbo].[${prefix}suite_workflows]', N'U') IS NULL
     CREATE TABLE [dbo].[${prefix}suite_workflows] (
       id           NVARCHAR(200)  NOT NULL PRIMARY KEY,
       name         NVARCHAR(500)  NOT NULL,
       description  NVARCHAR(MAX)  NULL,
       steps        NVARCHAR(MAX)  NULL,
       created_at   DATETIME2(7)   NOT NULL,
       updated_at   DATETIME2(7)   NOT NULL
     );`
  );
  await q(
    `IF COL_LENGTH(N'[dbo].[${prefix}suite_workflows]', N'steps') IS NULL
     ALTER TABLE [dbo].[${prefix}suite_workflows] ADD steps NVARCHAR(MAX) NULL;`
  );
  // Suite workflow runs (one run = one workflow × one generation; `data` is the JSON run tree).
  await q(
    `IF OBJECT_ID(N'[dbo].[${prefix}suite_workflow_runs]', N'U') IS NULL
     CREATE TABLE [dbo].[${prefix}suite_workflow_runs] (
       id             NVARCHAR(200)  NOT NULL PRIMARY KEY,
       workflow_id    NVARCHAR(200)  NOT NULL,
       generation_id  NVARCHAR(64)   NOT NULL,
       status         NVARCHAR(20)   NOT NULL,
       data           NVARCHAR(MAX)  NOT NULL,
       created_at     DATETIME2(7)   NOT NULL,
       updated_at     DATETIME2(7)   NOT NULL
     );`
  );
  await q(
    `IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = N'idx_${prefix}suite_workflow_runs_workflow')
     CREATE INDEX [idx_${prefix}suite_workflow_runs_workflow] ON [dbo].[${prefix}suite_workflow_runs](workflow_id);`
  );
  await q(
    `IF OBJECT_ID(N'[dbo].[${prefix}prompt_templates]', N'U') IS NULL
     CREATE TABLE [dbo].[${prefix}prompt_templates] (
       id           NVARCHAR(200)  NOT NULL PRIMARY KEY,
       name         NVARCHAR(500)  NOT NULL,
       description  NVARCHAR(MAX)  NULL,
       category     NVARCHAR(200)  NULL,
       template     NVARCHAR(MAX)  NOT NULL,
       placeholders NVARCHAR(MAX)  NULL,
       created_at   DATETIME2(7)   NOT NULL,
       updated_at   DATETIME2(7)   NOT NULL
     );`
  );
  await q(
    `IF OBJECT_ID(N'[dbo].[${prefix}criteria_uploads]', N'U') IS NULL
     CREATE TABLE [dbo].[${prefix}criteria_uploads] (
       id             NVARCHAR(200) NOT NULL PRIMARY KEY,
       filename       NVARCHAR(500) NULL,
       source         NVARCHAR(500) NULL,
       uploaded_at    DATETIME2(7)  NOT NULL,
       criteria_count INT           NULL,
       created_count  INT           NULL,
       updated_count  INT           NULL,
       criterion_ids  NVARCHAR(MAX) NULL,
       raw_json       NVARCHAR(MAX) NOT NULL
     );`
  );

  const chainKey = (criterionId, generationId) => `${criterionId}::${generationId}`;
  const suiteRewriteKey = (suiteId, generationId) => `${suiteId}::${generationId}`;

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

  // Seed any default prompt template not present yet (self-heals; never
  // overwrites an edited row). mssql has no other seed-on-connect pattern.
  for (const p of DEFAULT_PROMPTS) {
    const existing = await one(`SELECT 1 AS n FROM ${tbl("prompt_templates")} WHERE id=@p0`, [p.id]);
    if (!existing) {
      const now = new Date().toISOString();
      await insertRow("prompt_templates", {
        id: p.id, name: p.name, description: p.description ?? null, category: p.category ?? null,
        template: p.template, placeholders: JSON.stringify(p.placeholders ?? []),
        created_at: now, updated_at: now,
      });
    }
  }

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
    listGenerations: async ({ search, model, dataset, limit, offset, validProductData, genTypes, minLen, maxLen }) => {
      const cond = [], params = [];
      if (search) {
        const p = params.length;
        cond.push(`(last_user_message LIKE @p${p} OR response_content LIKE @p${p + 1} OR system_prompt LIKE @p${p + 2})`);
        const l = `%${search}%`;
        params.push(l, l, l);
      }
      if (model) { cond.push(`model=@p${params.length}`); params.push(model); }
      if (dataset && dataset !== "all") { cond.push(`dataset=@p${params.length}`); params.push(dataset); }
      if (validProductData) cond.push(HAS_PRODUCT_DATA_SQL);
      if (genTypes && genTypes.length) {
        const placeholders = genTypes.map((_, i) => `@p${params.length + i}`).join(",");
        cond.push(`gen_type IN (${placeholders})`);
        params.push(...genTypes);
      }
      // Response-length band (character count of the generated copy).
      if (minLen != null) { cond.push(`LEN(response_content) >= @p${params.length}`); params.push(minLen); }
      if (maxLen != null) { cond.push(`LEN(response_content) < @p${params.length}`); params.push(maxLen); }
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
    listGenerationDatasets: async () =>
      (await q(`SELECT DISTINCT dataset FROM ${tbl("generations")} WHERE dataset IS NOT NULL ORDER BY dataset`))
        .map((r) => r.dataset),
    // p10/p25/p50/p75/p90 of response length (chars) over the given types (default
    // Description+Title), optionally scoped to a dataset — seeds the length filter bands.
    getLengthPercentiles: async ({ dataset, genTypes } = {}) => {
      const cond = ["response_content IS NOT NULL"], params = [];
      if (dataset && dataset !== "all") { cond.push(`dataset=@p${params.length}`); params.push(dataset); }
      const types = genTypes && genTypes.length ? genTypes : ["Description", "Title"];
      cond.push(`gen_type IN (${types.map((_, i) => `@p${params.length + i}`).join(",")})`);
      params.push(...types);
      // Single sort (one ROW_NUMBER over the int length), then nearest-rank pick
      // per percentile — far cheaper than 5 PERCENTILE_CONT window sorts over MAX.
      const nth = (frac) => `MAX(CASE WHEN rn = CAST(${frac} * cnt AS INT) + 1 THEN L END)`;
      const row = await one(
        `WITH ranked AS (
           SELECT CAST(LEN(response_content) AS INT) AS L,
                  ROW_NUMBER() OVER (ORDER BY LEN(response_content)) AS rn,
                  COUNT(*) OVER () AS cnt
           FROM ${tbl("generations")} WHERE ${cond.join(" AND ")}
         )
         SELECT MAX(cnt) AS count, ${nth("0.10")} AS p10, ${nth("0.25")} AS p25,
                ${nth("0.50")} AS p50, ${nth("0.75")} AS p75, ${nth("0.90")} AS p90
         FROM ranked`,
        params,
      );
      if (!row || !row.count) return { count: 0, p10: 0, p25: 0, p50: 0, p75: 0, p90: 0 };
      return { count: row.count, p10: row.p10, p25: row.p25, p50: row.p50, p75: row.p75, p90: row.p90 };
    },
    getGeneration: async (id) =>
      fixGeneration(await one(`SELECT * FROM ${tbl("generations")} WHERE generation_id=@p0`, [id])),

    // Insert an API-uploaded generation, then classify its gen_type via the same
    // SQL CASE used everywhere else (no JS reimplementation → no classifier drift).
    insertGeneration: async (obj) => {
      await insertRow("generations", obj);
      await q(`UPDATE ${tbl("generations")} SET gen_type=(${TYPE_CASE_SQL}) WHERE generation_id=@p0`, [obj.generation_id]);
    },
    deleteGeneration: (id) => q(`DELETE FROM ${tbl("generations")} WHERE generation_id=@p0`, [id]),

    // product data (extracted product record persisted per generation)
    setProductJson: (generationId, productJson) =>
      updateRow("generations", "generation_id", generationId, { product_json: productJson }),
    // For the bulk extraction script. `mode`: "unprocessed" (product_json IS NULL)
    // or "empty" (product_json = '{}', for a re-attempt via --retry-empty).
    // Keyset-paginated by generation_id (> afterId) so irrecoverable rows that
    // stay '{}' don't get re-fetched into an infinite loop.
    getGenerationsForExtraction: (mode, limit, afterId = "") => {
      const filter = mode === "empty" ? "product_json = '{}'" : "product_json IS NULL";
      return q(
        `SELECT TOP (@p0) generation_id, req_json FROM ${tbl("generations")}
         WHERE ${filter} AND generation_id > @p1 ORDER BY generation_id`,
        [limit, afterId],
      );
    },
    countGenerationsForExtraction: async (mode) => {
      const filter = mode === "empty" ? "product_json = '{}'" : "product_json IS NULL";
      return (await one(`SELECT COUNT(*) AS n FROM ${tbl("generations")} WHERE ${filter}`)).n;
    },

    // Persist the (keyword-derived) generation type so type filtering is an
    // indexed lookup, not a per-query CHARINDEX scan. Batched so a single UPDATE
    // never exceeds the request timeout; each pass flips rows out of the
    // WHERE gen_type IS NULL set, so it progresses and terminates.
    classifyGenTypes: async () => {
      let total = 0, n;
      do {
        const r = await pool.request().query(
          `UPDATE TOP (2000) ${tbl("generations")} SET gen_type = (${TYPE_CASE_SQL}) WHERE gen_type IS NULL`
        );
        n = r.rowsAffected?.[0] ?? 0;
        total += n;
      } while (n > 0);
      return total;
    },

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

    // refinement chains (saved post-edit / re-grade history per generation+criterion)
    getChain: async (criterionId, generationId) => {
      const row = await one(`SELECT * FROM ${tbl("refinement_chains")} WHERE id=@p0`, [chainKey(criterionId, generationId)]);
      if (!row) return null;
      return { ...row, data: typeof row.data === "string" ? JSON.parse(row.data) : row.data };
    },
    saveChain: async (criterionId, generationId, criterionName, data) => {
      const id = chainKey(criterionId, generationId);
      const now = new Date();
      const existing = await one(`SELECT created_at FROM ${tbl("refinement_chains")} WHERE id=@p0`, [id]);
      const createdAt = existing ? existing.created_at : now;
      await q(`DELETE FROM ${tbl("refinement_chains")} WHERE id=@p0`, [id]);
      await q(
        `INSERT INTO ${tbl("refinement_chains")}
           (id, generation_id, criterion_id, criterion_name, data, created_at, updated_at)
         VALUES (@p0,@p1,@p2,@p3,@p4,@p5,@p6)`,
        [id, generationId, criterionId, criterionName ?? null, JSON.stringify(data), createdAt, now]
      );
    },
    deleteChain: (criterionId, generationId) =>
      q(`DELETE FROM ${tbl("refinement_chains")} WHERE id=@p0`, [chainKey(criterionId, generationId)]),
    listChainGenerationIds: async (criterionId) =>
      (await q(`SELECT generation_id FROM ${tbl("refinement_chains")} WHERE criterion_id=@p0`, [criterionId]))
        .map((r) => r.generation_id),

    // suite rewrite chains (aggregate-rewrite iterations per suite+generation)
    getSuiteRewriteChain: async (suiteId, generationId) => {
      const row = await one(`SELECT * FROM ${tbl("suite_rewrite_chains")} WHERE id=@p0`, [suiteRewriteKey(suiteId, generationId)]);
      if (!row) return null;
      return { ...row, data: typeof row.data === "string" ? JSON.parse(row.data) : row.data };
    },
    saveSuiteRewriteChain: async (suiteId, generationId, data) => {
      const id = suiteRewriteKey(suiteId, generationId);
      const now = new Date();
      const existing = await one(`SELECT created_at FROM ${tbl("suite_rewrite_chains")} WHERE id=@p0`, [id]);
      const createdAt = existing ? existing.created_at : now;
      await q(`DELETE FROM ${tbl("suite_rewrite_chains")} WHERE id=@p0`, [id]);
      await q(
        `INSERT INTO ${tbl("suite_rewrite_chains")}
           (id, suite_id, generation_id, data, created_at, updated_at)
         VALUES (@p0,@p1,@p2,@p3,@p4,@p5)`,
        [id, suiteId, generationId, JSON.stringify(data), createdAt, now]
      );
    },
    deleteSuiteRewriteChain: (suiteId, generationId) =>
      q(`DELETE FROM ${tbl("suite_rewrite_chains")} WHERE id=@p0`, [suiteRewriteKey(suiteId, generationId)]),
    listSuiteRewriteChains: async (suiteId) =>
      (await q(`SELECT generation_id, data FROM ${tbl("suite_rewrite_chains")} WHERE suite_id=@p0`, [suiteId]))
        .map((r) => ({ generation_id: r.generation_id, data: typeof r.data === "string" ? JSON.parse(r.data) : r.data })),

    // suites (+ suite_criteria junction; mirrors the type_mapping pattern)
    listSuites: () => q(`SELECT * FROM ${tbl("suites")} ORDER BY name`),
    getSuite: (id) => one(`SELECT * FROM ${tbl("suites")} WHERE id=@p0`, [id]),
    insertSuite: (obj) => insertRow("suites", obj),
    updateSuite: (id, obj) => updateRow("suites", "id", id, obj),
    deleteSuite: async (id) => {
      await q(`DELETE FROM ${tbl("suite_criteria")} WHERE suite_id=@p0`, [id]);
      await q(`DELETE FROM ${tbl("suites")} WHERE id=@p0`, [id]);
    },
    getSuiteCriterionIds: async (suiteId) =>
      (await q(`SELECT criterion_id FROM ${tbl("suite_criteria")} WHERE suite_id=@p0`, [suiteId]))
        .map((r) => r.criterion_id),
    listAllSuiteCriteria: () => q(`SELECT suite_id, criterion_id FROM ${tbl("suite_criteria")}`),
    addSuiteCriterion: (suiteId, criterionId) =>
      q(`IF NOT EXISTS (SELECT 1 FROM ${tbl("suite_criteria")} WHERE suite_id=@p0 AND criterion_id=@p1)
         INSERT INTO ${tbl("suite_criteria")} (suite_id, criterion_id) VALUES (@p0,@p1)`,
        [suiteId, criterionId]),
    removeSuiteCriterion: (suiteId, criterionId) =>
      q(`DELETE FROM ${tbl("suite_criteria")} WHERE suite_id=@p0 AND criterion_id=@p1`, [suiteId, criterionId]),

    // suite workflows (ordered chain of suites; `steps` is JSON [{ suite_id, mode }])
    listSuiteWorkflows: async () =>
      (await q(`SELECT * FROM ${tbl("suite_workflows")} ORDER BY updated_at DESC`)).map(parseWorkflowSteps),
    getSuiteWorkflow: async (id) => parseWorkflowSteps(await one(`SELECT * FROM ${tbl("suite_workflows")} WHERE id=@p0`, [id])),
    insertSuiteWorkflow: (obj) => insertRow("suite_workflows", serializeWorkflowSteps(obj)),
    updateSuiteWorkflow: (id, obj) => updateRow("suite_workflows", "id", id, serializeWorkflowSteps(obj)),
    deleteSuiteWorkflow: async (id) => {
      await q(`DELETE FROM ${tbl("suite_workflow_runs")} WHERE workflow_id=@p0`, [id]);
      await q(`DELETE FROM ${tbl("suite_workflows")} WHERE id=@p0`, [id]);
    },

    // suite workflow runs (one run = one workflow × one generation; `data` is the JSON run tree)
    createSuiteWorkflowRun: async (run) => {
      const now = new Date();
      await q(
        `INSERT INTO ${tbl("suite_workflow_runs")} (id, workflow_id, generation_id, status, data, created_at, updated_at)
         VALUES (@p0,@p1,@p2,@p3,@p4,@p5,@p6)`,
        [run.id, run.workflow_id, run.generation_id, run.status ?? "running", JSON.stringify(run.data ?? {}), now, now]
      );
    },
    getSuiteWorkflowRun: async (id) => {
      const row = await one(`SELECT * FROM ${tbl("suite_workflow_runs")} WHERE id=@p0`, [id]);
      if (!row) return null;
      return { ...row, data: typeof row.data === "string" ? JSON.parse(row.data) : row.data };
    },
    listSuiteWorkflowRuns: async (workflowId) =>
      (await q(`SELECT * FROM ${tbl("suite_workflow_runs")} WHERE workflow_id=@p0 ORDER BY created_at DESC`, [workflowId]))
        .map((r) => ({ ...r, data: typeof r.data === "string" ? JSON.parse(r.data) : r.data })),
    updateSuiteWorkflowRun: async (id, { status, data }) => {
      const sets = ["updated_at=@p0"], params = [new Date()];
      if (status !== undefined) { sets.push(`status=@p${params.length}`); params.push(status); }
      if (data !== undefined) { sets.push(`data=@p${params.length}`); params.push(JSON.stringify(data)); }
      await q(`UPDATE ${tbl("suite_workflow_runs")} SET ${sets.join(", ")} WHERE id=@p${params.length}`, [...params, id]);
    },
    deleteSuiteWorkflowRun: (id) => q(`DELETE FROM ${tbl("suite_workflow_runs")} WHERE id=@p0`, [id]),

    // prompt templates
    listPromptTemplates: () => q(`SELECT * FROM ${tbl("prompt_templates")} ORDER BY category, name`),
    getPromptTemplate: (id) => one(`SELECT * FROM ${tbl("prompt_templates")} WHERE id=@p0`, [id]),
    updatePromptTemplate: (id, obj) => updateRow("prompt_templates", "id", id, obj),

    // criteria upload audit log (raw JSON kept for traceability)
    insertCriteriaUpload: (obj) => insertRow("criteria_uploads", obj),
    listCriteriaUploads: () =>
      q(`SELECT id, filename, source, uploaded_at, criteria_count, created_count, updated_count, criterion_ids
         FROM ${tbl("criteria_uploads")} ORDER BY uploaded_at DESC`),

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
