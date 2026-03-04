import { useState, useMemo, useEffect } from "react";
import { MOCK_RUNS, MOCK_COPIES, MOCK_SUITES, MOCK_CRITERIA } from "@/data/mock-data";
import { StatusBadge } from "@/components/StatusBadge";
import { ScoreBar, ScoreCircle } from "@/components/ScoreDisplay";
import { CriteriaTypeBadge } from "@/components/CriteriaTypeBadge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Checkbox } from "@/components/ui/checkbox";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { Play, ChevronDown, ChevronUp, ChevronRight, MessageSquare, Plus, Trash2 } from "lucide-react";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { CONTEXTS, CONTENT_TYPES, deriveCategoriesFromCriteria } from "@/config/hierarchy";
import type { EvalRun, Criterion, ContentType } from "@/types";

interface ContentEntry {
  id: number;
  contentType: ContentType;
  text: string;
  fileName?: string;
}

const EvaluatePage = () => {
  // Suite-based selection
  const [selectedSuite, setSelectedSuite] = useState<string>("");
  const [selectedCopy, setSelectedCopy] = useState<string>("");
  const [copySource, setCopySource] = useState<"library" | "import" | "paste">("paste");
  const [customCopyName, setCustomCopyName] = useState("");
  const [contentEntries, setContentEntries] = useState<ContentEntry[]>([
    { id: 1, contentType: "Description", text: "" },
  ]);
  const [nextContentEntryId, setNextContentEntryId] = useState(2);
  const [importedCopyText, setImportedCopyText] = useState("");
  const [importFileName, setImportFileName] = useState("");
  const [importError, setImportError] = useState<string | null>(null);
  const [expandedRun, setExpandedRun] = useState<string | null>(null);
  const [expandedHistoryCategories, setExpandedHistoryCategories] = useState<Set<string>>(new Set());
  const [selectionMode, setSelectionMode] = useState<string>("suite");

  const allCriteria: Criterion[] = MOCK_CRITERIA;
  // Hierarchy-based selection
  const [selectedContexts, setSelectedContexts] = useState<Set<string>>(() => new Set(CONTEXTS));
  const [selectedContentTypes, setSelectedContentTypes] = useState<Set<string>>(() => new Set(CONTENT_TYPES));
  const [selectedCategories, setSelectedCategories] = useState<Set<string>>(() => new Set());
  const [selectedCriteriaIds, setSelectedCriteriaIds] = useState<Set<string>>(() => new Set());
  const [expandedCategories, setExpandedCategories] = useState<Set<string>>(new Set());
  const lightCheckboxClass =
    "rounded-full border-slate-300 data-[state=checked]:bg-slate-500 data-[state=checked]:border-slate-500 focus-visible:ring-slate-300";

  const hierarchyFiltered = useMemo(() => {
    return allCriteria.filter(c => {
      if (!selectedContexts.has(c.context)) return false;
      if (!selectedContentTypes.has(c.content_type)) return false;
      if (!selectedCategories.has(c.criteria_category)) return false;
      if (!selectedCriteriaIds.has(c.id)) return false;
      return true;
    });
  }, [allCriteria, selectedContexts, selectedContentTypes, selectedCategories, selectedCriteriaIds]);

  const filteredCriteria = useMemo(
    () =>
      allCriteria.filter(
        c => selectedContexts.has(c.context) && selectedContentTypes.has(c.content_type),
      ),
    [allCriteria, selectedContexts, selectedContentTypes],
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

  // Keep selections valid as context/content filters change.
  useEffect(() => {
    if (selectedCategories.size === 0 && selectedCriteriaIds.size === 0 && filteredCriteria.length > 0) {
      setSelectedCategories(new Set(availableCategories));
      setSelectedCriteriaIds(new Set(filteredCriteria.map(c => c.id)));
    }
  }, [availableCategories, filteredCriteria, selectedCategories.size, selectedCriteriaIds.size]);

  useEffect(() => {
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
    if (
      nextCategories.size !== selectedCategories.size ||
      nextCriteriaIds.size !== selectedCriteriaIds.size
    ) {
      setSelectedCategories(nextCategories);
      setSelectedCriteriaIds(nextCriteriaIds);
    }
  }, [availableCategories, filteredCriteria, selectedCategories, selectedCriteriaIds]);

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

  const handleRunEval = () => {
    const selectedLibraryCopy = MOCK_COPIES.find(c => c.id === selectedCopy) || null;
    const nonEmptyEntries = contentEntries.filter(entry => entry.text.trim());
    const runtimeCopy = copySource === "library"
      ? selectedLibraryCopy
      : copySource === "import"
        ? {
            id: "custom-import-copy",
            product_name: customCopyName.trim(),
            content_type: "Description" as ContentType,
            raw_text: importedCopyText,
            metadata: { source_file: importFileName || undefined },
            created_at: new Date().toISOString(),
            updated_at: new Date().toISOString(),
          }
        : {
            id: "custom-paste-copy",
            product_name: customCopyName.trim(),
            content_type: nonEmptyEntries[0]?.contentType || contentEntries[0]?.contentType || "Description",
            raw_text: nonEmptyEntries.map(entry => `[${entry.contentType}]\n${entry.text}`).join("\n\n"),
            metadata: {
              content_entries: nonEmptyEntries.map(entry => ({
                content_type: entry.contentType,
                raw_text: entry.text,
                file_name: entry.fileName,
              })),
            },
            created_at: new Date().toISOString(),
            updated_at: new Date().toISOString(),
          };

    console.log("Running evaluation", {
      mode: selectionMode,
      suite: selectedSuite,
      copy: runtimeCopy,
      hierarchyCriteria: [...selectedCriteriaIds],
    });
  };

  const canRun = (copySource === "library"
    ? !!selectedCopy
    : copySource === "import"
      ? !!importedCopyText.trim()
      : !!customCopyName.trim() && contentEntries.some(entry => entry.text.trim())) && (
    selectionMode === "suite" ? !!selectedSuite : hierarchyFiltered.length > 0
  );

  const handleImportFile = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;

    try {
      const content = await file.text();
      setImportedCopyText(content);
      setImportFileName(file.name);
      if (!customCopyName.trim()) {
        const nameWithoutExt = file.name.replace(/\.[^/.]+$/, "");
        setCustomCopyName(nameWithoutExt || "Imported Copy");
      }
      setImportError(null);
    } catch {
      setImportError("Failed to read file. Please try another file.");
    }
  };

  const updateContentEntry = (entryId: number, updates: Partial<ContentEntry>) => {
    setContentEntries(prev => prev.map(entry => (entry.id === entryId ? { ...entry, ...updates } : entry)));
  };

  const addContentEntry = () => {
    const selectedTypes = new Set(contentEntries.map(entry => entry.contentType));
    const firstAvailable = CONTENT_TYPES.find(type => !selectedTypes.has(type)) || "Description";
    setContentEntries(prev => [...prev, { id: nextContentEntryId, contentType: firstAvailable, text: "" }]);
    setNextContentEntryId(prev => prev + 1);
  };

  const removeContentEntry = (entryId: number) => {
    setContentEntries(prev => (prev.length > 1 ? prev.filter(entry => entry.id !== entryId) : prev));
  };

  const contentTypeUsedByOtherEntry = (entryId: number, type: ContentType) =>
    contentEntries.some(entry => entry.id !== entryId && entry.contentType === type);

  const formatCriterionScore = (criterion: Criterion | undefined, score: number) => {
    if (!criterion) return String(score);
    if (criterion.criteria_type === "yes-no") return score === 1 ? "Yes" : "No";
    if (criterion.criteria_type === "numerical-scale") return `Scale: ${score}`;
    return `Count: ${score}`;
  };

  const getCriterionPoints = (criterion: Criterion | undefined, rawScore: number, normalizedScore: number) => {
    if (!criterion) return normalizedScore / 100;
    if (criterion.criteria_type === "yes-no") return rawScore === 1 ? 1 : 0;
    if (criterion.criteria_type === "numerical-scale") return Math.max(0, Math.min(1, rawScore / 4));
    return normalizedScore / 100;
  };

  const toggleHistoryCategory = (runId: string, category: string) => {
    const key = `${runId}::${category}`;
    setExpandedHistoryCategories(prev => {
      const next = new Set(prev);
      // This set tracks collapsed categories; default state is expanded.
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };

  return (
    <div className="p-6 space-y-6 animate-fade-in">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Evaluate</h1>
        <p className="text-sm text-muted-foreground mt-1">Run AI evaluations on product copy</p>
      </div>

      {/* Run configuration */}
      <Card className="shadow-card">
        <CardHeader className="pb-3">
          <CardTitle className="text-base">New Evaluation Run</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          {/* Product copy selection — always visible */}
          <div className="space-y-2">
            <label className="text-xs font-medium text-muted-foreground">Product Copy</label>
            <Tabs value={copySource} onValueChange={(v) => setCopySource(v as "library" | "import" | "paste")}>
              <TabsList>
                <TabsTrigger value="library">Library</TabsTrigger>
                <TabsTrigger value="import">Import</TabsTrigger>
                <TabsTrigger value="paste">Paste</TabsTrigger>
              </TabsList>

              <TabsContent value="library" className="mt-2 max-w-md">
                <Select value={selectedCopy} onValueChange={setSelectedCopy}>
                  <SelectTrigger><SelectValue placeholder="Select copy" /></SelectTrigger>
                  <SelectContent>
                    {MOCK_COPIES.map(c => (
                      <SelectItem key={c.id} value={c.id}>{c.product_name} ({c.content_type})</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </TabsContent>

              <TabsContent value="import" className="mt-2 space-y-3">
                <p className="text-xs text-muted-foreground">
                  Import column format: product name (required), title (optional), description (optional),
                  bullets/specs (optional), meta description (optional).
                </p>
                <div className="space-y-2">
                  <Input
                    type="file"
                    accept=".txt,.md,.csv,.json"
                    onChange={handleImportFile}
                  />
                  {importFileName && <p className="text-xs text-muted-foreground">Loaded: {importFileName}</p>}
                  {importError && <p className="text-xs text-destructive">{importError}</p>}
                </div>
              </TabsContent>

              <TabsContent value="paste" className="mt-2 space-y-3">
                <Input
                  placeholder="Product name"
                  value={customCopyName}
                  onChange={(e) => setCustomCopyName(e.target.value)}
                />
                <div className="space-y-3">
                  {contentEntries.map((entry) => (
                    <div key={entry.id} className="space-y-2 rounded-md border p-3">
                      <div className="flex flex-wrap items-center gap-2">
                        <div className="min-w-[220px] flex-1">
                          <Select
                            value={entry.contentType}
                            onValueChange={(value) => updateContentEntry(entry.id, { contentType: value as ContentType })}
                          >
                            <SelectTrigger><SelectValue placeholder="Content type" /></SelectTrigger>
                            <SelectContent>
                              {CONTENT_TYPES.map(ct => (
                                <SelectItem key={`paste-entry-${entry.id}-${ct}`} value={ct} disabled={contentTypeUsedByOtherEntry(entry.id, ct)}>
                                  {ct}
                                </SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                        </div>
                        <Button type="button" variant="outline" size="icon" onClick={addContentEntry}>
                          <Plus className="h-4 w-4" />
                        </Button>
                        <Button type="button" variant="outline" size="icon" onClick={() => removeContentEntry(entry.id)} disabled={contentEntries.length === 1}>
                          <Trash2 className="h-4 w-4" />
                        </Button>
                      </div>
                      <Textarea
                        rows={4}
                        placeholder={`Paste or type ${entry.contentType} content here...`}
                        value={entry.text}
                        onChange={(e) => updateContentEntry(entry.id, { text: e.target.value })}
                      />
                    </div>
                  ))}
                </div>
              </TabsContent>
            </Tabs>
          </div>

          {/* Tabs: Suite vs Hierarchy */}
          <Tabs value={selectionMode} onValueChange={setSelectionMode}>
            <label className="block text-xs font-medium text-muted-foreground mb-1.5">Criteria</label>
            <TabsList>
              <TabsTrigger value="suite">Select Suite</TabsTrigger>
              <TabsTrigger value="hierarchy">Playground</TabsTrigger>
            </TabsList>

            <TabsContent value="suite" className="mt-3">
              <div className="space-y-1.5 max-w-md">
                <Select value={selectedSuite} onValueChange={setSelectedSuite}>
                  <SelectTrigger><SelectValue placeholder="Select suite" /></SelectTrigger>
                  <SelectContent>
                    {MOCK_SUITES.map(s => (
                      <SelectItem key={s.id} value={s.id}>{s.name}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </TabsContent>

            <TabsContent value="hierarchy" className="mt-3 space-y-4">
              {/* Context & Content Type selectors */}
              <div className="space-y-4">
                <div className="space-y-2">
                  <label className="text-xs font-medium text-muted-foreground">Context</label>
                  <div className="flex items-center gap-4 overflow-x-auto pb-1">
                    {CONTEXTS.map(ctx => (
                      <label key={ctx} className="inline-flex shrink-0 items-center gap-2 text-sm cursor-pointer whitespace-nowrap">
                        <Checkbox
                          className={lightCheckboxClass}
                          checked={selectedContexts.has(ctx)}
                          onCheckedChange={() => toggleSetValue(ctx, setSelectedContexts)}
                        />
                        {ctx}
                      </label>
                    ))}
                  </div>
                </div>
                <div className="space-y-2">
                  <label className="text-xs font-medium text-muted-foreground">Content Type</label>
                  <div className="flex items-center gap-4 overflow-x-auto pb-1">
                    {CONTENT_TYPES.map(ct => (
                      <label key={ct} className="inline-flex shrink-0 items-center gap-2 text-sm cursor-pointer whitespace-nowrap">
                        <Checkbox
                          className={lightCheckboxClass}
                          checked={selectedContentTypes.has(ct)}
                          onCheckedChange={() => toggleSetValue(ct, setSelectedContentTypes)}
                        />
                        {ct}
                      </label>
                    ))}
                  </div>
                </div>
              </div>

              {/* Category toggles */}
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
            </TabsContent>
          </Tabs>

          <Button
            onClick={handleRunEval}
            disabled={!canRun}
            className="gap-2"
          >
            <Play className="h-4 w-4" /> Run Evaluation
          </Button>
        </CardContent>
      </Card>

      {/* Past runs */}
      <div className="space-y-3">
        <h2 className="text-lg font-semibold">Evaluation History</h2>
        {MOCK_RUNS.map(run => {
          const copy = MOCK_COPIES.find(c => c.id === run.product_copy_id);
          const suite = MOCK_SUITES.find(s => s.id === run.suite_id);
          const isExpanded = expandedRun === run.id;

          return (
            <Card key={run.id} className="shadow-card">
              <CardContent className="p-4">
                <button
                  onClick={() => setExpandedRun(isExpanded ? null : run.id)}
                  className="w-full"
                >
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-4">
                      {run.overall_score !== null && <ScoreCircle score={run.overall_score} size="sm" />}
                      <div className="text-left">
                        <p className="text-sm font-semibold">{copy?.product_name}</p>
                        <p className="text-xs text-muted-foreground">{suite?.name} · {copy?.content_type}</p>
                      </div>
                    </div>
                    <div className="flex items-center gap-3">
                      <StatusBadge status={run.status} />
                      <span className="text-xs text-muted-foreground">
                        {new Date(run.started_at).toLocaleDateString()}
                      </span>
                      {isExpanded ? <ChevronUp className="h-4 w-4 text-muted-foreground" /> : <ChevronDown className="h-4 w-4 text-muted-foreground" />}
                    </div>
                  </div>
                </button>

                {isExpanded && run.status === "completed" && (
                  <div className="mt-4 pt-4 border-t space-y-4 animate-fade-in">
                    {(() => {
                      const runCriteriaDetails = run.criterion_scores
                        .map(cs => ({
                          cs,
                          criterion: MOCK_CRITERIA.find(c => c.id === cs.criterion_id),
                        }))
                        .filter(detail => !!detail.criterion) as Array<{
                        cs: EvalRun["criterion_scores"][number];
                        criterion: Criterion;
                      }>;

                      const runCategories = [...new Set(runCriteriaDetails.map(detail => detail.criterion.criteria_category))];
                      const groupedCriteria = runCategories.reduce<Record<string, typeof runCriteriaDetails>>((acc, category) => {
                        acc[category] = runCriteriaDetails.filter(detail => detail.criterion.criteria_category === category);
                        return acc;
                      }, {});
                      const categoryPointSums = runCategories.reduce<Record<string, number>>((acc, category) => {
                        const details = groupedCriteria[category] || [];
                        acc[category] = details.reduce(
                          (sum, detail) => sum + getCriterionPoints(detail.criterion, detail.cs.score, detail.cs.normalized_score),
                          0,
                        );
                        return acc;
                      }, {});

                      return (
                    <div className="space-y-2">
                        <div className="flex items-center justify-between gap-2">
                          <div className="flex items-center gap-2">
                            <h4 className="text-xs font-medium text-muted-foreground">Criteria Categories</h4>
                            <Badge variant="outline" className="text-[10px]">{runCategories.length}</Badge>
                          </div>
                          <Button
                            variant="outline"
                            size="sm"
                            className="h-7 text-xs"
                            onClick={() =>
                              setExpandedHistoryCategories(prev => {
                                const next = new Set(prev);
                                const allExpanded = runCategories.every(category => !next.has(`${run.id}::${category}`));
                                runCategories.forEach(category => {
                                  const key = `${run.id}::${category}`;
                                  if (allExpanded) next.add(key);
                                  else next.delete(key);
                                });
                                return next;
                              })
                            }
                          >
                            {runCategories.every(category => !expandedHistoryCategories.has(`${run.id}::${category}`))
                              ? "Collapse all"
                              : "Expand all"}
                          </Button>
                        </div>
                        <div className="space-y-2">
                          {runCategories.map(category => {
                            const details = groupedCriteria[category] || [];
                            const categoryKey = `${run.id}::${category}`;
                            const isCategoryExpanded = !expandedHistoryCategories.has(categoryKey);
                            const categoryPoints = categoryPointSums[category] ?? 0;
                            const categoryMaxPoints = details.length || 1;
                            const categoryPct = Math.min(100, (categoryPoints / categoryMaxPoints) * 100);
                            return (
                              <Collapsible key={categoryKey} open={isCategoryExpanded}>
                                <div className="flex items-center justify-between py-1.5">
                                  <div className="flex items-center gap-3">
                                    <span className="text-sm">{category}</span>
                                    <div className="flex items-center gap-2">
                                      <div className="w-24 h-1.5 rounded-full bg-muted overflow-hidden">
                                        <div
                                          className="h-full rounded-full bg-score-excellent transition-all duration-700 ease-out"
                                          style={{ width: `${categoryPct}%` }}
                                        />
                                      </div>
                                      <span className="text-sm font-semibold text-score-excellent tabular-nums">
                                        {categoryPoints.toFixed(2).replace(/\.00$/, "")}
                                      </span>
                                    </div>
                                  </div>
                                  <CollapsibleTrigger asChild>
                                    <Button
                                      variant="ghost"
                                      size="icon"
                                      className="h-7 w-7"
                                      onClick={() => toggleHistoryCategory(run.id, category)}
                                    >
                                      {isCategoryExpanded ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
                                    </Button>
                                  </CollapsibleTrigger>
                                </div>
                                <CollapsibleContent className="space-y-2 pl-4 pb-2">
                                  {details.map(({ cs, criterion }) => (
                                    <div key={cs.criterion_id} className="rounded-md border p-2.5 space-y-2">
                                      {(() => {
                                        const points = getCriterionPoints(criterion, cs.score, cs.normalized_score);
                                        return (
                                      <div className="flex items-center justify-between gap-3">
                                        <div className="flex items-center gap-2">
                                          <span className="text-sm font-medium">{criterion.criteria_name}</span>
                                          {criterion.criteria_type === "yes-no" ? (
                                            <Badge className="text-[10px] font-medium bg-score-excellent/15 text-score-excellent border border-score-excellent/30 hover:bg-score-excellent/15">
                                              {formatCriterionScore(criterion, cs.score)}
                                            </Badge>
                                          ) : criterion.criteria_type === "numerical-count" ? (
                                            <Badge className="text-[10px] font-medium bg-info/15 text-info border border-info/30 hover:bg-info/15">
                                              {formatCriterionScore(criterion, cs.score)}
                                            </Badge>
                                          ) : criterion.criteria_type === "numerical-scale" ? (
                                            <Badge className="text-[10px] font-medium bg-score-good/15 text-score-good border border-score-good/30 hover:bg-score-good/15">
                                              {formatCriterionScore(criterion, cs.score)}
                                            </Badge>
                                          ) : (
                                            <>
                                              <CriteriaTypeBadge type={criterion.criteria_type} />
                                              <Badge variant="outline" className="text-[10px]">
                                                {formatCriterionScore(criterion, cs.score)}
                                              </Badge>
                                            </>
                                          )}
                                        </div>
                                        <div className="flex h-11 w-11 items-center justify-center rounded-full border-2 border-score-excellent bg-score-excellent/10 text-score-excellent text-sm font-bold tabular-nums">
                                          {points.toFixed(2).replace(/\.00$/, "")}
                                        </div>
                                      </div>
                                        );
                                      })()}
                                      <div className="flex items-start gap-2 text-xs text-muted-foreground">
                                        <MessageSquare className="h-3 w-3 mt-0.5 shrink-0" />
                                        <span>{cs.reasoning}</span>
                                      </div>
                                    </div>
                                  ))}
                                </CollapsibleContent>
                              </Collapsible>
                            );
                          })}
                        </div>
                    </div>
                      );
                    })()}
                  </div>
                )}
              </CardContent>
            </Card>
          );
        })}
      </div>
    </div>
  );
};

export default EvaluatePage;
