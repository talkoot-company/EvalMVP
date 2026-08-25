import { useCallback, useEffect, useRef, useState } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { suiteWorkflowsApi } from "@/api/suiteWorkflows";
import { useSuites } from "@/hooks/useSuites";
import { useCriteria } from "@/hooks/useCriteria";
import { runWorkflow } from "@/lib/runWorkflow";
import { downloadJson } from "@/lib/download";
import { MODE_LABEL } from "@/components/WorkflowStepsBuilder";
import { ScoreBadge } from "@/components/ScoreBadge";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { ArrowLeft, ChevronRight, ChevronDown, Download, Loader2, RotateCw, CopyPlus, Workflow } from "lucide-react";
import { toast } from "sonner";
import type { WorkflowGrade, WorkflowRunStage } from "@/types";

function GradeRows({ grades }: { grades: WorkflowGrade[] }) {
  if (!grades.length) return <p className="text-xs text-muted-foreground italic">No criteria.</p>;
  return (
    <div className="space-y-1.5">
      {grades.map((g) => (
        <div key={g.criterion_id} className="flex items-start gap-2">
          <ScoreBadge score={g.score} desired={g.desired_score} />
          <span className="flex-1 min-w-0 text-xs">
            <span className="font-medium">{g.criterion_name}</span>
            {g.rationale && <span className="block text-muted-foreground">{g.rationale}</span>}
          </span>
        </div>
      ))}
    </div>
  );
}

const passCount = (grades: WorkflowGrade[]) => grades.filter((g) => String(g.score) === String(g.desired_score)).length;

// Side-by-side before/after of two pieces of copy, with a char-count delta.
function BeforeAfter({ before, after, beforeLabel = "Before", afterLabel = "After" }: {
  before: string; after: string; beforeLabel?: string; afterLabel?: string;
}) {
  const delta = after.length - before.length;
  const changed = after !== before;
  return (
    <div className="grid gap-2 sm:grid-cols-2">
      <div className="min-w-0">
        <div className="flex items-baseline justify-between mb-1">
          <p className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground">{beforeLabel}</p>
          <span className="text-[10px] tabular-nums text-muted-foreground">{before.length} ch</span>
        </div>
        <pre className="whitespace-pre-wrap break-words rounded-md border bg-muted/40 p-2 text-sm leading-relaxed font-sans min-h-full">{before || "(empty)"}</pre>
      </div>
      <div className="min-w-0">
        <div className="flex items-baseline justify-between mb-1">
          <p className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground">{afterLabel}</p>
          <span className="text-[10px] tabular-nums text-muted-foreground">
            {after.length} ch
            {changed && delta !== 0 && (
              <span className={delta > 0 ? "text-green-600" : "text-amber-600"}> ({delta > 0 ? "+" : ""}{delta})</span>
            )}
          </span>
        </div>
        <pre className={`whitespace-pre-wrap break-words rounded-md border p-2 text-sm leading-relaxed font-sans min-h-full ${changed ? "bg-blue-50/50 border-blue-200" : "bg-muted/40"}`}>{after || "(empty)"}</pre>
      </div>
    </div>
  );
}

