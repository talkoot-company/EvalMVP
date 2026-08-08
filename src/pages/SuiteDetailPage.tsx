import { useMemo, useState } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { suitesApi } from "@/api/suites";
import { useCriteria } from "@/hooks/useCriteria";
import { useCriteriaFilters } from "@/hooks/useCriteriaFilters";
import { SUITES_QUERY_KEY } from "@/hooks/useSuites";
import type { Suite, Criterion } from "@/types";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { InlineEdit } from "@/components/InlineEdit";
import { CriteriaFilterBar } from "@/components/CriteriaFilterBar";
import { SuiteTestPanel } from "@/components/SuiteTestPanel";
import { RewriteOrchestrationDialog } from "@/components/RewriteOrchestrationDialog";
import { ModelSelect } from "@/components/ModelSelect";
import { ArrowLeft, Loader2, Eye, EyeOff, ChevronUp, X, Plus, Download, Wand2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { downloadJson } from "@/lib/download";
import { toast } from "sonner";

function Section({ title, action, children }: { title: string; action?: React.ReactNode; children: React.ReactNode }) {
  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between gap-2">
        <p className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground">{title}</p>
        {action}
      </div>
      {children}
    </div>
  );
}

function CriterionMeta({ c }: { c: Criterion }) {
  return (
    <span className="flex-1 min-w-0">
      <span className={`text-sm ${!c.active ? "text-muted-foreground" : ""}`}>
        {c.criteria_name}
        {!c.active && <span className="ml-1.5 text-[10px] uppercase tracking-wide text-muted-foreground/70">(inactive)</span>}
      </span>
      <span className="mt-0.5 flex flex-wrap gap-1">
        <Badge variant="outline" className="text-[10px] border-blue-200 bg-blue-50 text-blue-700">{c.context}</Badge>
        <Badge variant="outline" className="text-[10px] border-violet-200 bg-violet-50 text-violet-700">{c.content_type}</Badge>
        {c.criteria_category && <Badge variant="outline" className="text-[10px]">{c.criteria_category}</Badge>}
      </span>
    </span>
  );
}

