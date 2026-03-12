import { useState, useMemo, useEffect, type Dispatch, type SetStateAction } from "react";
import { AddCriterionDialog } from "@/components/AddCriterionDialog";
import { UploadCriteriaDialog } from "@/components/UploadCriteriaDialog";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Search, Plus, Trash2, Pencil, Upload, ChevronDown } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { Criterion, CustomTagCategory } from "@/types";
import { CRITERIA_TYPES } from "@/config/hierarchy";
import {
  loadManagedTaxonomy,
  loadRuntimeCriteria,
  saveManagedTaxonomy,
  saveRuntimeCriteria,
} from "@/data/runtime-taxonomy";

const normalizeTag = (value: string) => value.trim().replace(/\s+/g, " ");

const uniqueTags = (values: string[]) => Array.from(new Set(values.map(normalizeTag).filter(Boolean))).sort((a, b) => a.localeCompare(b));
const isAllSelected = (selected: Set<string>, options: string[]) => selected.size === 0 || selected.size === options.length;
const getFilterLabel = (selected: Set<string>, options: string[], allLabel: string) => {
  if (isAllSelected(selected, options)) return allLabel;
  if (selected.size === 1) return [...selected][0];
  return `${selected.size} selected`;
};

const CriterionDefinitionsTable = ({ criterion }: { criterion: Criterion }) => {
  if (criterion.criteria_type === "yes-no") {
    const definition = criterion.eval_definition as {
      definition_yes?: string;
      definition_no?: string;
      yes_examples?: string[];
      no_examples?: string[];
    };
    const yesExamples = definition.yes_examples?.filter(Boolean).join("; ");
    const noExamples = definition.no_examples?.filter(Boolean).join("; ");
    return (
      <Table className="border rounded-md">
        <TableHeader>
          <TableRow>
            <TableHead className="h-9 py-2 w-[120px]">Score</TableHead>
            <TableHead className="h-9 py-2 w-[220px]">Title</TableHead>
            <TableHead className="h-9 py-2">Definition</TableHead>
            <TableHead className="h-9 py-2">Examples</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          <TableRow>
            <TableCell className="py-2 font-medium">Yes</TableCell>
            <TableCell className="py-2">—</TableCell>
            <TableCell className="py-2">{definition.definition_yes || "—"}</TableCell>
            <TableCell className="py-2">{yesExamples || "—"}</TableCell>
          </TableRow>
          <TableRow>
            <TableCell className="py-2 font-medium">No</TableCell>
            <TableCell className="py-2">—</TableCell>
            <TableCell className="py-2">{definition.definition_no || "—"}</TableCell>
            <TableCell className="py-2">{noExamples || "—"}</TableCell>
          </TableRow>
        </TableBody>
      </Table>
    );
  }

  if (criterion.criteria_type === "numerical-scale") {
    const definition = criterion.eval_definition as Record<string, { title?: string; definition?: string; example_1?: string; example_2?: string }>;
    return (
      <Table className="border rounded-md">
        <TableHeader>
          <TableRow>
            <TableHead className="h-9 py-2 w-[120px]">Score</TableHead>
            <TableHead className="h-9 py-2 w-[220px]">Title</TableHead>
            <TableHead className="h-9 py-2">Definition</TableHead>
            <TableHead className="h-9 py-2">Examples</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {[1, 2, 3, 4].map((score) => {
            const row = definition[`score_${score}`];
            const examples = [row?.example_1, row?.example_2].filter(Boolean).join("; ");
            return (
              <TableRow key={score}>
                <TableCell className="py-2 font-medium">{score}</TableCell>
                <TableCell className="py-2">{row?.title || "—"}</TableCell>
                <TableCell className="py-2">{row?.definition || "—"}</TableCell>
                <TableCell className="py-2">{examples || "—"}</TableCell>
              </TableRow>
            );
          })}
        </TableBody>
      </Table>
    );
  }

  const definition = criterion.eval_definition as {
    buckets?: string[];
    bucket_definitions?: Record<string, string>;
    bucket_examples?: Record<string, string[]>;
  };
  const buckets = definition.buckets || [];
  return (
    <Table className="border rounded-md">
      <TableHeader>
        <TableRow>
          <TableHead className="h-9 py-2 w-[120px]">Bucket</TableHead>
          <TableHead className="h-9 py-2 w-[220px]">Title</TableHead>
          <TableHead className="h-9 py-2">Definition</TableHead>
          <TableHead className="h-9 py-2">Examples</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {buckets.length > 0 ? (
          buckets.map((bucket) => (
            <TableRow key={bucket}>
              <TableCell className="py-2 font-medium">{bucket}</TableCell>
              <TableCell className="py-2">—</TableCell>
              <TableCell className="py-2">{definition.bucket_definitions?.[bucket] || "—"}</TableCell>
              <TableCell className="py-2">{definition.bucket_examples?.[bucket]?.filter(Boolean).join("; ") || "—"}</TableCell>
            </TableRow>
          ))
        ) : (
          <TableRow>
            <TableCell className="py-2 font-medium">—</TableCell>
            <TableCell className="py-2">—</TableCell>
            <TableCell className="py-2">No bucket definitions</TableCell>
            <TableCell className="py-2">—</TableCell>
          </TableRow>
        )}
      </TableBody>
    </Table>
  );
};

