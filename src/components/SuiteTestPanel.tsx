import { useMemo, useState, useEffect, useCallback } from "react";
import { useQuery, keepPreviousData } from "@tanstack/react-query";
import { generationsApi, type Generation } from "@/api/generations";
import { mappingApi } from "@/api/mapping";
import { evalsApi, type RewriteFeedbackItem, type ChatMessagesRequest } from "@/api/evals";
import type { Criterion } from "@/types";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { Checkbox } from "@/components/ui/checkbox";
import { ScoreBadge } from "@/components/ScoreBadge";
import { FilterDropdown } from "@/components/CriteriaFilterBar";
import { ChatChainModal } from "@/components/ChatChainModal";
import { RewriteDialog, type RewriteIteration } from "@/components/RewriteDialog";
import { cn } from "@/lib/utils";
import {
  ChevronUp, ChevronLeft, ChevronRight, X, Play, Loader2,
  Search, AlertTriangle, Plus, Sparkles, MessageSquare,
} from "lucide-react";

const PAGE_SIZE = 10;
const CONCURRENCY = 6;

// --- localStorage-backed rewrite chains, keyed per suite ----------------------
// Shape: { [generationId]: RewriteIteration[] }. Older single-rewrite entries
// (a bare object, not an array) are ignored so they don't crash the chain view.
function loadRewrites(suiteId: string): Record<string, RewriteIteration[]> {
  try {
    const raw = localStorage.getItem(`suite_rewrites:${suiteId}`);
    if (!raw) return {};
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    const out: Record<string, RewriteIteration[]> = {};
    for (const [genId, val] of Object.entries(parsed)) {
      if (Array.isArray(val)) out[genId] = val as RewriteIteration[];
    }
    return out;
  } catch {
    return {};
  }
}
function saveRewrites(suiteId: string, map: Record<string, RewriteIteration[]>) {
  localStorage.setItem(`suite_rewrites:${suiteId}`, JSON.stringify(map));
}

// --- localStorage-backed test set (generation ids), keyed per suite ----------
function loadTestSet(suiteId: string): Set<string> {
  try {
    const raw = localStorage.getItem(`suite_test_set:${suiteId}`);
    return raw ? new Set(JSON.parse(raw) as string[]) : new Set();
  } catch {
    return new Set();
  }
}
function saveTestSet(suiteId: string, ids: Set<string>) {
  localStorage.setItem(`suite_test_set:${suiteId}`, JSON.stringify([...ids]));
}

// Bounded-concurrency async pool — N generations × M criteria can be large, so
// we cap in-flight eval calls rather than firing everything with Promise.all.
async function runPool<T>(items: T[], limit: number, worker: (item: T) => Promise<void>) {
  let cursor = 0;
  const runners = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (cursor < items.length) {
      const idx = cursor++;
      await worker(items[idx]);
    }
  });
  await Promise.all(runners);
}

type CellStatus = "pending" | "running" | "done" | "error";
interface Cell {
  status: CellStatus;
  score?: string;
  desired_score?: string;
  rationale?: string;
  evidence?: string[];
  criterion_name?: string;
  extraction_warning?: string | null;
  restored?: boolean;
  error?: string;
}
const cellKey = (genId: string, critId: string) => `${genId}::${critId}`;

// Compact cell display for the results matrix (master).
function CellContent({ cell }: { cell?: Cell }) {
  if (!cell || cell.status === "pending") return <span className="text-muted-foreground">–</span>;
  if (cell.status === "running") return <Loader2 className="h-3.5 w-3.5 animate-spin text-muted-foreground" />;
  if (cell.status === "error") return <AlertTriangle className="h-3.5 w-3.5 text-destructive" />;
  return <ScoreBadge score={cell.score ?? ""} desired={cell.desired_score ?? ""} />;
}

