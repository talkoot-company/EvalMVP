import { useMemo, useState } from "react";
import { useEvalCriteria, useEvalResults, useRunEval } from "@/hooks/useEvals";
import { useTypeMapping } from "@/hooks/useMapping";
import type { EvalResult } from "@/api/evals";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Play, Loader2, AlertCircle } from "lucide-react";

function inferGenerationType(systemPrompt: string | null): string {
  if (!systemPrompt) return "Other";
  const sp = systemPrompt.toLowerCase();
  if (sp.includes("bullet")) return "Bullets";
  if (sp.includes("sustainab")) return "Sustainability";
  if (sp.includes("extract") || sp.includes("lookup") || sp.includes("identify")) return "Extraction";
  if (sp.includes("title") || sp.includes("subhead") || sp.includes("headline") || sp.includes("naming")) return "Title";
  if (sp.includes("description") || sp.includes("copywriter") || sp.includes("copy")) return "Description";
  return "Other";
}

function ScoreBadge({ score, desired }: { score: string; desired: string }) {
  const label = desired ? `${score} / ${desired}` : score;
  const passed = desired && score === desired;
  const failed = desired && score !== desired;
  const className = passed
    ? "bg-green-100 text-green-800 border-green-200"
    : failed
    ? "bg-red-100 text-red-800 border-red-200"
    : "bg-slate-100 text-slate-700 border-slate-200";
  return (
    <Badge variant="outline" className={`text-sm font-bold px-3 py-0.5 ${className}`}>
      {label}
    </Badge>
  );
}

function EvalResultCard({ result }: { result: EvalResult }) {
  return (
    <div className="border rounded-md p-4 space-y-3 bg-background">
      <div className="flex items-center justify-between flex-wrap gap-2">
        <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">
          {result.criterion_name}
        </span>
        <ScoreBadge score={result.score} desired={result.desired_score} />
      </div>

      <p className="text-sm leading-relaxed">{result.rationale}</p>

      {result.evidence.length > 0 && (
        <div className="flex flex-wrap gap-2">
          {result.evidence.map((e, i) => (
            <span
              key={i}
              className="text-xs italic text-muted-foreground bg-muted px-2 py-1 rounded"
            >
              &ldquo;{e}&rdquo;
            </span>
          ))}
        </div>
      )}

      <p className="text-[10px] text-muted-foreground">
        {new Date(result.run_at).toLocaleString()} · {result.product_name}
      </p>
    </div>
  );
}

interface EvalPanelProps {
  generationId: string;
  systemPrompt?: string | null;
}

export function EvalPanel({ generationId, systemPrompt }: EvalPanelProps) {
  const [selectedCriterionId, setSelectedCriterionId] = useState("");

  const {
    data: criteria = [],
    isLoading: criteriaLoading,
    error: criteriaError,
  } = useEvalCriteria();

  const { data: mapping = {} } = useTypeMapping();

  const { data: pastResults = [] } = useEvalResults(generationId);

  const generationType = inferGenerationType(systemPrompt ?? null);

  // Which local criteria content_types are applicable to this generation type
  const applicableContentTypes = useMemo(
    () => Object.entries(mapping)
      .filter(([, genTypes]) => genTypes.includes(generationType))
      .map(([ct]) => ct),
    [mapping, generationType],
  );

  const runEval = useRunEval();

  const handleRun = () => {
    if (!selectedCriterionId) return;
    runEval.mutate({ generationId, criterionId: selectedCriterionId });
  };

  return (
    <div className="space-y-4 pt-2 border-t mt-4">
      <div className="flex items-center gap-2 flex-wrap">
        <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">
          Run Evaluation
        </p>
        <Badge variant="outline" className="text-[10px] font-medium border-slate-300 text-slate-600">
          {generationType}
        </Badge>
        {applicableContentTypes.length > 0 && (
          <span className="text-[10px] text-muted-foreground">
            → applies criteria for: {applicableContentTypes.join(", ")}
          </span>
        )}
      </div>

      {/* Criterion selector + run button */}
      <div className="flex items-center gap-2 flex-wrap">
        {criteriaError ? (
          <div className="flex items-center gap-2 text-sm text-destructive">
            <AlertCircle className="h-4 w-4" />
            Could not load criteria — check API connection
          </div>
        ) : (
          <Select
            value={selectedCriterionId}
            onValueChange={setSelectedCriterionId}
            disabled={criteriaLoading || runEval.isPending}
          >
            <SelectTrigger className="w-72">
              <SelectValue placeholder={criteriaLoading ? "Loading criteria…" : "Select a criterion"} />
            </SelectTrigger>
            <SelectContent>
              {criteria.map((c) => (
                <SelectItem key={c.criteriaId} value={c.criteriaId}>
                  {c.criteriaName}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        )}

        <Button
          size="sm"
          disabled={!selectedCriterionId || runEval.isPending || !!criteriaError}
          onClick={handleRun}
        >
          {runEval.isPending ? (
            <>
              <Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" />
              Running…
            </>
          ) : (
            <>
              <Play className="h-3.5 w-3.5 mr-1.5" />
              Run
            </>
          )}
        </Button>
      </div>

      {/* Error from run */}
      {runEval.isError && (
        <p className="text-sm text-destructive flex items-center gap-1">
          <AlertCircle className="h-4 w-4" />
          {String(runEval.error)}
        </p>
      )}

      {/* Latest result from this run */}
      {runEval.data && (
        <EvalResultCard result={runEval.data} />
      )}

      {/* Past results for this generation */}
      {pastResults.length > 0 && (
        <div className="space-y-2">
          <p className="text-xs text-muted-foreground">
            Previous results ({pastResults.length})
          </p>
          {pastResults.map((r) => (
            <EvalResultCard key={r.result_id} result={r} />
          ))}
        </div>
      )}
    </div>
  );
}
