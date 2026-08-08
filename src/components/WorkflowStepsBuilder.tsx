import { Button } from "@/components/ui/button";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { ChevronUp, ChevronDown, X, Plus } from "lucide-react";
import { useSuites } from "@/hooks/useSuites";
import type { WorkflowStep, WorkflowStepMode } from "@/types";

const MODE_OPTIONS: { value: WorkflowStepMode; label: string; hint: string }[] = [
  { value: "assess_only", label: "Assess only", hint: "Run the criteria, no rewrite" },
  { value: "rewrite_once", label: "Rewrite once", hint: "One rewrite pass" },
  { value: "rewrite_until_pass", label: "Rewrite up to 3× until pass", hint: "Rewrite until all criteria pass (max 3)" },
];
export const MODE_LABEL: Record<WorkflowStepMode, string> =
  Object.fromEntries(MODE_OPTIONS.map((m) => [m.value, m.label])) as Record<WorkflowStepMode, string>;

// Ordered chain-of-suites builder. Mirrors the suite↔criteria association UX, but
// ordered and with a per-step mode. Every change persists via onChange(steps).
export function WorkflowStepsBuilder({ steps, onChange, saving }: {
  steps: WorkflowStep[];
  onChange: (steps: WorkflowStep[]) => void;
  saving?: boolean;
}) {
  const { data: suites = [] } = useSuites();
  const suiteName = (id: string) => suites.find((s) => s.id === id)?.name ?? id;

  const setStep = (i: number, patch: Partial<WorkflowStep>) =>
    onChange(steps.map((s, idx) => (idx === i ? { ...s, ...patch } : s)));
  const removeStep = (i: number) => onChange(steps.filter((_, idx) => idx !== i));
  const move = (i: number, dir: -1 | 1) => {
    const j = i + dir;
    if (j < 0 || j >= steps.length) return;
    const next = [...steps];
    [next[i], next[j]] = [next[j], next[i]];
    onChange(next);
  };
  const addStep = () => {
    const firstSuite = suites[0]?.id ?? "";
    onChange([...steps, { suite_id: firstSuite, mode: "assess_only" }]);
  };

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between gap-2">
        <p className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground">
          Steps ({steps.length})
        </p>
        {saving && <span className="text-[10px] text-muted-foreground">Saving…</span>}
      </div>

      <div className="border rounded-md divide-y">
        {steps.length === 0 ? (
          <p className="text-sm text-muted-foreground p-4 text-center">
            No steps yet — add a suite to start the chain.
          </p>
        ) : (
          steps.map((step, i) => (
            <div key={i} className="flex items-center gap-3 px-3 py-2.5">
              <Badge variant="outline" className="shrink-0 tabular-nums">{i + 1}</Badge>

              <Select value={step.suite_id} onValueChange={(v) => setStep(i, { suite_id: v })}>
                <SelectTrigger className="h-9 flex-1 min-w-0 text-sm">
                  <SelectValue placeholder="Choose a suite">{suiteName(step.suite_id)}</SelectValue>
                </SelectTrigger>
                <SelectContent>
                  {suites.map((s) => (
                    <SelectItem key={s.id} value={s.id}>{s.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>

              <Select value={step.mode} onValueChange={(v) => setStep(i, { mode: v as WorkflowStepMode })}>
                <SelectTrigger className="h-9 w-64 text-xs shrink-0">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {MODE_OPTIONS.map((m) => (
                    <SelectItem key={m.value} value={m.value}>
                      <span className="flex flex-col">
                        <span>{m.label}</span>
                        <span className="text-[10px] text-muted-foreground">{m.hint}</span>
                      </span>
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>

              <div className="flex items-center gap-0.5 shrink-0">
                <Button variant="ghost" size="icon" className="h-7 w-7 text-muted-foreground"
                  onClick={() => move(i, -1)} disabled={i === 0} title="Move up">
                  <ChevronUp className="h-3.5 w-3.5" />
                </Button>
                <Button variant="ghost" size="icon" className="h-7 w-7 text-muted-foreground"
                  onClick={() => move(i, 1)} disabled={i === steps.length - 1} title="Move down">
                  <ChevronDown className="h-3.5 w-3.5" />
                </Button>
                <Button variant="ghost" size="icon" className="h-7 w-7 text-muted-foreground hover:text-destructive"
                  onClick={() => removeStep(i)} title="Remove step">
                  <X className="h-3.5 w-3.5" />
                </Button>
              </div>
            </div>
          ))
        )}
      </div>

      <Button
        variant="outline"
        onClick={addStep}
        disabled={suites.length === 0}
        className="w-full justify-center gap-2 h-11 border-2 border-dashed font-medium text-muted-foreground hover:text-foreground hover:border-primary/50"
      >
        <Plus className="h-4 w-4" /> Add step
      </Button>
    </div>
  );
}