export function SuiteTestPanel({
  suiteId,
  selectedCriteria,
}: {
  suiteId: string;
  selectedCriteria: Criterion[];
}) {
  const [testSet, setTestSet] = useState<Set<string>>(() => loadTestSet(suiteId));
  const [showSelector, setShowSelector] = useState(false);
  const [genCache, setGenCache] = useState<Map<string, Generation>>(new Map());

  // selector filters
  const [search, setSearch] = useState("");
  const [validProductDataOnly, setValidProductDataOnly] = useState(true);
  const [page, setPage] = useState(0);

  // run state (snapshotted at Test time)
  const [ranGenIds, setRanGenIds] = useState<string[]>([]);
  const [ranCriteria, setRanCriteria] = useState<Criterion[]>([]);
  const [results, setResults] = useState<Map<string, Cell>>(new Map());
  const [isRunning, setIsRunning] = useState(false);
  const [selectedCell, setSelectedCell] = useState<{ genId: string; critId: string } | null>(null);

  // rewrite + prompt-inspection state
  const [rewrites, setRewrites] = useState<Record<string, RewriteIteration[]>>(() => loadRewrites(suiteId));
  const [rewriteFor, setRewriteFor] = useState<string | null>(null);
  const [chatRequest, setChatRequest] = useState<{ request: ChatMessagesRequest; title: string } | null>(null);

  // --- gen-type inference + explicit filter --------------------------------
  const { data: mapping = {} } = useQuery({
    queryKey: ["type_mapping"],
    queryFn: mappingApi.get,
    staleTime: 1000 * 60 * 10,
  });
  const { data: genTypeOptions = [] } = useQuery({
    queryKey: ["generation-types"],
    queryFn: mappingApi.generationTypes,
    staleTime: 1000 * 60 * 10,
  });

  const inferredGenTypes = useMemo(() => {
    const s = new Set<string>();
    for (const c of selectedCriteria) for (const gt of mapping[c.content_type] ?? []) s.add(gt);
    return [...s];
  }, [selectedCriteria, mapping]);

  const mixed = inferredGenTypes.length > 1;

  // The filter defaults to the inferred type(s) and follows criteria changes
  // until the user manually touches it.
  const [genTypeTouched, setGenTypeTouched] = useState(false);
  const [manualGenTypes, setManualGenTypes] = useState<Set<string>>(new Set());
  const genTypeFilter = genTypeTouched ? manualGenTypes : new Set(inferredGenTypes);
  const toggleGenType = (v: string) => {
    setGenTypeTouched(true);
    setPage(0);
    setManualGenTypes((prev) => {
      const base = genTypeTouched ? prev : new Set(inferredGenTypes);
      const n = new Set(base);
      if (n.has(v)) n.delete(v); else n.add(v);
      return n;
    });
  };
  const clearGenType = () => { setGenTypeTouched(true); setPage(0); setManualGenTypes(new Set()); };

  // --- generation fetch (server-paginated) ---------------------------------
  const { data, isLoading } = useQuery({
    queryKey: ["suite-gens", [...genTypeFilter].sort(), validProductDataOnly, search, page],
    queryFn: () => generationsApi.list({
      genTypes: [...genTypeFilter],
      validProductData: validProductDataOnly,
      search: search || undefined,
      limit: PAGE_SIZE,
      offset: page * PAGE_SIZE,
    }),
    enabled: showSelector,
    staleTime: 1000 * 60 * 5,
    placeholderData: keepPreviousData,
  });
  const pageItems = useMemo(() => data?.items ?? [], [data]);
  const total = data?.total ?? 0;
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  // accumulate every generation we see so the sub-list + result rows can render
  // items picked on pages we've since navigated away from
  useEffect(() => {
    if (!pageItems.length) return;
    setGenCache((prev) => {
      const n = new Map(prev);
      for (const g of pageItems) n.set(g.generation_id, g);
      return n;
    });
  }, [pageItems]);

  // backfill cache for selected ids we haven't loaded yet (e.g. after reload)
  useEffect(() => {
    const missing = [...testSet].filter((id) => !genCache.has(id));
    if (!missing.length) return;
    let cancelled = false;
    Promise.all(missing.map((id) => generationsApi.get(id).catch(() => null))).then((gens) => {
      if (cancelled) return;
      setGenCache((prev) => {
        const n = new Map(prev);
        for (const g of gens) if (g) n.set(g.generation_id, g);
        return n;
      });
    });
    return () => { cancelled = true; };
  }, [testSet, genCache]);

  // --- test set mutations ---------------------------------------------------
  const toggleTestSet = (genId: string) => {
    setTestSet((prev) => {
      const n = new Set(prev);
      if (n.has(genId)) n.delete(genId); else n.add(genId);
      saveTestSet(suiteId, n);
      return n;
    });
  };
  const selectedGens = useMemo(
    () => [...testSet].map((id) => genCache.get(id) ?? ({ generation_id: id } as Generation)),
    [testSet, genCache],
  );

  // --- run ------------------------------------------------------------------
  const handleRunTest = useCallback(async () => {
    if (isRunning || testSet.size === 0 || selectedCriteria.length === 0) return;
    const genIds = [...testSet];
    const crits = selectedCriteria;
    setRanGenIds(genIds);
    setRanCriteria(crits);

    const pairs = genIds.flatMap((g) => crits.map((c) => ({ genId: g, crit: c })));
    const init = new Map<string, Cell>();
    for (const p of pairs) init.set(cellKey(p.genId, p.crit.id), { status: "pending" });
    setResults(init);
    setSelectedCell({ genId: genIds[0], critId: crits[0].id });
    setIsRunning(true);

    const setCell = (key: string, patch: Partial<Cell>) =>
      setResults((prev) => {
        const n = new Map(prev);
        n.set(key, { ...(n.get(key) ?? { status: "pending" }), ...patch });
        return n;
      });

    await runPool(pairs, CONCURRENCY, async ({ genId, crit }) => {
      const key = cellKey(genId, crit.id);
      setCell(key, { status: "running" });
      try {
        // Reuse a saved refinement chain's original score if one exists — no AI cost.
        const chain = await evalsApi.chain.get(crit.id, genId).catch(() => null);
        if (chain?.data?.original) {
          const o = chain.data.original;
          setCell(key, {
            status: "done", score: o.score, desired_score: o.desired_score,
            rationale: o.rationale, evidence: o.evidence,
            criterion_name: o.criterion_name ?? crit.criteria_name, restored: true,
          });
          return;
        }
        const r = await evalsApi.run(genId, { criterion_id: crit.id });
        setCell(key, {
          status: "done", score: r.score, desired_score: r.desired_score,
          rationale: r.rationale, evidence: r.evidence,
          criterion_name: r.criterion_name, extraction_warning: r.extraction_warning,
        });
      } catch (err) {
        setCell(key, { status: "error", error: err instanceof Error ? err.message : String(err) });
      }
    });

    setIsRunning(false);
  }, [isRunning, testSet, selectedCriteria]);

  const canRun = testSet.size > 0 && selectedCriteria.length > 0 && !isRunning;

  // --- rewrite ---------------------------------------------------------------
  // Aggregate every completed eval for a generation into rewrite feedback.
  const feedbackForGeneration = useCallback((genId: string): RewriteFeedbackItem[] => {
    const out: RewriteFeedbackItem[] = [];
    for (const crit of ranCriteria) {
      const cell = results.get(cellKey(genId, crit.id));
      if (cell?.status !== "done") continue;
      out.push({
        criterion_id: crit.id,
        criterion_name: cell.criterion_name ?? crit.criteria_name,
        score: cell.score ?? "",
        desired_score: cell.desired_score ?? "",
        rationale: cell.rationale ?? "",
        evidence: cell.evidence ?? [],
      });
    }
    return out;
  }, [ranCriteria, results]);

  const doneCountFor = useCallback(
    (genId: string) => ranCriteria.reduce((n, c) => n + (results.get(cellKey(genId, c.id))?.status === "done" ? 1 : 0), 0),
    [ranCriteria, results],
  );

  const persistChain = (genId: string, iterations: RewriteIteration[]) => {
    setRewrites((prev) => {
      const next = { ...prev, [genId]: iterations };
      saveRewrites(suiteId, next);
      return next;
    });
  };

  return (
    <div className="space-y-3">
      {/* mixed-type warning */}
      {mixed && (
        <div className="flex items-start gap-2 rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">
          <AlertTriangle className="h-4 w-4 shrink-0 mt-0.5" />
          <span>
            Selected criteria target multiple generation types (
            <strong>{inferredGenTypes.join(", ")}</strong>). Pick one generation type below
            to test against for meaningful scores.
          </span>
        </div>
      )}

      {/* selected test generations — always visible */}
      <div className="border rounded-md divide-y">
        {selectedGens.length === 0 ? (
          <p className="text-sm text-muted-foreground p-4 text-center">No generations selected yet.</p>
        ) : (
          selectedGens.map((g) => (
            <div key={g.generation_id} className="flex items-start gap-3 px-3 py-2">
              <span className="flex-1 min-w-0">
                <span className="flex flex-wrap items-center gap-1.5">
                  <span className="font-mono text-xs">{g.generation_id.slice(0, 8)}</span>
                  {g.model && <Badge variant="outline" className="text-[10px]">{g.model}</Badge>}
                </span>
                {g.response_content && (
                  <span className="mt-0.5 block text-xs text-muted-foreground line-clamp-1">
                    {g.response_content.slice(0, 120)}
                  </span>
                )}
              </span>
              <Button
                variant="ghost" size="sm"
                className="h-7 px-2 text-xs text-muted-foreground hover:text-destructive shrink-0 gap-1"
                onClick={() => toggleTestSet(g.generation_id)}
              >
                <X className="h-3.5 w-3.5" /> Remove
              </Button>
            </div>
          ))
        )}
      </div>

      {/* distinctive expand/collapse affordance */}
      <Button
        variant="outline"
        onClick={() => setShowSelector((p) => !p)}
        className={cn(
          "w-full justify-center gap-2 h-11 border-2 border-dashed font-medium transition-colors",
          showSelector
            ? "border-primary/40 text-foreground bg-muted/40"
            : "text-muted-foreground hover:text-foreground hover:border-primary/50 hover:bg-muted/30",
        )}
      >
        {showSelector ? <ChevronUp className="h-4 w-4" /> : <Plus className="h-4 w-4" />}
        {showSelector ? "Hide generation selection" : "Add / edit generations"}
      </Button>

      {/* selector — expandable */}
      {showSelector && (
        <div className="space-y-2">
          <div className="flex flex-wrap gap-2 items-start">
            <div className="relative max-w-xs flex-1 min-w-[180px]">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <Input
                placeholder="Search generations…"
                value={search}
                onChange={(e) => { setSearch(e.target.value); setPage(0); }}
                className="pl-9"
              />
            </div>
            <FilterDropdown
              label="Generation type"
              options={genTypeOptions}
              selected={genTypeFilter}
              onToggle={toggleGenType}
              onClear={clearGenType}
            />
            <Button
              variant={validProductDataOnly ? "default" : "outline"}
              size="sm" className="h-10 text-xs gap-1.5"
              onClick={() => { setValidProductDataOnly((p) => !p); setPage(0); }}
            >
              <Switch checked={validProductDataOnly} className="pointer-events-none scale-75" />
              Valid product data only
            </Button>
          </div>

          <div className="border rounded-md divide-y max-h-[420px] overflow-y-auto">
            {isLoading ? (
              <p className="text-sm text-muted-foreground p-4 text-center">Loading generations…</p>
            ) : pageItems.length === 0 ? (
              <p className="text-sm text-muted-foreground p-4 text-center">No generations match.</p>
            ) : (
              pageItems.map((g) => {
                const checked = testSet.has(g.generation_id);
                return (
                  <label
                    key={g.generation_id}
                    className="flex items-start gap-3 px-3 py-2 hover:bg-muted/40 cursor-pointer transition-colors"
                  >
                    <Checkbox
                      checked={checked}
                      onCheckedChange={() => toggleTestSet(g.generation_id)}
                      className="mt-0.5"
                      aria-label={checked ? "Remove from test set" : "Add to test set"}
                    />
                    <span className="flex-1 min-w-0">
                      <span className="flex flex-wrap items-center gap-1.5">
                        <span className="font-mono text-xs">{g.generation_id.slice(0, 8)}</span>
                        {g.model && <Badge variant="outline" className="text-[10px]">{g.model}</Badge>}
                        {g.has_product_data && <Badge variant="outline" className="text-[10px] border-green-200 bg-green-50 text-green-700">product data</Badge>}
                      </span>
                      {g.response_content && (
                        <span className="mt-0.5 block text-xs text-muted-foreground line-clamp-2">
                          {g.response_content.slice(0, 200)}
                        </span>
                      )}
                    </span>
                  </label>
                );
              })
            )}
          </div>

          <div className="flex items-center justify-between text-xs text-muted-foreground">
            <span>{total} generation{total !== 1 ? "s" : ""}{testSet.size > 0 && ` · ${testSet.size} selected`}</span>
            {totalPages > 1 && (
              <div className="flex items-center gap-1">
                <Button variant="ghost" size="icon" className="h-6 w-6" disabled={page === 0} onClick={() => setPage((p) => p - 1)}>
                  <ChevronLeft className="h-3.5 w-3.5" />
                </Button>
                <span>{page + 1} / {totalPages}</span>
                <Button variant="ghost" size="icon" className="h-6 w-6" disabled={page >= totalPages - 1} onClick={() => setPage((p) => p + 1)}>
                  <ChevronRight className="h-3.5 w-3.5" />
                </Button>
              </div>
            )}
          </div>
        </div>
      )}

      {/* run */}
      <div className="flex justify-end">
        <Button className="gap-1.5" disabled={!canRun} onClick={handleRunTest}>
          {isRunning
            ? <><Loader2 className="h-3.5 w-3.5 animate-spin" /> Running…</>
            : <><Play className="h-3.5 w-3.5" /> Test ({testSet.size} × {selectedCriteria.length})</>}
        </Button>
      </div>

      {/* results — master (matrix) + detail (updates on selected run) */}
      {results.size > 0 && (
        <div className="space-y-2 pt-2">
          <p className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground">Results</p>

          {/* master: score matrix; click a cell to load its detail below */}
          <div className="border rounded-md overflow-x-auto">
            <table className="w-full text-sm border-collapse">
              <thead>
                <tr className="border-b bg-muted/40">
                  <th className="text-left font-medium px-3 py-2 sticky left-0 bg-muted/40 z-10">Generation</th>
                  {ranCriteria.map((c) => (
                    <th key={c.id} className="text-left font-medium px-3 py-2 min-w-[120px] max-w-[200px]" title={c.criteria_name}>
                      <span className="line-clamp-2 text-xs">{c.criteria_name}</span>
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {ranGenIds.map((genId) => {
                  const g = genCache.get(genId);
                  return (
                    <tr key={genId} className="border-b last:border-b-0">
                      <td className="px-3 py-2 align-top sticky left-0 bg-background z-10">
                        <span className="flex items-center gap-1.5">
                          <span className="font-mono text-xs">{genId.slice(0, 8)}</span>
                          {rewrites[genId]?.length > 0 && (
                            <span className="text-[10px] text-green-600 font-medium" title="Has a rewrite chain">
                              ↻{rewrites[genId].length}
                            </span>
                          )}
                        </span>
                        {g?.model && <span className="block text-[10px] text-muted-foreground">{g.model}</span>}
                        <Button
                          size="sm" variant="ghost"
                          className="h-6 mt-1 px-1.5 text-[11px] gap-1 text-muted-foreground hover:text-foreground"
                          disabled={doneCountFor(genId) === 0}
                          onClick={() => setRewriteFor(genId)}
                        >
                          <Sparkles className="h-3 w-3" /> {rewrites[genId]?.length ? "View chain" : "Rewrite"}
                        </Button>
                      </td>
                      {ranCriteria.map((c) => {
                        const cell = results.get(cellKey(genId, c.id));
                        const isSel = selectedCell?.genId === genId && selectedCell?.critId === c.id;
                        return (
                          <td key={c.id} className="px-2 py-1.5 align-top">
                            <button
                              onClick={() => setSelectedCell({ genId, critId: c.id })}
                              className={cn(
                                "flex w-full justify-center rounded px-1.5 py-1 transition-colors hover:bg-muted/50",
                                isSel && "ring-2 ring-primary bg-primary/5",
                              )}
                            >
                              <CellContent cell={cell} />
                            </button>
                          </td>
                        );
                      })}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          {/* detail: the currently selected evaluation run */}
          <div className="border rounded-md p-4 min-h-[120px] bg-muted/10">
            {(() => {
              if (!selectedCell) {
                return <p className="text-sm text-muted-foreground">Select a result cell to view its evaluation details.</p>;
              }
              const { genId, critId } = selectedCell;
              const cell = results.get(cellKey(genId, critId));
              const crit = ranCriteria.find((c) => c.id === critId);
              const g = genCache.get(genId);
              return (
                <div className="space-y-2.5">
                  <div className="flex items-start justify-between gap-3 flex-wrap">
                    <div className="min-w-0">
                      <p className="text-sm font-medium">{crit?.criteria_name ?? cell?.criterion_name ?? critId}</p>
                      <p className="font-mono text-[11px] text-muted-foreground">
                        {genId.slice(0, 8)}{g?.model ? ` · ${g.model}` : ""}
                      </p>
                    </div>
                    {cell?.status === "done" && (
                      <div className="flex items-center gap-2 shrink-0">
                        <ScoreBadge score={cell.score ?? ""} desired={cell.desired_score ?? ""} />
                        {cell.restored && <span className="text-[10px] text-muted-foreground">restored from history</span>}
                      </div>
                    )}
                  </div>

                  {(!cell || cell.status === "pending") && <p className="text-sm text-muted-foreground">Not run yet.</p>}
                  {cell?.status === "running" && (
                    <p className="flex items-center gap-2 text-sm text-muted-foreground">
                      <Loader2 className="h-3.5 w-3.5 animate-spin" /> Evaluating…
                    </p>
                  )}
                  {cell?.status === "error" && <p className="text-sm text-destructive">{cell.error}</p>}
                  {cell?.status === "done" && (
                    <>
                      {cell.rationale && <p className="text-sm leading-relaxed">{cell.rationale}</p>}
                      {cell.evidence && cell.evidence.length > 0 && (
                        <ul className="space-y-1">
                          {cell.evidence.map((e, i) => (
                            <li key={i} className="text-xs text-muted-foreground border-l-2 border-muted pl-2 italic">"{e}"</li>
                          ))}
                        </ul>
                      )}
                      {cell.extraction_warning && <p className="text-[11px] text-amber-700">{cell.extraction_warning}</p>}
                      <Button
                        size="sm" variant="ghost"
                        className="h-6 px-1.5 text-[11px] gap-1 text-muted-foreground hover:text-foreground"
                        onClick={() => setChatRequest({
                          request: { generation_id: genId, mode: "eval", criterion_id: critId },
                          title: `Eval prompt · ${genId.slice(0, 8)}`,
                        })}
                      >
                        <MessageSquare className="h-3 w-3" /> View eval prompt
                      </Button>
                    </>
                  )}
                </div>
              );
            })()}
          </div>
        </div>
      )}

      {/* rewrite chain dialog for the selected generation */}
      {rewriteFor && (
        <RewriteDialog
          open={!!rewriteFor}
          onOpenChange={(v) => { if (!v) setRewriteFor(null); }}
          generationId={rewriteFor}
          model={genCache.get(rewriteFor)?.model}
          originalCopy={genCache.get(rewriteFor)?.response_content ?? ""}
          baseFeedback={feedbackForGeneration(rewriteFor)}
          chain={rewrites[rewriteFor] ?? []}
          onChainChange={(iterations) => persistChain(rewriteFor, iterations)}
          onViewPrompt={(feedback, content, title) => setChatRequest({
            request: { generation_id: rewriteFor, mode: "rewrite", feedback, content },
            title,
          })}
        />
      )}

      {/* shared prompt-inspection modal (eval + rewrite) */}
      <ChatChainModal
        open={!!chatRequest}
        onOpenChange={(v) => { if (!v) setChatRequest(null); }}
        request={chatRequest?.request ?? null}
        title={chatRequest?.title ?? ""}
      />
    </div>
  );
}
