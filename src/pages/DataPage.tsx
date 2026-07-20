import { useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Upload, Download, Loader2, CheckCircle2, AlertCircle, ListChecks, Sparkles, FileJson, FileUp,
} from "lucide-react";
import { downloadJson } from "@/lib/download";
import { CRITERIA_UPLOAD_SPEC } from "@/lib/criteriaUploadSpec";

type Kind = "criteria" | "generations";

const VALID_CRITERIA_TYPES = ["yes-no", "numerical-scale", "numerical-count"];

interface ParsedUpload {
  raw: string;
  criteria: Record<string, unknown>[];
  source?: string;
  issues: string[];
}

// Parse + lightly validate an upload file client-side (mirrors the server's
// checks) so the user sees problems before uploading.
function parseUpload(raw: string): ParsedUpload {
  const parsed = JSON.parse(raw);
  const list = Array.isArray(parsed)
    ? parsed
    : (parsed && Array.isArray(parsed.criteria)) ? parsed.criteria : null;
  if (!list) throw new Error("Expected an object with a 'criteria' array (or a bare array of criteria).");
  if (list.length === 0) throw new Error("No criteria in the file.");
  const issues: string[] = [];
  list.forEach((c: Record<string, unknown>, i: number) => {
    const n = `#${i + 1}`;
    if (!c || typeof c !== "object") { issues.push(`${n}: not an object`); return; }
    if (!c.criteria_name) issues.push(`${n}: missing criteria_name`);
    if (!c.content_type) issues.push(`${n}: missing content_type`);
    if (!c.criteria_type) issues.push(`${n}: missing criteria_type`);
    else if (!VALID_CRITERIA_TYPES.includes(c.criteria_type as string)) issues.push(`${n}: invalid criteria_type "${c.criteria_type}"`);
  });
  return { raw, criteria: list, source: !Array.isArray(parsed) ? parsed.source : undefined, issues };
}

