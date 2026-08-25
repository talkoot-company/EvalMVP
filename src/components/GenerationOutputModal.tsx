import { Button } from "@/components/ui/button";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription,
} from "@/components/ui/dialog";
import { Sparkles } from "lucide-react";

// Shows a generation's produced copy — and, when a rewrite chain exists, the
// latest rewritten copy alongside it (original vs. new). When there is no
// revision yet, offers a button to run a rewrite.
export function GenerationOutputModal({
  open,
  onOpenChange,
  generationId,
  model,
  original,
  rewritten,
  rewriteIndex,
  onRewrite,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  generationId: string;
  model?: string | null;
  original: string;
  rewritten?: string;
  rewriteIndex?: number;
  onRewrite?: () => void;
}) {
  const hasRewrite = typeof rewritten === "string" && rewritten.length > 0;

  const panel = (label: string, text: string, accent?: boolean) => (
    <div className="flex min-w-0 flex-col gap-1">
      <p className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground">{label}</p>
      <pre
        className={`flex-1 overflow-auto whitespace-pre-wrap break-words rounded-md border p-3 text-sm leading-relaxed font-sans ${
          accent ? "border-green-200 bg-green-50/50" : "bg-muted/40"
        }`}
      >
        {text.trim() ? text : "(no output)"}
      </pre>
    </div>
  );

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-4xl max-h-[85vh] flex flex-col gap-3">
        <DialogHeader>
          <DialogTitle className="text-base">Generation · {generationId.slice(0, 8)}</DialogTitle>
          <DialogDescription>
            {hasRewrite
              ? "The original produced copy and the latest rewritten copy."
              : "The produced copy for this generation."}
            {model ? ` · ${model}` : ""}
          </DialogDescription>
        </DialogHeader>

        <div className={`overflow-y-auto flex-1 grid gap-4 ${hasRewrite ? "md:grid-cols-2" : "grid-cols-1"}`}>
          {panel("Original output", original)}
          {hasRewrite && panel(`Rewritten output (latest, #${rewriteIndex ?? 1})`, rewritten!, true)}
        </div>

        {!hasRewrite && onRewrite && (
          <div className="flex items-center justify-between gap-3 border-t pt-3">
            <span className="text-sm text-muted-foreground">No revisions yet.</span>
            <Button size="sm" className="gap-1.5" onClick={onRewrite}>
              <Sparkles className="h-3.5 w-3.5" /> Run rewrite
            </Button>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
