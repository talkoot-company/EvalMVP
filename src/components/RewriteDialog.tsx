import { useState } from "react";
import { evalsApi, type RewriteFeedbackItem } from "@/api/evals";
import { Button } from "@/components/ui/button";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription,
} from "@/components/ui/dialog";
import { ScoreBadge } from "@/components/ScoreBadge";
import { downloadJson } from "@/lib/download";
import { toast } from "sonner";
import { Loader2, Sparkles, MessageSquare, ChevronDown, ChevronRight, Download } from "lucide-react";

// One link in a rewrite chain: the rewritten copy plus its re-grade against
// every selected criterion. `grades` are RewriteFeedbackItems so the next
// rewrite can be driven directly by them.
export interface RewriteIteration {
  content: string;
  created_at: string;
  grades: RewriteFeedbackItem[];
}

function mapById(items: RewriteFeedbackItem[]): Map<string, RewriteFeedbackItem> {
  return new Map(items.map((f) => [f.criterion_id, f]));
}

// Per-criterion result row: score (with a "was X" delta vs the previous step)
// plus the evaluator's rationale and the evidence it flagged — the pertinent
// detail behind each score.
function GradeRow({ grade, prev }: { grade: RewriteFeedbackItem; prev?: RewriteFeedbackItem }) {
  const changed = prev && prev.score !== grade.score;
  return (
    <div className="space-y-1">
      <div className="flex items-start justify-between gap-2 text-xs">
        <span className="min-w-0 font-medium">{grade.criterion_name}</span>
        <span className="flex items-center gap-1.5 shrink-0">
          {changed && <span className="text-[10px] text-muted-foreground">was {prev!.score}</span>}
          <ScoreBadge score={grade.score} desired={grade.desired_score} />
        </span>
      </div>
      {grade.rationale && <p className="text-xs text-muted-foreground leading-relaxed">{grade.rationale}</p>}
      {grade.evidence && grade.evidence.length > 0 && (
        <ul className="space-y-0.5">
          {grade.evidence.map((e, i) => (
            <li key={i} className="text-[11px] text-muted-foreground border-l-2 border-muted pl-2 italic">"{e}"</li>
          ))}
        </ul>
      )}
    </div>
  );
}