function BulkCriteriaUploadCard() {
  const qc = useQueryClient();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [filename, setFilename] = useState("");
  const [parsed, setParsed] = useState<ParsedUpload | null>(null);
  const [parseError, setParseError] = useState<string | null>(null);
  const [source, setSource] = useState("");
  const [uploading, setUploading] = useState(false);
  const [result, setResult] = useState<{ created: number; updated: number; total: number; source: string } | null>(null);
  const [error, setError] = useState<string | null>(null);

  function reset() {
    setParsed(null); setParseError(null); setResult(null); setError(null); setSource(""); setFilename("");
    if (fileInputRef.current) fileInputRef.current.value = "";
  }

  async function onFile(file: File) {
    setResult(null); setError(null); setParseError(null); setParsed(null);
    setFilename(file.name);
    setSource((s) => s || file.name);
    try {
      const text = await file.text();
      setParsed(parseUpload(text));
    } catch (e) {
      setParseError(e instanceof Error ? e.message : String(e));
    }
  }

  async function upload() {
    if (!parsed) return;
    setUploading(true); setError(null); setResult(null);
    try {
      const res = await fetch("/api/criteria/bulk-upload", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ filename, source: source.trim() || undefined, raw: parsed.raw }),
      });
      const body = await res.json().catch(() => ({ detail: `HTTP ${res.status}` }));
      if (!res.ok) {
        const extra = Array.isArray(body.errors)
          ? ` — ${body.errors.slice(0, 5).map((e: { index: number; message: string }) => `#${e.index + 1} ${e.message}`).join("; ")}${body.errors.length > 5 ? " …" : ""}`
          : "";
        throw new Error((body.detail || `HTTP ${res.status}`) + extra);
      }
      setResult(body);
      qc.invalidateQueries({ queryKey: ["criteria"] }); // upserted rows show on the Criteria page
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setUploading(false);
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <FileUp className="h-4 w-4" /> Bulk-upload criteria
        </CardTitle>
        <CardDescription>
          Upsert many criteria at once from a JSON file. Existing criteria (matched by id, or by name + content type)
          are updated; the rest are created. Every row is tagged with the upload date and source, and the raw file is
          kept for traceability.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="flex items-center gap-2 flex-wrap">
          <Button
            variant="outline" size="sm"
            onClick={() => downloadJson("criteria-upload-spec.schema", CRITERIA_UPLOAD_SPEC)}
          >
            <FileJson className="h-4 w-4 mr-2" /> Download JSON spec
          </Button>
          <span className="text-xs text-muted-foreground">Hand this schema (with examples) to an AI agent to generate conformant files.</span>
        </div>

        <input
          ref={fileInputRef}
          type="file"
          accept=".json,application/json"
          className="hidden"
          onChange={(e) => { const f = e.target.files?.[0]; if (f) onFile(f); }}
        />
        <div className="flex items-center gap-2">
          <Button variant="secondary" onClick={() => fileInputRef.current?.click()} disabled={uploading}>
            <Upload className="h-4 w-4 mr-2" /> Choose JSON file…
          </Button>
          {filename && <span className="text-xs text-muted-foreground font-mono truncate">{filename}</span>}
          {(parsed || parseError) && (
            <Button variant="ghost" size="sm" className="text-xs text-muted-foreground" onClick={reset} disabled={uploading}>Clear</Button>
          )}
        </div>

        {parseError && (
          <div className="flex items-start gap-2 text-sm text-destructive bg-red-50 border border-red-200 rounded-md p-3">
            <AlertCircle className="h-4 w-4 mt-0.5 shrink-0" />
            <p>Couldn't read the file: {parseError}</p>
          </div>
        )}

        {parsed && (
          <div className="space-y-3 rounded-md border p-3">
            <p className="text-sm"><strong>{parsed.criteria.length}</strong> criteri{parsed.criteria.length === 1 ? "on" : "a"} found.</p>
            {parsed.issues.length > 0 ? (
              <div className="flex items-start gap-2 text-xs text-amber-800 bg-amber-50 border border-amber-200 rounded-md p-2">
                <AlertCircle className="h-4 w-4 mt-0.5 shrink-0" />
                <div>
                  <p className="font-medium">{parsed.issues.length} issue{parsed.issues.length === 1 ? "" : "s"} — fix before uploading:</p>
                  <ul className="mt-1 list-disc pl-4 space-y-0.5">
                    {parsed.issues.slice(0, 8).map((m, i) => <li key={i}>{m}</li>)}
                    {parsed.issues.length > 8 && <li>…and {parsed.issues.length - 8} more</li>}
                  </ul>
                </div>
              </div>
            ) : (
              <p className="text-xs text-green-700 flex items-center gap-1.5"><CheckCircle2 className="h-3.5 w-3.5" /> All criteria look valid.</p>
            )}
            <label className="block space-y-1">
              <span className="text-xs font-medium text-muted-foreground">Source label (provenance)</span>
              <Input value={source} onChange={(e) => setSource(e.target.value)} placeholder="e.g. my-agent-batch" className="h-8 text-sm" />
            </label>
            <Button onClick={upload} disabled={uploading || parsed.issues.length > 0}>
              {uploading
                ? <><Loader2 className="h-4 w-4 mr-2 animate-spin" /> Uploading…</>
                : <><FileUp className="h-4 w-4 mr-2" /> Upload &amp; upsert {parsed.criteria.length}</>}
            </Button>
          </div>
        )}

        {result && (
          <div className="flex items-start gap-2 text-sm text-green-700 bg-green-50 border border-green-200 rounded-md p-3">
            <CheckCircle2 className="h-4 w-4 mt-0.5 shrink-0" />
            <div>
              <p className="font-medium">Upload complete</p>
              <p>{result.created} created, {result.updated} updated ({result.total} total) · source “{result.source}”.</p>
            </div>
          </div>
        )}
        {error && (
          <div className="flex items-start gap-2 text-sm text-destructive bg-red-50 border border-red-200 rounded-md p-3">
            <AlertCircle className="h-4 w-4 mt-0.5 shrink-0" />
            <p>{error}</p>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

interface ImportCounts {
  criteria: number;
  generations: number;
  eval_results: number;
  type_mapping: number;
}

interface ImportResponse {
  manifest: { exported_at: string; kind?: string };
  imported: ImportCounts;
}

function ImportExportCard({
  kind,
  icon: Icon,
  title,
  blurb,
  filenameHint,
  summarize,
}: {
  kind: Kind;
  icon: React.ElementType;
  title: string;
  blurb: string;
  filenameHint: string;
  summarize: (c: ImportCounts) => string;
}) {
  const qc = useQueryClient();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [importing, setImporting] = useState(false);
  const [result, setResult] = useState<ImportResponse | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function handleFile(file: File) {
    setImporting(true);
    setResult(null);
    setError(null);
    try {
      const form = new FormData();
      form.append("kind", kind); // append BEFORE the file so multer sees it
      form.append("file", file);
      const res = await fetch("/api/admin/import", { method: "POST", body: form });
      if (!res.ok) {
        const body = await res.json().catch(() => ({ detail: `HTTP ${res.status}` }));
        throw new Error(body.detail || `HTTP ${res.status}`);
      }
      setResult(await res.json());
      qc.invalidateQueries(); // imported rows may appear anywhere
    } catch (err) {
      setError(String(err instanceof Error ? err.message : err));
    } finally {
      setImporting(false);
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <Icon className="h-4 w-4" /> Upload {title.toLowerCase()}
        </CardTitle>
        <CardDescription>{blurb}</CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="rounded-md border border-dashed border-muted-foreground/30 bg-muted/30 p-3 text-xs text-muted-foreground">
          Choose the file named{" "}
          <code className="rounded bg-muted px-1 py-0.5 font-mono text-[11px] text-foreground">
            {filenameHint}
          </code>
        </div>

        <input
          ref={fileInputRef}
          type="file"
          accept=".zip"
          className="hidden"
          onChange={(e) => {
            const file = e.target.files?.[0];
            if (file) handleFile(file);
          }}
        />

        <Button onClick={() => fileInputRef.current?.click()} disabled={importing}>
          {importing ? (
            <><Loader2 className="h-4 w-4 mr-2 animate-spin" /> Importing…</>
          ) : (
            <><Upload className="h-4 w-4 mr-2" /> Choose {title.toLowerCase()} file…</>
          )}
        </Button>

        {result && (
          <div className="flex items-start gap-2 text-sm text-green-700 bg-green-50 border border-green-200 rounded-md p-3">
            <CheckCircle2 className="h-4 w-4 mt-0.5 shrink-0" />
            <div>
              <p className="font-medium">Import complete</p>
              <p>{summarize(result.imported)}</p>
            </div>
          </div>
        )}

        {error && (
          <div className="flex items-start gap-2 text-sm text-destructive bg-red-50 border border-red-200 rounded-md p-3">
            <AlertCircle className="h-4 w-4 mt-0.5 shrink-0" />
            <p>{error}</p>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

export default function DataPage() {
  return (
    <div className="p-6 max-w-3xl space-y-6 animate-fade-in">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Data</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Load your starting data here. Import the two files separately — criteria first, then
          generations. Existing rows with the same ID are overwritten; everything else is kept.
        </p>
      </div>

      <BulkCriteriaUploadCard />

      <ImportExportCard
        kind="criteria"
        icon={ListChecks}
        title="Criteria"
        blurb="The evaluation criteria and their scoring rubrics (plus the content-type mapping). This is what shows up on the Criteria page."
        filenameHint="evalmvp-criteria-*.zip"
        summarize={(c) =>
          `${c.criteria.toLocaleString()} criteria and ${c.type_mapping} type mappings loaded.`
        }
      />

      <ImportExportCard
        kind="generations"
        icon={Sparkles}
        title="Generations"
        blurb="The AI-generated product copy to be evaluated (plus any saved evaluation results). This is what shows up on the Generations page."
        filenameHint="evalmvp-generations-*.zip"
        summarize={(c) =>
          `${c.generations.toLocaleString()} generations and ${c.eval_results.toLocaleString()} evaluation results loaded.`
        }
      />

      {/* Export is a separate, secondary concern — kept out of the upload cards. */}
      <div className="border-t pt-4">
        <p className="text-xs font-medium text-muted-foreground mb-2">
          Export your data (criteria edits and evaluation results) to share or back up
        </p>
        <div className="flex items-center gap-2">
          <Button asChild variant="outline" size="sm">
            <a href="/api/admin/export?kind=criteria" download>
              <Download className="h-4 w-4 mr-2" /> Export criteria
            </a>
          </Button>
          <Button asChild variant="outline" size="sm">
            <a href="/api/admin/export?kind=generations" download>
              <Download className="h-4 w-4 mr-2" /> Export generations
            </a>
          </Button>
        </div>
      </div>
    </div>
  );
}
