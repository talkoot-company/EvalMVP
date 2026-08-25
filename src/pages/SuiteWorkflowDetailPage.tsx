import { useParams, useNavigate } from "react-router-dom";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { suiteWorkflowsApi } from "@/api/suiteWorkflows";
import { SUITE_WORKFLOWS_QUERY_KEY } from "@/hooks/useSuiteWorkflows";
import type { SuiteWorkflow } from "@/types";
import { InlineEdit } from "@/components/InlineEdit";
import { WorkflowStepsBuilder } from "@/components/WorkflowStepsBuilder";
import { WorkflowRunsSection } from "@/components/WorkflowRunsSection";
import { ArrowLeft, Workflow } from "lucide-react";
import { toast } from "sonner";
import type { WorkflowStep } from "@/types";

export default function SuiteWorkflowDetailPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const workflowKey = ["suite-workflows", id] as const;

  const { data: workflow, isLoading, error } = useQuery({
    queryKey: workflowKey,
    queryFn: () => suiteWorkflowsApi.get(id!),
    enabled: !!id,
    staleTime: 1000 * 30,
  });

  const saveMutation = useMutation({
    mutationFn: (patch: Partial<Pick<SuiteWorkflow, "name" | "description" | "steps">>) => suiteWorkflowsApi.update(id!, patch),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: workflowKey });
      qc.invalidateQueries({ queryKey: SUITE_WORKFLOWS_QUERY_KEY });
    },
  });

  const saveField = (field: "name" | "description", value: string) => {
    toast.promise(saveMutation.mutateAsync({ [field]: value }), {
      loading: "Saving…",
      success: "Saved",
      error: (e) => `Save failed: ${e instanceof Error ? e.message : String(e)}`,
    });
  };

  const saveSteps = (steps: WorkflowStep[]) => {
    // Optimistically reflect the change so the builder stays responsive.
    qc.setQueryData(workflowKey, (prev: SuiteWorkflow | undefined) => (prev ? { ...prev, steps } : prev));
    saveMutation.mutate({ steps });
  };

  if (isLoading) {
    return <div className="p-6 text-sm text-muted-foreground">Loading workflow…</div>;
  }
  if (error || !workflow) {
    return (
      <div className="p-6 space-y-4">
        <button onClick={() => navigate("/suite-workflows")} className="flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground">
          <ArrowLeft className="h-4 w-4" /> Back to workflows
        </button>
        <p className="text-sm text-destructive">Workflow not found.</p>
      </div>
    );
  }

  return (
    <div className="p-6 max-w-4xl space-y-6 animate-fade-in">
      {/* Back */}
      <button
        onClick={() => navigate("/suite-workflows")}
        className="flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground"
      >
        <ArrowLeft className="h-4 w-4" /> Back to workflows
      </button>

      {/* Header */}
      <div className="flex items-start gap-2">
        <Workflow className="h-6 w-6 text-muted-foreground mt-1 shrink-0" />
        <div className="flex-1 min-w-0">
          <InlineEdit
            value={workflow.name}
            onSave={(v) => saveField("name", v)}
            placeholder="Untitled workflow"
            saving={saveMutation.isPending}
            className="text-2xl font-bold tracking-tight"
          />
          <p className="font-mono text-[11px] text-muted-foreground mt-1">{workflow.id}</p>
        </div>
      </div>

      {/* Description */}
      <div className="space-y-2">
        <p className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground">Description</p>
        <InlineEdit
          value={workflow.description ?? ""}
          multiline
          minRows={3}
          onSave={(v) => saveField("description", v)}
          placeholder="Add a description…"
          saving={saveMutation.isPending}
          className="text-sm leading-relaxed"
        />
      </div>

      {/* Steps builder — the ordered chain of suites */}
      <WorkflowStepsBuilder steps={workflow.steps ?? []} onChange={saveSteps} saving={saveMutation.isPending} />

      {/* Runs */}
      <WorkflowRunsSection workflowId={workflow.id} steps={workflow.steps ?? []} />
    </div>
  );
}