// A generation's rewrite chain: each "Rewrite" improves the latest copy using
// the latest scores, then automatically re-grades against every selected
// criterion — so the user watches scores evolve across iterations. The chain is
// persisted by the parent (localStorage) so it isn't re-run on reopen.
export function RewriteDialog({
  open,
  onOpenChange,
  generationId,
  model,
  originalCopy,
  baseFeedback,
  chain,
  onChainChange,
  onViewPrompt,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  generationId: string;
  model?: string | null;
  originalCopy: string;
  baseFeedback: RewriteFeedbackItem[];
  chain: RewriteIteration[];
  onChainChange: (iterations: RewriteIteration[]) => void;
  onViewPrompt: (feedback: RewriteFeedbackItem[], content: string | undefined, title: string) => void;
}) {
  const [status, setStatus] = useState<"idle" | "running" | "error">("idle");
  const [stage, setStage] = useState<"rewriting" | "regrading" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [showOriginal, setShowOriginal] = useState(false);

  // What the NEXT rewrite builds on: the latest link's copy + scores, or the
  // original copy + original suite-run scores when the chain is empty.
  const last = chain.length ? chain[chain.length - 1] : null;
  const nextFeedback = last ? last.grades : baseFeedback;
  const nextBaseContent = last ? last.content : undefined; // undefined → server uses the original copy

  async function generate() {
    setStatus("running");
    setError(null);
    try {
      setStage("rewriting");
      const { improved_content } = await evalsApi.rewrite(generationId, nextFeedback, nextBaseContent);

      setStage("regrading");
      const grades = await Promise.all(
        baseFeedback.map(async (f) => {
          const r = await evalsApi.regrade(generationId, { criterion_id: f.criterion_id, content: improved_content });
          return {
            criterion_id: f.criterion_id,
            criterion_name: r.criterion_name,
            score: r.score,
            desired_score: r.desired_score,
            rationale: r.rationale,
            evidence: r.evidence,
          } satisfies RewriteFeedbackItem;
        }),
      );

      onChainChange([...chain, { content: improved_content, created_at: new Date().toISOString(), grades }]);
      setStatus("idle");
      setStage(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setStatus("error");
      setStage(null);
    }
  }

  // Export the whole rewrite chain as JSON, including the exact rewrite prompt
  // (chat chain) that produced each link and its re-grade scores.
  function downloadChain() {
    // The feedback + base copy that drove each link (link 0 uses the baseline).
    const promptFor = (i: number) => evalsApi.messages({
      generation_id: generationId,
      mode: "rewrite",
      feedback: i === 0 ? baseFeedback : chain[i - 1].grades,
      content: i === 0 ? undefined : chain[i - 1].content,
    }).then((r) => r.messages);

    toast.promise(
      Promise.all(chain.map((_, i) => promptFor(i))).then((prompts) => {
        downloadJson(`rewrite-chain-${generationId.slice(0, 8)}`, {
          kind: "rewrite_chain",
          exported_at: new Date().toISOString(),
          generation_id: generationId,
          model: model ?? null,
          original_copy: originalCopy,
          baseline_grades: baseFeedback,
          iterations: chain.map((it, i) => ({
            index: i + 1,
            rewrite_prompt: prompts[i],
            content: it.content,
            created_at: it.created_at,
            grades: it.grades,
          })),
        });
      }),
      { loading: "Preparing download…", success: "Downloaded rewrite chain JSON", error: (e) => `Download failed: ${e instanceof Error ? e.message : String(e)}` },
    );
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-3xl max-h-[85vh] flex flex-col gap-3">
        <DialogHeader>
          <DialogTitle className="text-base">Rewrite chain · {generationId.slice(0, 8)}</DialogTitle>
          <DialogDescription>
            Each rewrite uses the latest scores from {baseFeedback.length} criteri{baseFeedback.length === 1 ? "on" : "a"} and is auto re-graded{model ? ` · ${model}` : ""}.
          </DialogDescription>
        </DialogHeader>

        <div className="overflow-y-auto flex-1 space-y-3 pr-1">
          {/* baseline: the original copy + its suite-run scores */}
          <div className="border rounded-md p-3 space-y-2">
            <div className="flex items-center justify-between">
              <p className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground">Original</p>
              <button
                className="flex items-center gap-1 text-[10px] uppercase tracking-widest text-muted-foreground hover:text-foreground"
                onClick={() => setShowOriginal((v) => !v)}
              >
                {showOriginal ? <ChevronDown className="h-3 w-3" /> : <ChevronRight className="h-3 w-3" />}
                copy
              </button>
            </div>
            <div className="space-y-2.5">
              {baseFeedback.map((f) => <GradeRow key={f.criterion_id} grade={f} />)}
            </div>
            {showOriginal && (
              <pre className="whitespace-pre-wrap break-words rounded-md border bg-muted/40 p-2 text-xs leading-relaxed font-sans">
                {originalCopy || "(empty)"}
              </pre>
            )}
          </div>

          {/* the chain */}
          {chain.map((it, idx) => {
            const prev = idx === 0 ? baseFeedback : chain[idx - 1].grades;
            const prevById = mapById(prev);
            const feedbackUsed = idx === 0 ? baseFeedback : chain[idx - 1].grades;
            const baseContentUsed = idx === 0 ? undefined : chain[idx - 1].content;
            return (
              <div key={idx} className="border rounded-md p-3 space-y-2">
                <div className="flex items-center justify-between gap-2">
                  <p className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground">
                    Rewrite #{idx + 1}
                  </p>
                  <span className="text-[10px] text-muted-foreground">{new Date(it.created_at).toLocaleString()}</span>
                </div>
                {/* rewrite first, then its evaluation — reads chronologically */}
                <pre className="whitespace-pre-wrap break-words rounded-md border bg-green-50/50 border-green-200 p-2 text-sm leading-relaxed font-sans">
                  {it.content}
                </pre>
                <Button
                  size="sm" variant="ghost"
                  className="h-6 px-1.5 text-[11px] gap-1 text-muted-foreground hover:text-foreground"
                  onClick={() => onViewPrompt(feedbackUsed, baseContentUsed, `Rewrite prompt · #${idx + 1}`)}
                >
                  <MessageSquare className="h-3 w-3" /> View rewrite prompt
                </Button>
                <div className="space-y-2.5 border-t pt-2">
                  {it.grades.map((g) => <GradeRow key={g.criterion_id} grade={g} prev={prevById.get(g.criterion_id)} />)}
                </div>
              </div>
            );
          })}

          {status === "running" && (
            <p className="flex items-center gap-2 text-sm text-muted-foreground">
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
              {stage === "regrading" ? "Re-grading against all criteria…" : "Rewriting…"}
            </p>
          )}
          {status === "error" && <p className="text-sm text-destructive whitespace-pre-wrap">{error}</p>}
        </div>

        {/* action */}
        <div className="flex items-center gap-2 flex-wrap border-t pt-3">
          <Button
            size="sm" className="gap-1.5"
            disabled={status === "running" || baseFeedback.length === 0}
            onClick={generate}
          >
            {status === "running"
              ? <><Loader2 className="h-3.5 w-3.5 animate-spin" /> Working…</>
              : <><Sparkles className="h-3.5 w-3.5" /> {chain.length ? "Rewrite again" : "Generate rewrite"}</>}
          </Button>
          <Button
            size="sm" variant="outline" className="gap-1.5"
            disabled={baseFeedback.length === 0}
            onClick={() => onViewPrompt(nextFeedback, nextBaseContent, `Next rewrite prompt · #${chain.length + 1}`)}
          >
            <MessageSquare className="h-3.5 w-3.5" /> View next prompt
          </Button>
          <Button
            size="sm" variant="outline" className="gap-1.5"
            disabled={chain.length === 0}
            onClick={downloadChain}
            title="Download the full rewrite chain (chat + scores) as JSON"
          >
            <Download className="h-3.5 w-3.5" /> Download chain
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
