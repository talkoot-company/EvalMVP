import { useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { GenerationPickerDialog, type RunModelOverrides } from "@/components/GenerationPickerDialog";
import { suiteWorkflowsApi } from "@/api/suiteWorkflows";
import { useSuiteWorkflowRuns } from "@/hooks/useSuiteWorkflows";
import type { WorkflowStep } from "@/types";
import type { Generation } from "@/api/generations";
import { Play, ArrowRight, Trash2 } from "lucide-react";
import { toast } from "sonner";

function formatDate(iso: string): string {
  const d = new Date(iso);
  return isNaN(d.getTime()) ? "—" : d.toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });
}
const STATUS_STYLE: Record<string, string> = {
  running: "border-amber-200 bg-amber-50 text-amber-700",
  done: "border-green-200 bg-green-50 text-green-700",
  error: "border-red-200 bg-red-50 text-red-700",
};

// Snapshot of models actually used, derived from the run's stages (each stage
// records the resolved deployment). Falls back to the run-level override, then "—".
function modelSummary(run: { data?: { stages?: { eval_model?: string; rewrite_model?: string; mode?: string }[]; eval_model?: string | null; rewrite_model?: string | null } }): string {
  const stages = run.data?.stages ?? [];
  const distinct = (xs: (string | undefined)[]) => [...new Set(xs.filter((x): x is string => !!x))];
  const ev = distinct(stages.map((s) => s.eval_model));
  const rw = distinct(stages.filter((s) => s.mode !== "assess_only").map((s) => s.rewrite_model));
  const evLabel = ev.length ? ev.join(", ") : (run.data?.eval_model ?? "—");
  const rwLabel = rw.length ? rw.join(", ") : (run.data?.rewrite_model ?? "—");
  return `${evLabel} / ${rwLabel}`;
}

export function WorkflowRunsSection({ workflowId, steps }: { workflowId: string; steps: WorkflowStep[] }) {
  const navigate = useNavigate();
  const qc = useQueryClient();
  const { data: runs = [] } = useSuiteWorkflowRuns(workflowId);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [creating, setCreating] = useState(false);
  const [deletingId, setDeletingId] = useState<string | null>(null);

  // Number runs that share the same copy (generation) in creation order: (1), (2), …
  // The list arrives newest-first, so walk it ascending to assign ordinals.
  const { ordinal, copyCount } = useMemo(() => {
    const asc = [...runs].sort((a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime());
    const counter = new Map<string, number>();
    const ordinal = new Map<string, number>();
    for (const r of asc) {
      const n = (counter.get(r.generation_id) ?? 0) + 1;
      counter.set(r.generation_id, n);
      ordinal.set(r.id, n);
    }
    return { ordinal, copyCount: counter };
  }, [runs]);

  const deleteRun = async (runId: string) => {
    if (!window.confirm("Delete this run? This cannot be undone.")) return;
    setDeletingId(runId);
    try {
      await suiteWorkflowsApi.runs.delete(runId);
      qc.invalidateQueries({ queryKey: ["suite-workflow-runs", workflowId] });
    } catch (e) {
      toast.error(`Failed to delete run: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setDeletingId(null);
    }
  };

  const startRun = async (gen: Generation, models?: RunModelOverrides) => {
    setCreating(true);
    try {
      const run = await suiteWorkflowsApi.runs.create(workflowId, gen.generation_id, {
        generation_id: gen.generation_id,
        original_copy: gen.response_content ?? "",
        stages: [],
        eval_model: models?.evalModel ?? null,
        rewrite_model: models?.rewriteModel ?? null,
      });
      qc.invalidateQueries({ queryKey: ["suite-workflow-runs", workflowId] });
      setPickerOpen(false);
      navigate(`/suite-workflows/${workflowId}/runs/${run.id}`);
    } catch (e) {
      toast.error(`Failed to start run: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setCreating(false);
    }
  };

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between gap-2">
        <p className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground">Runs</p>
        <Button
          size="sm" className="h-8 gap-1.5 text-xs"
          disabled={steps.length === 0 || creating}
          onClick={() => setPickerOpen(true)}
          title={steps.length === 0 ? "Add at least one step first" : "Run copy through this workflow"}
        >
          <Play className="h-3.5 w-3.5" /> New run
        </Button>
      </div>

      <div className="border rounded-md divide-y">
        {runs.length === 0 ? (
          <p className="text-sm text-muted-foreground p-4 text-center">No runs yet.</p>
        ) : (
          runs.map((run) => (
            <div key={run.id} className="flex items-center hover:bg-muted/40 transition-colors">
              <button
                className="flex-1 min-w-0 flex items-center gap-3 px-3 py-2.5 text-left"
                onClick={() => navigate(`/suite-workflows/${workflowId}/runs/${run.id}`)}
              >
                <Badge variant="outline" className={`shrink-0 text-[10px] ${STATUS_STYLE[run.status] ?? ""}`}>{run.status}</Badge>
                <span className="font-mono text-xs shrink-0">{run.generation_id.slice(0, 8)}</span>
                {(copyCount.get(run.generation_id) ?? 0) > 1 && (
                  <span className="shrink-0 text-[10px] font-medium tabular-nums text-muted-foreground" title="Run number for this copy">({ordinal.get(run.id)})</span>
                )}
                <span className="text-xs text-muted-foreground">{(run.data?.stages?.length ?? 0)} / {steps.length} stages</span>
                <span className="text-[10px] text-muted-foreground shrink-0 hidden md:inline" title="Eval / rewrite model (actual)">
                  {modelSummary(run)}
                </span>
                <span className="ml-auto text-[10px] text-muted-foreground shrink-0">{formatDate(run.created_at)}</span>
                <ArrowRight className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
              </button>
              <button
                className="shrink-0 px-3 py-2.5 text-muted-foreground hover:text-destructive disabled:opacity-40"
                onClick={() => deleteRun(run.id)}
                disabled={deletingId === run.id}
                title="Delete run"
              >
                <Trash2 className="h-3.5 w-3.5" />
              </button>
            </div>
          ))
        )}
      </div>

      <GenerationPickerDialog open={pickerOpen} onOpenChange={setPickerOpen} onPick={startRun} confirmLabel="Start run" withModelOverrides />
    </div>
  );
}
