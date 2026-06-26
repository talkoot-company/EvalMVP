import { useMemo, useState, useCallback, useRef, useEffect } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { useQuery, useQueryClient, useMutation } from "@tanstack/react-query";
import { criteriaApi } from "@/api/criteria";
import { generationsApi, type Generation } from "@/api/generations";
import { mappingApi } from "@/api/mapping";
import { evalsApi, type EvalResult, type RegradeResult, type RefinementChainData, type ChatMessage, type ChatMessagesRequest } from "@/api/evals";
import type { Criterion } from "@/types";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { Textarea } from "@/components/ui/textarea";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription,
} from "@/components/ui/dialog";
import { ArrowLeft, ChevronLeft, ChevronRight, Play, Loader2, CheckCircle2, XCircle, Pencil, EyeOff, Eye, Trash2, History, MessageSquare } from "lucide-react";
import { cn } from "@/lib/utils";

// ---------------------------------------------------------------------------
// Inline editable field
// ---------------------------------------------------------------------------

interface InlineEditProps {
  value: string;
  onSave: (next: string) => void;
  multiline?: boolean;
  minRows?: number;
  placeholder?: string;
  className?: string;
  saving?: boolean;
}

function InlineEdit({ value, onSave, multiline = false, minRows = 3, placeholder = "—", className = "", saving = false }: InlineEditProps) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(value);
  const [hovered, setHovered] = useState(false);
  const ref = useRef<HTMLTextAreaElement & HTMLInputElement>(null);

  useEffect(() => { setDraft(value); }, [value]);
  useEffect(() => { if (editing) ref.current?.focus(); }, [editing]);

  function commit() {
    setEditing(false);
    if (draft !== value) onSave(draft);
  }

  function handleKeyDown(e: React.KeyboardEvent) {
    if (!multiline && e.key === "Enter") { e.preventDefault(); commit(); }
    if (e.key === "Escape") { setDraft(value); setEditing(false); }
  }

  if (editing) {
    const shared = {
      ref,
      value: draft,
      onChange: (e: React.ChangeEvent<HTMLTextAreaElement | HTMLInputElement>) => setDraft(e.target.value),
      onBlur: commit,
      onKeyDown: handleKeyDown,
      className: `w-full rounded border border-blue-400 bg-blue-50/30 px-2 py-1 text-sm outline-none ring-1 ring-blue-400 resize-none ${className}`,
    };
    return multiline
      ? <textarea {...shared} style={{ minHeight: `${minRows * 1.6}rem` }} />
      : <input {...shared} />;
  }

  return (
    <span
      className={`group relative inline-block w-full cursor-text rounded px-1 py-0.5 transition-colors ${hovered ? "bg-muted/60 ring-1 ring-muted-foreground/20" : ""} ${className}`}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      onClick={() => { setDraft(value); setEditing(true); }}
    >
      {saving
        ? <Loader2 className="inline h-3 w-3 animate-spin text-muted-foreground mr-1" />
        : null}
      {value?.trim()
        ? <span className="whitespace-pre-wrap">{value}</span>
        : <span className="text-muted-foreground italic">{placeholder}</span>}
      {hovered && !saving && (
        <Pencil className="absolute right-1 top-1 h-3 w-3 text-muted-foreground/60 opacity-80" />
      )}
    </span>
  );
}

const PAGE_SIZE = 10;

function loadTestSet(criterionId: string): Set<string> {
  try {
    const raw = localStorage.getItem(`test_set:${criterionId}`);
    return raw ? new Set(JSON.parse(raw) as string[]) : new Set();
  } catch {
    return new Set();
  }
}

function saveTestSet(criterionId: string, ids: Set<string>) {
  localStorage.setItem(`test_set:${criterionId}`, JSON.stringify([...ids]));
}

// ---------------------------------------------------------------------------
// Test run result types + display
// ---------------------------------------------------------------------------

type RunStatus = "pending" | "running" | "done" | "error";
type StepStatus = "idle" | "running" | "done" | "error";

// One round of the refine loop: an AI post-edit and its (optional) re-grade.
interface PostEditIteration {
  content: string;
  comments: string;            // the (possibly user-edited) feedback that generated this round
  regradeStatus: StepStatus;
  regradeResult?: RegradeResult;
  regradeError?: string;
}

interface RunEntry {
  generationId: string;
  status: RunStatus;
  result?: EvalResult;
  error?: string;
  postEditStatus?: StepStatus; // status of an in-flight (new) post-edit
  postEditError?: string;
  iterations?: PostEditIteration[];
  pendingComments?: string;    // editable feedback that will drive the NEXT post-edit
  restoredFromChain?: boolean; // result came from a saved chain, not a fresh eval run
}

// Serialize an entry's original eval + iterations into the persisted chain shape.
function buildChainData(entry: RunEntry, iterations: PostEditIteration[]): RefinementChainData {
  return {
    original: entry.result
      ? {
          score: entry.result.score,
          desired_score: entry.result.desired_score,
          rationale: entry.result.rationale,
          evidence: entry.result.evidence,
          criterion_name: entry.result.criterion_name,
          product_name: entry.result.product_name,
        }
      : undefined,
    iterations: iterations.map((it) => ({
      content: it.content,
      comments: it.comments ?? "",
      regrade: it.regradeResult
        ? {
            score: it.regradeResult.score,
            desired_score: it.regradeResult.desired_score,
            rationale: it.regradeResult.rationale,
            evidence: it.regradeResult.evidence,
          }
        : undefined,
    })),
  };
}


// Generation copy is long; show 2 lines with a click-to-expand toggle that only
// appears when the content is actually truncated.
function ExpandableContent({ text, className, textClassName }: {
  text: string; className?: string; textClassName?: string;
}) {
  const [expanded, setExpanded] = useState(false);
  const [overflowing, setOverflowing] = useState(false);
  const ref = useRef<HTMLParagraphElement>(null);

  useEffect(() => {
    const el = ref.current;
    if (el && !expanded) setOverflowing(el.scrollHeight > el.clientHeight + 1);
  }, [text, expanded]);

  return (
    <div className={className}>
      <p
        ref={ref}
        className={cn("whitespace-pre-wrap", textClassName, !expanded && "line-clamp-2")}
      >
        {text}
      </p>
      {(overflowing || expanded) && (
        <button
          type="button"
          onClick={() => setExpanded((v) => !v)}
          className="mt-1 text-[10px] font-medium text-primary hover:underline"
        >
          {expanded ? "Show less" : "Show full generation"}
        </button>
      )}
    </div>
  );
}

