import { useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Upload, Download, Loader2, CheckCircle2, AlertCircle, ListChecks, Sparkles,
} from "lucide-react";

type Kind = "criteria" | "generations";

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
