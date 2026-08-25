import { useState, useMemo, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { AddCriterionDialog } from "@/components/AddCriterionDialog";
import { UploadCriteriaDialog } from "@/components/UploadCriteriaDialog";
import { CriteriaFilterBar } from "@/components/CriteriaFilterBar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import { Plus, Trash2, Upload, ChevronDown, ChevronRight, FlaskConical } from "lucide-react";
import type { Criterion } from "@/types";
import { useCriteria, useCreateCriterion, useDeleteCriterion, useToggleActiveCriterion } from "@/hooks/useCriteria";
import { useCriteriaFilters } from "@/hooks/useCriteriaFilters";
import { useTypeMapping } from "@/hooks/useMapping";
import { useGenerationCountsByType } from "@/hooks/useGenerations";

// ---------------------------------------------------------------------------
// Applicable-generation count for a criterion
// ---------------------------------------------------------------------------
function useApplicableCount(contentType: string) {
  const { data: mapping = {} } = useTypeMapping();
  const { data: counts = {} } = useGenerationCountsByType();
  return useMemo(() => {
    const genTypes = mapping[contentType] ?? [];
    return genTypes.reduce((sum, t) => sum + (counts[t] ?? 0), 0);
  }, [mapping, counts, contentType]);
}

function ApplicableCount({ contentType }: { contentType: string }) {
  const count = useApplicableCount(contentType);
  return (
    <span className="tabular-nums text-xs text-muted-foreground">
      {count > 0 ? count : "—"}
    </span>
  );
}

// ---------------------------------------------------------------------------
// Read-only detail view (list expansion) — editing happens in the test view
// ---------------------------------------------------------------------------
function RubricRow({ label, definition, examples }: { label: string; definition?: string; examples?: string[] }) {
  const exs = (examples ?? []).filter(Boolean);
  return (
    <div className="rounded-md border p-2.5 bg-background space-y-1">
      <Badge variant="outline" className="text-[10px]">{label}</Badge>
      {definition
        ? <p className="text-sm leading-snug">{definition}</p>
        : <p className="text-xs text-muted-foreground italic">No definition</p>}
      {exs.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {exs.map((ex, i) => (
            <span key={i} className="text-xs italic text-muted-foreground bg-muted px-2 py-0.5 rounded">&ldquo;{ex}&rdquo;</span>
          ))}
        </div>
      )}
    </div>
  );
}

function EvalDefReadOnly({ criterion }: { criterion: Criterion }) {
  if (criterion.criteria_type === "yes-no") {
    const d = criterion.eval_definition as { definition_yes?: string; definition_no?: string; yes_examples?: string[]; no_examples?: string[] };
    return (
      <div className="space-y-2">
        <RubricRow label="Yes" definition={d.definition_yes} examples={d.yes_examples} />
        <RubricRow label="No"  definition={d.definition_no}  examples={d.no_examples} />
      </div>
    );
  }
  if (criterion.criteria_type === "numerical-scale") {
    const d = criterion.eval_definition as Record<string, { title?: string; definition?: string; example_1?: string; example_2?: string }>;
    return (
      <div className="space-y-2">
        {[1, 2, 3, 4].map((n) => {
          const s = d[`score_${n}`] ?? {};
          return <RubricRow key={n} label={s.title ? `${n} — ${s.title}` : String(n)} definition={s.definition} examples={[s.example_1, s.example_2].filter((e): e is string => !!e)} />;
        })}
      </div>
    );
  }
  const d = criterion.eval_definition as { buckets?: string[]; bucket_titles?: Record<string, string>; bucket_definitions?: Record<string, string>; bucket_examples?: Record<string, string[]> };
  const buckets = d.buckets?.length ? d.buckets : ["0", "1", "2", "3+"];
  return (
    <div className="space-y-2">
      {buckets.map((b) => (
        <RubricRow key={b} label={d.bucket_titles?.[b] ? `${b} — ${d.bucket_titles[b]}` : b} definition={d.bucket_definitions?.[b]} examples={d.bucket_examples?.[b]} />
      ))}
    </div>
  );
}

function MetaField({ label, value }: { label: string; value?: string | number | null }) {
  if (value === null || value === undefined || value === "") return null;
  return (
    <div>
      <p className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">{label}</p>
      <p className="text-sm">{value}</p>
    </div>
  );
}

