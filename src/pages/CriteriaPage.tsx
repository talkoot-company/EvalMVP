import { useState, useMemo } from "react";
import { useNavigate } from "react-router-dom";
import { AddCriterionDialog } from "@/components/AddCriterionDialog";
import { CriterionForm } from "@/components/CriterionForm";
import { UploadCriteriaDialog } from "@/components/UploadCriteriaDialog";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import {
  DropdownMenu, DropdownMenuCheckboxItem, DropdownMenuContent,
  DropdownMenuSeparator, DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import { Search, Plus, Trash2, Upload, ChevronDown, ChevronRight, X, FlaskConical } from "lucide-react";
import type { Criterion } from "@/types";
import { CRITERIA_TYPES, CONTEXTS, CONTENT_TYPES } from "@/config/hierarchy";
import { useCriteria, useCreateCriterion, useUpdateCriterion, useDeleteCriterion, useToggleActiveCriterion } from "@/hooks/useCriteria";
import { useTypeMapping } from "@/hooks/useMapping";
import { useGenerationCountsByType } from "@/hooks/useGenerations";

// ---------------------------------------------------------------------------
// Well-specified check
// ---------------------------------------------------------------------------
function isWellSpecified(c: Criterion): boolean {
  if (!c.criteria_definition?.trim()) return false;
  const whenApplicable = /when applicable|if applicable/i;
  if (whenApplicable.test(c.criteria_name) || whenApplicable.test(c.criteria_definition ?? "")) return false;
  const d = c.eval_definition as Record<string, unknown>;
  if (c.criteria_type === "yes-no")
    return !!(d.definition_yes || d.definition_no);
  if (c.criteria_type === "numerical-scale")
    return [1, 2, 3, 4].some((n) => (d[`score_${n}`] as Record<string, string> | undefined)?.definition);
  const defs = d.bucket_definitions as Record<string, string> | undefined;
  return !!defs && Object.values(defs).some((v) => !!v);
}

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
// Filter helpers
// ---------------------------------------------------------------------------
const criteriaTypeLabelMap = Object.fromEntries(CRITERIA_TYPES.map((t) => [t.value, t.label]));

// The "Marketplace" filter keys off the marketplace tag, but treats
// Universal-context criteria (which have no marketplace tag) as "Universal".
const marketplaceKey = (c: Criterion): string =>
  c.marketplace_tag || (c.context === "Universal" ? "Universal" : "");

function useFilter(initial: string[] = []): [Set<string>, (v: string) => void, () => void] {
  const [s, setS] = useState<Set<string>>(() => new Set(initial));
  const toggle = (v: string) => setS((p) => { const n = new Set(p); if (n.has(v)) n.delete(v); else n.add(v); return n; });
  const clear = () => setS(new Set());
  return [s, toggle, clear];
}

function FilterDropdown({ label, options, selected, labelMap, onToggle, onClear }: {
  label: string; options: string[]; selected: Set<string>;
  labelMap?: Record<string, string>; onToggle(v: string): void; onClear(): void;
}) {
  const allSelected = selected.size === 0 || selected.size === options.length;
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="outline" className="min-h-10 h-auto py-2 px-3 justify-between font-normal items-start gap-2">
          <span className="min-w-0 flex-1 text-left space-y-0.5">
            <span className="block text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">{label}</span>
            {allSelected ? (
              <span className="text-sm">All</span>
            ) : (
              <div className="flex flex-wrap gap-1">
                {options.filter((o) => selected.has(o)).map((v) => (
                  <Badge key={v} variant="secondary" className="h-4 text-[10px] pr-1">
                    {labelMap?.[v] ?? v}
                    <span role="button" className="ml-0.5 cursor-pointer"
                      onPointerDown={(e) => { e.preventDefault(); e.stopPropagation(); }}
                      onClick={(e) => { e.preventDefault(); e.stopPropagation(); onToggle(v); }}>
                      <X className="h-2.5 w-2.5" />
                    </span>
                  </Badge>
                ))}
              </div>
            )}
          </span>
          <ChevronDown className="h-4 w-4 opacity-50 shrink-0 mt-1" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent className="w-56 max-h-72 overflow-y-auto">
        <DropdownMenuCheckboxItem checked={allSelected} onSelect={(e) => e.preventDefault()} onCheckedChange={onClear}>
          All {label}
        </DropdownMenuCheckboxItem>
        <DropdownMenuSeparator />
        {options.map((opt) => (
          <DropdownMenuCheckboxItem key={opt} checked={selected.has(opt)}
            onSelect={(e) => e.preventDefault()} onCheckedChange={() => onToggle(opt)}>
            {labelMap?.[opt] ?? opt}
          </DropdownMenuCheckboxItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

// ---------------------------------------------------------------------------
// Row with inline expand
// ---------------------------------------------------------------------------
function CriterionRow({
  criterion, expanded, onToggle, onToggleActive, onSave, onDelete, existingCategories,
}: {
  criterion: Criterion;
  expanded: boolean;
  onToggle(): void;
  onToggleActive(): void;
  onSave(c: Criterion): void;
  onDelete(): void;
  existingCategories: string[];
}) {
  const navigate = useNavigate();

  return (
    <>
      {/* Summary row */}
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
              checked={criterion.active}
              onClick={(e) => e.stopPropagation()}
              onCheckedChange={() => onToggleActive()}
              title={criterion.active ? "Active — click to deactivate" : "Inactive — click to activate"}
              aria-label={criterion.active ? "Active" : "Inactive"}
              className="scale-90 shrink-0 data-[state=unchecked]:bg-input"
            />
            <span className={`text-sm font-medium leading-snug ${!criterion.active ? "text-muted-foreground" : ""}`}>
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

      {/* Expanded detail */}
      {expanded && (
        <TableRow className="hover:bg-transparent">
          <TableCell colSpan={8} className="px-10 py-6 bg-muted/20 border-b">
            <CriterionForm
              key={criterion.id}
              initialCriterion={criterion}
              existingCategories={existingCategories}
              onSave={(updated) => { onSave(updated); onToggle(); }}
              onCancel={onToggle}
            />
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
  const updateMutation = useUpdateCriterion();
  const deleteMutation = useDeleteCriterion();
  const toggleActiveMutation = useToggleActiveCriterion();

  const [search, setSearch] = useState("");
  const [addOpen, setAddOpen] = useState(false);
  const [uploadOpen, setUploadOpen] = useState(false);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [wellSpecifiedOnly, setWellSpecifiedOnly] = useState(true);
  const [activeFilter, setActiveFilter] = useState<"active" | "inactive" | "all">("active");

  const [contextFilter,     toggleContext,     clearContext    ] = useFilter();
  const [typeFilter,        toggleType,        clearType       ] = useFilter();
  const [contentTypeFilter, toggleContentType, clearContentType] = useFilter();
  const [categoryFilter,    toggleCategory,    clearCategory   ] = useFilter();
  const [marketplaceFilter, toggleMarketplace, clearMarketplace] = useFilter(["Universal"]);
  const [brandFilter,       toggleBrand,       clearBrand      ] = useFilter();
  const [industryFilter,    toggleIndustry,    clearIndustry   ] = useFilter();

  const categoryOptions = useMemo(() =>
    Array.from(new Set(criteria.map((c) => c.criteria_category).filter(Boolean))).sort(),
    [criteria]);
  const marketplaceOptions = useMemo(() =>
    Array.from(new Set(criteria.map(marketplaceKey).filter(Boolean))).sort(),
    [criteria]);
  const brandOptions = useMemo(() =>
    Array.from(new Set(criteria.map((c) => c.brand_tag).filter((v): v is string => !!v))).sort(),
    [criteria]);
  const industryOptions = useMemo(() =>
    Array.from(new Set(criteria.map((c) => c.industry_tag).filter((v): v is string => !!v))).sort(),
    [criteria]);

  const filtered = useMemo(() => criteria.filter((c) => {
    if (activeFilter === "active"   && !c.active) return false;
    if (activeFilter === "inactive" &&  c.active) return false;
    if (wellSpecifiedOnly && !isWellSpecified(c)) return false;
    if (search && !c.criteria_name.toLowerCase().includes(search.toLowerCase()) &&
        !(c.criteria_definition ?? "").toLowerCase().includes(search.toLowerCase())) return false;
    if (contextFilter.size     && !contextFilter.has(c.context))           return false;
    if (typeFilter.size        && !typeFilter.has(c.criteria_type))         return false;
    if (contentTypeFilter.size && !contentTypeFilter.has(c.content_type))  return false;
    if (categoryFilter.size    && !categoryFilter.has(c.criteria_category)) return false;
    if (marketplaceFilter.size && !marketplaceFilter.has(marketplaceKey(c))) return false;
    if (brandFilter.size       && !brandFilter.has(c.brand_tag ?? ""))     return false;
    if (industryFilter.size    && !industryFilter.has(c.industry_tag ?? "")) return false;
    return true;
  }), [criteria, search, activeFilter, wellSpecifiedOnly, contextFilter, typeFilter, contentTypeFilter, categoryFilter, marketplaceFilter, brandFilter, industryFilter]);

  const existingCategories = useMemo(() =>
    Array.from(new Set(criteria.map((c) => c.criteria_category).filter(Boolean))).sort(),
    [criteria]);

  const handleToggle = (id: string) =>
    setExpandedId((prev) => prev === id ? null : id);

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
      <div className="space-y-2">
        <div className="relative max-w-sm">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input placeholder="Search criteria…" value={search} onChange={(e) => setSearch(e.target.value)} className="pl-9" />
        </div>
        <div className="flex flex-wrap gap-2 items-start">
          <FilterDropdown label="Context"      options={CONTEXTS}                             selected={contextFilter}     labelMap={undefined}           onToggle={toggleContext}      onClear={clearContext} />
          <FilterDropdown label="Score type"   options={CRITERIA_TYPES.map((t) => t.value)} selected={typeFilter}         labelMap={criteriaTypeLabelMap} onToggle={toggleType}        onClear={clearType} />
          <FilterDropdown label="Content type" options={CONTENT_TYPES}                        selected={contentTypeFilter}  labelMap={undefined}           onToggle={toggleContentType} onClear={clearContentType} />
          <FilterDropdown label="Category"     options={categoryOptions}                      selected={categoryFilter}     labelMap={undefined}           onToggle={toggleCategory}    onClear={clearCategory} />
          {marketplaceOptions.length > 0 && <FilterDropdown label="Marketplace" options={marketplaceOptions} selected={marketplaceFilter} onToggle={toggleMarketplace} onClear={clearMarketplace} />}
          {brandOptions.length > 0      && <FilterDropdown label="Brand"       options={brandOptions}       selected={brandFilter}       onToggle={toggleBrand}       onClear={clearBrand} />}
          {industryOptions.length > 0   && <FilterDropdown label="Industry"    options={industryOptions}    selected={industryFilter}    onToggle={toggleIndustry}    onClear={clearIndustry} />}
          <Button
            variant={wellSpecifiedOnly ? "default" : "outline"}
            size="sm" className="h-10 text-xs"
            onClick={() => setWellSpecifiedOnly((p) => !p)}
          >
            Well-specified only
          </Button>
          <div className="flex rounded-md border overflow-hidden h-10">
            {(["active", "all", "inactive"] as const).map((opt) => (
              <button
                key={opt}
                onClick={() => setActiveFilter(opt)}
                className={`px-3 text-xs font-medium capitalize transition-colors ${
                  activeFilter === opt
                    ? "bg-primary text-primary-foreground"
                    : "bg-background text-muted-foreground hover:bg-muted"
                } border-r last:border-r-0`}
              >
                {opt === "all" ? "All" : opt === "active" ? "Active" : "Inactive"}
              </button>
            ))}
          </div>
          <span className="text-xs text-muted-foreground self-center ml-1">{filtered.length} of {criteria.length}</span>
        </div>
      </div>

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
                  onToggle={() => handleToggle(c.id)}
                  onToggleActive={() => toggleActiveMutation.mutate(c.id)}
                  onSave={(updated) => updateMutation.mutate({ id: updated.id, data: updated })}
                  onDelete={() => deleteMutation.mutate(c.id)}
                  existingCategories={existingCategories}
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