function StageCard({ stage, workflowName, generationId }: { stage: WorkflowRunStage; workflowName: string; generationId: string }) {
  const [open, setOpen] = useState(stage.position === 0);
  const [showCopy, setShowCopy] = useState(true);
  const latest = stage.iterations.at(-1)?.grades ?? stage.initial_grades;
  const changed = stage.output_copy !== stage.input_copy;
  const total = stage.initial_grades.length;
  const startPass = passCount(stage.initial_grades);
  const endPass = passCount(latest);
  const improved = stage.iterations.length > 0; // only a rewrite can move the count

  const exportStage = () => {
    downloadJson(`workflow-stage-${stage.position + 1}-${generationId.slice(0, 8)}`, {
      kind: "workflow_stage_chain",
      exported_at: new Date().toISOString(),
      workflow_name: workflowName,
      generation_id: generationId,
      stage,
    });
  };

  return (
    <div className="border rounded-md">
      <button className="w-full flex items-center gap-2 px-3 py-2.5 text-left hover:bg-muted/40 transition-colors" onClick={() => setOpen((o) => !o)}>
        {open ? <ChevronDown className="h-3.5 w-3.5 shrink-0 text-muted-foreground" /> : <ChevronRight className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />}
        <Badge variant="outline" className="shrink-0 tabular-nums">{stage.position + 1}</Badge>
        <span className="text-sm font-medium shrink-0">{stage.suite_name}</span>
        <span className="text-[10px] text-muted-foreground shrink-0">{MODE_LABEL[stage.mode]}</span>
        {improved ? (
          <span className="text-[10px] font-medium shrink-0 flex items-center gap-1">
            <span className={startPass === total ? "text-green-600" : "text-amber-600"}>{startPass}/{total}</span>
            <span className="text-muted-foreground">→</span>
            <span className={endPass === total ? "text-green-600" : "text-amber-600"}>{endPass}/{total}</span>
            <span className="text-muted-foreground">pass</span>
          </span>
        ) : (
          <span className={`text-[10px] font-medium shrink-0 ${endPass === total ? "text-green-600" : "text-amber-600"}`}>
            {endPass}/{total} pass
          </span>
        )}
        {stage.status === "running" && <Loader2 className="h-3.5 w-3.5 animate-spin text-muted-foreground shrink-0" />}
        {stage.status === "error" && <span className="text-[10px] text-destructive shrink-0">error</span>}
        {stage.iterations.length > 0 && <span className="text-[10px] text-muted-foreground shrink-0">· {stage.iterations.length} rewrite{stage.iterations.length === 1 ? "" : "s"}</span>}
      </button>

      {open && (
        <div className="px-3 pb-3 space-y-3 border-t pt-3">
          <div className="space-y-1.5">
            <button
              className="flex items-center gap-1 text-[10px] font-semibold uppercase tracking-widest text-muted-foreground hover:text-foreground"
              onClick={() => setShowCopy((v) => !v)}
            >
              {showCopy ? <ChevronDown className="h-3 w-3" /> : <ChevronRight className="h-3 w-3" />}
              {changed ? "Before / after" : "Input copy"}
              {!changed && <span className="normal-case font-normal">· unchanged</span>}
            </button>
            {showCopy && (
              changed ? (
                <BeforeAfter before={stage.input_copy} after={stage.output_copy} beforeLabel="Input copy" afterLabel="Output copy (→ next stage)" />
              ) : (
                <pre className="whitespace-pre-wrap break-words rounded-md border bg-muted/40 p-2 text-sm leading-relaxed font-sans">{stage.input_copy || "(empty)"}</pre>
              )
            )}
          </div>
          {(stage.eval_model || stage.rewrite_model) && (
            <div className="flex flex-wrap gap-1.5">
              {stage.eval_model && (
                <Badge variant="outline" className="text-[10px] font-normal gap-1"><span className="text-muted-foreground">eval</span>{stage.eval_model}</Badge>
              )}
              {stage.mode !== "assess_only" && stage.rewrite_model && (
                <Badge variant="outline" className="text-[10px] font-normal gap-1"><span className="text-muted-foreground">rewrite</span>{stage.rewrite_model}</Badge>
              )}
            </div>
          )}
          <div>
            <p className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground mb-1">Assessment</p>
            <GradeRows grades={stage.initial_grades} />
          </div>
          {stage.iterations.map((it, i) => (
            <div key={i} className="rounded-md border p-2 space-y-2">
              <p className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground">Rewrite #{i + 1}</p>
              <pre className="whitespace-pre-wrap break-words rounded-md border bg-green-50/50 border-green-200 p-2 text-sm leading-relaxed font-sans">{it.content}</pre>
              {it.thesis && (
                <details className="group">
                  <summary className="cursor-pointer list-none flex items-center gap-1 text-[10px] font-semibold uppercase tracking-widest text-muted-foreground hover:text-foreground">
                    <ChevronRight className="h-3 w-3 group-open:hidden" /><ChevronDown className="h-3 w-3 hidden group-open:inline" /> Orchestration thesis
                  </summary>
                  <pre className="mt-1 whitespace-pre-wrap break-words rounded-md border bg-amber-50/50 border-amber-200 p-2 text-xs leading-relaxed font-sans">{it.thesis}</pre>
                </details>
              )}
              <GradeRows grades={it.grades} />
            </div>
          ))}
          <Button size="sm" variant="ghost" className="h-6 px-1.5 text-[11px] gap-1 text-muted-foreground hover:text-foreground" onClick={exportStage}>
            <Download className="h-3 w-3" /> Export this stage
          </Button>
        </div>
      )}
    </div>
  );
}