function CriterionReadOnly({ criterion, onEdit }: { criterion: Criterion; onEdit(): void }) {
  const scoreTypeLabel =
    criterion.criteria_type === "yes-no" ? "Yes / No"
    : criterion.criteria_type === "numerical-scale" ? "Scale 1–4" : "Count";
  return (
    <div className="space-y-5 text-sm">
      <div className="flex items-start justify-between gap-4">
        <p className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground">Details</p>
        <Button size="sm" variant="outline" className="h-7 gap-1.5 text-xs" onClick={onEdit}>
          <FlaskConical className="h-3.5 w-3.5" /> Open to edit &amp; test
        </Button>
      </div>

      <div>
        <p className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground mb-1">Criteria definition</p>
        {criterion.criteria_definition?.trim()
          ? <p className="leading-relaxed whitespace-pre-wrap">{criterion.criteria_definition}</p>
          : <p className="text-muted-foreground italic">No definition</p>}
      </div>

      <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
        <MetaField label="Context" value={criterion.context} />
        <MetaField label="Content type" value={criterion.content_type} />
        <MetaField label="Category" value={criterion.criteria_category} />
        <MetaField label="Score type" value={scoreTypeLabel} />
        <MetaField label="Weight" value={criterion.weight} />
        <MetaField label="Marketplace" value={criterion.marketplace_tag} />
        <MetaField label="Brand tag" value={criterion.brand_tag} />
        <MetaField label="Industry" value={criterion.industry_tag} />
        <MetaField label="Customer" value={criterion.customer} />
        <MetaField label="Brand" value={criterion.brand} />
      </div>

      <div>
        <p className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground mb-2">Evaluation definitions</p>
        <EvalDefReadOnly criterion={criterion} />
      </div>

      {criterion.notes?.trim() && (
        <div>
          <p className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground mb-1">Notes</p>
          <p className="leading-relaxed whitespace-pre-wrap text-muted-foreground">{criterion.notes}</p>
        </div>
      )}

      <div className="flex flex-wrap gap-x-6 gap-y-1 pt-2 border-t text-[11px] text-muted-foreground font-mono">
        <span>id: {criterion.id}</span>
        {criterion.created_at && <span>created: {criterion.created_at}</span>}
        {criterion.updated_at && <span>updated: {criterion.updated_at}</span>}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Row with inline expand
// ---------------------------------------------------------------------------
function CriterionRow({
  criterion, expanded, exiting, onToggle, onToggleActive, onDelete,
}: {
  criterion: Criterion;
  expanded: boolean;
  exiting: boolean;
  onToggle(): void;
  onToggleActive(): void;
  onDelete(): void;
}) {
  const navigate = useNavigate();
  // While exiting, optimistically reflect the toggled-to state (switch + dimming)
  // so the row reads as "being hidden" during the animation.
  const shownActive = exiting ? !criterion.active : criterion.active;

  return (
    <>
      {/* Summary row */}
      <TableRow
        className={`cursor-pointer hover:bg-muted/40 transition-colors group ${
          exiting ? "pointer-events-none animate-out fade-out-0 slide-out-to-right-6 duration-300 [animation-fill-mode:forwards]" : ""
        }`}
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
              checked={shownActive}
              onClick={(e) => e.stopPropagation()}
              onCheckedChange={() => onToggleActive()}
              title={shownActive ? "Active — click to deactivate" : "Inactive — click to activate"}
              aria-label={shownActive ? "Active" : "Inactive"}
              className="scale-90 shrink-0 data-[state=unchecked]:bg-input"
            />
            <span className={`text-sm font-medium leading-snug ${!shownActive ? "text-muted-foreground" : ""}`}>
              {criterion.criteria_name}
            </span>
          </div>
        </TableCell>

        <TableCell>
          <Badge variant="outline" className="text-[10px] border-blue-200 bg-blue-50 text-blue-700">
            {criterion.context}
          </Badge>
        </TableCell>

        <TableCell>
          <Badge variant="outline" className="text-[10px] border-violet-200 bg-violet-50 text-violet-700">
            {criterion.content_type}
          </Badge>
        </TableCell>

        <TableCell className="text-xs text-muted-foreground max-w-[160px] truncate">
          {criterion.criteria_category}
        </TableCell>

        <TableCell className="text-xs text-muted-foreground text-right tabular-nums">
          {criterion.weight}
        </TableCell>

        <TableCell className="text-right">
          <ApplicableCount contentType={criterion.content_type} />
        </TableCell>

        <TableCell className="text-right pr-4">
          <div className="flex items-center justify-end gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
            <Button
              variant="ghost" size="sm"
              className="h-7 px-2 text-xs text-muted-foreground gap-1"
              onClick={(e) => { e.stopPropagation(); navigate(`/criteria/${criterion.id}`); }}
            >
              <FlaskConical className="h-3.5 w-3.5" /> Test
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

      {/* Expanded detail (read-only — edit from the test view) */}
      {expanded && (
        <TableRow className="hover:bg-transparent">
          <TableCell colSpan={8} className="px-10 py-6 bg-muted/20 border-b">
            <CriterionReadOnly criterion={criterion} onEdit={() => navigate(`/criteria/${criterion.id}`)} />
          </TableCell>
        </TableRow>
      )}
    </>
  );
}

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------
const CriteriaPage = () => {
  const { data: criteria = [], isLoading } = useCriteria();
  const createMutation = useCreateCriterion();
  const deleteMutation = useDeleteCriterion();
  const toggleActiveMutation = useToggleActiveCriterion();

  const [addOpen, setAddOpen] = useState(false);
  const [uploadOpen, setUploadOpen] = useState(false);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  // Rows mid-exit-animation (toggled to a state the current filter hides). They
  // stay rendered until the animation finishes, then get pruned when the refetch
  // drops them from `filtered`.
  const [exitingIds, setExitingIds] = useState<Set<string>>(new Set());

  const filters = useCriteriaFilters(criteria, {
    defaultActive: "active",
    defaultMarketplace: ["Universal"],
    defaultWellSpecified: true,
  });
  const filtered = filters.filtered;

  const existingCategories = useMemo(() =>
    Array.from(new Set(criteria.map((c) => c.criteria_category).filter(Boolean))).sort(),
    [criteria]);

  const handleToggle = (id: string) =>
    setExpandedId((prev) => prev === id ? null : id);

  const EXIT_MS = 300;
  const handleToggleActive = (c: Criterion) => {
    // Will this toggle move the row out of what the current filter shows?
    const willHide =
      (filters.activeFilter === "active" && c.active) ||
      (filters.activeFilter === "inactive" && !c.active);
    if (!willHide) {
      toggleActiveMutation.mutate(c.id);
      return;
    }
    // Play the exit animation first, then persist — so the animation always
    // shows, even when the API responds instantly.
    setExitingIds((prev) => new Set(prev).add(c.id));
    window.setTimeout(() => toggleActiveMutation.mutate(c.id), EXIT_MS);
  };

  // Drop ids from `exitingIds` once the refetch has removed them from `filtered`
  // (keeps the set from growing; the row is already unmounted by then).
  useEffect(() => {
    setExitingIds((prev) => {
      if (prev.size === 0) return prev;
      const visible = new Set(filtered.map((c) => c.id));
      const next = new Set([...prev].filter((id) => visible.has(id)));
      return next.size === prev.size ? prev : next;
    });
  }, [filtered]);

  if (isLoading) {
    return <div className="p-6 flex items-center justify-center h-64 text-muted-foreground text-sm">Loading criteria…</div>;
  }

  return (
    <div className="p-6 space-y-5 animate-fade-in">
      {/* Header */}
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold tracking-tight">Criteria</h1>
        <div className="flex items-center gap-2">
          <Button variant="outline" className="gap-2" onClick={() => setUploadOpen(true)}>
            <Upload className="h-4 w-4" /> Upload
          </Button>
          <Button className="gap-2" onClick={() => setAddOpen(true)}>
            <Plus className="h-4 w-4" /> New criterion
          </Button>
        </div>
      </div>

      {/* Filters */}
      <CriteriaFilterBar filters={filters} />

      {/* Table */}
      <div className="border rounded-md overflow-hidden">
        <Table>
          <TableHeader>
            <TableRow className="hover:bg-transparent">
              <TableHead className="w-8" />
              <TableHead>Name</TableHead>
              <TableHead className="w-28">Context</TableHead>
              <TableHead className="w-32">Content type</TableHead>
              <TableHead className="w-40">Category</TableHead>
              <TableHead className="w-16 text-right">Weight</TableHead>
              <TableHead className="w-24 text-right">Generations</TableHead>
              <TableHead className="w-28" />
            </TableRow>
          </TableHeader>
          <TableBody>
            {filtered.length === 0 ? (
              <TableRow>
                <TableCell colSpan={8} className="text-center text-muted-foreground py-10">
                  No criteria match the current filters
                </TableCell>
              </TableRow>
            ) : (
              filtered.map((c) => (
                <CriterionRow
                  key={c.id}
                  criterion={c}
                  expanded={expandedId === c.id}
                  exiting={exitingIds.has(c.id)}
                  onToggle={() => handleToggle(c.id)}
                  onToggleActive={() => handleToggleActive(c)}
                  onDelete={() => deleteMutation.mutate(c.id)}
                />
              ))
            )}
          </TableBody>
        </Table>
      </div>

      <AddCriterionDialog
        open={addOpen}
        onOpenChange={setAddOpen}
        onAdd={(c) => createMutation.mutate(c)}
        existingCategories={existingCategories}
      />
      <UploadCriteriaDialog
        open={uploadOpen}
        onOpenChange={setUploadOpen}
        onUpload={(imported) => imported.forEach((c) => createMutation.mutate(c))}
      />
    </div>
  );
};

export default CriteriaPage;
