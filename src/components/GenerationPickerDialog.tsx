import { useMemo, useState } from "react";
import { useQuery, keepPreviousData } from "@tanstack/react-query";
import { generationsApi, type Generation } from "@/api/generations";
import { useGenerationDatasets, useLengthPercentiles } from "@/hooks/useGenerations";
import { datasetLabel } from "@/lib/datasets";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { ModelSelect } from "@/components/ModelSelect";
import { Search, ChevronLeft, ChevronRight, Loader2 } from "lucide-react";

export interface RunModelOverrides {
  evalModel: string | null;
  rewriteModel: string | null;
}

const PAGE_SIZE = 8;
const TYPES = ["Title", "Description", "Bullets", "Sustainability", "Extraction", "Other"];

// Single-select generation picker — choose one piece of product copy to push
// through a workflow. Mirrors the SuiteTestPanel filter bar (dataset / type /
// length / valid-product-data + search), trimmed to a single selection.
export function GenerationPickerDialog({ open, onOpenChange, onPick, confirmLabel = "Run", withModelOverrides = false }: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  onPick: (gen: Generation, models?: RunModelOverrides) => void;
  confirmLabel?: string;
  // When true, show eval/rewrite model pickers (null → each suite's own model).
  withModelOverrides?: boolean;
}) {
  const [search, setSearch] = useState("");
  const [debounced, setDebounced] = useState("");
  const [dataset, setDataset] = useState("all");
  const [typeFilter, setTypeFilter] = useState("all");
  const [lengthBand, setLengthBand] = useState("all");
  const [validOnly, setValidOnly] = useState(true);
  const [page, setPage] = useState(0);
  const [selected, setSelected] = useState<Generation | null>(null);
  // Run-level model overrides (null → each step uses its suite's configured model).
  const [evalModel, setEvalModel] = useState<string | null>(null);
  const [rewriteModel, setRewriteModel] = useState<string | null>(null);

  const { data: datasets = [] } = useGenerationDatasets();
  const { data: pctl } = useLengthPercentiles({ dataset });
  const bands = useMemo(() => {
    if (!pctl || !pctl.count) return [] as { value: string; label: string; min?: number; max?: number }[];
    const { p10, p25, p50, p75, p90 } = pctl;
    return [
      { value: "lte_p10", label: `Shortest 10% (≤${p10})`, max: p10 },
      { value: "p25_50", label: `p25–p50 (${p25}–${p50})`, min: p25, max: p50 },
      { value: "p50_75", label: `p50–p75 (${p50}–${p75})`, min: p50, max: p75 },
      { value: "gte_p90", label: `Longest 10% (≥${p90})`, min: p90 },
    ];
  }, [pctl]);
  const activeBand = bands.find((b) => b.value === lengthBand);

  const { data, isLoading } = useQuery({
    queryKey: ["wf-copy-picker", debounced, dataset, typeFilter, lengthBand, validOnly, page],
    queryFn: () => generationsApi.list({
      search: debounced || undefined,
      dataset,
      genTypes: typeFilter === "all" ? undefined : [typeFilter],
      validProductData: validOnly,
      minLen: activeBand?.min,
      maxLen: activeBand?.max,
      limit: PAGE_SIZE,
      offset: page * PAGE_SIZE,
    }),
    enabled: open,
    placeholderData: keepPreviousData,
    staleTime: 1000 * 60,
  });
  const items = data?.items ?? [];
  const totalPages = Math.max(1, Math.ceil((data?.total ?? 0) / PAGE_SIZE));

  const onSearch = (v: string) => {
    setSearch(v); setPage(0);
    clearTimeout((window as unknown as { _wfp?: ReturnType<typeof setTimeout> })._wfp);
    (window as unknown as { _wfp?: ReturnType<typeof setTimeout> })._wfp = setTimeout(() => setDebounced(v), 300);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-3xl max-h-[85vh] flex flex-col gap-3">
        <DialogHeader>
          <DialogTitle className="text-base">Choose product copy</DialogTitle>
          <DialogDescription>Pick one generation to push through the workflow.</DialogDescription>
        </DialogHeader>

        <div className="flex flex-wrap gap-2 items-center">
          <div className="relative flex-1 min-w-[180px]">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input placeholder="Search prompt or response…" value={search} onChange={(e) => onSearch(e.target.value)} className="pl-9 h-9" />
          </div>
          <Select value={typeFilter} onValueChange={(v) => { setTypeFilter(v); setPage(0); }}>
            <SelectTrigger className="h-9 w-36 text-xs"><SelectValue placeholder="All types" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All types</SelectItem>
              {TYPES.map((t) => <SelectItem key={t} value={t}>{t}</SelectItem>)}
            </SelectContent>
          </Select>
          {datasets.length > 0 && (
            <Select value={dataset} onValueChange={(v) => { setDataset(v); setLengthBand("all"); setPage(0); }}>
              <SelectTrigger className="h-9 w-36 text-xs"><SelectValue placeholder="All datasets" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All datasets</SelectItem>
                {datasets.map((d) => <SelectItem key={d} value={d}>{datasetLabel(d)}</SelectItem>)}
              </SelectContent>
            </Select>
          )}
          {bands.length > 0 && (
            <Select value={lengthBand} onValueChange={(v) => { setLengthBand(v); setPage(0); }}>
              <SelectTrigger className="h-9 w-44 text-xs"><SelectValue placeholder="Any length" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Any length</SelectItem>
                {bands.map((b) => <SelectItem key={b.value} value={b.value}>{b.label}</SelectItem>)}
              </SelectContent>
            </Select>
          )}
          <label className="flex items-center gap-1.5 text-xs text-muted-foreground cursor-pointer select-none">
            <Switch checked={validOnly} onCheckedChange={(v) => { setValidOnly(v); setPage(0); }} className="scale-75" />
            Valid product data
          </label>
        </div>

        <div className="border rounded-md divide-y overflow-y-auto flex-1 min-h-[240px]">
          {isLoading ? (
            <p className="text-sm text-muted-foreground p-4 text-center flex items-center justify-center gap-1.5"><Loader2 className="h-3.5 w-3.5 animate-spin" /> Loading…</p>
          ) : items.length === 0 ? (
            <p className="text-sm text-muted-foreground p-4 text-center">No generations match.</p>
          ) : items.map((g) => {
            const chosen = selected?.generation_id === g.generation_id;
            return (
              <label key={g.generation_id} className={`flex items-start gap-3 px-3 py-2 cursor-pointer transition-colors ${chosen ? "bg-primary/10" : "hover:bg-muted/40"}`}>
                <input type="radio" name="wf-copy" checked={chosen} onChange={() => setSelected(g)} className="mt-1" />
                <span className="flex-1 min-w-0">
                  <span className="flex items-center gap-2 text-xs">
                    <span className="font-mono">{g.generation_id.slice(0, 8)}</span>
                    {g.model && <span className="text-muted-foreground">{g.model}</span>}
                    {g.dataset && <span className="text-muted-foreground">· {datasetLabel(g.dataset)}</span>}
                  </span>
                  <span className="block text-xs text-muted-foreground truncate">{(g.response_content ?? "").replace(/\s+/g, " ").trim() || "(empty)"}</span>
                </span>
              </label>
            );
          })}
        </div>

        <div className="flex items-center justify-between">
          <div className="flex items-center gap-1 text-xs text-muted-foreground">
            <Button variant="ghost" size="icon" className="h-7 w-7" disabled={page === 0} onClick={() => setPage((p) => Math.max(0, p - 1))}><ChevronLeft className="h-4 w-4" /></Button>
            Page {page + 1} / {totalPages}
            <Button variant="ghost" size="icon" className="h-7 w-7" disabled={page + 1 >= totalPages} onClick={() => setPage((p) => p + 1)}><ChevronRight className="h-4 w-4" /></Button>
          </div>
        </div>

        {withModelOverrides && (
          <div className="flex flex-wrap items-center gap-4 border-t pt-3">
            <div className="flex items-center gap-1.5">
              <span className="text-xs text-muted-foreground">Eval model</span>
              <ModelSelect className="h-9 w-48 text-xs" value={evalModel} onChange={setEvalModel} defaultOptionLabel="Each suite's model" />
            </div>
            <div className="flex items-center gap-1.5">
              <span className="text-xs text-muted-foreground">Rewrite model</span>
              <ModelSelect className="h-9 w-48 text-xs" value={rewriteModel} onChange={setRewriteModel} defaultOptionLabel="Each suite's model" />
            </div>
          </div>
        )}

        <DialogFooter>
          <Button variant="outline" size="sm" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button size="sm" disabled={!selected} onClick={() => selected && onPick(selected, { evalModel, rewriteModel })}>{confirmLabel}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
