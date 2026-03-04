import { useEffect, useMemo, useState } from "react";
import { MOCK_SUITES, MOCK_CRITERIA } from "@/data/mock-data";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { CriteriaTypeBadge } from "@/components/CriteriaTypeBadge";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
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
import { CONTEXTS, CONTENT_TYPES, deriveCategoriesFromCriteria } from "@/config/hierarchy";
import type { EvalSuite } from "@/types";

const SuitesPage = () => {
  const [suites, setSuites] = useState<EvalSuite[]>(MOCK_SUITES);
  const [newSuiteOpen, setNewSuiteOpen] = useState(false);
  const [editingSuiteId, setEditingSuiteId] = useState<string | null>(null);
  const [deletingSuiteId, setDeletingSuiteId] = useState<string | null>(null);
  const [suiteName, setSuiteName] = useState("");
  const [selectedContexts, setSelectedContexts] = useState<Set<string>>(new Set(CONTEXTS));
  const [selectedContentTypes, setSelectedContentTypes] = useState<Set<string>>(new Set(CONTENT_TYPES));
  const [selectedCategories, setSelectedCategories] = useState<Set<string>>(new Set());
  const [selectedCriteriaIds, setSelectedCriteriaIds] = useState<Set<string>>(new Set());
  const [expandedCategories, setExpandedCategories] = useState<Set<string>>(new Set());
  const [metricType, setMetricType] = useState("GEval");
  const [threshold, setThreshold] = useState("0.78");
  const [model, setModel] = useState("gpt-4o");
  const [expandedSuiteCategoryKeys, setExpandedSuiteCategoryKeys] = useState<Set<string>>(new Set());
  const lightCheckboxClass =
    "rounded-full border-slate-300 data-[state=checked]:bg-slate-500 data-[state=checked]:border-slate-500 focus-visible:ring-slate-300";

  const readConfigStringArray = (value: unknown): string[] => (
    Array.isArray(value) ? value.filter((entry): entry is string => typeof entry === "string") : []
  );

  const readConfigString = (value: unknown): string | null => (
    typeof value === "string" && value.trim() ? value : null
  );

  const readConfigNumber = (value: unknown): number | null => (
    typeof value === "number" && Number.isFinite(value) ? value : null
  );

  const filteredCriteria = useMemo(
    () =>
      MOCK_CRITERIA.filter(
        c =>
          selectedContexts.has(c.context) &&
          selectedContentTypes.has(c.content_type),
      ),
    [selectedContexts, selectedContentTypes],
  );

  const availableCategories = useMemo(
    () => deriveCategoriesFromCriteria(filteredCriteria),
    [filteredCriteria],
  );

  const criteriaByCategory = useMemo(
    () =>
      availableCategories.reduce<Record<string, typeof filteredCriteria>>((acc, category) => {
        acc[category] = filteredCriteria.filter(c => c.criteria_category === category);
        return acc;
      }, {}),
    [availableCategories, filteredCriteria],
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

  const toggleCategory = (category: string) => {
    const categoryCriteriaIds = criteriaByCategory[category]?.map(c => c.id) || [];
    const isSelected = selectedCategories.has(category);

    setSelectedCategories(prev => {
      const next = new Set(prev);
      if (isSelected) next.delete(category); else next.add(category);
      return next;
    });

    setSelectedCriteriaIds(prev => {
      const next = new Set(prev);
      if (isSelected) {
        categoryCriteriaIds.forEach(id => next.delete(id));
      } else {
        categoryCriteriaIds.forEach(id => next.add(id));
      }
      return next;
    });
  };

  const toggleCriterion = (category: string, criterionId: string) => {
    const categoryCriteriaIds = criteriaByCategory[category]?.map(c => c.id) || [];

    setSelectedCriteriaIds(prev => {
      const next = new Set(prev);
      if (next.has(criterionId)) next.delete(criterionId); else next.add(criterionId);

      const selectedInCategory = categoryCriteriaIds.some(id => next.has(id));
      setSelectedCategories(prevCategories => {
        const nextCategories = new Set(prevCategories);
        if (selectedInCategory) nextCategories.add(category); else nextCategories.delete(category);
        return nextCategories;
      });

      return next;
    });
  };

  const createSuite = () => {
    const trimmedName = suiteName.trim();
    const parsedThreshold = Number(threshold);
    if (!trimmedName || selectedCriteriaIds.size === 0 || !metricType || !model || Number.isNaN(parsedThreshold)) return;

    const clampedThreshold = Math.max(0, Math.min(1, parsedThreshold));
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
                  metric_type: metricType,
                  threshold: clampedThreshold,
                  model,
                  contexts: [...selectedContexts],
                  content_types: [...selectedContentTypes],
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
        metric_type: metricType,
        threshold: clampedThreshold,
        model,
        contexts: [...selectedContexts],
        content_types: [...selectedContentTypes],
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
    const suiteCriteria = MOCK_CRITERIA.filter(c => suite.criteria_ids.includes(c.id));
    const configuredContexts = readConfigStringArray(suite.config.contexts);
    const configuredContentTypes = readConfigStringArray(suite.config.content_types);
    const configuredCategories = readConfigStringArray(suite.config.categories);

    setEditingSuiteId(suite.id);
    setSuiteName(suite.name);
    setMetricType(readConfigString(suite.config.metric_type) || "GEval");
    setThreshold((readConfigNumber(suite.config.threshold) ?? 0.78).toString());
    setModel(readConfigString(suite.config.model) || "gpt-4o");
    setSelectedContexts(new Set(configuredContexts.length ? configuredContexts : suiteCriteria.map(c => c.context)));
    setSelectedContentTypes(new Set(configuredContentTypes.length ? configuredContentTypes : suiteCriteria.map(c => c.content_type)));
    setSelectedCategories(new Set(configuredCategories.length ? configuredCategories : deriveCategoriesFromCriteria(suiteCriteria)));
    setSelectedCriteriaIds(new Set(suite.criteria_ids));
    setExpandedCategories(new Set());
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
            setMetricType("GEval");
            setThreshold("0.78");
            setModel("gpt-4o");
            setNewSuiteOpen(true);
          }}
        >
          <Plus className="h-4 w-4" /> New Suite
        </Button>
      </div>

      <Dialog open={newSuiteOpen} onOpenChange={handleSuiteDialogOpenChange}>
        <DialogContent className="max-w-3xl max-h-[85vh] overflow-y-auto">
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

            <div className="space-y-2">
              <h3 className="text-sm font-semibold">Metric Configuration</h3>
              <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                <div className="space-y-1.5">
                  <label className="text-xs font-medium text-muted-foreground">Metric type</label>
                  <Input
                    list="metric-types"
                    value={metricType}
                    onChange={e => setMetricType(e.target.value)}
                    placeholder="e.g. GEval"
                  />
                  <datalist id="metric-types">
                    <option value="GEval" />
                    <option value="Rubric" />
                    <option value="Binary Pass/Fail" />
                  </datalist>
                </div>
                <div className="space-y-1.5">
                  <label className="text-xs font-medium text-muted-foreground">Threshold</label>
                  <Input
                    type="number"
                    min="0"
                    max="1"
                    step="0.01"
                    value={threshold}
                    onChange={e => setThreshold(e.target.value)}
                    placeholder="0.00 - 1.00"
                  />
                </div>
                <div className="space-y-1.5">
                  <label className="text-xs font-medium text-muted-foreground">Model</label>
                  <Input
                    list="model-options"
                    value={model}
                    onChange={e => setModel(e.target.value)}
                    placeholder="e.g. gpt-4o"
                  />
                  <datalist id="model-options">
                    <option value="gpt-4o" />
                    <option value="gpt-4.1" />
                    <option value="gpt-4.1-mini" />
                    <option value="gpt-4.1-nano" />
                  </datalist>
                </div>
              </div>
            </div>

            <div className="space-y-4">
              <div className="space-y-2">
                <label className="text-xs font-medium text-muted-foreground">Context (multi-select)</label>
                <div className="flex items-center gap-4 overflow-x-auto pb-1">
                  {CONTEXTS.map(context => (
                    <label key={context} className="inline-flex shrink-0 items-center gap-2 text-sm cursor-pointer whitespace-nowrap">
                      <Checkbox
                        className={lightCheckboxClass}
                        checked={selectedContexts.has(context)}
                        onCheckedChange={() => toggleSetValue(context, setSelectedContexts)}
                      />
                      {context}
                    </label>
                  ))}
                </div>
              </div>

              <div className="space-y-2">
                <label className="text-xs font-medium text-muted-foreground">Content Type (multi-select)</label>
                <div className="flex items-center gap-4 overflow-x-auto pb-1">
                  {CONTENT_TYPES.map(contentType => (
                    <label key={contentType} className="inline-flex shrink-0 items-center gap-2 text-sm cursor-pointer whitespace-nowrap">
                      <Checkbox
                        className={lightCheckboxClass}
                        checked={selectedContentTypes.has(contentType)}
                        onCheckedChange={() => toggleSetValue(contentType, setSelectedContentTypes)}
                      />
                      {contentType}
                    </label>
                  ))}
                </div>
              </div>
            </div>

            <div className="space-y-2">
              <label className="text-xs font-medium text-muted-foreground">Criteria Categories (multi-select)</label>
              <div className="space-y-2 border rounded-lg p-3">
                {availableCategories.length === 0 ? (
                  <p className="text-xs text-muted-foreground">No categories available for the selected filters.</p>
                ) : (
                  availableCategories.map(category => {
                    const criteria = criteriaByCategory[category] || [];
                    const isExpanded = expandedCategories.has(category);
                    const selectedCount = criteria.filter(c => selectedCriteriaIds.has(c.id)).length;
                    return (
                      <Collapsible key={category} open={isExpanded}>
                        <div className="flex items-center justify-between py-1.5">
                          <label className="flex items-center gap-2 text-sm cursor-pointer">
                            <Checkbox
                              className={lightCheckboxClass}
                              checked={selectedCategories.has(category)}
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
                                disabled={!selectedCategories.has(category)}
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
                  })
                )}
              </div>
            </div>
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setNewSuiteOpen(false)}>Cancel</Button>
            <Button
              onClick={createSuite}
              disabled={
                !suiteName.trim() ||
                selectedCriteriaIds.size === 0 ||
                !metricType.trim() ||
                !model.trim() ||
                Number.isNaN(Number(threshold))
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
          const suiteCriteria = MOCK_CRITERIA.filter(c => suite.criteria_ids.includes(c.id));
          const configuredContexts = readConfigStringArray(suite.config.contexts);
          const configuredContentTypes = readConfigStringArray(suite.config.content_types);
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