function ScoreBadge({ score, desired }: { score: string; desired: string }) {
  const passed = desired && score === desired;
  const failed = desired && score !== desired;
  const cls = passed
    ? "bg-green-100 text-green-800 border-green-200"
    : failed
    ? "bg-red-100 text-red-800 border-red-200"
    : "bg-slate-100 text-slate-700 border-slate-200";
  return (
    <Badge variant="outline" className={`font-bold px-2.5 py-0.5 ${cls}`}>
      {desired ? `${score} / ${desired}` : score}
    </Badge>
  );
}

// ---------------------------------------------------------------------------
// "View chat" modal — reconstructs and shows the exact chat chain (no LLM call)
// ---------------------------------------------------------------------------
function ChatChainModal({
  open,
  onOpenChange,
  request,
  title,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  request: ChatMessagesRequest | null;
  title: string;
}) {
  const [messages, setMessages] = useState<ChatMessage[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [raw, setRaw] = useState(false);

  useEffect(() => {
    if (!open || !request) return;
    let cancelled = false;
    setLoading(true);
    setError(null);
    setMessages(null);
    evalsApi
      .messages(request)
      .then((r) => { if (!cancelled) setMessages(r.messages); })
      .catch((e) => { if (!cancelled) setError(String(e)); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [open, request]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-3xl max-h-[85vh] flex flex-col gap-3">
        <DialogHeader>
          <DialogTitle className="text-base">{title}</DialogTitle>
          <DialogDescription>
            The exact chat chain sent to the model — {messages?.length ?? 0} message{messages?.length === 1 ? "" : "s"}.
          </DialogDescription>
        </DialogHeader>

        <div className="flex items-center justify-end -mt-1">
          <Button
            size="sm" variant="ghost" className="h-6 text-[11px]"
            onClick={() => setRaw((v) => !v)}
            disabled={!messages}
          >
            {raw ? "Readable view" : "Raw JSON"}
          </Button>
        </div>

        <div className="overflow-y-auto flex-1 space-y-3 pr-1">
          {loading && (
            <p className="text-sm text-muted-foreground flex items-center gap-1.5">
              <Loader2 className="h-3.5 w-3.5 animate-spin" /> Building chat…
            </p>
          )}
          {error && <p className="text-sm text-destructive whitespace-pre-wrap">{error}</p>}

          {messages && !raw && messages.map((m, i) => (
            <div key={i} className="space-y-1">
              <p className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground">
                {m.role}
              </p>
              <pre className="whitespace-pre-wrap break-words rounded-md border bg-muted/40 p-3 text-xs leading-relaxed font-sans">
                {m.content}
              </pre>
            </div>
          ))}

          {messages && raw && (
            <pre className="whitespace-pre-wrap break-words rounded-md border bg-muted/40 p-3 text-xs leading-relaxed">
              {JSON.stringify(messages, null, 2)}
            </pre>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}

function TestRunResults({
  entries,
  generationsById,
  onPostEdit,
  onRegrade,
  onClear,
  onCommentsChange,
  onViewChat,
}: {
  entries: RunEntry[];
  generationsById: Map<string, Generation>;
  onPostEdit: (generationId: string) => void;
  onRegrade: (generationId: string, index: number) => void;
  onClear: (generationId: string) => void;
  onCommentsChange: (generationId: string, value: string) => void;
  onViewChat: (request: ChatMessagesRequest, title: string) => void;
}) {
  const done = entries.filter((e) => e.status === "done").length;
  const total = entries.length;

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2">
        <p className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground">
          Test Run Results
        </p>
        <span className="text-xs text-muted-foreground">
          {done} / {total} complete
        </span>
        {done === total && (
          <CheckCircle2 className="h-3.5 w-3.5 text-green-600" />
        )}
      </div>

      <div className="space-y-2">
        {entries.map((entry) => {
          const gen = generationsById.get(entry.generationId);
          const shortId = entry.generationId.slice(0, 8);
          const iterations = entry.iterations ?? [];
          const lastIter = iterations[iterations.length - 1];
          // First round edits the original output; each later round needs the
          // previous round's re-grade as the feedback that drives it.
          const canPostEdit =
            entry.status === "done" && !!entry.result &&
            (iterations.length === 0 || lastIter?.regradeStatus === "done");
          // Feedback that drives the next post-edit: latest re-grade, else the
          // original eval. Pre-fills the editable instructions box.
          const driverGrade = lastIter?.regradeResult ?? entry.result;
          const commentsValue = entry.pendingComments ?? driverGrade?.rationale ?? "";

          return (
            <div
              key={entry.generationId}
              className="border rounded-md p-3 space-y-2 bg-background text-sm"
            >
              {/* Row header */}
              <div className="flex items-center gap-2 flex-wrap">
                <span className="font-mono text-xs text-muted-foreground">{shortId}…</span>
                {gen?.model && (
                  <span className="text-xs text-muted-foreground">{gen.model}</span>
                )}
                <div className="ml-auto flex items-center gap-1.5">
                  {entry.status === "pending" && (
                    <span className="text-xs text-muted-foreground">Queued</span>
                  )}
                  {entry.status === "running" && (
                    <span className="flex items-center gap-1 text-xs text-muted-foreground">
                      <Loader2 className="h-3 w-3 animate-spin" /> Running…
                    </span>
                  )}
                  {entry.status === "done" && entry.result && (
                    <ScoreBadge score={entry.result.score} desired={entry.result.desired_score} />
                  )}
                  {entry.status === "error" && (
                    <span className="flex items-center gap-1 text-xs text-destructive">
                      <XCircle className="h-3.5 w-3.5" /> Failed
                    </span>
                  )}
                </div>
              </div>

              {/* Generation preview (click to expand full content) */}
              {gen?.response_content && (
                <ExpandableContent
                  text={gen.response_content}
                  className="border-l-2 border-muted pl-2"
                  textClassName="text-xs text-muted-foreground"
                />
              )}

              {/* Result detail */}
              {entry.status === "done" && entry.result && (
                <div className="space-y-2 pt-1">
                  <p className="text-sm leading-relaxed">{entry.result.rationale}</p>
                  {entry.result.evidence.length > 0 && (
                    <div className="flex flex-wrap gap-1.5">
                      {entry.result.evidence.map((e, i) => (
                        <span
                          key={i}
                          className="text-xs italic text-muted-foreground bg-muted px-2 py-0.5 rounded"
                        >
                          &ldquo;{e}&rdquo;
                        </span>
                      ))}
                    </div>
                  )}

                  <Button
                    size="sm" variant="ghost"
                    className="h-6 text-[11px] gap-1 text-muted-foreground hover:text-foreground"
                    onClick={() => onViewChat(
                      { generation_id: entry.generationId, mode: "eval", criterion_id: entry.result!.criterion_id },
                      `Eval chat · ${shortId}…`,
                    )}
                  >
                    <MessageSquare className="h-3 w-3" /> View eval chat
                  </Button>

                  {/* Iterative post-edit → re-grade loop */}
                  <div className="pt-1 border-t border-dashed space-y-3">
                    <div className="flex items-center justify-between gap-2">
                      <p className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground">Refinements</p>
                      {iterations.length > 0 && (
                        <Button
                          size="sm" variant="ghost"
                          className="h-6 text-[11px] gap-1.5 text-muted-foreground hover:text-destructive"
                          onClick={() => onClear(entry.generationId)}
                        >
                          <Trash2 className="h-3 w-3" /> Clear &amp; start over
                        </Button>
                      )}
                    </div>

                    {iterations.map((iter, i) => {
                      const prevScore = i === 0
                        ? entry.result?.score
                        : iterations[i - 1]?.regradeResult?.score;
                      // The grade that drove this rewrite (original eval for the
                      // first round, else the previous round's re-grade) and the
                      // copy it started from — used to reconstruct the rewrite chat.
                      const driver = i === 0 ? entry.result : iterations[i - 1]?.regradeResult;
                      const baseContent = i === 0 ? undefined : iterations[i - 1]?.content;
                      return (
                        <div key={i} className="space-y-1.5">
                          <div className="flex items-center gap-2 flex-wrap">
                            <p className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground">
                              Post-edit #{i + 1}
                            </p>
                            {iter.regradeStatus === "running" ? (
                              <span className="flex items-center gap-1.5 text-xs text-muted-foreground">
                                <Loader2 className="h-3 w-3 animate-spin" /> Re-grading…
                              </span>
                            ) : (
                              <Button
                                size="sm" variant="outline" className="h-6 text-[11px] gap-1.5"
                                onClick={() => onRegrade(entry.generationId, i)}
                              >
                                <Play className="h-3 w-3" /> {iter.regradeStatus === "done" ? "Re-grade again" : "Re-grade"}
                              </Button>
                            )}
                            {iter.regradeStatus === "done" && iter.regradeResult && (
                              <>
                                <ScoreBadge score={iter.regradeResult.score} desired={iter.regradeResult.desired_score} />
                                {prevScore != null && (
                                  <span className="text-[11px] text-muted-foreground">was {prevScore}</span>
                                )}
                              </>
                            )}
                            {iter.regradeStatus === "error" && (
                              <span className="text-xs text-destructive">{iter.regradeError ?? "Re-grade failed"}</span>
                            )}
                          </div>
                          {iter.comments && (
                            <p className="text-[11px] text-muted-foreground italic">Instructions: {iter.comments}</p>
                          )}
                          <p className="text-sm leading-relaxed bg-muted/50 rounded p-2 whitespace-pre-wrap">
                            {iter.content}
                          </p>
                          <div className="flex flex-wrap gap-1">
                            <Button
                              size="sm" variant="ghost"
                              className="h-6 text-[11px] gap-1 text-muted-foreground hover:text-foreground"
                              onClick={() => onViewChat(
                                {
                                  generation_id: entry.generationId,
                                  mode: "postedit",
                                  criterion_name: driver?.criterion_name,
                                  score: driver?.score,
                                  desired_score: driver?.desired_score,
                                  rationale: iter.comments,
                                  evidence: driver?.evidence,
                                  content: baseContent,
                                },
                                `Rewrite chat · post-edit #${i + 1}`,
                              )}
                            >
                              <MessageSquare className="h-3 w-3" /> View rewrite chat
                            </Button>
                            {iter.regradeStatus === "done" && iter.regradeResult && (
                              <Button
                                size="sm" variant="ghost"
                                className="h-6 text-[11px] gap-1 text-muted-foreground hover:text-foreground"
                                onClick={() => onViewChat(
                                  {
                                    generation_id: entry.generationId,
                                    mode: "eval",
                                    criterion_id: iter.regradeResult!.criterion_id,
                                    content: iter.content,
                                  },
                                  `Re-grade chat · post-edit #${i + 1}`,
                                )}
                              >
                                <MessageSquare className="h-3 w-3" /> View re-grade chat
                              </Button>
                            )}
                          </div>
                          {iter.regradeStatus === "done" && iter.regradeResult && (
                            <div className="space-y-1.5 pl-2 border-l-2 border-muted">
                              <p className="text-sm leading-relaxed">{iter.regradeResult.rationale}</p>
                              {iter.regradeResult.evidence.length > 0 && (
                                <div className="flex flex-wrap gap-1.5">
                                  {iter.regradeResult.evidence.map((e, j) => (
                                    <span key={j} className="text-xs italic text-muted-foreground bg-muted px-2 py-0.5 rounded">
                                      &ldquo;{e}&rdquo;
                                    </span>
                                  ))}
                                </div>
                              )}
                            </div>
                          )}
                        </div>
                      );
                    })}

                    {entry.postEditStatus === "running" && (
                      <span className="flex items-center gap-1.5 text-xs text-muted-foreground">
                        <Loader2 className="h-3 w-3 animate-spin" /> Generating post-edit…
                      </span>
                    )}
                    {entry.postEditStatus !== "running" && canPostEdit && (
                      <div className="space-y-1.5">
                        <p className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground">
                          Refinement instructions {iterations.length === 0 ? "(from this eval — edit to steer)" : "(from latest re-grade — edit to steer)"}
                        </p>
                        <Textarea
                          value={commentsValue}
                          onChange={(e) => onCommentsChange(entry.generationId, e.target.value)}
                          rows={2}
                          className="text-xs"
                          placeholder="What should the rewrite fix?"
                        />
                        <Button
                          size="sm" variant="outline" className="h-7 text-xs gap-1.5"
                          onClick={() => onPostEdit(entry.generationId)}
                        >
                          <Pencil className="h-3 w-3" />
                          {iterations.length === 0 ? "Post-edit with AI" : "Post-edit again"}
                        </Button>
                      </div>
                    )}
                    {entry.postEditStatus !== "running" && !canPostEdit && iterations.length > 0 && (
                      <p className="text-[11px] text-muted-foreground">Re-grade the latest post-edit to refine it again.</p>
                    )}
                    {entry.postEditStatus === "error" && (
                      <span className="text-xs text-destructive">{entry.postEditError ?? "Post-edit failed"}</span>
                    )}
                  </div>
                </div>
              )}

              {entry.status === "error" && (
                <p className="text-xs text-destructive">{entry.error}</p>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Generation type inference (mirrors GenerationsPage / EvalPanel)
// ---------------------------------------------------------------------------
function inferType(systemPrompt: string | null): string {
  if (!systemPrompt) return "Other";
  const sp = systemPrompt.toLowerCase();
  if (sp.includes("bullet")) return "Bullets";
  if (sp.includes("sustainab")) return "Sustainability";
  if (sp.includes("extract") || sp.includes("lookup") || sp.includes("identify")) return "Extraction";
  if (sp.includes("title") || sp.includes("subhead") || sp.includes("naming")) return "Title";
  if (sp.includes("description") || sp.includes("copywriter") || sp.includes("copy")) return "Description";
  return "Other";
}

function formatDate(unix: number | null) {
  if (!unix) return "—";
  return new Date(unix * 1000).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });
}

// ---------------------------------------------------------------------------
// Matching generations sub-table
// ---------------------------------------------------------------------------
function MatchingGenerationsTable({
  contentType,
  criterionId,
  criterionName,
}: {
  contentType: string;
  criterionId: string;
  criterionName: string;
}) {
  const [page, setPage] = useState(0);
  const [testSet, setTestSet] = useState<Set<string>>(() => loadTestSet(criterionId));
  const [runEntries, setRunEntries] = useState<RunEntry[] | null>(null);
  const [isRunning, setIsRunning] = useState(false);
  const [viewChat, setViewChat] = useState<{ request: ChatMessagesRequest; title: string } | null>(null);

  function toggleTestSet(generationId: string) {
    setTestSet((prev) => {
      const next = new Set(prev);
      if (next.has(generationId)) next.delete(generationId);
      else next.add(generationId);
      saveTestSet(criterionId, next);
      return next;
    });
  }

  const handleRunTest = useCallback(async () => {
    if (isRunning || testSet.size === 0) return;

    const ids = [...testSet];
    const initial: RunEntry[] = ids.map((id) => ({ generationId: id, status: "pending" }));
    setRunEntries(initial);
    setIsRunning(true);

    const update = (generationId: string, patch: Partial<RunEntry>) =>
      setRunEntries((prev) =>
        prev ? prev.map((e) => (e.generationId === generationId ? { ...e, ...patch } : e)) : prev,
      );

    await Promise.all(
      ids.map(async (generationId) => {
        update(generationId, { status: "running" });
        try {
          // If a saved refinement chain exists, just pull up the history — no
          // re-running the eval (the original score is restored from the chain).
          const chain = await evalsApi.chain.get(criterionId, generationId).catch(() => null);
          const mapIter = (it: RefinementChainData["iterations"][number], critName: string): PostEditIteration => ({
            content: it.content,
            comments: it.comments ?? "",
            regradeStatus: (it.regrade ? "done" : "idle") as StepStatus,
            regradeResult: it.regrade
              ? {
                  generation_id: generationId, criterion_id: criterionId,
                  criterion_name: critName, product_name: "",
                  score: it.regrade.score, desired_score: it.regrade.desired_score,
                  rationale: it.regrade.rationale, evidence: it.regrade.evidence,
                }
              : undefined,
          });

          if (chain?.data?.original) {
            const o = chain.data.original;
            const critName = o.criterion_name ?? criterionName;
            const result: EvalResult = {
              result_id: "", generation_id: generationId, criterion_id: criterionId,
              criterion_name: critName, product_name: o.product_name ?? "",
              score: o.score, desired_score: o.desired_score, rationale: o.rationale,
              evidence: o.evidence, run_at: chain.updated_at, html_report: null,
            };
            update(generationId, {
              status: "done",
              result,
              iterations: (chain.data.iterations ?? []).map((it) => mapIter(it, critName)),
              restoredFromChain: true,
            });
            return;
          }

          // No saved chain → run the eval.
          const result = await evalsApi.run(generationId, { criterion_id: criterionId });
          update(generationId, { status: "done", result });
        } catch (err) {
          update(generationId, { status: "error", error: String(err) });
        }
      }),
    );

    setIsRunning(false);
  }, [isRunning, testSet, criterionId, criterionName]);

  const { data: mapping = {} } = useQuery({
    queryKey: ["type_mapping"],
    queryFn: mappingApi.get,
    staleTime: 1000 * 60 * 10,
  });

  const { data: allGenerations, isLoading } = useQuery({
    queryKey: ["generations", { limit: 200 }],
    queryFn: () => generationsApi.list({ limit: 200 }),
    staleTime: 1000 * 60 * 5,
  });

  // Which generations already have a saved refinement chain (for the list badge).
  const queryClient = useQueryClient();
  const { data: chainGenIds = [] } = useQuery({
    queryKey: ["chains", criterionId],
    queryFn: () => evalsApi.chain.generationIds(criterionId),
    staleTime: 1000 * 30,
  });
  const chainIdSet = useMemo(() => new Set(chainGenIds), [chainGenIds]);
  const refreshChainIds = useCallback(
    () => queryClient.invalidateQueries({ queryKey: ["chains", criterionId] }),
    [queryClient, criterionId],
  );

  const applicableGenTypes = useMemo(
    () => mapping[contentType] ?? [],
    [mapping, contentType],
  );

  const matching = useMemo<Generation[]>(() => {
    if (!allGenerations?.items) return [];
    return allGenerations.items.filter(
      (g) => applicableGenTypes.includes(inferType(g.system_prompt)),
    );
  }, [allGenerations, applicableGenTypes]);

  const totalPages = Math.ceil(matching.length / PAGE_SIZE);
  const pageItems = matching.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE);

  const generationsById = useMemo(
    () => new Map(matching.map((g) => [g.generation_id, g])),
    [matching],
  );

  // Reconcile the saved test set against the generations that actually match
  // this criterion now. Stale ids (from a previous dataset or a different
  // criterion) are dropped so they don't trigger "Generation not found" and the
  // selected count stays accurate. Guarded on a non-empty match set so we never
  // wipe selections while generations/mapping are still loading.
  useEffect(() => {
    if (matching.length === 0) return;
    const validIds = new Set(matching.map((g) => g.generation_id));
    setTestSet((prev) => {
      const pruned = new Set([...prev].filter((id) => validIds.has(id)));
      if (pruned.size === prev.size) return prev;
      saveTestSet(criterionId, pruned);
      return pruned;
    });
  }, [matching, criterionId]);

  if (applicableGenTypes.length === 0) {
    return (
      <p className="text-sm text-muted-foreground">
        No generation types are mapped to <strong>{contentType}</strong> yet.
        Configure this in the <a href="/mapping" className="underline">Mapping</a> page.
      </p>
    );
  }

  if (isLoading) {
    return <p className="text-sm text-muted-foreground">Loading generations…</p>;
  }

  if (matching.length === 0) {
    return (
      <p className="text-sm text-muted-foreground">
        No generations found for type{applicableGenTypes.length > 1 ? "s" : ""}{" "}
        <strong>{applicableGenTypes.join(", ")}</strong>.
      </p>
    );
  }

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <span className="text-xs text-muted-foreground flex items-center flex-wrap gap-1">
          {matching.length} generation{matching.length !== 1 ? "s" : ""} matching{" "}
          <strong>{contentType}</strong> → type{applicableGenTypes.length > 1 ? "s" : ""}{" "}
          {applicableGenTypes.map((t) => (
            <Badge key={t} variant="outline" className="text-[10px] mx-0.5">{t}</Badge>
          ))}
          {testSet.size > 0 && (
            <span className="ml-1 text-blue-600 font-medium">· {testSet.size} in test set</span>
          )}
        </span>

        <div className="flex items-center gap-2">
          {testSet.size > 0 && (
            <Button size="sm" onClick={handleRunTest} disabled={isRunning}>
              {isRunning ? (
                <><Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" /> Running…</>
              ) : (
                <><Play className="h-3.5 w-3.5 mr-1.5" /> Run Test ({testSet.size})</>
              )}
            </Button>
          )}
          {totalPages > 1 && (
            <div className="flex items-center gap-1 text-xs text-muted-foreground">
              <Button
                variant="ghost"
                size="icon"
                className="h-6 w-6"
                disabled={page === 0}
                onClick={() => setPage((p) => p - 1)}
              >
                <ChevronLeft className="h-3.5 w-3.5" />
              </Button>
              <span>{page + 1} / {totalPages}</span>
              <Button
                variant="ghost"
                size="icon"
                className="h-6 w-6"
                disabled={page >= totalPages - 1}
                onClick={() => setPage((p) => p + 1)}
              >
                <ChevronRight className="h-3.5 w-3.5" />
              </Button>
            </div>
          )}
        </div>
      </div>

      <div className="border rounded-md overflow-hidden">
        <div className="overflow-y-auto max-h-[380px]">
          <Table>
            <TableHeader>
              <TableRow className="hover:bg-transparent sticky top-0 bg-background z-10">
                <TableHead className="w-10 text-center">Test</TableHead>
                <TableHead className="w-28">ID</TableHead>
                <TableHead className="w-40">Model</TableHead>
                <TableHead className="w-36">Date</TableHead>
                <TableHead>Response</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {pageItems.map((g) => (
                <TableRow key={g.generation_id} className={testSet.has(g.generation_id) ? "bg-blue-50/60" : undefined}>
                  <TableCell className="text-center">
                    <Checkbox
                      checked={testSet.has(g.generation_id)}
                      onCheckedChange={() => toggleTestSet(g.generation_id)}
                      aria-label="Add to test set"
                    />
                  </TableCell>
                  <TableCell className="font-mono text-xs text-muted-foreground">
                    <div className="flex items-center gap-1.5">
                      {g.generation_id.slice(0, 8)}…
                      {chainIdSet.has(g.generation_id) && (
                        <span
                          title="Has a saved refinement chain"
                          className="inline-flex items-center gap-0.5 rounded border border-blue-200 bg-blue-50 px-1 py-0.5 text-[9px] font-medium text-blue-700"
                        >
                          <History className="h-2.5 w-2.5" /> refined
                        </span>
                      )}
                    </div>
                  </TableCell>
                  <TableCell className="font-mono text-xs text-muted-foreground">
                    {g.model ?? "—"}
                  </TableCell>
                  <TableCell className="text-xs text-muted-foreground whitespace-nowrap">
                    {formatDate(g.created_at)}
                  </TableCell>
                  <TableCell className="text-sm max-w-md">
                    {g.response_content
                      ? <ExpandableContent text={g.response_content} textClassName="text-sm" />
                      : "—"}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      </div>

      {totalPages > 1 && (
        <p className="text-[11px] text-muted-foreground text-right">
          Showing {page * PAGE_SIZE + 1}–{Math.min((page + 1) * PAGE_SIZE, matching.length)} of {matching.length}
        </p>
      )}

      {runEntries && (
        <div className="pt-4 border-t space-y-3">
          <TestRunResults
            entries={runEntries}
            generationsById={generationsById}
            onViewChat={(request, title) => setViewChat({ request, title })}
            onCommentsChange={(generationId, value) => {
              setRunEntries((prev) => prev ? prev.map((e) =>
                e.generationId === generationId ? { ...e, pendingComments: value } : e
              ) : prev);
            }}
            onClear={async (generationId) => {
              setRunEntries((prev) => prev ? prev.map((e) =>
                e.generationId === generationId
                  ? { ...e, iterations: [], pendingComments: undefined, postEditStatus: undefined, postEditError: undefined }
                  : e
              ) : prev);
              try {
                await evalsApi.chain.remove(criterionId, generationId);
              } catch (err) {
                console.error("Clear chain failed:", err);
              }
              refreshChainIds();
            }}
            onPostEdit={async (generationId) => {
              const entry = runEntries.find((e) => e.generationId === generationId);
              if (!entry?.result) return;
              const iters = entry.iterations ?? [];
              const last = iters[iters.length - 1];
              // First round: improve the original output using the original eval.
              // Later rounds: improve the latest post-edit using its re-grade.
              const baseContent = last ? last.content : undefined;
              const driver = last ? last.regradeResult : entry.result; // score/target/evidence source
              if (!driver) return; // need a grade to refine from
              // The (possibly user-edited) instructions drive the rewrite.
              const comments = (entry.pendingComments ?? driver.rationale) || "";
              setRunEntries((prev) => prev ? prev.map((e) =>
                e.generationId === generationId ? { ...e, postEditStatus: "running", postEditError: undefined } : e
              ) : prev);
              try {
                const { improved_content } = await evalsApi.postEdit({
                  generation_id: generationId,
                  criterion_name: driver.criterion_name,
                  score: driver.score,
                  desired_score: driver.desired_score,
                  rationale: comments,
                  evidence: driver.evidence,
                  content: baseContent,
                });
                const newIterations: PostEditIteration[] =
                  [...iters, { content: improved_content, comments, regradeStatus: "idle" }];
                setRunEntries((prev) => prev ? prev.map((e) =>
                  e.generationId === generationId
                    ? { ...e, postEditStatus: "done", iterations: newIterations, pendingComments: undefined }
                    : e
                ) : prev);
                evalsApi.chain.save({
                  criterion_id: criterionId, generation_id: generationId, criterion_name: criterionName,
                  data: buildChainData(entry, newIterations),
                }).then(refreshChainIds).catch((err) => console.error("Save chain failed:", err));
              } catch (err) {
                setRunEntries((prev) => prev ? prev.map((e) =>
                  e.generationId === generationId ? { ...e, postEditStatus: "error", postEditError: String(err) } : e
                ) : prev);
                console.error("Post-edit failed:", err);
              }
            }}
            onRegrade={async (generationId, index) => {
              const entry = runEntries.find((e) => e.generationId === generationId);
              const iter = entry?.iterations?.[index];
              if (!entry || !iter) return;
              const patchIter = (patch: Partial<PostEditIteration>) =>
                setRunEntries((prev) => prev ? prev.map((e) => {
                  if (e.generationId !== generationId) return e;
                  return { ...e, iterations: (e.iterations ?? []).map((it, i) => i === index ? { ...it, ...patch } : it) };
                }) : prev);
              patchIter({ regradeStatus: "running", regradeError: undefined });
              try {
                const regradeResult = await evalsApi.regrade(generationId, {
                  criterion_id: criterionId,
                  content: iter.content,
                });
                patchIter({ regradeStatus: "done", regradeResult });
                const newIterations = (entry.iterations ?? []).map((it, i) =>
                  i === index ? { ...it, regradeStatus: "done" as StepStatus, regradeResult } : it);
                evalsApi.chain.save({
                  criterion_id: criterionId, generation_id: generationId, criterion_name: criterionName,
                  data: buildChainData(entry, newIterations),
                }).then(refreshChainIds).catch((err) => console.error("Save chain failed:", err));
              } catch (err) {
                patchIter({ regradeStatus: "error", regradeError: String(err) });
                console.error("Re-grade failed:", err);
              }
            }}
          />
        </div>
      )}

      <ChatChainModal
        open={!!viewChat}
        onOpenChange={(v) => { if (!v) setViewChat(null); }}
        request={viewChat?.request ?? null}
        title={viewChat?.title ?? "Chat chain"}
      />
    </div>
  );
}

// ---------------------------------------------------------------------------
// Eval definition display
// ---------------------------------------------------------------------------

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="space-y-2">
      <p className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground">{title}</p>
      {children}
    </div>
  );
}

const TABLE_CLS =
  "w-full border rounded-md [&_th]:bg-muted/40 [&_th]:text-xs [&_th]:font-semibold [&_td]:text-sm [&_td]:align-top [&_td]:py-3 [&_th]:py-2";

type PatchFn = (patch: Record<string, unknown>) => void;

function ExamplesCell({ examples, onSaveAll }: { examples?: string[]; onSaveAll: (arr: string[]) => void }) {
  const existing = (examples ?? []).filter((e) => e !== undefined);
  const [adding, setAdding] = useState(false);
  const newRef = useRef<HTMLTextAreaElement & HTMLInputElement>(null);

  useEffect(() => { if (adding) newRef.current?.focus(); }, [adding]);

  function commitEdit(i: number, val: string) {
    const arr = [...existing];
    arr[i] = val;
    onSaveAll(arr.filter(Boolean));
  }

  function commitNew(val: string) {
    setAdding(false);
    if (val.trim()) onSaveAll([...existing, val.trim()]);
  }

  return (
    <div className="space-y-1">
      {existing.map((e, i) => (
        <div key={i} className="flex items-start gap-1 group/ex">
          <p className="flex-1 text-xs italic text-muted-foreground">
            <InlineEdit value={e ?? ""} onSave={(v) => commitEdit(i, v)} placeholder={`Example ${i + 1}`} />
          </p>
          <button
            onClick={() => onSaveAll(existing.filter((_, j) => j !== i))}
            title="Delete example"
            className="mt-0.5 shrink-0 text-muted-foreground/40 opacity-0 transition-opacity hover:text-destructive group-hover/ex:opacity-100"
          >
            <Trash2 className="h-3 w-3" />
          </button>
        </div>
      ))}
      {adding && (
        <input
          ref={newRef}
          defaultValue=""
          placeholder="Type example…"
          className="w-full rounded border border-blue-400 bg-blue-50/30 px-2 py-0.5 text-xs italic outline-none ring-1 ring-blue-400"
          onBlur={(e) => commitNew(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") { e.preventDefault(); commitNew((e.target as HTMLInputElement).value); }
            if (e.key === "Escape") setAdding(false);
          }}
        />
      )}
      {!adding && (
        <button
          onClick={() => setAdding(true)}
          className="text-[11px] text-muted-foreground/60 hover:text-muted-foreground flex items-center gap-0.5 mt-0.5"
        >
          + add example
        </button>
      )}
    </div>
  );
}

function YesNoTable({ d, onPatch }: { d: { definition_yes?: string; definition_no?: string; yes_examples?: string[]; no_examples?: string[] }; onPatch: PatchFn }) {
  return (
    <Table className={TABLE_CLS}>
      <TableHeader><TableRow>
        <TableHead className="w-16">Score</TableHead>
        <TableHead>Definition</TableHead>
        <TableHead>Examples</TableHead>
      </TableRow></TableHeader>
      <TableBody>
        {([
          { score: "Yes", defKey: "definition_yes", exKey: "yes_examples", def: d.definition_yes, examples: d.yes_examples },
          { score: "No",  defKey: "definition_no",  exKey: "no_examples",  def: d.definition_no,  examples: d.no_examples  },
        ] as const).map(({ score, defKey, exKey, def, examples }) => (
          <TableRow key={score}>
            <TableCell><Badge variant="outline" className={score === "Yes" ? "border-green-200 bg-green-50 text-green-700" : "border-red-200 bg-red-50 text-red-700"}>{score}</Badge></TableCell>
            <TableCell>
              <InlineEdit value={def ?? ""} multiline minRows={5} onSave={(v) => onPatch({ [defKey]: v })} placeholder="Add definition…" />
            </TableCell>
            <TableCell>
              <ExamplesCell
                examples={examples}
                onSaveAll={(arr) => onPatch({ [exKey]: arr })}
              />
            </TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}

function ScaleTable({ d, onPatch }: { d: Record<string, { title?: string; definition?: string; example_1?: string; example_2?: string }>; onPatch: PatchFn }) {
  return (
    <Table className={TABLE_CLS}>
      <TableHeader><TableRow>
        <TableHead className="w-16">Score</TableHead>
        <TableHead className="w-36">Title</TableHead>
        <TableHead>Definition</TableHead>
        <TableHead>Examples</TableHead>
      </TableRow></TableHeader>
      <TableBody>
        {[1, 2, 3, 4].map((n) => {
          const row = d[`score_${n}`] ?? {};
          return (
            <TableRow key={n}>
              <TableCell><Badge variant="outline">{n}</Badge></TableCell>
              <TableCell>
                <InlineEdit value={row.title ?? ""} onSave={(v) => onPatch({ [`score_${n}`]: { ...row, title: v } })} placeholder="Add title…" />
              </TableCell>
              <TableCell>
                <InlineEdit value={row.definition ?? ""} multiline minRows={5} onSave={(v) => onPatch({ [`score_${n}`]: { ...row, definition: v } })} placeholder="Add definition…" />
              </TableCell>
              <TableCell>
                <ExamplesCell
                  examples={Object.keys(row)
                    .filter((k) => k.startsWith("example_"))
                    .sort()
                    .map((k) => row[k as keyof typeof row] ?? "")}
                  onSaveAll={(arr) => {
                    const exPatch: Record<string, string> = {};
                    arr.forEach((v, i) => { exPatch[`example_${i + 1}`] = v; });
                    onPatch({ [`score_${n}`]: { ...row, ...exPatch } });
                  }}
                />
              </TableCell>
            </TableRow>
          );
        })}
      </TableBody>
    </Table>
  );
}

function CountTable({ d, onPatch }: { d: { buckets?: string[]; bucket_titles?: Record<string, string>; bucket_definitions?: Record<string, string>; bucket_examples?: Record<string, string[]> }; onPatch: PatchFn }) {
  const buckets = d.buckets?.length ? d.buckets : ["0", "1", "2", "3+"];
  return (
    <Table className={TABLE_CLS}>
      <TableHeader><TableRow>
        <TableHead className="w-16">Count</TableHead>
        <TableHead className="w-36">Title</TableHead>
        <TableHead>Definition</TableHead>
        <TableHead>Examples</TableHead>
      </TableRow></TableHeader>
      <TableBody>
        {buckets.map((b) => {
          const examples = d.bucket_examples?.[b] ?? ["", ""];
          return (
            <TableRow key={b}>
              <TableCell><Badge variant="outline">{b}</Badge></TableCell>
              <TableCell>
                <InlineEdit value={d.bucket_titles?.[b] ?? ""} onSave={(v) => onPatch({ bucket_titles: { ...d.bucket_titles, [b]: v } })} placeholder="Add title…" />
              </TableCell>
              <TableCell>
                <InlineEdit value={d.bucket_definitions?.[b] ?? ""} multiline minRows={5} onSave={(v) => onPatch({ bucket_definitions: { ...d.bucket_definitions, [b]: v } })} placeholder="Add definition…" />
              </TableCell>
              <TableCell>
                <ExamplesCell
                  examples={examples}
                  onSaveAll={(arr) => onPatch({ bucket_examples: { ...d.bucket_examples, [b]: arr } })}
                />
              </TableCell>
            </TableRow>
          );
        })}
      </TableBody>
    </Table>
  );
}

function EvalDefinitionSection({ criterion, onPatch }: { criterion: Criterion; onPatch: PatchFn }) {
  if (criterion.criteria_type === "yes-no") {
    return <YesNoTable d={criterion.eval_definition as Parameters<typeof YesNoTable>[0]["d"]} onPatch={onPatch} />;
  }
  if (criterion.criteria_type === "numerical-scale") {
    return <ScaleTable d={criterion.eval_definition as Parameters<typeof ScaleTable>[0]["d"]} onPatch={onPatch} />;
  }
  return <CountTable d={criterion.eval_definition as Parameters<typeof CountTable>[0]["d"]} onPatch={onPatch} />;
}

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------

export default function CriterionDetailPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const qc = useQueryClient();

  const { data: criterion, isLoading, error } = useQuery({
    queryKey: ["criteria", id],
    queryFn: () => criteriaApi.get(id!),
    enabled: !!id,
  });

  const saveMutation = useMutation({
    mutationFn: (patch: Partial<Criterion>) => criteriaApi.update(id!, patch),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["criteria", id] });
      qc.invalidateQueries({ queryKey: ["criteria"] });
    },
  });

  const toggleActiveMutation = useMutation({
    mutationFn: () => criteriaApi.toggleActive(id!),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["criteria", id] });
      qc.invalidateQueries({ queryKey: ["criteria"] });
    },
  });

  // Patch a top-level field (e.g. criteria_definition)
  function saveField(field: keyof Criterion, value: unknown) {
    saveMutation.mutate({ [field]: value } as Partial<Criterion>);
  }

  // Patch a nested eval_definition key
  function patchEvalDef(patch: Record<string, unknown>) {
    if (!criterion) return;
    saveMutation.mutate({
      eval_definition: { ...(criterion.eval_definition as Record<string, unknown>), ...patch },
    } as Partial<Criterion>);
  }

  if (isLoading) {
    return (
      <div className="p-6 flex items-center justify-center h-64 text-muted-foreground text-sm">
        Loading…
      </div>
    );
  }

  if (error || !criterion) {
    return (
      <div className="p-6 space-y-4">
        <Button variant="ghost" size="sm" className="gap-1.5" onClick={() => navigate("/criteria")}>
          <ArrowLeft className="h-4 w-4" /> Back to criteria
        </Button>
        <p className="text-destructive text-sm">Criterion not found.</p>
      </div>
    );
  }

  const typeLabel =
    criterion.criteria_type === "yes-no" ? "Yes / No" :
    criterion.criteria_type === "numerical-scale" ? "Scale 1–4" : "Count";

  return (
    <div className="p-6 max-w-5xl space-y-8 animate-fade-in">
      {/* Back button */}
      <Button variant="ghost" size="sm" className="gap-1.5 -ml-2" onClick={() => navigate("/criteria")}>
        <ArrowLeft className="h-4 w-4" /> Back to criteria
      </Button>

      {/* Header */}
      <div className="space-y-3">
        <div className="flex items-start gap-3 flex-wrap">
          <h1 className="text-2xl font-bold tracking-tight">{criterion.criteria_name}</h1>
          <button
            onClick={() => toggleActiveMutation.mutate()}
            disabled={toggleActiveMutation.isPending}
            className="mt-1 flex items-center gap-1.5"
            title={criterion.active ? "Mark as inactive" : "Mark as active"}
          >
            {toggleActiveMutation.isPending
              ? <Loader2 className="h-3.5 w-3.5 animate-spin text-muted-foreground" />
              : criterion.active
              ? <Badge variant="outline" className="border-green-200 bg-green-50 text-green-700 hover:bg-green-100 cursor-pointer gap-1"><Eye className="h-3 w-3" />Active</Badge>
              : <Badge variant="outline" className="border-gray-300 text-gray-400 hover:bg-gray-50 cursor-pointer gap-1"><EyeOff className="h-3 w-3" />Inactive</Badge>
            }
          </button>
        </div>

        {/* Metadata badges */}
        <div className="flex flex-wrap gap-2">
          <Badge variant="outline" className="border-blue-200 bg-blue-50 text-blue-700">{criterion.context}</Badge>
          <Badge variant="outline" className="border-violet-200 bg-violet-50 text-violet-700">{criterion.content_type}</Badge>
          <Badge variant="outline" className="border-amber-200 bg-amber-50 text-amber-700">{criterion.criteria_category}</Badge>
          <Badge variant="outline" className="border-slate-200 text-slate-600">{typeLabel}</Badge>
          <Badge variant="outline" className="border-slate-200 text-slate-600">Weight {criterion.weight}</Badge>
          {criterion.marketplace_tag && <Badge variant="outline">Marketplace: {criterion.marketplace_tag}</Badge>}
          {criterion.brand_tag       && <Badge variant="outline">Brand: {criterion.brand_tag}</Badge>}
          {criterion.industry_tag    && <Badge variant="outline">Industry: {criterion.industry_tag}</Badge>}
          {criterion.customer        && <Badge variant="outline" className="border-green-200 bg-green-50 text-green-700">{criterion.customer}</Badge>}
        </div>

        {/* ID */}
        <p className="font-mono text-[11px] text-muted-foreground">{criterion.id}</p>
      </div>

      {/* Definition */}
      <Section title="Criteria definition">
        <InlineEdit
          value={criterion.criteria_definition ?? ""}
          multiline
          minRows={6}
          onSave={(v) => saveField("criteria_definition", v)}
          placeholder="Add a definition…"
          saving={saveMutation.isPending}
          className="text-sm leading-relaxed"
        />
      </Section>

      {/* Eval definition */}
      <Section title="Evaluation definitions">
        <EvalDefinitionSection criterion={criterion} onPatch={patchEvalDef} />
      </Section>

      {/* Notes */}
      <Section title="Notes">
        <InlineEdit
          value={criterion.notes ?? ""}
          multiline
          onSave={(v) => saveField("notes", v)}
          placeholder="Add notes for reference…"
          saving={saveMutation.isPending}
          className="text-sm leading-relaxed text-muted-foreground"
        />
      </Section>

      {/* Matching generations */}
      <Section title="Applicable generations">
        <MatchingGenerationsTable
          key={criterion.id}
          contentType={criterion.content_type}
          criterionId={criterion.id}
          criterionName={criterion.criteria_name}
        />
      </Section>
    </div>
  );
}