export default function SuiteDetailPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const qc = useQueryClient();

  const suiteKey = ["suites", id] as const;

  const { data: suite, isLoading, error } = useQuery({
    queryKey: suiteKey,
    queryFn: () => suitesApi.get(id!),
    enabled: !!id,
    staleTime: 1000 * 30,
  });

  const { data: criteria = [] } = useCriteria();
  const filters = useCriteriaFilters(criteria, {
    defaultActive: "active",
    defaultMarketplace: ["Universal"],
    defaultWellSpecified: true,
  });

  const invalidate = () => {
    qc.invalidateQueries({ queryKey: suiteKey });
    qc.invalidateQueries({ queryKey: SUITES_QUERY_KEY });
  };

  const saveMutation = useMutation({
    mutationFn: (patch: Partial<Pick<Suite, "name" | "description" | "active" | "rewrite_orchestration_prompt">>) => suitesApi.update(id!, patch),
    onSuccess: invalidate,
  });

  const toggleActiveMutation = useMutation({
    mutationFn: () => suitesApi.toggleActive(id!),
    onSuccess: invalidate,
  });

  // Optimistic + race-safe: the suite query refetches on window focus (staleTime
  // 0), so a plain fire-and-invalidate lets a stale in-flight GET land after the
  // write and silently drop a just-toggled criterion (it's still in the DB — a
  // reload brings it back). onMutate cancels outgoing refetches and applies the
  // change to the cache immediately; we only reconcile with the server once the
  // last concurrent toggle has settled.
  const assocMutationKey = ["suite-assoc", id] as const;
  const assocMutation = useMutation({
    mutationKey: assocMutationKey,
    mutationFn: ({ criterionId, add }: { criterionId: string; add: boolean }) =>
      add ? suitesApi.addCriterion(id!, criterionId) : suitesApi.removeCriterion(id!, criterionId),
    onMutate: async ({ criterionId, add }) => {
      await qc.cancelQueries({ queryKey: suiteKey });
      const prev = qc.getQueryData<Suite>(suiteKey);
      if (prev) {
        const ids = new Set(prev.criteria_ids ?? []);
        if (add) ids.add(criterionId); else ids.delete(criterionId);
        qc.setQueryData<Suite>(suiteKey, { ...prev, criteria_ids: [...ids] });
      }
      return { prev };
    },
    onError: (_err, _vars, ctx) => {
      if (ctx?.prev) qc.setQueryData(suiteKey, ctx.prev);
    },
    onSettled: () => {
      // Skip the refetch while other toggles are still in flight so an early
      // GET can't drop a not-yet-committed association; the last one reconciles.
      if (qc.isMutating({ mutationKey: assocMutationKey }) === 0) invalidate();
    },
  });

  function saveField(field: "name" | "description" | "rewrite_orchestration_prompt", value: string) {
    toast.promise(saveMutation.mutateAsync({ [field]: value }), {
      loading: "Saving…",
      success: "Saved",
      error: (e) => `Save failed: ${e instanceof Error ? e.message : String(e)}`,
    });
  }

  function saveModel(field: "eval_model" | "rewrite_model", value: string | null) {
    toast.promise(saveMutation.mutateAsync({ [field]: value }), {
      loading: "Saving…",
      success: "Saved",
      error: (e) => `Save failed: ${e instanceof Error ? e.message : String(e)}`,
    });
  }

  const associated = useMemo(() => new Set(suite?.criteria_ids ?? []), [suite]);
  const selected = useMemo(() => criteria.filter((c) => associated.has(c.id)), [criteria, associated]);
  const [showSelector, setShowSelector] = useState(false);
  const [orchestrationOpen, setOrchestrationOpen] = useState(false);

  // Export the suite's associated criteria as JSON (full criterion objects).
  function exportCriteria() {
    if (!suite) return;
    downloadJson(`suite-${suite.id}-criteria`, {
      kind: "suite_criteria",
      exported_at: new Date().toISOString(),
      suite: {
        id: suite.id,
        name: suite.name,
        description: suite.description,
        active: suite.active,
        criteria_ids: suite.criteria_ids,
      },
      criteria: selected,
    });
  }

  if (isLoading) {
    return <div className="p-6 flex items-center justify-center h-64 text-muted-foreground text-sm">Loading…</div>;
  }
  if (error || !suite) {
    return (
      <div className="p-6 space-y-4">
        <Button variant="ghost" size="sm" className="gap-1.5" onClick={() => navigate("/suites")}>
          <ArrowLeft className="h-4 w-4" /> Back to suites
        </Button>
        <p className="text-destructive text-sm">Suite not found.</p>
      </div>
    );
  }

  return (
    <div className="p-6 max-w-4xl space-y-8 animate-fade-in">
      <Button variant="ghost" size="sm" className="gap-1.5 -ml-2" onClick={() => navigate("/suites")}>
        <ArrowLeft className="h-4 w-4" /> Back to suites
      </Button>

      {/* Header: editable name + active toggle */}
      <div className="space-y-3">
        <div className="flex items-start gap-3 flex-wrap">
          <div className="flex-1 min-w-[240px]">
            <InlineEdit
              value={suite.name}
              onSave={(v) => { const t = v.trim(); if (t && t !== suite.name) saveField("name", t); }}
              placeholder="Suite name"
              saving={saveMutation.isPending}
              className="text-2xl font-bold tracking-tight"
            />
          </div>
          <button
            onClick={() => toast.promise(toggleActiveMutation.mutateAsync(), {
              loading: "Updating…",
              success: suite.active ? "Marked inactive" : "Marked active",
              error: "Update failed",
            })}
            disabled={toggleActiveMutation.isPending}
            className="mt-1 flex items-center gap-1.5"
            title={suite.active ? "Mark as inactive" : "Mark as active"}
          >
            {toggleActiveMutation.isPending
              ? <Loader2 className="h-3.5 w-3.5 animate-spin text-muted-foreground" />
              : suite.active
              ? <Badge variant="outline" className="border-green-200 bg-green-50 text-green-700 hover:bg-green-100 cursor-pointer gap-1"><Eye className="h-3 w-3" />Active</Badge>
              : <Badge variant="outline" className="border-gray-300 text-gray-400 hover:bg-gray-50 cursor-pointer gap-1"><EyeOff className="h-3 w-3" />Inactive</Badge>}
          </button>
        </div>
        <p className="font-mono text-[11px] text-muted-foreground">{suite.id}</p>
      </div>

      {/* Description */}
      <Section title="Description">
        <InlineEdit
          value={suite.description ?? ""}
          multiline
          minRows={3}
          onSave={(v) => saveField("description", v)}
          placeholder="Add a description…"
          saving={saveMutation.isPending}
          className="text-sm leading-relaxed"
        />
      </Section>

      {/* Rewrite orchestration prompt */}
      <Section title="Rewrite">
        <div className="flex items-center justify-between gap-3 border rounded-md px-3 py-2.5">
          <p className="text-sm text-muted-foreground">
            Rewrite orchestration prompt —{" "}
            <span className="font-medium text-foreground">
              {suite.rewrite_orchestration_prompt ? "custom" : "using default"}
            </span>
            . Builds a coherence thesis from the criteria feedback before each rewrite.
          </p>
          <Button
            variant="outline" size="sm" className="h-8 gap-1.5 text-xs shrink-0"
            onClick={() => setOrchestrationOpen(true)}
          >
            <Wand2 className="h-3.5 w-3.5" /> View / edit prompt
          </Button>
        </div>
      </Section>

      <RewriteOrchestrationDialog
        open={orchestrationOpen}
        onOpenChange={setOrchestrationOpen}
        value={suite.rewrite_orchestration_prompt}
        onSave={(v) => saveField("rewrite_orchestration_prompt", v)}
        saving={saveMutation.isPending}
      />

      {/* Per-suite models (persisted). null → default (gpt-5). */}
      <Section title="Models">
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="space-y-1.5">
            <label className="text-xs font-medium">Eval model</label>
            <ModelSelect
              className="h-9 w-full text-xs"
              value={suite.eval_model}
              onChange={(v) => saveModel("eval_model", v)}
              disabled={saveMutation.isPending}
            />
            <p className="text-[11px] text-muted-foreground">Used to assess copy against this suite's criteria.</p>
          </div>
          <div className="space-y-1.5">
            <label className="text-xs font-medium">Rewrite model</label>
            <ModelSelect
              className="h-9 w-full text-xs"
              value={suite.rewrite_model}
              onChange={(v) => saveModel("rewrite_model", v)}
              disabled={saveMutation.isPending}
            />
            <p className="text-[11px] text-muted-foreground">Used for the orchestration + rewrite steps.</p>
          </div>
        </div>
      </Section>

      {/* Associated criteria */}
      <Section
        title={`Associated criteria (${associated.size} selected)`}
        action={
          <Button
            variant="outline" size="sm" className="h-7 gap-1.5 text-xs"
            onClick={exportCriteria}
            disabled={selected.length === 0}
            title="Download the suite's criteria as JSON"
          >
            <Download className="h-3.5 w-3.5" /> Export JSON
          </Button>
        }
      >
        {/* Selected criteria — always visible */}
        <div className="border rounded-md divide-y">
          {selected.length === 0 ? (
            <p className="text-sm text-muted-foreground p-4 text-center">No criteria selected yet.</p>
          ) : (
            selected.map((c) => (
              <div key={c.id} className="flex items-start gap-3 px-3 py-2">
                <CriterionMeta c={c} />
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-7 px-2 text-xs text-muted-foreground hover:text-destructive shrink-0 gap-1"
                  onClick={() => assocMutation.mutate({ criterionId: c.id, add: false })}
                >
                  <X className="h-3.5 w-3.5" /> Remove
                </Button>
              </div>
            ))
          )}
        </div>

        {/* Toggle for the selection table */}
        <Button
          variant="outline"
          onClick={() => setShowSelector((p) => !p)}
          className={cn(
            "mt-3 w-full justify-center gap-2 h-11 border-2 border-dashed font-medium transition-colors",
            showSelector
              ? "border-primary/40 text-foreground bg-muted/40"
              : "text-muted-foreground hover:text-foreground hover:border-primary/50 hover:bg-muted/30",
          )}
        >
          {showSelector ? <ChevronUp className="h-4 w-4" /> : <Plus className="h-4 w-4" />}
          {showSelector ? "Hide criteria selection" : "Add / edit criteria"}
        </Button>

        {/* Selection checkbox table — expandable */}
        {showSelector && (
          <div className="mt-3 space-y-2">
            <CriteriaFilterBar filters={filters} />
            <div className="border rounded-md divide-y max-h-[460px] overflow-y-auto">
              {filters.filtered.length === 0 ? (
                <p className="text-sm text-muted-foreground p-4 text-center">No criteria match.</p>
              ) : (
                filters.filtered.map((c) => {
                  const checked = associated.has(c.id);
                  return (
                    <label
                      key={c.id}
                      className="flex items-start gap-3 px-3 py-2 hover:bg-muted/40 cursor-pointer transition-colors"
                    >
                      <Checkbox
                        checked={checked}
                        onCheckedChange={() => assocMutation.mutate({ criterionId: c.id, add: !checked })}
                        className="mt-0.5"
                        aria-label={checked ? "Remove from suite" : "Add to suite"}
                      />
                      <CriterionMeta c={c} />
                    </label>
                  );
                })
              )}
            </div>
          </div>
        )}
      </Section>

      {/* Test — run selected criteria against selected generations */}
      <Section title="Test">
        <SuiteTestPanel suiteId={suite.id} selectedCriteria={selected} defaultEvalModel={suite.eval_model} />
      </Section>
    </div>
  );
}