export default function SuiteWorkflowRunPage() {
  const { id, runId } = useParams<{ id: string; runId: string }>();
  const navigate = useNavigate();
  const qc = useQueryClient();

  const { data: run } = useQuery({
    queryKey: ["suite-workflow-run", runId],
    queryFn: () => suiteWorkflowsApi.runs.get(runId!),
    enabled: !!runId,
    // Server-executed runs advance on the backend — poll for their progress.
    refetchInterval: (query) => {
      const r = query.state.data;
      return r?.data?.executor === "server" && r.status === "running" ? 1500 : false;
    },
  });
  const { data: workflow } = useQuery({
    queryKey: ["suite-workflows", id],
    queryFn: () => suiteWorkflowsApi.get(id!),
    enabled: !!id,
  });
  const { data: suites = [] } = useSuites();
  const { data: criteria = [] } = useCriteria();

  const [stages, setStages] = useState<WorkflowRunStage[]>([]);
  const [status, setStatus] = useState<"running" | "done" | "error">("running");
  const started = useRef(false);
  const runningRef = useRef(false);
  const persistTimer = useRef<ReturnType<typeof setTimeout>>();

  // Reset per-run guards when navigating between runs (same component instance).
  useEffect(() => {
    started.current = false;
    runningRef.current = false;
  }, [runId]);

  // Adopt persisted state when the run loads (unless a live execution is in flight).
  useEffect(() => {
    if (run && !runningRef.current) { setStages(run.data?.stages ?? []); setStatus(run.status); }
  }, [run]);

  // Execute the workflow, streaming + persisting progress. Overwrites this run's row.
  const execute = useCallback(async () => {
    if (runningRef.current || !run || !workflow || !runId) return;
    if (!suites.length || !criteria.length) return; // wait for deps
    runningRef.current = true;
    // Preserve run-level model overrides across every progress persist.
    const meta = {
      generation_id: run.generation_id,
      original_copy: run.data.original_copy ?? "",
      eval_model: run.data.eval_model ?? null,
      rewrite_model: run.data.rewrite_model ?? null,
    };
    setStages([]);
    setStatus("running");

    const persist = (s: WorkflowRunStage[], st: "running" | "done" | "error") => {
      clearTimeout(persistTimer.current);
      persistTimer.current = setTimeout(() => {
        suiteWorkflowsApi.runs.update(runId, { status: st, data: { ...meta, stages: s } }).catch(() => { /* best-effort */ });
      }, 600);
    };

    try {
      const final = await runWorkflow({
        steps: workflow.steps ?? [],
        generationId: run.generation_id,
        originalCopy: meta.original_copy,
        suites,
        criteria,
        evalModel: meta.eval_model,
        rewriteModel: meta.rewrite_model,
        onStages: (s) => { setStages([...s]); persist(s, "running"); },
      });
      setStatus("done");
      clearTimeout(persistTimer.current);
      await suiteWorkflowsApi.runs.update(runId, { status: "done", data: { ...meta, stages: final } });
    } catch {
      setStatus("error");
      clearTimeout(persistTimer.current);
      setStages((s) => { suiteWorkflowsApi.runs.update(runId, { status: "error", data: { ...meta, stages: s } }).catch(() => {}); return s; });
    } finally {
      runningRef.current = false;
    }
  }, [run, workflow, suites, criteria, runId]);

  // Auto-run once when this is a fresh run and all inputs are loaded. Server-executed
  // runs (invoke endpoint) advance on the backend — never drive them from the client.
  useEffect(() => {
    if (started.current || !run || !workflow) return;
    if (run.data?.executor === "server") { started.current = true; return; }
    const alreadyRan = (run.data?.stages?.length ?? 0) > 0 || run.status !== "running";
    if (alreadyRan) return;
    if (!suites.length || !criteria.length) return;
    started.current = true;
    execute();
  }, [run, workflow, suites, criteria, execute]);

  // Rerun in place — overwrites the existing run row.
  const rerun = () => {
    if (runningRef.current) return;
    if (!window.confirm("Rerun this workflow? This overwrites the current run's results.")) return;
    started.current = true; // suppress the auto-run effect
    execute();
  };

  // Rerun as a copy — create a new run for the same copy and go run it.
  const rerunCopy = async () => {
    if (!run) return;
    try {
      const newRun = await suiteWorkflowsApi.runs.create(run.workflow_id, run.generation_id, {
        generation_id: run.generation_id,
        original_copy: run.data?.original_copy ?? "",
        stages: [],
        // Carry the run-level model overrides forward to the copy.
        eval_model: run.data?.eval_model ?? null,
        rewrite_model: run.data?.rewrite_model ?? null,
      });
      qc.invalidateQueries({ queryKey: ["suite-workflow-runs", run.workflow_id] });
      navigate(`/suite-workflows/${id}/runs/${newRun.id}`);
    } catch (e) {
      toast.error(`Failed to start new run: ${e instanceof Error ? e.message : String(e)}`);
    }
  };

  const exportRun = () => {
    if (!run) return;
    downloadJson(`workflow-run-${run.generation_id.slice(0, 8)}`, {
      kind: "workflow_run",
      exported_at: new Date().toISOString(),
      workflow_id: run.workflow_id,
      workflow_name: workflow?.name ?? null,
      generation_id: run.generation_id,
      original_copy: run.data?.original_copy ?? "",
      eval_model: run.data?.eval_model ?? null,
      rewrite_model: run.data?.rewrite_model ?? null,
      stages,
    });
  };

  if (!run) return <div className="p-6 text-sm text-muted-foreground">Loading run…</div>;

  const originalCopy = run.data?.original_copy ?? "";
  // Final copy = last stage that produced output; falls back to the original.
  const finalCopy = [...stages].reverse().find((s) => s.output_copy)?.output_copy ?? originalCopy;

  // Snapshot of the models actually used, read off the stages (each stage records
  // the resolved deployment). Falls back to the run-level override, then "—".
  const distinct = (xs: (string | undefined)[]) => [...new Set(xs.filter((x): x is string => !!x))];
  const usedEval = distinct(stages.map((s) => s.eval_model));
  const usedRewrite = distinct(stages.filter((s) => s.mode !== "assess_only").map((s) => s.rewrite_model));
  const evalLabel = usedEval.length ? usedEval.join(", ") : (run.data?.eval_model ?? "—");
  const rewriteLabel = usedRewrite.length ? usedRewrite.join(", ") : (run.data?.rewrite_model ?? "—");

  return (
    <div className="p-6 max-w-4xl space-y-5 animate-fade-in">
      <button onClick={() => navigate(`/suite-workflows/${id}`)} className="flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground">
        <ArrowLeft className="h-4 w-4" /> Back to workflow
      </button>

      <div className="flex items-start justify-between gap-3">
        <div className="flex items-start gap-2 min-w-0">
          <Workflow className="h-6 w-6 text-muted-foreground mt-0.5 shrink-0" />
          <div className="min-w-0">
            <h1 className="text-xl font-bold tracking-tight truncate">{workflow?.name ?? "Workflow run"}</h1>
            <p className="text-xs text-muted-foreground">
              copy <span className="font-mono">{run.generation_id.slice(0, 8)}</span> ·{" "}
              <span className={status === "done" ? "text-green-600" : status === "error" ? "text-destructive" : "text-amber-600"}>{status}</span>
              {status === "running" && <Loader2 className="inline h-3 w-3 ml-1 animate-spin" />}
            </p>
            <div className="flex flex-wrap gap-1.5 mt-1.5">
              <Badge variant="outline" className="text-[10px] font-normal gap-1">
                <span className="text-muted-foreground">eval</span>
                {evalLabel}
              </Badge>
              <Badge variant="outline" className="text-[10px] font-normal gap-1">
                <span className="text-muted-foreground">rewrite</span>
                {rewriteLabel}
              </Badge>
              {run.data?.eval_model || run.data?.rewrite_model ? (
                <span className="text-[10px] text-muted-foreground self-center">· run override</span>
              ) : null}
            </div>
          </div>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <Button size="sm" variant="outline" className="gap-1.5" disabled={status === "running"} onClick={rerun} title="Rerun this workflow, overwriting this run">
            <RotateCw className="h-3.5 w-3.5" /> Rerun
          </Button>
          <Button size="sm" variant="outline" className="gap-1.5" onClick={rerunCopy} title="Create a new run for the same copy and run it">
            <CopyPlus className="h-3.5 w-3.5" /> Rerun copy
          </Button>
          <Button size="sm" variant="outline" className="gap-1.5" disabled={stages.length === 0} onClick={exportRun}>
            <Download className="h-3.5 w-3.5" /> Export run
          </Button>
        </div>
      </div>

      {/* Stages */}
      <div className="space-y-2">
        {stages.length === 0 ? (
          <p className="text-sm text-muted-foreground p-4 text-center border rounded-md flex items-center justify-center gap-1.5">
            <Loader2 className="h-3.5 w-3.5 animate-spin" /> Starting run…
          </p>
        ) : (
          stages.map((stage) => (
            <StageCard key={stage.position} stage={stage} workflowName={workflow?.name ?? ""} generationId={run.generation_id} />
          ))
        )}
      </div>

      {/* Overall before/after: original copy → final stage output — sits below the stages */}
      {stages.length > 0 && (
        <div className="rounded-md border p-3 space-y-2">
          <p className="text-xs font-semibold">Product copy: original → final</p>
          <BeforeAfter before={originalCopy} after={finalCopy} beforeLabel="Original" afterLabel="Final" />
        </div>
      )}
    </div>
  );
}
