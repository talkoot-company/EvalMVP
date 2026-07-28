import { useState, useMemo } from "react";
import { useGenerations, useGenerationModels, useGenerationDatasets } from "@/hooks/useGenerations";
import type { Generation } from "@/api/generations";
import { datasetLabel } from "@/lib/datasets";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Search, ChevronLeft, ChevronRight, ChevronDown, ChevronRight as ChevronRightIcon } from "lucide-react";
import { EvalPanel } from "@/components/EvalPanel";

const PAGE_SIZE = 25;

function formatDate(unix: number | null): string {
  if (!unix) return "—";
  return new Date(unix * 1000).toLocaleString(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
  });
}

function truncate(text: string | null | undefined, len = 100): string {
  if (!text) return "—";
  const flat = text.replace(/\s+/g, " ").trim();
  return flat.length > len ? flat.slice(0, len) + "…" : flat;
}

type ContentType = "Title" | "Description" | "Bullets" | "Sustainability" | "Extraction" | "Other";

function inferType(systemPrompt: string | null): ContentType {
  if (!systemPrompt) return "Other";
  const sp = systemPrompt.toLowerCase();
  if (sp.includes("bullet")) return "Bullets";
  if (sp.includes("sustainab")) return "Sustainability";
  if (sp.includes("extract") || sp.includes("lookup") || sp.includes("identify")) return "Extraction";
  if (sp.includes("title") || sp.includes("subhead") || sp.includes("naming")) return "Title";
  if (sp.includes("description") || sp.includes("copywriter") || sp.includes("copy")) return "Description";
  return "Other";
}

const TYPE_STYLES: Record<ContentType, string> = {
  Title:          "border-blue-200   bg-blue-50   text-blue-700",
  Description:    "border-violet-200 bg-violet-50 text-violet-700",
  Bullets:        "border-amber-200  bg-amber-50  text-amber-700",
  Sustainability: "border-green-200  bg-green-50  text-green-700",
  Extraction:     "border-slate-200  bg-slate-50  text-slate-600",
  Other:          "border-gray-200   bg-gray-50   text-gray-500",
};

function TypeBadge({ systemPrompt }: { systemPrompt: string | null }) {
  const type = inferType(systemPrompt);
  return (
    <Badge variant="outline" className={`text-[10px] font-medium whitespace-nowrap ${TYPE_STYLES[type]}`}>
      {type}
    </Badge>
  );
}

function tryFormatJson(text: string): string {
  try {
    return JSON.stringify(JSON.parse(text), null, 2);
  } catch {
    return text;
  }
}

function ResponseContent({ text }: { text: string | null }) {
  if (!text) return <p className="text-sm text-muted-foreground italic">No response</p>;
  const trimmed = text.trim();
  const isJson = trimmed.startsWith("{") || trimmed.startsWith("[");
  const formatted = isJson ? tryFormatJson(trimmed) : trimmed;
  return (
    <pre className="text-sm whitespace-pre-wrap break-words leading-relaxed font-sans">
      {formatted}
    </pre>
  );
}

const COLUMNS = 6;

function GenerationRow({
  gen,
  expanded,
  onToggle,
}: {
  gen: Generation;
  expanded: boolean;
  onToggle: () => void;
}) {
  const [showRequest, setShowRequest] = useState(false);

  return (
    <>
      <TableRow
        className="cursor-pointer hover:bg-muted/50 transition-colors"
        onClick={onToggle}
        data-state={expanded ? "selected" : undefined}
      >
        <TableCell className="w-8 pr-0">
          {expanded
            ? <ChevronDown className="h-3.5 w-3.5 text-muted-foreground" />
            : <ChevronRightIcon className="h-3.5 w-3.5 text-muted-foreground" />}
        </TableCell>
        <TableCell className="font-mono text-xs text-muted-foreground">
          {gen.generation_id.slice(0, 8)}…
        </TableCell>
        <TableCell>
          <TypeBadge systemPrompt={gen.system_prompt} />
        </TableCell>
        <TableCell className="font-mono text-xs text-muted-foreground">
          {gen.model ?? "—"}
        </TableCell>
        <TableCell className="text-xs text-muted-foreground whitespace-nowrap">
          {formatDate(gen.created_at)}
        </TableCell>
        <TableCell className="text-right text-xs text-muted-foreground tabular-nums">
          {gen.total_tokens ?? "—"}
        </TableCell>
      </TableRow>

      {expanded && (
        <TableRow className="bg-muted/30 hover:bg-muted/30">
          <TableCell colSpan={COLUMNS} className="px-10 py-5 space-y-4">
            <ResponseContent text={gen.response_content} />

            <div>
              <button
                className="text-xs text-muted-foreground hover:text-foreground flex items-center gap-1 transition-colors"
                onClick={(e) => { e.stopPropagation(); setShowRequest((v) => !v); }}
              >
                {showRequest
                  ? <ChevronDown className="h-3 w-3" />
                  : <ChevronRightIcon className="h-3 w-3" />}
                {showRequest ? "Hide request" : "Show request"}
              </button>
              {showRequest && (
                <pre className="mt-2 text-xs text-muted-foreground whitespace-pre-wrap break-words leading-relaxed bg-muted rounded-md p-3">
                  {gen.last_user_message?.trim() ?? "—"}
                </pre>
              )}
            </div>

            <div onClick={(e) => e.stopPropagation()}>
              <EvalPanel generationId={gen.generation_id} systemPrompt={gen.system_prompt} />
            </div>
          </TableCell>
        </TableRow>
      )}
    </>
  );
}

