import { useEffect, useMemo, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { CriteriaTypeBadge } from "@/components/CriteriaTypeBadge";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { Plus, ChevronDown, ChevronRight, Pencil, Trash2 } from "lucide-react";
import { deriveCategoriesFromCriteria } from "@/config/hierarchy";
import type { EvalSuite } from "@/types";
import { loadManagedTaxonomy, loadRuntimeCriteria } from "@/data/runtime-taxonomy";
import { loadRuntimeSuites, saveRuntimeSuites } from "@/data/runtime-suites";

const SuitesPage = () => {
  const [suites, setSuites] = useState<EvalSuite[]>(() => loadRuntimeSuites());
  const runtimeCriteria = useMemo(() => loadRuntimeCriteria(), []);
  const runtimeTaxonomy = useMemo(() => loadManagedTaxonomy(runtimeCriteria), [runtimeCriteria]);
  const [newSuiteOpen, setNewSuiteOpen] = useState(false);
  const [editingSuiteId, setEditingSuiteId] = useState<string | null>(null);
  const [deletingSuiteId, setDeletingSuiteId] = useState<string | null>(null);
  const [suiteName, setSuiteName] = useState("");
  const [selectedContexts, setSelectedContexts] = useState<Set<string>>(new Set(runtimeTaxonomy.contexts));
  const [selectedContentTypes, setSelectedContentTypes] = useState<Set<string>>(new Set(runtimeTaxonomy.contentTypes));
  const [selectedBrands, setSelectedBrands] = useState<Set<string>>(new Set());
  const [selectedIndustries, setSelectedIndustries] = useState<Set<string>>(new Set());
  const [selectedMarketplaces, setSelectedMarketplaces] = useState<Set<string>>(new Set());
  const [selectedCategories, setSelectedCategories] = useState<Set<string>>(new Set());
  const [selectedCriteriaIds, setSelectedCriteriaIds] = useState<Set<string>>(new Set());
  const [expandedCategories, setExpandedCategories] = useState<Set<string>>(new Set());
  const [activeCriteriaTab, setActiveCriteriaTab] = useState("all");
  const [expandedSuiteCategoryKeys, setExpandedSuiteCategoryKeys] = useState<Set<string>>(new Set());
  const lightCheckboxClass =
    "h-5 w-5 !rounded-[4px] border-slate-300 data-[state=checked]:bg-slate-500 data-[state=checked]:border-slate-500 focus-visible:ring-slate-300";
  const contextButtonBase = "h-11 px-6";
  const contextButtonActive = "bg-[#1f3b67] border-[#1f3b67] text-white hover:bg-[#1f3b67]/95";
  const contextButtonInactive = "bg-background";

  const readConfigStringArray = (value: unknown): string[] => (
    Array.isArray(value) ? value.filter((entry): entry is string => typeof entry === "string") : []
  );

  const readConfigString = (value: unknown): string | null => (
    typeof value === "string" && value.trim() ? value : null
  );

  const readConfigNumber = (value: unknown): number | null => (
    typeof value === "number" && Number.isFinite(value) ? value : null
  );

  const DEFAULT_METRIC_TYPE = "GEval";
  const DEFAULT_THRESHOLD = 0.78;
  const DEFAULT_MODEL = "gpt-4o";

  const filteredCriteria = useMemo(
    () =>
      runtimeCriteria.filter(
        c =>
          selectedContexts.has(c.context) &&
          selectedContentTypes.has(c.content_type) &&
          (c.context !== "Brand" || selectedBrands.size === 0 || (c.brand_tag ? selectedBrands.has(c.brand_tag) : false)) &&
          (c.context !== "Industry" || selectedIndustries.size === 0 || (c.industry_tag ? selectedIndustries.has(c.industry_tag) : false)) &&
          (c.context !== "Marketplace" || selectedMarketplaces.size === 0 || (c.marketplace_tag ? selectedMarketplaces.has(c.marketplace_tag) : false)),
      ),
    [runtimeCriteria, selectedContexts, selectedContentTypes, selectedBrands, selectedIndustries, selectedMarketplaces],
  );

  const availableCategories = useMemo(() => deriveCategoriesFromCriteria(filteredCriteria), [filteredCriteria]);

  const criteriaByCategory = useMemo(
    () =>
      availableCategories.reduce<Record<string, typeof filteredCriteria>>((acc, category) => {
        acc[category] = filteredCriteria.filter(c => c.criteria_category === category);
        return acc;
      }, {}),
    [availableCategories, filteredCriteria],
  );

  const criteriaTabOptions = useMemo(
    () => ["all", ...runtimeTaxonomy.contexts.filter((context) => selectedContexts.has(context))],
    [runtimeTaxonomy.contexts, selectedContexts],
  );

  useEffect(() => {
    if (!criteriaTabOptions.includes(activeCriteriaTab)) {
      setActiveCriteriaTab("all");
    }
  }, [criteriaTabOptions, activeCriteriaTab]);

  const criteriaInActiveTab = useMemo(
    () =>
      activeCriteriaTab === "all"
        ? filteredCriteria
        : filteredCriteria.filter((criterion) => criterion.context === activeCriteriaTab),
    [filteredCriteria, activeCriteriaTab],
  );

  const displayedCategories = useMemo(
    () => deriveCategoriesFromCriteria(criteriaInActiveTab),
    [criteriaInActiveTab],
  );

  const displayedCriteriaByCategory = useMemo(
    () =>
      displayedCategories.reduce<Record<string, typeof criteriaInActiveTab>>((acc, category) => {
        acc[category] = criteriaInActiveTab.filter(c => c.criteria_category === category);
        return acc;
      }, {}),
    [displayedCategories, criteriaInActiveTab],
  );

  useEffect(() => {
    if (!newSuiteOpen) return;
    if (editingSuiteId) return;

    const allCategorySet = new Set(availableCategories);
    const allCriteriaSet = new Set(filteredCriteria.map(c => c.id));
    setSelectedCategories(allCategorySet);
    setSelectedCriteriaIds(allCriteriaSet);
    setExpandedCategories(new Set());
  }, [newSuiteOpen, availableCategories, filteredCriteria, editingSuiteId]);

  useEffect(() => {
    if (!newSuiteOpen) return;

    if (!editingSuiteId) {
      setSelectedCategories(new Set(availableCategories));
      setSelectedCriteriaIds(new Set(filteredCriteria.map(c => c.id)));
      return;
    }

    const nextCategories = new Set(
      [...selectedCategories].filter(category => availableCategories.includes(category)),
    );
    const allowedCriteriaIds = new Set(
      filteredCriteria
        .filter(c => nextCategories.has(c.criteria_category))
        .map(c => c.id),
    );
    const nextCriteriaIds = new Set(
      [...selectedCriteriaIds].filter(id => allowedCriteriaIds.has(id)),
    );

    setSelectedCategories(nextCategories);
    setSelectedCriteriaIds(nextCriteriaIds);
  }, [availableCategories, filteredCriteria]);

  useEffect(() => {
    saveRuntimeSuites(suites);
  }, [suites]);

  useEffect(() => {
    if (!selectedContexts.has("Brand") && selectedBrands.size > 0) setSelectedBrands(new Set());
    if (!selectedContexts.has("Industry") && selectedIndustries.size > 0) setSelectedIndustries(new Set());
    if (!selectedContexts.has("Marketplace") && selectedMarketplaces.size > 0) setSelectedMarketplaces(new Set());
  }, [selectedContexts, selectedBrands.size, selectedIndustries.size, selectedMarketplaces.size]);

  const toggleSetValue = (
    value: string,
    setter: (updater: (prev: Set<string>) => Set<string>) => void,
  ) => {
    setter(prev => {
      const next = new Set(prev);
      if (next.has(value)) {
        next.delete(value);
      } else {
        next.add(value);
      }
      return next;
    });
  };

  const setToAll = (
    options: string[],
    setter: (updater: (prev: Set<string>) => Set<string>) => void,
  ) => {
    setter(() => new Set(options));
  };

  const clearSet = (
    setter: (updater: (prev: Set<string>) => Set<string>) => void,
  ) => {
    setter(() => new Set());
  };

  const getMultiSelectLabel = (
    selected: Set<string>,
    options: string[],
    allLabel: string,
    emptyMeansAll: boolean,
  ) => {
    if (selected.size === 0) return emptyMeansAll ? allLabel : "None selected";
    if (selected.size === options.length) return allLabel;
    if (selected.size === 1) return [...selected][0];
    return `${selected.size} selected`;
  };

  const toggleCategory = (category: string) => {
    const categoryCriteriaIds = displayedCriteriaByCategory[category]?.map(c => c.id) || [];
    const anySelected = categoryCriteriaIds.some((id) => selectedCriteriaIds.has(id));

    setSelectedCriteriaIds(prev => {
      const next = new Set(prev);
      if (anySelected) categoryCriteriaIds.forEach(id => next.delete(id));
      else categoryCriteriaIds.forEach(id => next.add(id));

      const nextCategories = new Set<string>();
      availableCategories.forEach((categoryName) => {
        const hasAnySelected = (criteriaByCategory[categoryName] || []).some((criterion) => next.has(criterion.id));
        if (hasAnySelected) nextCategories.add(categoryName);
      });
      setSelectedCategories(nextCategories);
      return next;
    });
  };

  const toggleCriterion = (category: string, criterionId: string) => {
    setSelectedCriteriaIds(prev => {
      const next = new Set(prev);
      if (next.has(criterionId)) next.delete(criterionId); else next.add(criterionId);
      const nextCategories = new Set<string>();
      availableCategories.forEach((categoryName) => {
        const hasAnySelected = (criteriaByCategory[categoryName] || []).some((criterion) => next.has(criterion.id));
        if (hasAnySelected) nextCategories.add(categoryName);
      });
      setSelectedCategories(nextCategories);

      return next;
    });
  };

  const createSuite = () => {
    const trimmedName = suiteName.trim();
    if (!trimmedName || selectedCriteriaIds.size === 0) return;
    const now = new Date().toISOString();

    if (editingSuiteId) {
      setSuites(prev =>
        prev.map(suite =>
          suite.id === editingSuiteId
            ? {
                ...suite,
                name: trimmedName,
                criteria_ids: [...selectedCriteriaIds],
                config: {
                  ...suite.config,
                  metric_type: readConfigString(suite.config.metric_type) || DEFAULT_METRIC_TYPE,
                  threshold: readConfigNumber(suite.config.threshold) ?? DEFAULT_THRESHOLD,
                  model: readConfigString(suite.config.model) || DEFAULT_MODEL,
                  contexts: [...selectedContexts],
                  content_types: [...selectedContentTypes],
                  brand_tags: selectedContexts.has("Brand") ? [...selectedBrands] : [],
                  industry_tags: selectedContexts.has("Industry") ? [...selectedIndustries] : [],
                  marketplace_tags: selectedContexts.has("Marketplace") ? [...selectedMarketplaces] : [],
                  categories: [...selectedCategories],
                },
                updated_at: now,
              }
            : suite,
        ),
      );
      setSuiteName("");
      setEditingSuiteId(null);
      setNewSuiteOpen(false);
      return;
    }

    const baseId = trimmedName.toLowerCase().replace(/\s+/g, "-").replace(/[^a-z0-9-]/g, "");
    const existingIds = new Set(suites.map(s => s.id));
    let nextId = `suite-${baseId}`;
    let idx = 2;
    while (existingIds.has(nextId)) {
      nextId = `suite-${baseId}-${idx}`;
      idx += 1;
    }

    const newSuite: EvalSuite = {
      id: nextId,
      name: trimmedName,
      comment: "User-created suite",
      criteria_ids: [...selectedCriteriaIds],
      config: {
        metric_type: DEFAULT_METRIC_TYPE,
        threshold: DEFAULT_THRESHOLD,
        model: DEFAULT_MODEL,
        contexts: [...selectedContexts],
        content_types: [...selectedContentTypes],
        brand_tags: selectedContexts.has("Brand") ? [...selectedBrands] : [],
        industry_tags: selectedContexts.has("Industry") ? [...selectedIndustries] : [],
        marketplace_tags: selectedContexts.has("Marketplace") ? [...selectedMarketplaces] : [],
        categories: [...selectedCategories],
      },
      created_at: now,
      updated_at: now,
    };

    setSuites(prev => [newSuite, ...prev]);
    setSuiteName("");
    setNewSuiteOpen(false);
  };

  const openEditSuite = (suite: EvalSuite) => {
    const suiteCriteria = runtimeCriteria.filter(c => suite.criteria_ids.includes(c.id));
    const configuredContexts = readConfigStringArray(suite.config.contexts);
    const configuredContentTypes = readConfigStringArray(suite.config.content_types);
    const configuredBrandTags = readConfigStringArray(suite.config.brand_tags);
    const configuredIndustryTags = readConfigStringArray(suite.config.industry_tags);
    const configuredMarketplaceTags = readConfigStringArray(suite.config.marketplace_tags);
    const configuredCategories = readConfigStringArray(suite.config.categories);

    setEditingSuiteId(suite.id);
    setSuiteName(suite.name);
    setSelectedContexts(new Set(configuredContexts.length ? configuredContexts : runtimeTaxonomy.contexts));
    setSelectedContentTypes(new Set(configuredContentTypes.length ? configuredContentTypes : runtimeTaxonomy.contentTypes));
    setSelectedBrands(new Set(configuredBrandTags));
    setSelectedIndustries(new Set(configuredIndustryTags));
    setSelectedMarketplaces(new Set(configuredMarketplaceTags));
    setSelectedCategories(new Set(configuredCategories.length ? configuredCategories : deriveCategoriesFromCriteria(suiteCriteria)));
                    setSelectedCriteriaIds(new Set(suite.criteria_ids));
    setExpandedCategories(new Set());
    setActiveCriteriaTab("all");
    setNewSuiteOpen(true);
  };

  const handleDeleteSuite = () => {
    if (!deletingSuiteId) return;
    setSuites(prev => prev.filter(suite => suite.id !== deletingSuiteId));
    setDeletingSuiteId(null);
  };

  const handleSuiteDialogOpenChange = (open: boolean) => {
    setNewSuiteOpen(open);
    if (!open) {
      setEditingSuiteId(null);
    }
  };

  const toggleSuiteCategory = (suiteId: string, category: string) => {
    const key = `${suiteId}::${category}`;
    setExpandedSuiteCategoryKeys(prev => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key); else next.add(key);
      return next;
    });
  };

  const areAllDisplayedCategoriesExpanded =
    displayedCategories.length > 0 && displayedCategories.every((category) => expandedCategories.has(category));

  const toggleAllDisplayedCategories = () => {
    setExpandedCategories((prev) => {
      const next = new Set(prev);
      if (areAllDisplayedCategoriesExpanded) {
        displayedCategories.forEach((category) => next.delete(category));
      } else {
        displayedCategories.forEach((category) => next.add(category));
      }
      return next;
    });
  };

  return (
    <div className="p-6 space-y-6 animate-fade-in">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Evaluation Suites</h1>
          <p className="text-sm text-muted-foreground mt-1">Configure grouped criteria sets for evaluation runs</p>
        </div>
        <Button
          className="gap-2"
          onClick={() => {
            setEditingSuiteId(null);
            setSuiteName("");
            setSelectedContexts(new Set(runtimeTaxonomy.contexts));
            setSelectedContentTypes(new Set(runtimeTaxonomy.contentTypes));
            setSelectedBrands(new Set());
            setSelectedIndustries(new Set());
            setSelectedMarketplaces(new Set());
            setActiveCriteriaTab("all");
            setNewSuiteOpen(true);
          }}
        >
          <Plus className="h-4 w-4" /> New Suite
        </Button>
      </div>

      <Dialog open={newSuiteOpen} onOpenChange={handleSuiteDialogOpenChange}>
        <DialogContent className="max-w-2xl h-[85vh] overflow-y-scroll overflow-x-hidden [scrollbar-gutter:stable]">
          <DialogHeader>
            <DialogTitle>{editingSuiteId ? "Edit Suite" : "Create New Suite"}</DialogTitle>
          </DialogHeader>

          <div className="space-y-4">
            <div className="space-y-1.5">
              <label className="text-xs font-medium text-muted-foreground">Suite Name</label>
              <Input
                placeholder="e.g. Marketplace Description Focus"
                value={suiteName}
                onChange={e => setSuiteName(e.target.value)}
              />
            </div>

            <div className="space-y-4">
              <h3 className="text-sm font-semibold">Evaluation Criteria</h3>
              <div className="space-y-2">
                <label className="block text-xs font-medium text-muted-foreground">Context</label>
                <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
                  {runtimeTaxonomy.contexts.map(context => (
                    <Button
                      key={context}
                      type="button"
                      variant={selectedContexts.has(context) ? "default" : "outline"}
                      className={`${contextButtonBase} ${selectedContexts.has(context) ? contextButtonActive : contextButtonInactive}`}
                      onClick={() => toggleSetValue(context, setSelectedContexts)}
                    >
                      {context}
                    </Button>
                  ))}
                </div>
              </div>

              {selectedContexts.has("Industry") && (
                <div className="space-y-2">
                  <label className="block text-xs font-medium text-muted-foreground">Industries</label>
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <Button variant="outline" className="w-full justify-between font-normal">
                        {getMultiSelectLabel(selectedIndustries, runtimeTaxonomy.branchTags.industries, "All Industries", true)}
                        <ChevronDown className="h-4 w-4 opacity-60" />
                      </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent className="w-[var(--radix-dropdown-menu-trigger-width)]">
                      <DropdownMenuCheckboxItem
                        checked={selectedIndustries.size === 0 || selectedIndustries.size === runtimeTaxonomy.branchTags.industries.length}
                        onSelect={(e) => e.preventDefault()}
                        onCheckedChange={() => clearSet(setSelectedIndustries)}
                      >
                        All Industries
                      </DropdownMenuCheckboxItem>
                      <DropdownMenuSeparator />
                      {runtimeTaxonomy.branchTags.industries.map((industry) => (
                        <DropdownMenuCheckboxItem
                          key={industry}
                          checked={selectedIndustries.has(industry)}
                          onSelect={(e) => e.preventDefault()}
                          onCheckedChange={() => toggleSetValue(industry, setSelectedIndustries)}
                        >
                          {industry}
                        </DropdownMenuCheckboxItem>
                      ))}
                    </DropdownMenuContent>
                  </DropdownMenu>
                </div>
              )}

              {selectedContexts.has("Marketplace") && (
                <div className="space-y-2">
                  <label className="block text-xs font-medium text-muted-foreground">Marketplaces</label>
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <Button variant="outline" className="w-full justify-between font-normal">
                        {getMultiSelectLabel(selectedMarketplaces, runtimeTaxonomy.branchTags.marketplaces, "All Marketplaces", true)}
                        <ChevronDown className="h-4 w-4 opacity-60" />
                      </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent className="w-[var(--radix-dropdown-menu-trigger-width)]">
                      <DropdownMenuCheckboxItem
                        checked={selectedMarketplaces.size === 0 || selectedMarketplaces.size === runtimeTaxonomy.branchTags.marketplaces.length}
                        onSelect={(e) => e.preventDefault()}
                        onCheckedChange={() => clearSet(setSelectedMarketplaces)}
                      >
                        All Marketplaces
                      </DropdownMenuCheckboxItem>
                      <DropdownMenuSeparator />
                      {runtimeTaxonomy.branchTags.marketplaces.map((marketplace) => (
                        <DropdownMenuCheckboxItem
                          key={marketplace}
                          checked={selectedMarketplaces.has(marketplace)}
                          onSelect={(e) => e.preventDefault()}
                          onCheckedChange={() => toggleSetValue(marketplace, setSelectedMarketplaces)}
                        >
                          {marketplace}
                        </DropdownMenuCheckboxItem>
                      ))}
                    </DropdownMenuContent>
                  </DropdownMenu>
                </div>
              )}

              {selectedContexts.has("Brand") && (
                <div className="space-y-2">
                  <label className="block text-xs font-medium text-muted-foreground">Brands</label>
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <Button variant="outline" className="w-full justify-between font-normal">
                        {getMultiSelectLabel(selectedBrands, runtimeTaxonomy.branchTags.brands, "All Brands", true)}
                        <ChevronDown className="h-4 w-4 opacity-60" />
                      </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent className="w-[var(--radix-dropdown-menu-trigger-width)]">
                      <DropdownMenuCheckboxItem
                        checked={selectedBrands.size === 0 || selectedBrands.size === runtimeTaxonomy.branchTags.brands.length}
                        onSelect={(e) => e.preventDefault()}
                        onCheckedChange={() => clearSet(setSelectedBrands)}
                      >
                        All Brands
                      </DropdownMenuCheckboxItem>
                      <DropdownMenuSeparator />
                      {runtimeTaxonomy.branchTags.brands.map((brand) => (
                        <DropdownMenuCheckboxItem
                          key={brand}
                          checked={selectedBrands.has(brand)}
                          onSelect={(e) => e.preventDefault()}
                          onCheckedChange={() => toggleSetValue(brand, setSelectedBrands)}
                        >
                          {brand}
                        </DropdownMenuCheckboxItem>
                      ))}
                    </DropdownMenuContent>
                  </DropdownMenu>
                </div>
              )}

              <div className="space-y-2">
                <label className="block text-xs font-medium text-muted-foreground">Content Type</label>
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button variant="outline" className="w-full justify-between font-normal">
                      {getMultiSelectLabel(selectedContentTypes, runtimeTaxonomy.contentTypes, "All Content Types", false)}
                      <ChevronDown className="h-4 w-4 opacity-60" />
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent className="w-[var(--radix-dropdown-menu-trigger-width)]">
                    <DropdownMenuCheckboxItem
                      checked={selectedContentTypes.size === runtimeTaxonomy.contentTypes.length}
                      onSelect={(e) => e.preventDefault()}
                      onCheckedChange={() => setToAll(runtimeTaxonomy.contentTypes, setSelectedContentTypes)}
                    >
                      All Content Types
                    </DropdownMenuCheckboxItem>
                    <DropdownMenuSeparator />
                    {runtimeTaxonomy.contentTypes.map((contentType) => (
                      <DropdownMenuCheckboxItem
                        key={contentType}
                        checked={selectedContentTypes.has(contentType)}
                        onSelect={(e) => e.preventDefault()}
                        onCheckedChange={() => toggleSetValue(contentType, setSelectedContentTypes)}
                      >
                        {contentType}
                      </DropdownMenuCheckboxItem>
                    ))}
                  </DropdownMenuContent>
                </DropdownMenu>
              </div>
            </div>

            <div className="space-y-2">
              <label className="text-xs font-medium text-muted-foreground">Criteria Categories</label>
              <div className="space-y-2 border rounded-lg p-3">
                <div className="mb-2 flex items-center justify-between gap-2">
                  <Tabs value={activeCriteriaTab} onValueChange={setActiveCriteriaTab}>
                    <TabsList className="h-auto flex-wrap justify-start">
                      {criteriaTabOptions.map((tab) => (
                        <TabsTrigger key={tab} value={tab} className="capitalize">
                          {tab}
                        </TabsTrigger>
                      ))}
                    </TabsList>
                  </Tabs>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    className="shrink-0"
                    onClick={toggleAllDisplayedCategories}
                  >
                    {areAllDisplayedCategoriesExpanded ? "Hide criteria" : "Show criteria"}
                  </Button>
                </div>
                {displayedCategories.map(category => {
                    const criteria = displayedCriteriaByCategory[category] || [];
                    const isExpanded = expandedCategories.has(category);
                    const selectedCount = criteria.filter(c => selectedCriteriaIds.has(c.id)).length;
                    const anyInCategorySelected = selectedCount > 0;
                    return (
                      <Collapsible key={category} open={isExpanded}>
                        <div className="flex items-center justify-between py-1.5">
                          <label className="flex items-center gap-2 text-sm cursor-pointer">
                            <Checkbox
                              className={lightCheckboxClass}
                              checked={anyInCategorySelected}
                              onCheckedChange={() => toggleCategory(category)}
                            />
                            <span>{category}</span>
                            <Badge variant="outline" className="text-[10px]">{selectedCount}/{criteria.length}</Badge>
                          </label>
                          <CollapsibleTrigger asChild>
                            <Button
                              variant="ghost"
                              size="icon"
                              className="h-7 w-7"
                              onClick={() => toggleSetValue(category, setExpandedCategories)}
                            >
                              {isExpanded ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
                            </Button>
                          </CollapsibleTrigger>
                        </div>

                        <CollapsibleContent className="space-y-1 pl-6 pb-2">
                          {criteria.map(criterion => (
                            <label key={criterion.id} className="flex items-center gap-2 text-sm cursor-pointer">
                              <Checkbox
                                className={lightCheckboxClass}
                                checked={selectedCriteriaIds.has(criterion.id)}
                                onCheckedChange={() => toggleCriterion(category, criterion.id)}
                              />
                              <span className={!criterion.active ? "text-muted-foreground" : ""}>
                                {criterion.criteria_name}
                              </span>
                              <CriteriaTypeBadge type={criterion.criteria_type} />
                            </label>
                          ))}
                        </CollapsibleContent>
                      </Collapsible>
                    );
                  })}
              </div>
            </div>
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setNewSuiteOpen(false)}>Cancel</Button>
            <Button
              onClick={createSuite}
              disabled={
              !suiteName.trim() ||
                selectedContexts.size === 0 ||
                selectedContentTypes.size === 0 ||
                selectedCategories.size === 0 ||
                selectedCriteriaIds.size === 0
              }
            >
              {editingSuiteId ? "Save Changes" : "Create Suite"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <AlertDialog open={!!deletingSuiteId} onOpenChange={(open) => !open && setDeletingSuiteId(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete Suite?</AlertDialogTitle>
            <AlertDialogDescription>
              This will permanently remove this suite from the list.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={handleDeleteSuite}>Delete</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {suites.map(suite => {
          const suiteCriteria = runtimeCriteria.filter(c => suite.criteria_ids.includes(c.id));
          const configuredContexts = readConfigStringArray(suite.config.contexts);
          const configuredContentTypes = readConfigStringArray(suite.config.content_types);
          const configuredBrandTags = readConfigStringArray(suite.config.brand_tags);
          const configuredIndustryTags = readConfigStringArray(suite.config.industry_tags);
          const configuredMarketplaceTags = readConfigStringArray(suite.config.marketplace_tags);
          const configuredCategories = readConfigStringArray(suite.config.categories);
          const suiteContexts = configuredContexts.length
            ? configuredContexts
            : [...new Set(suiteCriteria.map(c => c.context))];
          const suiteContentTypes = configuredContentTypes.length
            ? configuredContentTypes
            : [...new Set(suiteCriteria.map(c => c.content_type))];
          const suiteCategories = configuredCategories.length
            ? configuredCategories
            : deriveCategoriesFromCriteria(suiteCriteria);
          const suiteCriteriaByCategory = suiteCategories.reduce<Record<string, typeof suiteCriteria>>((acc, category) => {
            acc[category] = suiteCriteria.filter(c => c.criteria_category === category);
            return acc;
          }, {});
          const metricTypeValue = readConfigString(suite.config.metric_type) || "GEval";
          const metricThresholdValue = readConfigNumber(suite.config.threshold) ?? 0.78;
          const modelValue = readConfigString(suite.config.model) || "gpt-4o";

          return (
            <Card key={suite.id} className="shadow-card hover:shadow-elevated transition-shadow">
              <CardHeader className="pb-3">
                <div className="flex items-start justify-between">
                  <div className="flex items-center gap-2">
                    <div>
                      <CardTitle className="text-base">{suite.name}</CardTitle>
                      <div className="mt-2 flex flex-wrap gap-1.5">
                        {suiteContexts.map(context => (
                          <Badge
                            key={`${suite.id}-context-${context}`}
                            variant="outline"
                            className="text-[10px] font-normal border-blue-200 bg-blue-50 text-blue-700"
                          >
                            {context}
                          </Badge>
                        ))}
                        {suiteContentTypes.map(contentType => (
                          <Badge
                            key={`${suite.id}-content-${contentType}`}
                            variant="outline"
                            className="text-[10px] font-normal border-violet-200 bg-violet-50 text-violet-700"
                          >
                            {contentType}
                          </Badge>
                        ))}
                        {configuredBrandTags.map((tag) => (
                          <Badge
                            key={`${suite.id}-brand-${tag}`}
                            variant="outline"
                            className="text-[10px] font-normal border-slate-300 bg-slate-50 text-slate-700"
                          >
                            Brand: {tag}
                          </Badge>
                        ))}
                        {configuredIndustryTags.map((tag) => (
                          <Badge
                            key={`${suite.id}-industry-${tag}`}
                            variant="outline"
                            className="text-[10px] font-normal border-slate-300 bg-slate-50 text-slate-700"
                          >
                            Industry: {tag}
                          </Badge>
                        ))}
                        {configuredMarketplaceTags.map((tag) => (
                          <Badge
                            key={`${suite.id}-marketplace-${tag}`}
                            variant="outline"
                            className="text-[10px] font-normal border-slate-300 bg-slate-50 text-slate-700"
                          >
                            Marketplace: {tag}
                          </Badge>
                        ))}
                      </div>
                    </div>
                  </div>
                  <div className="flex items-center gap-1.5">
                    <Badge variant="outline" className="text-xs whitespace-nowrap shrink-0">
                      {suiteCriteria.length} criteria
                    </Badge>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-8 w-8 text-muted-foreground"
                      aria-label={`Edit ${suite.name}`}
                      onClick={() => openEditSuite(suite)}
                    >
                      <Pencil className="h-4 w-4" />
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-8 w-8 text-muted-foreground hover:text-destructive"
                      aria-label={`Delete ${suite.name}`}
                      onClick={() => setDeletingSuiteId(suite.id)}
                    >
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </div>
                </div>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="flex flex-wrap gap-1.5">
                  <Badge variant="outline" className="text-[10px] font-normal">Type: {metricTypeValue}</Badge>
                  <Badge variant="outline" className="text-[10px] font-normal">Threshold: {metricThresholdValue.toFixed(2)}</Badge>
                  <Badge variant="outline" className="text-[10px] font-normal">Model: {modelValue}</Badge>
                </div>

                <div className="space-y-2 border rounded-lg p-3">
                  <div className="flex items-center gap-2">
                    <p className="text-xs font-medium text-muted-foreground">Criteria Categories</p>
                    <Badge variant="outline" className="text-[10px]">{suiteCategories.length}</Badge>
                  </div>
                  <div className="h-40 overflow-y-auto pr-1 space-y-2">
                    {suiteCategories.length === 0 ? (
                      <p className="text-xs text-muted-foreground">No categories configured.</p>
                    ) : (
                      suiteCategories.map(category => {
                        const criteriaInCategory = suiteCriteriaByCategory[category] || [];
                        const categoryKey = `${suite.id}::${category}`;
                        const isExpanded = expandedSuiteCategoryKeys.has(categoryKey);
                        return (
                          <Collapsible key={categoryKey} open={isExpanded}>
                            <div className="flex items-center justify-between py-1.5">
                              <div className="flex items-center gap-2">
                                <span className="text-sm">{category}</span>
                                <Badge variant="outline" className="text-[10px]">
                                  {criteriaInCategory.length}/{criteriaInCategory.length}
                                </Badge>
                              </div>
                              <CollapsibleTrigger asChild>
                                <Button
                                  variant="ghost"
                                  size="icon"
                                  className="h-7 w-7"
                                  onClick={() => toggleSuiteCategory(suite.id, category)}
                                >
                                  {isExpanded ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
                                </Button>
                              </CollapsibleTrigger>
                            </div>
                            <CollapsibleContent className="space-y-1 pl-4 pb-2">
                              {criteriaInCategory.length === 0 ? (
                                <p className="text-xs text-muted-foreground">No criteria in this category.</p>
                              ) : (
                                criteriaInCategory.map(criterion => (
                                  <div key={criterion.id} className="flex items-center gap-2 text-sm">
                                    <span className="text-muted-foreground">•</span>
                                    <span className={!criterion.active ? "text-muted-foreground" : ""}>
                                      {criterion.criteria_name}
                                    </span>
                                    <CriteriaTypeBadge type={criterion.criteria_type} />
                                    {!criterion.active && <Badge variant="outline" className="text-[10px]">inactive</Badge>}
                                  </div>
                                ))
                              )}
                            </CollapsibleContent>
                          </Collapsible>
                        );
                      })
                    )}
                  </div>
                </div>
              </CardContent>
            </Card>
          );
        })}
      </div>
    </div>
  );
};

export default SuitesPage;
