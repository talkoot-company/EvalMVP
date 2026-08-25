import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { getRewriteOrchestrationDefault } from "@/api/suites";
import { Save, RotateCcw, Loader2 } from "lucide-react";

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** The suite's stored prompt, or null when it uses the default. */
  value: string | null;
  /** Persist the edited prompt (parent wires this to suitesApi.update). */
  onSave: (value: string) => void;
  saving?: boolean;
}

/**
 * View/edit a suite's rewrite orchestration prompt — the prompt that turns the
 * criteria feedback into a coherence thesis before the rewrite drafts. Shows the
 * available parameters as a legend OUTSIDE the textarea so they're always visible.
 */
export function RewriteOrchestrationDialog({ open, onOpenChange, value, onSave, saving }: Props) {
  const { data: def } = useQuery({
    queryKey: ["rewrite-orchestration-default"],
    queryFn: getRewriteOrchestrationDefault,
    staleTime: 1000 * 60 * 60,
  });

  const [draft, setDraft] = useState("");
  const usingDefault = value == null || value.trim() === "";

  // (Re)initialise the draft each time the dialog opens or the default arrives:
  // the suite's own prompt if set, otherwise the built-in default.
  useEffect(() => {
    if (!open) return;
    setDraft(usingDefault ? (def?.template ?? "") : value!);
  }, [open, value, usingDefault, def?.template]);

  const placeholders = def?.placeholders ?? [];
  const isDefaultText = def?.template != null && draft === def.template;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-3xl max-h-[85vh] flex flex-col gap-3">
        <DialogHeader>
          <DialogTitle className="text-base">Rewrite orchestration prompt</DialogTitle>
          <DialogDescription>
            Runs before the rewrite: it reads all criteria feedback and the current copy and
            produces one coherence thesis (message map + drafting instructions) that the rewrite
            then develops — instead of patching feedback one item at a time.
            {usingDefault && (
              <span className="ml-1 text-muted-foreground">This suite currently uses the default.</span>
            )}
          </DialogDescription>
        </DialogHeader>

        {/* Available parameters — shown outside the textarea so they're always visible */}
        <div className="space-y-1.5">
          <p className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground">
            Available parameters <span className="normal-case font-normal">— insert these tokens in the prompt</span>
          </p>
          <div className="border rounded-md divide-y">
            {placeholders.length === 0 ? (
              <p className="text-xs text-muted-foreground px-3 py-2">Loading parameters…</p>
            ) : placeholders.map((ph) => {
              const present = draft.includes(`{${ph.token}}`);
              return (
                <div key={ph.token} className="flex items-start gap-2.5 px-3 py-2">
                  <span className={`font-mono text-[11px] px-1.5 py-0.5 rounded shrink-0 ${present ? "bg-blue-100 text-blue-700" : "bg-muted"}`}>
                    {`{${ph.token}}`}
                  </span>
                  <span className="flex-1 min-w-0 text-xs text-muted-foreground">{ph.description}</span>
                  {ph.required && (
                    <Badge variant="outline" className="text-[10px] border-amber-200 bg-amber-50 text-amber-700 shrink-0">required</Badge>
                  )}
                </div>
              );
            })}
          </div>
        </div>

        <Textarea
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          className="flex-1 min-h-[240px] font-mono text-xs leading-relaxed resize-none"
          spellCheck={false}
        />

        <DialogFooter className="sm:justify-between">
          <Button
            variant="ghost" size="sm" className="gap-1.5 text-muted-foreground"
            onClick={() => setDraft(def?.template ?? "")}
            disabled={!def || isDefaultText}
            title="Replace the editor with the built-in default prompt"
          >
            <RotateCcw className="h-3.5 w-3.5" /> Reset to default
          </Button>
          <div className="flex gap-2">
            <Button variant="outline" size="sm" onClick={() => onOpenChange(false)}>Cancel</Button>
            <Button
              size="sm" className="gap-1.5"
              onClick={() => { onSave(draft); onOpenChange(false); }}
              disabled={saving || !draft.trim()}
            >
              {saving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Save className="h-3.5 w-3.5" />} Save
            </Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
