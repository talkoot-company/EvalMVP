// Bootstrap-data zip format: import/export of the eval dataset, via a `store`.
//
// Files come in three "kinds" so criteria and generations can be moved
// independently (the Data page uploads them in separate slots):
//   kind "criteria"    → criteria.jsonl + type_mapping.json
//   kind "generations" → generations-NNN.jsonl + eval_results.jsonl
//   kind "all"         → everything (legacy combined bootstrap zip)
//
// Zip layout (format "evalmvp-data" v1):
//   manifest.json          { format, version, kind, exported_at, counts }
//   criteria.jsonl         one criterion row per line (raw columns)
//   generations-NNN.jsonl  generations chunked 5000 rows/file to bound memory
//   eval_results.jsonl     one result row per line
//   type_mapping.json      [{ criteria_content_type, generation_type }]
import AdmZip from "adm-zip";

const FORMAT = "evalmvp-data";
const FORMAT_VERSION = 1;
const GENERATION_CHUNK = 5000;

export const KINDS = ["criteria", "generations", "all"];

const toJsonl = (rows) => rows.map((r) => JSON.stringify(r)).join("\n");

export async function exportZipBuffer(store, kind = "all") {
  if (!KINDS.includes(kind)) throw new Error(`Unknown export kind: ${kind}`);
  const includeCriteria = kind === "all" || kind === "criteria";
  const includeGenerations = kind === "all" || kind === "generations";

  const zip = new AdmZip();
  const counts = { criteria: 0, generations: 0, eval_results: 0, type_mapping: 0 };

  if (includeCriteria) {
    const criteria = await store.allRows("criteria");
    const typeMapping = await store.allRows("type_mapping");
    zip.addFile("criteria.jsonl", Buffer.from(toJsonl(criteria), "utf-8"));
    zip.addFile("type_mapping.json", Buffer.from(JSON.stringify(typeMapping, null, 2), "utf-8"));
    counts.criteria = criteria.length;
    counts.type_mapping = typeMapping.length;
  }

  if (includeGenerations) {
    const evalResults = await store.allRows("eval_results");
    zip.addFile("eval_results.jsonl", Buffer.from(toJsonl(evalResults), "utf-8"));
    counts.eval_results = evalResults.length;

    const genCount = await store.countRows("generations");
    let chunkIndex = 0;
    for (let offset = 0; offset < genCount; offset += GENERATION_CHUNK) {
      const rows = await store.chunkRows("generations", GENERATION_CHUNK, offset);
      const name = `generations-${String(chunkIndex).padStart(3, "0")}.jsonl`;
      zip.addFile(name, Buffer.from(toJsonl(rows), "utf-8"));
      chunkIndex++;
    }
    counts.generations = genCount;
  }

  const manifest = {
    format: FORMAT,
    version: FORMAT_VERSION,
    kind,
    exported_at: new Date().toISOString(),
    counts,
  };
  zip.addFile("manifest.json", Buffer.from(JSON.stringify(manifest, null, 2), "utf-8"));

  return zip.toBuffer();
}

const KIND_LABELS = { criteria: "criteria", generations: "generations", all: "combined" };

// expectKind: when set ("criteria"/"generations"), reject a file whose manifest
// kind is a different specific kind. A combined ("all") file is always accepted.
export async function importZipBuffer(store, buffer, expectKind = null) {
  let zip;
  try {
    zip = new AdmZip(buffer);
  } catch {
    throw new Error("That doesn't look like a valid .zip file");
  }
  const entryByName = new Map(zip.getEntries().map((e) => [e.entryName, e]));

  const manifestEntry = entryByName.get("manifest.json");
  if (!manifestEntry) throw new Error("Not an EvalMVP data file (manifest.json missing)");
  const manifest = JSON.parse(manifestEntry.getData().toString("utf-8"));
  if (manifest.format !== FORMAT) throw new Error(`Unexpected file format: ${manifest.format}`);
  if (manifest.version > FORMAT_VERSION) {
    throw new Error(`This file (version ${manifest.version}) is newer than this app supports (${FORMAT_VERSION}). Update the app.`);
  }

  const fileKind = manifest.kind || "all";
  if (expectKind && fileKind !== "all" && fileKind !== expectKind) {
    throw new Error(
      `This is a ${KIND_LABELS[fileKind]} file, but it was dropped in the ${KIND_LABELS[expectKind]} slot. ` +
      `Upload it under "${KIND_LABELS[fileKind]}" instead.`
    );
  }

  const imported = { criteria: 0, generations: 0, eval_results: 0, type_mapping: 0 };

  const importJsonl = async (table, text) => {
    const rows = [];
    for (const line of text.split("\n")) {
      const trimmed = line.trim();
      if (trimmed) rows.push(JSON.parse(trimmed));
    }
    if (rows.length) await store.upsertRows(table, rows);
    return rows.length;
  };

  for (const [name, entry] of entryByName) {
    if (name === "criteria.jsonl") {
      imported.criteria += await importJsonl("criteria", entry.getData().toString("utf-8"));
    } else if (/^generations-\d+\.jsonl$/.test(name)) {
      imported.generations += await importJsonl("generations", entry.getData().toString("utf-8"));
    } else if (name === "eval_results.jsonl") {
      imported.eval_results += await importJsonl("eval_results", entry.getData().toString("utf-8"));
    } else if (name === "type_mapping.json") {
      const rows = JSON.parse(entry.getData().toString("utf-8"));
      if (rows.length) await store.upsertRows("type_mapping", rows);
      imported.type_mapping += rows.length;
    }
  }

  return { manifest, imported };
}
