import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu, DropdownMenuCheckboxItem, DropdownMenuContent,
  DropdownMenuSeparator, DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Search, ChevronDown, X } from "lucide-react";
import { CRITERIA_TYPES, CONTEXTS, CONTENT_TYPES } from "@/config/hierarchy";
import type { CriteriaFilters } from "@/hooks/useCriteriaFilters";

const criteriaTypeLabelMap = Object.fromEntries(CRITERIA_TYPES.map((t) => [t.value, t.label]));

export function FilterDropdown({ label, options, selected, labelMap, onToggle, onClear }: {
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

// The full criteria filter bar: search + faceted dropdowns + toggle buttons +
// Active/All/Inactive segmented control + a "{filtered} of {total}" count.
// Driven entirely by the `filters` object from useCriteriaFilters.
export function CriteriaFilterBar({ filters: f }: { filters: CriteriaFilters }) {
  return (
    <div className="space-y-2">
      <div className="relative max-w-sm">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
        <Input placeholder="Search criteria…" value={f.search} onChange={(e) => f.setSearch(e.target.value)} className="pl-9" />
      </div>
      <div className="flex flex-wrap gap-2 items-start">
        <FilterDropdown label="Context"      options={CONTEXTS}                           selected={f.contextFilter}     onToggle={f.toggleContext}      onClear={f.clearContext} />
        <FilterDropdown label="Score type"   options={CRITERIA_TYPES.map((t) => t.value)} selected={f.typeFilter}        labelMap={criteriaTypeLabelMap} onToggle={f.toggleType}        onClear={f.clearType} />
        <FilterDropdown label="Content type" options={CONTENT_TYPES}                      selected={f.contentTypeFilter} onToggle={f.toggleContentType} onClear={f.clearContentType} />
        <FilterDropdown label="Category"     options={f.categoryOptions}                  selected={f.categoryFilter}    onToggle={f.toggleCategory}    onClear={f.clearCategory} />
        {f.marketplaceOptions.length > 0 && <FilterDropdown label="Marketplace" options={f.marketplaceOptions} selected={f.marketplaceFilter} onToggle={f.toggleMarketplace} onClear={f.clearMarketplace} />}
        {f.brandOptions.length > 0      && <FilterDropdown label="Brand"       options={f.brandOptions}       selected={f.brandFilter}       onToggle={f.toggleBrand}       onClear={f.clearBrand} />}
        {f.industryOptions.length > 0   && <FilterDropdown label="Industry"    options={f.industryOptions}    selected={f.industryFilter}    onToggle={f.toggleIndustry}    onClear={f.clearIndustry} />}
        <Button
          variant={f.wellSpecifiedOnly ? "default" : "outline"}
          size="sm" className="h-10 text-xs"
          onClick={() => f.setWellSpecifiedOnly((p) => !p)}
        >
          Well-specified only
        </Button>
        <Button
          variant={f.hasNotesOnly ? "default" : "outline"}
          size="sm" className="h-10 text-xs"
          onClick={() => f.setHasNotesOnly((p) => !p)}
        >
          Has notes
        </Button>
        <div className="flex rounded-md border overflow-hidden h-10">
          {(["active", "all", "inactive"] as const).map((opt) => (
            <button
              key={opt}
              onClick={() => f.setActiveFilter(opt)}
              className={`px-3 text-xs font-medium capitalize transition-colors ${
                f.activeFilter === opt
                  ? "bg-primary text-primary-foreground"
                  : "bg-background text-muted-foreground hover:bg-muted"
              } border-r last:border-r-0`}
            >
              {opt === "all" ? "All" : opt === "active" ? "Active" : "Inactive"}
            </button>
          ))}
        </div>
        <span className="text-xs text-muted-foreground self-center ml-1">{f.filtered.length} of {f.total}</span>
      </div>
    </div>
  );
}
