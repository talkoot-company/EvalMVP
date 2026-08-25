import { useState, useMemo, useCallback } from "react";
import type { Criterion } from "@/types";

// ---------------------------------------------------------------------------
// Shared criteria filtering — used by the criteria list AND the suite criteria
// selection so both offer identical filters. Owns all filter state, derives the
// dynamic option lists, and exposes a `matches` predicate + `filtered` list.
// ---------------------------------------------------------------------------

export function isWellSpecified(c: Criterion): boolean {
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

// The "Marketplace" filter keys off the marketplace tag, but treats
// Universal-context criteria (which have no marketplace tag) as "Universal".
export const marketplaceKey = (c: Criterion): string =>
  c.marketplace_tag || (c.context === "Universal" ? "Universal" : "");

function useFilter(initial: string[] = []): [Set<string>, (v: string) => void, () => void] {
  const [s, setS] = useState<Set<string>>(() => new Set(initial));
  const toggle = (v: string) => setS((p) => { const n = new Set(p); if (n.has(v)) n.delete(v); else n.add(v); return n; });
  const clear = () => setS(new Set());
  return [s, toggle, clear];
}

export type ActiveFilter = "active" | "inactive" | "all";

export interface CriteriaFiltersConfig {
  defaultActive?: ActiveFilter;
  defaultMarketplace?: string[];
  defaultWellSpecified?: boolean;
}

export function useCriteriaFilters(criteria: Criterion[], config: CriteriaFiltersConfig = {}) {
  const { defaultActive = "all", defaultMarketplace = [], defaultWellSpecified = false } = config;

  const [search, setSearch] = useState("");
  const [wellSpecifiedOnly, setWellSpecifiedOnly] = useState(defaultWellSpecified);
  const [hasNotesOnly, setHasNotesOnly] = useState(false);
  const [activeFilter, setActiveFilter] = useState<ActiveFilter>(defaultActive);

  const [contextFilter,     toggleContext,     clearContext    ] = useFilter();
  const [typeFilter,        toggleType,        clearType       ] = useFilter();
  const [contentTypeFilter, toggleContentType, clearContentType] = useFilter();
  const [categoryFilter,    toggleCategory,    clearCategory   ] = useFilter();
  const [marketplaceFilter, toggleMarketplace, clearMarketplace] = useFilter(defaultMarketplace);
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

  const matches = useCallback((c: Criterion) => {
    if (activeFilter === "active"   && !c.active) return false;
    if (activeFilter === "inactive" &&  c.active) return false;
    if (wellSpecifiedOnly && !isWellSpecified(c)) return false;
    if (hasNotesOnly && !(c.notes ?? "").trim()) return false;
    if (search && !c.criteria_name.toLowerCase().includes(search.toLowerCase()) &&
        !(c.criteria_definition ?? "").toLowerCase().includes(search.toLowerCase())) return false;
    if (contextFilter.size     && !contextFilter.has(c.context))            return false;
    if (typeFilter.size        && !typeFilter.has(c.criteria_type))         return false;
    if (contentTypeFilter.size && !contentTypeFilter.has(c.content_type))   return false;
    if (categoryFilter.size    && !categoryFilter.has(c.criteria_category)) return false;
    if (marketplaceFilter.size && !marketplaceFilter.has(marketplaceKey(c))) return false;
    if (brandFilter.size       && !brandFilter.has(c.brand_tag ?? ""))      return false;
    if (industryFilter.size    && !industryFilter.has(c.industry_tag ?? "")) return false;
    return true;
  }, [search, activeFilter, wellSpecifiedOnly, hasNotesOnly, contextFilter, typeFilter, contentTypeFilter, categoryFilter, marketplaceFilter, brandFilter, industryFilter]);

  const filtered = useMemo(() => criteria.filter(matches), [criteria, matches]);

  return {
    filtered, matches, total: criteria.length,
    search, setSearch,
    wellSpecifiedOnly, setWellSpecifiedOnly,
    hasNotesOnly, setHasNotesOnly,
    activeFilter, setActiveFilter,
    contextFilter, toggleContext, clearContext,
    typeFilter, toggleType, clearType,
    contentTypeFilter, toggleContentType, clearContentType,
    categoryFilter, toggleCategory, clearCategory,
    marketplaceFilter, toggleMarketplace, clearMarketplace,
    brandFilter, toggleBrand, clearBrand,
    industryFilter, toggleIndustry, clearIndustry,
    categoryOptions, marketplaceOptions, brandOptions, industryOptions,
  };
}

export type CriteriaFilters = ReturnType<typeof useCriteriaFilters>;