const CriteriaPage = () => {
  const [search, setSearch] = useState("");
  const [contextFilter, setContextFilter] = useState<Set<string>>(new Set());
  const [typeFilter, setTypeFilter] = useState<Set<string>>(new Set());
  const [contentTypeFilter, setContentTypeFilter] = useState<Set<string>>(new Set());
  const [categoryFilter, setCategoryFilter] = useState<Set<string>>(new Set());
  const [brandFilter, setBrandFilter] = useState<Set<string>>(new Set());
  const [industryFilter, setIndustryFilter] = useState<Set<string>>(new Set());
  const [marketplaceFilter, setMarketplaceFilter] = useState<Set<string>>(new Set());
  const [criteria, setCriteria] = useState<Criterion[]>(() => loadRuntimeCriteria());
  const [contextOptions] = useState<string[]>(() => loadManagedTaxonomy().contexts);
  const [contentTypeOptions] = useState<string[]>(() => loadManagedTaxonomy().contentTypes);
  const [criteriaCategoriesByContentType, setCriteriaCategoriesByContentType] = useState<Record<string, string[]>>(
    () => loadManagedTaxonomy().criteriaCategoriesByContentType,
  );
  const [branchTags, setBranchTags] = useState(() => loadManagedTaxonomy().branchTags);
  const [customTagCategories, setCustomTagCategories] = useState<CustomTagCategory[]>(() => loadManagedTaxonomy().customTagCategories);
  const [customTagFilters, setCustomTagFilters] = useState<Record<string, Set<string>>>({});
  const [addOpen, setAddOpen] = useState(false);
  const [uploadOpen, setUploadOpen] = useState(false);
  const [editingCriterion, setEditingCriterion] = useState<Criterion | null>(null);

  const criteriaCategoryOptions = useMemo(
    () => uniqueTags(Object.values(criteriaCategoriesByContentType).flat()),
    [criteriaCategoriesByContentType],
  );

  const customFilterCategories = useMemo(
    () => customTagCategories.filter((category) => category.tags.length > 0),
    [customTagCategories],
  );

  useEffect(() => {
    setCustomTagFilters((prev) => {
      const next: Record<string, Set<string>> = {};
      customFilterCategories.forEach((category) => {
        const existing = prev[category.name] || new Set<string>();
        const valid = new Set([...existing].filter((entry) => category.tags.includes(entry)));
        next[category.name] = valid;
      });
      return next;
    });
  }, [customFilterCategories]);

  useEffect(() => {
    saveRuntimeCriteria(criteria);
  }, [criteria]);

  useEffect(() => {
    saveManagedTaxonomy({
      contexts: contextOptions,
      contentTypes: contentTypeOptions,
      criteriaCategories: uniqueTags(criteriaCategoryOptions),
      criteriaCategoriesByContentType: Object.fromEntries(
        contentTypeOptions.map((contentType) => [
          contentType,
          uniqueTags(criteriaCategoriesByContentType[contentType] || []),
        ]),
      ),
      branchTags: {
        brands: uniqueTags(branchTags.brands),
        industries: uniqueTags(branchTags.industries),
        marketplaces: uniqueTags(branchTags.marketplaces),
      },
      customTagCategories: customTagCategories
        .map((category) => ({ name: normalizeTag(category.name), tags: uniqueTags(category.tags) }))
        .sort((a, b) => a.name.localeCompare(b.name)),
    });
  }, [contextOptions, contentTypeOptions, criteriaCategoryOptions, criteriaCategoriesByContentType, branchTags, customTagCategories]);

  const filtered = useMemo(() => {
    return criteria.filter(c => {
      const matchesSearch = c.criteria_name.toLowerCase().includes(search.toLowerCase()) ||
        c.criteria_definition.toLowerCase().includes(search.toLowerCase());
      const matchesContext = contextFilter.size === 0 || contextFilter.has(c.context);
      const matchesType = typeFilter.size === 0 || typeFilter.has(c.criteria_type);
      const matchesContentType = contentTypeFilter.size === 0 || contentTypeFilter.has(c.content_type);
      const matchesCategory = categoryFilter.size === 0 || categoryFilter.has(c.criteria_category);
      const matchesBrand = brandFilter.size === 0 || (c.brand_tag ? brandFilter.has(c.brand_tag) : false);
      const matchesIndustry = industryFilter.size === 0 || (c.industry_tag ? industryFilter.has(c.industry_tag) : false);
      const matchesMarketplace = marketplaceFilter.size === 0 || (c.marketplace_tag ? marketplaceFilter.has(c.marketplace_tag) : false);
      const matchesCustomTags = customFilterCategories.every((customCategory) => {
        const selectedTags = customTagFilters[customCategory.name] || new Set<string>();
        if (selectedTags.size === 0) return true;
        const criterionTags = c.custom_tags?.[customCategory.name] || [];
        return criterionTags.some((tag) => selectedTags.has(tag));
      });
      return (
        matchesSearch &&
        matchesContext &&
        matchesType &&
        matchesContentType &&
        matchesCategory &&
        matchesBrand &&
        matchesIndustry &&
        matchesMarketplace &&
        matchesCustomTags
      );
    });
  }, [
    criteria,
    search,
    contextFilter,
    typeFilter,
    contentTypeFilter,
    categoryFilter,
    brandFilter,
    industryFilter,
    marketplaceFilter,
    customFilterCategories,
    customTagFilters,
  ]);

  const syncTaxonomyFromCriteria = (items: Criterion[]) => {
    setCriteriaCategoriesByContentType((prev) => {
      const next: Record<string, string[]> = { ...prev };
      items.forEach((criterion) => {
        const contentType = criterion.content_type;
        const category = criterion.criteria_category;
        next[contentType] = uniqueTags([...(next[contentType] || []), category]);
      });
      return next;
    });
    setBranchTags((prev) => ({
      brands: uniqueTags([...prev.brands, ...items.map((criterion) => criterion.brand_tag || "").filter(Boolean)]),
      industries: uniqueTags([...prev.industries, ...items.map((criterion) => criterion.industry_tag || "").filter(Boolean)]),
      marketplaces: uniqueTags([...prev.marketplaces, ...items.map((criterion) => criterion.marketplace_tag || "").filter(Boolean)]),
    }));
    setCustomTagCategories((prev) => {
      const tagMap = new Map(prev.map((category) => [category.name, new Set(category.tags)]));
      items.forEach((criterion) => {
        Object.entries(criterion.custom_tags || {}).forEach(([categoryName, tags]) => {
          const next = tagMap.get(categoryName) || new Set<string>();
          tags.forEach((tag) => next.add(tag));
          tagMap.set(categoryName, next);
        });
      });
      return Array.from(tagMap.entries())
        .map(([name, tags]) => ({ name, tags: Array.from(tags).sort((a, b) => a.localeCompare(b)) }))
        .sort((a, b) => a.name.localeCompare(b.name));
    });
  };

  const handleAddBranchTag = (branchType: "brands" | "industries" | "marketplaces", tag: string) => {
    const normalizedTag = normalizeTag(tag);
    if (!normalizedTag) return;
    setBranchTags((prev) => ({
      ...prev,
      [branchType]: uniqueTags([...(prev[branchType] || []), normalizedTag]),
    }));
  };

  const toggleFilterValue = (
    value: string,
    setter: Dispatch<SetStateAction<Set<string>>>,
  ) => {
    setter((prev) => {
      const next = new Set(prev);
      if (next.has(value)) next.delete(value);
      else next.add(value);
      return next;
    });
  };

  const clearFilter = (setter: Dispatch<SetStateAction<Set<string>>>) => {
    setter(new Set());
  };

  const toggleCustomFilterValue = (categoryName: string, value: string) => {
    setCustomTagFilters((prev) => {
      const current = prev[categoryName] || new Set<string>();
      const nextSet = new Set(current);
      if (nextSet.has(value)) nextSet.delete(value);
      else nextSet.add(value);
      return { ...prev, [categoryName]: nextSet };
    });
  };

  const clearCustomFilter = (categoryName: string) => {
    setCustomTagFilters((prev) => ({ ...prev, [categoryName]: new Set<string>() }));
  };

  const handleAddCategoryForContentType = (contentType: string, category: string) => {
    const normalizedCategory = normalizeTag(category);
    if (!contentType || !normalizedCategory) return;
    setCriteriaCategoriesByContentType((prev) => ({
      ...prev,
      [contentType]: uniqueTags([...(prev[contentType] || []), normalizedCategory]),
    }));
  };

  const handleDeleteCriterion = (id: string) => {
    setCriteria(prev => prev.filter(c => c.id !== id));
  };

  const handleAddCriterion = (criterion: Criterion) => {
    setCriteria(prev => [criterion, ...prev]);
    syncTaxonomyFromCriteria([criterion]);
  };

  const handleUpdateCriterion = (criterion: Criterion) => {
    setCriteria(prev => prev.map(c => (c.id === criterion.id ? criterion : c)));
    syncTaxonomyFromCriteria([criterion]);
  };

  const handleUploadCriteria = (importedCriteria: Criterion[]) => {
    setCriteria(prev => [...importedCriteria, ...prev]);
    syncTaxonomyFromCriteria(importedCriteria);
  };

  const handleDialogOpenChange = (open: boolean) => {
    setAddOpen(open);
    if (!open) {
      setEditingCriterion(null);
    }
  };

  return (
    <div className="p-6 space-y-6 animate-fade-in">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Criteria</h1>
        </div>
        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            className="gap-2"
            onClick={() => setUploadOpen(true)}
          >
            <Upload className="h-4 w-4" /> Upload Criteria
          </Button>
          <Button
            className="gap-2"
            onClick={() => {
              setEditingCriterion(null);
              setAddOpen(true);
            }}
          >
            <Plus className="h-4 w-4" /> Create Criteria
          </Button>
        </div>
      </div>

      {/* Filters */}
      <div className="space-y-3">
        <div className="space-y-1 max-w-2xl">
          <p className="text-xs font-medium text-muted-foreground">Search</p>
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input
              placeholder="Search criteria..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="pl-9"
            />
          </div>
        </div>

        <div className="flex items-end gap-3 overflow-x-auto pb-1 whitespace-nowrap">
        <div className="space-y-1">
          <p className="text-xs font-medium text-muted-foreground">Context</p>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="outline" className="w-40 justify-between font-normal">
                {getFilterLabel(contextFilter, contextOptions, "All Contexts")}
                <ChevronDown className="h-4 w-4 opacity-60" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent className="w-56">
              <DropdownMenuCheckboxItem checked={isAllSelected(contextFilter, contextOptions)} onSelect={(e) => e.preventDefault()} onCheckedChange={() => clearFilter(setContextFilter)}>All Contexts</DropdownMenuCheckboxItem>
              <DropdownMenuSeparator />
              {contextOptions.map((option) => (
                <DropdownMenuCheckboxItem key={option} checked={contextFilter.has(option)} onSelect={(e) => e.preventDefault()} onCheckedChange={() => toggleFilterValue(option, setContextFilter)}>
                  {option}
                </DropdownMenuCheckboxItem>
              ))}
            </DropdownMenuContent>
          </DropdownMenu>
        </div>

        <div className="space-y-1">
          <p className="text-xs font-medium text-muted-foreground">Score Type</p>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="outline" className="w-40 justify-between font-normal">
                {getFilterLabel(typeFilter, CRITERIA_TYPES.map((ct) => ct.value), "All Types")}
                <ChevronDown className="h-4 w-4 opacity-60" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent className="w-56">
              <DropdownMenuCheckboxItem checked={isAllSelected(typeFilter, CRITERIA_TYPES.map((ct) => ct.value))} onSelect={(e) => e.preventDefault()} onCheckedChange={() => clearFilter(setTypeFilter)}>All Types</DropdownMenuCheckboxItem>
              <DropdownMenuSeparator />
              {CRITERIA_TYPES.map((option) => (
                <DropdownMenuCheckboxItem key={option.value} checked={typeFilter.has(option.value)} onSelect={(e) => e.preventDefault()} onCheckedChange={() => toggleFilterValue(option.value, setTypeFilter)}>
                  {option.label}
                </DropdownMenuCheckboxItem>
              ))}
            </DropdownMenuContent>
          </DropdownMenu>
        </div>

        <div className="space-y-1">
          <p className="text-xs font-medium text-muted-foreground">Content Type</p>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="outline" className="w-40 justify-between font-normal">
                {getFilterLabel(contentTypeFilter, contentTypeOptions, "All Content")}
                <ChevronDown className="h-4 w-4 opacity-60" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent className="w-56">
              <DropdownMenuCheckboxItem checked={isAllSelected(contentTypeFilter, contentTypeOptions)} onSelect={(e) => e.preventDefault()} onCheckedChange={() => clearFilter(setContentTypeFilter)}>All Content</DropdownMenuCheckboxItem>
              <DropdownMenuSeparator />
              {contentTypeOptions.map((option) => (
                <DropdownMenuCheckboxItem key={option} checked={contentTypeFilter.has(option)} onSelect={(e) => e.preventDefault()} onCheckedChange={() => toggleFilterValue(option, setContentTypeFilter)}>
                  {option}
                </DropdownMenuCheckboxItem>
              ))}
            </DropdownMenuContent>
          </DropdownMenu>
        </div>

        <div className="space-y-1">
          <p className="text-xs font-medium text-muted-foreground">Category</p>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="outline" className="w-48 justify-between font-normal">
                {getFilterLabel(categoryFilter, criteriaCategoryOptions, "All Categories")}
                <ChevronDown className="h-4 w-4 opacity-60" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent className="w-64">
              <DropdownMenuCheckboxItem checked={isAllSelected(categoryFilter, criteriaCategoryOptions)} onSelect={(e) => e.preventDefault()} onCheckedChange={() => clearFilter(setCategoryFilter)}>All Categories</DropdownMenuCheckboxItem>
              <DropdownMenuSeparator />
              {criteriaCategoryOptions.map((option) => (
                <DropdownMenuCheckboxItem key={option} checked={categoryFilter.has(option)} onSelect={(e) => e.preventDefault()} onCheckedChange={() => toggleFilterValue(option, setCategoryFilter)}>
                  {option}
                </DropdownMenuCheckboxItem>
              ))}
            </DropdownMenuContent>
          </DropdownMenu>
        </div>

        <div className="space-y-1">
          <p className="text-xs font-medium text-muted-foreground">Brand</p>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="outline" className="w-44 justify-between font-normal">
                {getFilterLabel(brandFilter, branchTags.brands, "All Brands")}
                <ChevronDown className="h-4 w-4 opacity-60" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent className="w-56">
              <DropdownMenuCheckboxItem checked={isAllSelected(brandFilter, branchTags.brands)} onSelect={(e) => e.preventDefault()} onCheckedChange={() => clearFilter(setBrandFilter)}>All Brands</DropdownMenuCheckboxItem>
              <DropdownMenuSeparator />
              {branchTags.brands.map((option) => (
                <DropdownMenuCheckboxItem key={option} checked={brandFilter.has(option)} onSelect={(e) => e.preventDefault()} onCheckedChange={() => toggleFilterValue(option, setBrandFilter)}>
                  {option}
                </DropdownMenuCheckboxItem>
              ))}
            </DropdownMenuContent>
          </DropdownMenu>
        </div>

        <div className="space-y-1">
          <p className="text-xs font-medium text-muted-foreground">Industry</p>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="outline" className="w-44 justify-between font-normal">
                {getFilterLabel(industryFilter, branchTags.industries, "All Industries")}
                <ChevronDown className="h-4 w-4 opacity-60" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent className="w-64">
              <DropdownMenuCheckboxItem checked={isAllSelected(industryFilter, branchTags.industries)} onSelect={(e) => e.preventDefault()} onCheckedChange={() => clearFilter(setIndustryFilter)}>All Industries</DropdownMenuCheckboxItem>
              <DropdownMenuSeparator />
              {branchTags.industries.map((option) => (
                <DropdownMenuCheckboxItem key={option} checked={industryFilter.has(option)} onSelect={(e) => e.preventDefault()} onCheckedChange={() => toggleFilterValue(option, setIndustryFilter)}>
                  {option}
                </DropdownMenuCheckboxItem>
              ))}
            </DropdownMenuContent>
          </DropdownMenu>
        </div>

        <div className="space-y-1">
          <p className="text-xs font-medium text-muted-foreground">Marketplace</p>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="outline" className="w-44 justify-between font-normal">
                {getFilterLabel(marketplaceFilter, branchTags.marketplaces, "All Marketplaces")}
                <ChevronDown className="h-4 w-4 opacity-60" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent className="w-56">
              <DropdownMenuCheckboxItem checked={isAllSelected(marketplaceFilter, branchTags.marketplaces)} onSelect={(e) => e.preventDefault()} onCheckedChange={() => clearFilter(setMarketplaceFilter)}>All Marketplaces</DropdownMenuCheckboxItem>
              <DropdownMenuSeparator />
              {branchTags.marketplaces.map((option) => (
                <DropdownMenuCheckboxItem key={option} checked={marketplaceFilter.has(option)} onSelect={(e) => e.preventDefault()} onCheckedChange={() => toggleFilterValue(option, setMarketplaceFilter)}>
                  {option}
                </DropdownMenuCheckboxItem>
              ))}
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
        {customFilterCategories.map((customCategory) => (
          <div key={`filter-${customCategory.name}`} className="space-y-1">
            <p className="text-xs font-medium text-muted-foreground">{customCategory.name}</p>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="outline" className="w-48 justify-between font-normal">
                  {getFilterLabel(customTagFilters[customCategory.name] || new Set<string>(), customCategory.tags, `All ${customCategory.name}`)}
                  <ChevronDown className="h-4 w-4 opacity-60" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent className="w-64">
                <DropdownMenuCheckboxItem
                  checked={isAllSelected(customTagFilters[customCategory.name] || new Set<string>(), customCategory.tags)}
                  onSelect={(e) => e.preventDefault()}
                  onCheckedChange={() => clearCustomFilter(customCategory.name)}
                >
                  All {customCategory.name}
                </DropdownMenuCheckboxItem>
                <DropdownMenuSeparator />
                {customCategory.tags.map((tag) => (
                  <DropdownMenuCheckboxItem
                    key={`${customCategory.name}-${tag}`}
                    checked={(customTagFilters[customCategory.name] || new Set<string>()).has(tag)}
                    onSelect={(e) => e.preventDefault()}
                    onCheckedChange={() => toggleCustomFilterValue(customCategory.name, tag)}
                  >
                    {tag}
                  </DropdownMenuCheckboxItem>
                ))}
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        ))}
        <span className="text-xs text-muted-foreground">
          {filtered.length} of {criteria.length} criteria
        </span>
        </div>
      </div>

      {/* Criteria list */}
      <div className="space-y-3">
        {filtered.map((c, i) => (
          <Card key={c.id} className="shadow-card hover:shadow-elevated transition-shadow" style={{ animationDelay: `${i * 40}ms` }}>
            <CardContent className="p-4">
              <div className="flex items-start gap-4">
                <div className="flex-1 min-w-0 space-y-2">
                  <div className="flex items-center gap-2 flex-wrap">
                    <h3 className="text-sm font-semibold">{c.criteria_name}</h3>
                    <span className="text-xs text-muted-foreground">Weight: <span className="font-medium text-foreground">{c.weight}</span></span>
                    <Badge variant="outline" className="text-[10px] font-normal border-blue-200 bg-blue-50 text-blue-700">{c.context}</Badge>
                    {c.context === "Brand" && c.brand_tag && (
                      <Badge variant="outline" className="text-[10px] font-normal border-slate-300 bg-slate-50 text-slate-700">
                        Brand: {c.brand_tag}
                      </Badge>
                    )}
                    {c.context === "Industry" && c.industry_tag && (
                      <Badge variant="outline" className="text-[10px] font-normal border-slate-300 bg-slate-50 text-slate-700">
                        Industry: {c.industry_tag}
                      </Badge>
                    )}
                    {c.context === "Marketplace" && c.marketplace_tag && (
                      <Badge variant="outline" className="text-[10px] font-normal border-slate-300 bg-slate-50 text-slate-700">
                        Marketplace: {c.marketplace_tag}
                      </Badge>
                    )}
                    <Badge variant="outline" className="text-[10px] font-normal border-violet-200 bg-violet-50 text-violet-700">{c.content_type}</Badge>
                    <Badge variant="outline" className="text-[10px] font-normal border-amber-200 bg-amber-50 text-amber-700">{c.criteria_category}</Badge>
                    {Object.entries(c.custom_tags || {}).map(([customCategory, tags]) => (
                      <Badge
                        key={`${c.id}-${customCategory}`}
                        variant="outline"
                        className="text-[10px] font-normal border-slate-300 bg-slate-50 text-slate-700"
                      >
                        {customCategory}: {tags.join(", ")}
                      </Badge>
                    ))}
                  </div>
                  <p className="text-sm text-muted-foreground leading-relaxed">{c.criteria_definition}</p>
                  <div>
                    <CriterionDefinitionsTable criterion={c} />
                  </div>
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-8 w-8 text-muted-foreground"
                    aria-label={`Edit ${c.criteria_name}`}
                    onClick={() => {
                      setEditingCriterion(c);
                      setAddOpen(true);
                    }}
                  >
                    <Pencil className="h-4 w-4" />
                  </Button>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-8 w-8 text-muted-foreground hover:text-destructive"
                    aria-label={`Delete ${c.criteria_name}`}
                    onClick={() => handleDeleteCriterion(c.id)}
                  >
                    <Trash2 className="h-4 w-4" />
                  </Button>
                </div>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>

      <AddCriterionDialog
        open={addOpen}
        onOpenChange={handleDialogOpenChange}
        onAdd={handleAddCriterion}
        onUpdate={handleUpdateCriterion}
        initialCriterion={editingCriterion}
        contextOptions={contextOptions}
        contentTypeOptions={contentTypeOptions}
        criteriaCategoriesByContentType={criteriaCategoriesByContentType}
        branchTags={branchTags}
        onAddBranchTag={handleAddBranchTag}
        onAddCategoryForContentType={handleAddCategoryForContentType}
      />

      <UploadCriteriaDialog
        open={uploadOpen}
        onOpenChange={setUploadOpen}
        onUpload={handleUploadCriteria}
      />
    </div>
  );
};

export default CriteriaPage;