const GenerationsPage = () => {
  const [search, setSearch] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");
  const [modelFilter, setModelFilter] = useState("all");
  const [datasetFilter, setDatasetFilter] = useState("all");
  const [typeFilter, setTypeFilter] = useState<ContentType | "all">("all");
  const [validProductDataOnly, setValidProductDataOnly] = useState(true);
  const [page, setPage] = useState(0);
  const [expandedId, setExpandedId] = useState<string | null>(null);

  const { data: models = [] } = useGenerationModels();
  const { data: datasets = [] } = useGenerationDatasets();

  const { data, isLoading } = useGenerations({
    search: debouncedSearch,
    model: modelFilter === "all" ? "" : modelFilter,
    dataset: datasetFilter,
    validProductData: validProductDataOnly,
    limit: PAGE_SIZE,
    offset: page * PAGE_SIZE,
  });

  const items = useMemo(() => {
    if (!data?.items) return [];
    if (typeFilter === "all") return data.items;
    return data.items.filter((g) => inferType(g.system_prompt) === typeFilter);
  }, [data?.items, typeFilter]);

  const totalPages = useMemo(
    () => (data ? Math.ceil(data.total / PAGE_SIZE) : 0),
    [data],
  );

  const handleSearch = (value: string) => {
    setSearch(value);
    setPage(0);
    clearTimeout((window as unknown as { _st?: ReturnType<typeof setTimeout> })._st);
    (window as unknown as { _st?: ReturnType<typeof setTimeout> })._st = setTimeout(
      () => setDebouncedSearch(value),
      300,
    );
  };

  const handleToggle = (id: string) => {
    setExpandedId((prev) => (prev === id ? null : id));
  };

  const ALL_TYPES: ContentType[] = ["Title", "Description", "Bullets", "Sustainability", "Extraction", "Other"];

  return (
    <div className="p-6 space-y-6 animate-fade-in">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold tracking-tight">Generations</h1>
        {data && (
          <span className="text-sm text-muted-foreground">{data.total} total</span>
        )}
      </div>

      {/* Filters */}
      <div className="flex flex-wrap items-center gap-3">
        <div className="relative flex-1 min-w-48 max-w-sm">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder="Search prompt or response…"
            value={search}
            onChange={(e) => handleSearch(e.target.value)}
            className="pl-9"
          />
        </div>

        <Select value={typeFilter} onValueChange={(v) => { setTypeFilter(v as ContentType | "all"); setPage(0); }}>
          <SelectTrigger className="w-44">
            <SelectValue placeholder="All types" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All types</SelectItem>
            {ALL_TYPES.map((t) => <SelectItem key={t} value={t}>{t}</SelectItem>)}
          </SelectContent>
        </Select>

        <Select value={modelFilter} onValueChange={(v) => { setModelFilter(v); setPage(0); }}>
          <SelectTrigger className="w-52">
            <SelectValue placeholder="All models" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All models</SelectItem>
            {models.map((m) => (
              <SelectItem key={m} value={m}>{m}</SelectItem>
            ))}
          </SelectContent>
        </Select>

        {datasets.length > 0 && (
          <Select value={datasetFilter} onValueChange={(v) => { setDatasetFilter(v); setPage(0); }}>
            <SelectTrigger className="w-44">
              <SelectValue placeholder="All datasets" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All datasets</SelectItem>
              {datasets.map((d) => (
                <SelectItem key={d} value={d}>{datasetLabel(d)}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        )}

        <label className="flex items-center gap-2 text-sm text-muted-foreground cursor-pointer select-none">
          <Switch
            checked={validProductDataOnly}
            onCheckedChange={(v) => { setValidProductDataOnly(v); setPage(0); }}
          />
          Valid product data only
        </label>
      </div>

      {/* Table */}
      {isLoading ? (
        <div className="flex items-center justify-center h-48 text-muted-foreground text-sm">
          Loading…
        </div>
      ) : (
        <div className="border rounded-md overflow-hidden">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-8" />
                <TableHead className="w-28">ID</TableHead>
                <TableHead className="w-28">Type</TableHead>
                <TableHead className="w-44">Model</TableHead>
                <TableHead className="w-36">Date</TableHead>
                <TableHead className="w-24 text-right">Tokens</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {items.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={COLUMNS} className="text-center text-muted-foreground py-10">
                    No generations found
                  </TableCell>
                </TableRow>
              ) : (
                items.map((gen) => (
                  <GenerationRow
                    key={gen.generation_id}
                    gen={gen}
                    expanded={expandedId === gen.generation_id}
                    onToggle={() => handleToggle(gen.generation_id)}
                  />
                ))
              )}
            </TableBody>
          </Table>
        </div>
      )}

      {/* Pagination */}
      {totalPages > 1 && (
        <div className="flex items-center justify-between">
          <span className="text-sm text-muted-foreground">
            Page {page + 1} of {totalPages}
          </span>
          <div className="flex gap-2">
            <Button variant="outline" size="sm" disabled={page === 0} onClick={() => setPage((p) => p - 1)}>
              <ChevronLeft className="h-4 w-4" />
            </Button>
            <Button variant="outline" size="sm" disabled={page >= totalPages - 1} onClick={() => setPage((p) => p + 1)}>
              <ChevronRight className="h-4 w-4" />
            </Button>
          </div>
        </div>
      )}
    </div>
  );
};

export default GenerationsPage;
