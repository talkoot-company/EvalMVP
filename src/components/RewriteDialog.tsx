import { useState, useEffect, useMemo } from "react";
import { evalsApi, type RewriteFeedbackItem, type RewriteIteration } from "@/api/evals";
import { RewriteFlowModal, type RewriteFlowData } from "@/components/RewriteFlowModal";
import { Button } from "@/components/ui/button";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription,
} from "@/components/ui/dialog";
import { ScoreBadge } from "@/components/ScoreBadge";
import { downloadJson } from "@/lib/download";
import { toast } from "sonner";
import { Loader2, Sparkles, MessageSquare, ChevronDown, ChevronRight, Download, Trash2 } from "lucide-react";

// Re-exported from the api layer so existing imports from this component keep
// working. A link in a rewrite chain: the rewritten copy, its re-grade against
// every selected criterion, and the orchestration thesis that shaped it.
export type { RewriteIteration };

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
  suiteId,
  model,
  originalCopy,
  baseFeedback,
  chain,
  onChainChange,
  onClearChain,
  autoStart = false,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  generationId: string;
  suiteId?: string;
  model?: string | null;
  originalCopy: string;
  baseFeedback: RewriteFeedbackItem[];
  chain: RewriteIteration[];
  onChainChange: (iterations: RewriteIteration[]) => void;
  onClearChain?: () => void;
  autoStart?: boolean;
}) {
  const [status, setStatus] = useState<"idle" | "running" | "error">("idle");
  const [stage, setStage] = useState<"rewriting" | "regrading" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [showOriginal, setShowOriginal] = useState(false);
  // Which iteration cards are expanded (collapsed by default so the whole chain
  // is scannable without scrolling).
  const [expanded, setExpanded] = useState<Set<number>>(new Set());
  const [confirmClear, setConfirmClear] = useState(false);
  const toggleExpanded = (idx: number) =>
    setExpanded((prev) => {
      const n = new Set(prev);
      if (n.has(idx)) n.delete(idx); else n.add(idx);
      return n;
    });

  // Which iteration's step-by-step flow to show in the RewriteFlowModal.
  const [flowFor, setFlowFor] = useState<number | null>(null);
  const flowData: RewriteFlowData | null = useMemo(() => {
    if (flowFor === null || !chain[flowFor]) return null;
    const it = chain[flowFor];
    const inputCopy = flowFor === 0 ? originalCopy : chain[flowFor - 1].content;
    const inputFeedback = flowFor === 0 ? baseFeedback : chain[flowFor - 1].grades;
    return {
      title: `Rewrite flow · #${flowFor + 1}`,
      originalLabel: flowFor === 0 ? "Original copy" : `Previous copy (rewrite #${flowFor})`,
      originalCopy: inputCopy,
      request: {
        generation_id: generationId,
        mode: "rewrite",
        feedback: inputFeedback,
        content: flowFor === 0 ? undefined : inputCopy,
        suite_id: suiteId,
        thesis: it.thesis,
      },
      thesis: it.thesis,
      resultCopy: it.content,
    };
  }, [flowFor, chain, originalCopy, baseFeedback, generationId, suiteId]);

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
      const { improved_content, thesis } = await evalsApi.rewrite(generationId, nextFeedback, nextBaseContent, suiteId);

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

      const newIndex = chain.length; // index of the iteration we're appending
      onChainChange([...chain, { content: improved_content, created_at: new Date().toISOString(), grades, thesis }]);
      setExpanded(new Set([newIndex])); // focus the freshest result, collapse the rest
      setStatus("idle");
      setStage(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setStatus("error");
      setStage(null);
    }
  }

  // When opened via "Run rewrite" from the output modal, kick off the first
  // rewrite automatically (once, on open, only if there's no chain yet).
  useEffect(() => {
    if (autoStart && chain.length === 0 && status === "idle") generate();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- fire once on open
  }, []);

  // Export the whole rewrite chain as JSON, including the exact rewrite prompt
  // (chat chain) that produced each link and its re-grade scores.
  function downloadChain() {
    // The feedback + base copy that drove each link (link 0 uses the baseline),
    // plus the suite + the iteration's stored thesis so the reconstructed chain
    // includes the orchestration prompt and thesis that actually ran.
    const promptFor = (i: number) => evalsApi.messages({
      generation_id: generationId,
      mode: "rewrite",
      feedback: i === 0 ? baseFeedback : chain[i - 1].grades,
      content: i === 0 ? undefined : chain[i - 1].content,
      suite_id: suiteId,
      thesis: chain[i].thesis,
    }).then((r) => r.messages);

    toast.promise(
      Promise.all(chain.map((_, i) => promptFor(i))).then((prompts) => {
        downloadJson(`rewrite-chain-${generationId.slice(0, 8)}`, {
          kind: "rewrite_chain",
          exported_at: new Date().toISOString(),
          generation_id: generationId,
          suite_id: suiteId ?? null,
          model: model ?? null,
          original_copy: originalCopy,
          baseline_grades: baseFeedback,
          iterations: chain.map((it, i) => ({
            index: i + 1,
            // The full reconstructed chat chain: orchestration prompt → thesis →
            // rewrite prompt (the rewrite prompt embeds the thesis below).
            rewrite_prompt: prompts[i],
            orchestration_thesis: it.thesis ?? null,
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

          {/* the chain — each rewrite is a collapsible card so the whole chain
              is scannable without scrolling; expand one to see its detail */}
          {chain.map((it, idx) => {
            const prev = idx === 0 ? baseFeedback : chain[idx - 1].grades;
            const prevById = mapById(prev);
            const isOpen = expanded.has(idx);
            const passCount = it.grades.filter((g) => String(g.score) === String(g.desired_score)).length;
            return (
              <div key={idx} className="border rounded-md">
                {/* header row — click to expand/collapse */}
                <button
                  className="w-full flex items-center gap-2 px-3 py-2 text-left hover:bg-muted/40 transition-colors"
                  onClick={() => toggleExpanded(idx)}
                  aria-expanded={isOpen}
                >
                  {isOpen ? <ChevronDown className="h-3.5 w-3.5 shrink-0 text-muted-foreground" /> : <ChevronRight className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />}
                  <span className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground shrink-0">Rewrite #{idx + 1}</span>
                  <span className={`text-[10px] font-medium shrink-0 ${passCount === it.grades.length ? "text-green-600" : "text-amber-600"}`}>
                    {passCount}/{it.grades.length} pass
                  </span>
                  {!isOpen && (
                    <span className="flex-1 min-w-0 truncate text-xs text-muted-foreground">{it.content}</span>
                  )}
                  <span className="ml-auto text-[10px] text-muted-foreground shrink-0">{new Date(it.created_at).toLocaleString()}</span>
                </button>

                {isOpen && (
                  <div className="px-3 pb-3 space-y-2 border-t">
                    {/* rewrite first, then its evaluation — reads chronologically */}
                    <pre className="mt-2 whitespace-pre-wrap break-words rounded-md border bg-green-50/50 border-green-200 p-2 text-sm leading-relaxed font-sans">
                      {it.content}
                    </pre>
                    {it.thesis && (
                      <details className="group">
                        <summary className="cursor-pointer list-none flex items-center gap-1 text-[10px] font-semibold uppercase tracking-widest text-muted-foreground hover:text-foreground">
                          <ChevronRight className="h-3 w-3 group-open:hidden" />
                          <ChevronDown className="h-3 w-3 hidden group-open:inline" />
                          Orchestration thesis
                        </summary>
                        <pre className="mt-1 whitespace-pre-wrap break-words rounded-md border bg-amber-50/50 border-amber-200 p-2 text-xs leading-relaxed font-sans">
                          {it.thesis}
                        </pre>
                      </details>
                    )}
                    <Button
                      size="sm" variant="ghost"
                      className="h-6 px-1.5 text-[11px] gap-1 text-muted-foreground hover:text-foreground"
                      onClick={() => setFlowFor(idx)}
                    >
                      <MessageSquare className="h-3 w-3" /> View flow
                    </Button>
                    <div className="space-y-2.5 border-t pt-2">
                      {it.grades.map((g) => <GradeRow key={g.criterion_id} grade={g} prev={prevById.get(g.criterion_id)} />)}
                    </div>
                  </div>
                )}
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
            disabled={chain.length === 0}
            onClick={downloadChain}
            title="Download the full rewrite chain (chat + scores) as JSON"
          >
            <Download className="h-3.5 w-3.5" /> Download chain
          </Button>
          {onClearChain && (
            confirmClear ? (
              <div className="flex items-center gap-1.5 ml-auto">
                <span className="text-xs text-muted-foreground">Clear all {chain.length} rewrite{chain.length === 1 ? "" : "s"}?</span>
                <Button
                  size="sm" variant="destructive" className="gap-1.5"
                  onClick={() => { onClearChain(); setExpanded(new Set()); setConfirmClear(false); }}
                >
                  <Trash2 className="h-3.5 w-3.5" /> Confirm
                </Button>
                <Button size="sm" variant="ghost" onClick={() => setConfirmClear(false)}>Cancel</Button>
              </div>
            ) : (
              <Button
                size="sm" variant="ghost" className="gap-1.5 ml-auto text-muted-foreground hover:text-destructive"
                disabled={chain.length === 0 || status === "running"}
                onClick={() => setConfirmClear(true)}
                title="Delete this rewrite chain so it can be rebuilt from scratch"
              >
                <Trash2 className="h-3.5 w-3.5" /> Clear chain
              </Button>
            )
          )}
        </div>
      </DialogContent>

      <RewriteFlowModal
        open={flowFor !== null}
        onOpenChange={(v) => { if (!v) setFlowFor(null); }}
        flow={flowData}
      />
    </Dialog>
  );
}
