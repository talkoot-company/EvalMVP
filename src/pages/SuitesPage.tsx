import { useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import { Plus, Search, Trash2, ChevronDown, ChevronRight, FlaskConical, Layers } from "lucide-react";
import { toast } from "sonner";
import type { Suite } from "@/types";
import { AddSuiteDialog } from "@/components/AddSuiteDialog";
import { useSuites, useCreateSuite, useDeleteSuite, useToggleActiveSuite } from "@/hooks/useSuites";
import { useCriteria } from "@/hooks/useCriteria";

// ---------------------------------------------------------------------------
// Row with inline (read-only) expand — mirrors the criteria list pattern
// ---------------------------------------------------------------------------
function SuiteRow({
  suite, expanded, onToggle, onToggleActive, onDelete, criteriaNameById,
}: {
  suite: Suite;
  expanded: boolean;
  onToggle(): void;
  onToggleActive(): void;
  onDelete(): void;
  criteriaNameById: Map<string, string>;
}) {
  const navigate = useNavigate();
  const count = suite.criteria_ids.length;

  return (
    <>
      <TableRow
        className="cursor-pointer hover:bg-muted/40 transition-colors group"
        onClick={onToggle}
        data-state={expanded ? "selected" : undefined}
      >
        <TableCell className="w-8 pr-0">
          {expanded
            ? <ChevronDown className="h-3.5 w-3.5 text-muted-foreground" />
            : <ChevronRight className="h-3.5 w-3.5 text-muted-foreground" />}
        </TableCell>

        <TableCell>
          <div className="flex items-center gap-2.5">
            <Switch
              checked={suite.active}
              onClick={(e) => e.stopPropagation()}
              onCheckedChange={onToggleActive}
              title={suite.active ? "Active — click to deactivate" : "Inactive — click to activate"}
              aria-label={suite.active ? "Active" : "Inactive"}
              className="scale-90 shrink-0 data-[state=unchecked]:bg-input"
            />
            <span className={`text-sm font-medium leading-snug ${!suite.active ? "text-muted-foreground" : ""}`}>
              {suite.name}
            </span>
          </div>
        </TableCell>

        <TableCell className="text-right tabular-nums text-xs text-muted-foreground">
          {count} {count === 1 ? "criterion" : "criteria"}
        </TableCell>

        <TableCell className="text-right pr-4">
          <div className="flex items-center justify-end gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
            <Button
              variant="ghost" size="sm"
              className="h-7 px-2 text-xs text-muted-foreground gap-1"
              onClick={(e) => { e.stopPropagation(); navigate(`/suites/${suite.id}`); }}
            >
              <FlaskConical className="h-3.5 w-3.5" /> Open
            </Button>
            <Button
              variant="ghost" size="icon"
              className="h-7 w-7 text-muted-foreground hover:text-destructive"
              onClick={(e) => { e.stopPropagation(); onDelete(); }}
            >
              <Trash2 className="h-3.5 w-3.5" />
            </Button>
          </div>
        </TableCell>
      </TableRow>

      {expanded && (
        <TableRow className="hover:bg-transparent">
          <TableCell colSpan={4} className="px-10 py-6 bg-muted/20 border-b">
            <div className="space-y-5 text-sm">
              <div className="flex items-start justify-between gap-4">
                <p className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground">Details</p>
                <Button size="sm" variant="outline" className="h-7 gap-1.5 text-xs" onClick={() => navigate(`/suites/${suite.id}`)}>
                  <FlaskConical className="h-3.5 w-3.5" /> Open to edit &amp; test
                </Button>
              </div>

              <div>
                <p className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground mb-1">Description</p>
                {suite.description?.trim()
                  ? <p className="leading-relaxed whitespace-pre-wrap">{suite.description}</p>
                  : <p className="text-muted-foreground italic">No description</p>}
              </div>

              <div>
                <p className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground mb-2">
                  Associated criteria ({count})
                </p>
                {count === 0 ? (
                  <p className="text-muted-foreground italic">No criteria associated yet.</p>
                ) : (
                  <div className="flex flex-wrap gap-1.5">
                    {suite.criteria_ids.map((cid) => (
                      <Badge key={cid} variant="outline" className="text-[11px] font-normal">
                        {criteriaNameById.get(cid) ?? cid}
                      </Badge>
                    ))}
                  </div>
                )}
              </div>

              <p className="font-mono text-[11px] text-muted-foreground pt-2 border-t">{suite.id}</p>
            </div>
          </TableCell>
        </TableRow>
      )}
    </>
  );
}

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------
const SuitesPage = () => {
  const { data: suites = [], isLoading } = useSuites();
  const { data: criteria = [] } = useCriteria();
  const createMutation = useCreateSuite();
  const deleteMutation = useDeleteSuite();
  const toggleActiveMutation = useToggleActiveSuite();

  const [search, setSearch] = useState("");
  const [activeFilter, setActiveFilter] = useState<"active" | "inactive" | "all">("all");
  const [addOpen, setAddOpen] = useState(false);
  const [expandedId, setExpandedId] = useState<string | null>(null);

  const criteriaNameById = useMemo(
    () => new Map(criteria.map((c) => [c.id, c.criteria_name])),
    [criteria],
  );

  const filtered = useMemo(() => suites.filter((s) => {
    if (activeFilter === "active" && !s.active) return false;
    if (activeFilter === "inactive" && s.active) return false;
    if (search) {
      const q = search.toLowerCase();
      if (!s.name.toLowerCase().includes(q) && !(s.description ?? "").toLowerCase().includes(q)) return false;
    }
    return true;
  }), [suites, activeFilter, search]);

  const handleCreate = (suite: { name: string; description?: string | null }) => {
    toast.promise(createMutation.mutateAsync(suite).then((created) => { setAddOpen(false); return created; }), {
      loading: "Creating suite…",
      success: "Suite created",
      error: (e) => `Create failed: ${e instanceof Error ? e.message : String(e)}`,
    });
  };

  if (isLoading) {
    return <div className="p-6 flex items-center justify-center h-64 text-muted-foreground text-sm">Loading suites…</div>;
  }

  return (
    <div className="p-6 space-y-5 animate-fade-in">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Layers className="h-5 w-5 text-muted-foreground" />
          <h1 className="text-2xl font-bold tracking-tight">Suites</h1>
        </div>
        <Button className="gap-2" onClick={() => setAddOpen(true)}>
          <Plus className="h-4 w-4" /> New suite
        </Button>
      </div>

      {/* Filters */}
      <div className="flex flex-wrap gap-2 items-center">
        <div className="relative flex-1 min-w-48 max-w-sm">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input placeholder="Search suites…" value={search} onChange={(e) => setSearch(e.target.value)} className="pl-9" />
        </div>
        <div className="flex rounded-md border overflow-hidden h-10">
          {(["active", "all", "inactive"] as const).map((opt) => (
            <button
              key={opt}
              onClick={() => setActiveFilter(opt)}
              className={`px-3 text-xs font-medium capitalize transition-colors border-r last:border-r-0 ${
                activeFilter === opt ? "bg-primary text-primary-foreground" : "bg-background text-muted-foreground hover:bg-muted"
              }`}
            >
              {opt === "all" ? "All" : opt === "active" ? "Active" : "Inactive"}
            </button>
          ))}
        </div>
        <span className="text-xs text-muted-foreground self-center ml-1">{filtered.length} of {suites.length}</span>
      </div>

      {/* Table */}
      <div className="border rounded-md overflow-hidden">
        <Table>
          <TableHeader>
            <TableRow className="hover:bg-transparent">
              <TableHead className="w-8" />
              <TableHead>Name</TableHead>
              <TableHead className="w-32 text-right">Criteria</TableHead>
              <TableHead className="w-28" />
            </TableRow>
          </TableHeader>
          <TableBody>
            {filtered.length === 0 ? (
              <TableRow>
                <TableCell colSpan={4} className="text-center text-muted-foreground py-10">
                  {suites.length === 0 ? "No suites yet — create one to get started." : "No suites match the current filters."}
                </TableCell>
              </TableRow>
            ) : (
              filtered.map((s) => (
                <SuiteRow
                  key={s.id}
                  suite={s}
                  expanded={expandedId === s.id}
                  onToggle={() => setExpandedId((prev) => (prev === s.id ? null : s.id))}
                  onToggleActive={() => toggleActiveMutation.mutate(s.id)}
                  onDelete={() => deleteMutation.mutate(s.id)}
                  criteriaNameById={criteriaNameById}
                />
              ))
            )}
          </TableBody>
        </Table>
      </div>

      <AddSuiteDialog open={addOpen} onOpenChange={setAddOpen} onAdd={handleCreate} saving={createMutation.isPending} />
    </div>
  );
};

export default SuitesPage;
