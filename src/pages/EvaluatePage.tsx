import { useState, useMemo, useEffect } from "react";
import { MOCK_RUNS, MOCK_COPIES, MOCK_SUITES, MOCK_CRITERIA } from "@/data/mock-data";
import { ScoreBar } from "@/components/ScoreDisplay";
import { CriteriaTypeBadge } from "@/components/CriteriaTypeBadge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Checkbox } from "@/components/ui/checkbox";
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { Play, ChevronDown, ChevronUp, ChevronRight, MessageSquare, Plus, Trash2, Download } from "lucide-react";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { CONTENT_TYPES, deriveCategoriesFromCriteria } from "@/config/hierarchy";
import type { EvalRun, Criterion, ContentType, EvalRunScoreNode } from "@/types";
import { loadManagedTaxonomy, loadRuntimeCriteria } from "@/data/runtime-taxonomy";

interface ContentEntry {
  id: number;
  contentType: ContentType;
  text: string;
  fileName?: string;
}

interface PasteProductDraft {
  id: number;
  name: string;
  contentEntries: ContentEntry[];
  isExpanded: boolean;
}

interface HierarchyScoreSource {
  criterion_scores: EvalRun["criterion_scores"];
  hierarchical_scores?: Record<string, EvalRunScoreNode>;
  root_node_ids?: string[];
}

const CONTEXT_ORDER = ["Universal", "Industry", "Marketplace", "Brand"];

const getBranchTagForCriterion = (criterion: Criterion) => {
  if (criterion.context === "Industry") return criterion.industry_tag;
  if (criterion.context === "Marketplace") return criterion.marketplace_tag;
  if (criterion.context === "Brand") return criterion.brand_tag;
  return undefined;
};

const normalizeCriterionToQuartile = (criterion: Criterion | undefined, rawScore: number) => {
  if (!criterion) return Math.max(0.25, Math.min(1, rawScore));
  if (criterion.criteria_type === "yes-no") return rawScore >= 1 ? 1 : 0.25;
  if (criterion.criteria_type === "numerical-scale") {
    const clamped = Math.max(1, Math.min(4, Math.round(rawScore)));
    return clamped / 4;
  }
  const rounded = Math.round(rawScore);
  if (rounded <= 0) return 0.25;
  if (rounded === 1) return 0.5;
  if (rounded === 2) return 0.75;
  return 1;
};

const toWeightTier = (weight: number | undefined) => {
  const rounded = Math.round(weight ?? 1);
  return Math.max(1, Math.min(3, rounded));
};

const EvaluatePage = () => {
  // Suite-based selection
  const [selectedSuite, setSelectedSuite] = useState<string>("");
  const [runName, setRunName] = useState("");
  const [runBrand, setRunBrand] = useState("");
  const [copySource, setCopySource] = useState<"import" | "paste">("paste");
  const [customCopyName, setCustomCopyName] = useState("");
  const [pasteProducts, setPasteProducts] = useState<PasteProductDraft[]>([
    {
      id: 1,
      name: "",
      isExpanded: true,
      contentEntries: [{ id: 1, contentType: "Description", text: "" }],
    },
  ]);
  const [nextPasteProductId, setNextPasteProductId] = useState(2);
  const [nextContentEntryId, setNextContentEntryId] = useState(2);
  const [importedCopyText, setImportedCopyText] = useState("");
  const [importFileName, setImportFileName] = useState("");
  const [importError, setImportError] = useState<string | null>(null);
  const [openHistoryNodesByTree, setOpenHistoryNodesByTree] = useState<Record<string, Set<string>>>({});
  const [openHistoryProducts, setOpenHistoryProducts] = useState<Record<string, boolean>>({});
  const [openRunInputByRun, setOpenRunInputByRun] = useState<Record<string, boolean>>({});
  const [historyTitleQuery, setHistoryTitleQuery] = useState("");
  const [historyBrandFilter, setHistoryBrandFilter] = useState("all");
  const [historySuiteFilter, setHistorySuiteFilter] = useState("all");
  const [historySortBy, setHistorySortBy] = useState<"date_desc" | "date_asc" | "title_asc" | "title_desc">("date_desc");
  const [isNewEvaluationRunOpen, setIsNewEvaluationRunOpen] = useState(true);
  const [selectionMode, setSelectionMode] = useState<string>("suite");

  const runtimeCriteria = useMemo(() => loadRuntimeCriteria(), []);
  const runtimeTaxonomy = useMemo(() => loadManagedTaxonomy(runtimeCriteria), [runtimeCriteria]);
  const allCriteria: Criterion[] = runtimeCriteria;
  // Hierarchy-based selection
  const [selectedContexts, setSelectedContexts] = useState<Set<string>>(() => new Set(runtimeTaxonomy.contexts));
  const [selectedContentTypes, setSelectedContentTypes] = useState<Set<string>>(() => new Set(runtimeTaxonomy.contentTypes));
  const [selectedBrands, setSelectedBrands] = useState<Set<string>>(new Set());
  const [selectedIndustries, setSelectedIndustries] = useState<Set<string>>(new Set());
  const [selectedMarketplaces, setSelectedMarketplaces] = useState<Set<string>>(new Set());
  const [selectedCategories, setSelectedCategories] = useState<Set<string>>(() => new Set());
  const [selectedCriteriaIds, setSelectedCriteriaIds] = useState<Set<string>>(() => new Set());
  const [expandedCategories, setExpandedCategories] = useState<Set<string>>(new Set());
  const [activeCriteriaTab, setActiveCriteriaTab] = useState("all");
  const lightCheckboxClass =
    "h-5 w-5 !rounded-[4px] border-slate-300 data-[state=checked]:bg-slate-500 data-[state=checked]:border-slate-500 focus-visible:ring-slate-300";
  const contextButtonBase = "h-11 px-6";
  const contextButtonActive = "bg-[#1f3b67] border-[#1f3b67] text-white hover:bg-[#1f3b67]/95";
  const contextButtonInactive = "bg-background";

  const hierarchyFiltered = useMemo(() => {
    return allCriteria.filter(c => {
      if (!selectedContexts.has(c.context)) return false;
      if (!selectedContentTypes.has(c.content_type)) return false;
      if (c.context === "Brand" && selectedBrands.size > 0 && (!c.brand_tag || !selectedBrands.has(c.brand_tag))) return false;
      if (c.context === "Industry" && selectedIndustries.size > 0 && (!c.industry_tag || !selectedIndustries.has(c.industry_tag))) return false;
      if (c.context === "Marketplace" && selectedMarketplaces.size > 0 && (!c.marketplace_tag || !selectedMarketplaces.has(c.marketplace_tag))) return false;
      if (!selectedCategories.has(c.criteria_category)) return false;
      if (!selectedCriteriaIds.has(c.id)) return false;
      return true;
    });
  }, [
    allCriteria,
    selectedContexts,
    selectedContentTypes,
    selectedBrands,
    selectedIndustries,
    selectedMarketplaces,
    selectedCategories,
    selectedCriteriaIds,
  ]);

  const filteredCriteria = useMemo(
    () =>
      allCriteria.filter(
        c =>
          selectedContexts.has(c.context) &&
          selectedContentTypes.has(c.content_type) &&
          (c.context !== "Brand" || selectedBrands.size === 0 || (c.brand_tag ? selectedBrands.has(c.brand_tag) : false)) &&
          (c.context !== "Industry" || selectedIndustries.size === 0 || (c.industry_tag ? selectedIndustries.has(c.industry_tag) : false)) &&
          (c.context !== "Marketplace" || selectedMarketplaces.size === 0 || (c.marketplace_tag ? selectedMarketplaces.has(c.marketplace_tag) : false)),
      ),
    [allCriteria, selectedContexts, selectedContentTypes, selectedBrands, selectedIndustries, selectedMarketplaces],
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
    () => (activeCriteriaTab === "all" ? filteredCriteria : filteredCriteria.filter((criterion) => criterion.context === activeCriteriaTab)),
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

  const toggleCategory = (category: string) => {
    const categoryCriteriaIds = criteriaByCategory[category]?.map(c => c.id) || [];
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
    const validPasteProducts = pasteProducts
      .map((product) => {
        const nonEmptyEntries = product.contentEntries.filter((entry) => entry.text.trim());
        if (!product.name.trim() || nonEmptyEntries.length === 0) return null;
        return {
          id: `custom-paste-copy-${product.id}`,
          product_name: product.name.trim(),
          content_type: nonEmptyEntries[0]?.contentType || product.contentEntries[0]?.contentType || "Description",
          raw_text: nonEmptyEntries.map((entry) => `[${entry.contentType}]\n${entry.text}`).join("\n\n"),
          metadata: {
            content_entries: nonEmptyEntries.map((entry) => ({
              content_type: entry.contentType,
              raw_text: entry.text,
              file_name: entry.fileName,
            })),
          },
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        };
      })
      .filter(Boolean);

    const runtimeCopies = copySource === "import"
      ? {
          id: "custom-import-copy",
          product_name: customCopyName.trim(),
          content_type: "Description" as ContentType,
          raw_text: importedCopyText,
          metadata: { source_file: importFileName || undefined },
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        }
      : validPasteProducts;

    console.log("Running evaluation", {
      runName: runName.trim() || null,
      brand: runBrand.trim() || null,
      mode: selectionMode,
      suite: selectedSuite,
      copies: Array.isArray(runtimeCopies) ? runtimeCopies : [runtimeCopies],
      hierarchyCriteria: [...selectedCriteriaIds],
    });
  };

  const hasAtLeastOneValidPasteProduct = pasteProducts.some(
    (product) => product.name.trim() && product.contentEntries.some((entry) => entry.text.trim()),
  );

  const canRun = (copySource === "import"
    ? !!importedCopyText.trim()
    : hasAtLeastOneValidPasteProduct) && (
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

  const updatePasteProductName = (productId: number, name: string) => {
    setPasteProducts((prev) =>
      prev.map((product) => (product.id === productId ? { ...product, name } : product)),
    );
  };

  const updateProductContentEntry = (productId: number, entryId: number, updates: Partial<ContentEntry>) => {
    setPasteProducts((prev) =>
      prev.map((product) =>
        product.id === productId
          ? {
              ...product,
              contentEntries: product.contentEntries.map((entry) =>
                entry.id === entryId ? { ...entry, ...updates } : entry,
              ),
            }
          : product,
      ),
    );
  };

  const addProductContentEntry = (productId: number) => {
    const product = pasteProducts.find((candidate) => candidate.id === productId);
    if (!product) return;
    const selectedTypes = new Set(product.contentEntries.map((entry) => entry.contentType));
    const firstAvailable = CONTENT_TYPES.find(type => !selectedTypes.has(type)) || "Description";
    const newEntryId = nextContentEntryId;
    setNextContentEntryId((prev) => prev + 1);
    setPasteProducts((prev) =>
      prev.map((candidate) =>
        candidate.id === productId
          ? {
              ...candidate,
              contentEntries: [...candidate.contentEntries, { id: newEntryId, contentType: firstAvailable, text: "" }],
            }
          : candidate,
      ),
    );
  };

  const removeProductContentEntry = (productId: number, entryId: number) => {
    setPasteProducts((prev) =>
      prev.map((product) => {
        if (product.id !== productId) return product;
        if (product.contentEntries.length <= 1) return product;
        return {
          ...product,
          contentEntries: product.contentEntries.filter((entry) => entry.id !== entryId),
        };
      }),
    );
  };

  const contentTypeUsedByOtherEntry = (productId: number, entryId: number, type: ContentType) => {
    const product = pasteProducts.find((candidate) => candidate.id === productId);
    if (!product) return false;
    return product.contentEntries.some((entry) => entry.id !== entryId && entry.contentType === type);
  };

  const addPasteProduct = () => {
    const productId = nextPasteProductId;
    const entryId = nextContentEntryId;
    setNextPasteProductId((prev) => prev + 1);
    setNextContentEntryId((prev) => prev + 1);
    setPasteProducts((prev) => [
      ...prev,
      {
        id: productId,
        name: "",
        isExpanded: true,
        contentEntries: [{ id: entryId, contentType: "Description", text: "" }],
      },
    ]);
  };

  const removePasteProduct = (productId: number) => {
    setPasteProducts((prev) => {
      if (prev.length <= 1) return prev;
      return prev.filter((product) => product.id !== productId);
    });
  };

  const togglePasteProductExpanded = (productId: number) => {
    setPasteProducts((prev) =>
      prev.map((product) =>
        product.id === productId ? { ...product, isExpanded: !product.isExpanded } : product,
      ),
    );
  };

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

  const criterionById = useMemo(() => {
    const map = new Map<string, Criterion>();
    MOCK_CRITERIA.forEach((criterion) => map.set(criterion.id, criterion));
    allCriteria.forEach((criterion) => map.set(criterion.id, criterion));
    return map;
  }, [allCriteria]);

  const buildDefaultOpenTreeNodes = (nodes: Record<string, EvalRunScoreNode>, rootNodeIds: string[]) => {
    const open = new Set<string>();
    const visit = (nodeId: string) => {
      const node = nodes[nodeId];
      if (!node) return;
      if (node.level === "context" || node.level === "branch" || node.level === "content_type") {
        open.add(node.id);
      }
      node.children_ids.forEach((childId) => visit(childId));
    };
    rootNodeIds.forEach((rootId) => visit(rootId));
    return open;
  };

  const getTreeOpenNodes = (treeKey: string, nodes: Record<string, EvalRunScoreNode>, rootNodeIds: string[]) =>
    openHistoryNodesByTree[treeKey] || buildDefaultOpenTreeNodes(nodes, rootNodeIds);

  const toggleTreeNode = (treeKey: string, nodeId: string, nodes: Record<string, EvalRunScoreNode>, rootNodeIds: string[]) => {
    setOpenHistoryNodesByTree((prev) => {
      const base = prev[treeKey] || buildDefaultOpenTreeNodes(nodes, rootNodeIds);
      const next = new Set(base);
      if (next.has(nodeId)) next.delete(nodeId);
      else next.add(nodeId);
      return { ...prev, [treeKey]: next };
    });
  };

  const getLegacyHierarchyForSource = (source: HierarchyScoreSource) => {
    const nodes: Record<string, EvalRunScoreNode> = {};
    const rootNodeIds: string[] = [];
    const addChild = (parentId: string | null, childId: string) => {
      if (!parentId || !nodes[parentId]) return;
      if (!nodes[parentId].children_ids.includes(childId)) nodes[parentId].children_ids.push(childId);
    };
    const ensureNode = (
      id: string,
      label: string,
      level: EvalRunScoreNode["level"],
      parentId: string | null,
      meta?: EvalRunScoreNode["meta"],
    ) => {
      if (!nodes[id]) {
        nodes[id] = {
          id,
          label,
          level,
          parent_id: parentId,
          children_ids: [],
          raw_points: 0,
          max_points: 0,
          normalized_0_100: 0,
          meta,
        };
        if (!parentId && !rootNodeIds.includes(id)) rootNodeIds.push(id);
        addChild(parentId, id);
      }
      return nodes[id];
    };

    source.criterion_scores.forEach((entry) => {
      const criterion = criterionById.get(entry.criterion_id);
      if (!criterion) return;
      const context = criterion.context;
      const branchTag = getBranchTagForCriterion(criterion);
      const contentType = criterion.content_type;
      const category = criterion.criteria_category;
      const score01 = normalizeCriterionToQuartile(criterion, entry.score);
      const maxPoints = toWeightTier(criterion.weight);
      const rawPoints = score01 * maxPoints;

      const contextNodeId = `context:${context}`;
      ensureNode(contextNodeId, context, "context", null, { context });

      const branchNodeId = context === "Universal" ? null : `branch:${context}:${branchTag || "unknown"}`;
      if (branchNodeId) ensureNode(branchNodeId, branchTag || "Unknown", "branch", contextNodeId, { context, branch_tag: branchTag || "Unknown" });

      const contentTypeNodeId = `content_type:${context}:${branchTag || ""}:${contentType}`;
      ensureNode(
        contentTypeNodeId,
        contentType,
        "content_type",
        branchNodeId || contextNodeId,
        { context, branch_tag: branchTag, content_type: contentType },
      );

      const categoryNodeId = `category:${context}:${branchTag || ""}:${contentType}:${category}`;
      ensureNode(
        categoryNodeId,
        category,
        "category",
        contentTypeNodeId,
        { context, branch_tag: branchTag, content_type: contentType, category },
      );

      const criterionNodeId = `criterion:${context}:${branchTag || ""}:${contentType}:${category}:${criterion.id}`;
      nodes[criterionNodeId] = {
        id: criterionNodeId,
        label: criterion.criteria_name,
        level: "criterion",
        parent_id: categoryNodeId,
        children_ids: [],
        raw_points: rawPoints,
        max_points: maxPoints,
        normalized_0_100: maxPoints > 0 ? (rawPoints / maxPoints) * 100 : 0,
        meta: { context, branch_tag: branchTag, content_type: contentType, category, criterion_id: criterion.id },
      };
      addChild(categoryNodeId, criterionNodeId);
    });

    const compute = (nodeId: string): { raw: number; max: number } => {
      const node = nodes[nodeId];
      if (!node) return { raw: 0, max: 0 };
      if (node.level === "criterion") return { raw: node.raw_points, max: node.max_points };
      const totals = node.children_ids.reduce(
        (acc, childId) => {
          const childTotals = compute(childId);
          return { raw: acc.raw + childTotals.raw, max: acc.max + childTotals.max };
        },
        { raw: 0, max: 0 },
      );
      node.raw_points = totals.raw;
      node.max_points = totals.max;
      node.normalized_0_100 = totals.max > 0 ? (totals.raw / totals.max) * 100 : 0;
      return totals;
    };

    rootNodeIds.forEach((nodeId) => compute(nodeId));
    rootNodeIds.sort((a, b) => {
      const aLabel = nodes[a]?.label || "";
      const bLabel = nodes[b]?.label || "";
      const aOrder = CONTEXT_ORDER.indexOf(aLabel);
      const bOrder = CONTEXT_ORDER.indexOf(bLabel);
      return (aOrder === -1 ? 999 : aOrder) - (bOrder === -1 ? 999 : bOrder);
    });
    return { nodes, rootNodeIds };
  };

  const getRunHierarchy = (source: HierarchyScoreSource) => {
    if (source.hierarchical_scores && source.root_node_ids && source.root_node_ids.length > 0) {
      return { nodes: source.hierarchical_scores, rootNodeIds: source.root_node_ids };
    }
    return getLegacyHierarchyForSource(source);
  };

  const getRunCounts = (nodes: Record<string, EvalRunScoreNode>) =>
    Object.values(nodes).reduce(
      (acc, node) => {
        if (node.level === "context") acc.contexts += 1;
        if (node.level === "branch") acc.branches += 1;
        if (node.level === "content_type") acc.contentTypes += 1;
        if (node.level === "category") acc.categories += 1;
        if (node.level === "criterion") acc.criteria += 1;
        return acc;
      },
      { contexts: 0, branches: 0, contentTypes: 0, categories: 0, criteria: 0 },
    );

  const getOutcomeBadgeClass = (normalizedScore: number) => {
    if (normalizedScore >= 85) return "bg-score-excellent/15 text-score-excellent border border-score-excellent/30 hover:bg-score-excellent/15";
    if (normalizedScore >= 65) return "bg-score-good/15 text-score-good border border-score-good/30 hover:bg-score-good/15";
    if (normalizedScore >= 40) return "bg-score-fair/15 text-score-fair border border-score-fair/30 hover:bg-score-fair/15";
    return "bg-score-poor/15 text-score-poor border border-score-poor/30 hover:bg-score-poor/15";
  };
  const renderNormalizedScoreBadge = (score01: number) => (
    <Badge className={`text-[10px] font-medium min-w-[74px] justify-center tabular-nums ${getOutcomeBadgeClass(score01 * 100)}`}>
      {formatScore01(score01)}
    </Badge>
  );

  const toDisplayedScale = (normalizedScore: number) => Math.max(1, Math.min(4, Math.round((normalizedScore / 100) * 4)));
  const toDisplayedCount = (rawScore: number) => {
    if (rawScore >= 3) return "3+";
    if (rawScore <= 0) return "0";
    return String(Math.round(rawScore));
  };
  const formatScore01 = (value: number) => Math.max(0.25, Math.min(1, value)).toFixed(2);

  const renderCriterionBadge = (criterion: Criterion, score: number, normalizedScore: number) => {
    const label = criterion.criteria_type === "yes-no"
      ? (score >= 1 ? "Yes" : "No")
      : criterion.criteria_type === "numerical-count"
        ? `Count: ${toDisplayedCount(score)}`
        : `Scale: ${toDisplayedScale(normalizedScore)}`;
    return (
      <Badge className={`text-[10px] font-medium min-w-[96px] justify-center tabular-nums ${getOutcomeBadgeClass(normalizedScore)}`}>
        {label}
      </Badge>
    );
  };

  const renderFallbackCriterionBadge = (normalizedScore: number) => (
    <Badge className={`text-[10px] font-medium min-w-[96px] justify-center tabular-nums ${getOutcomeBadgeClass(normalizedScore)}`}>
      Scale: {toDisplayedScale(normalizedScore)}
    </Badge>
  );

  const renderNestedTree = (criterionScores: EvalRun["criterion_scores"], nodes: Record<string, EvalRunScoreNode>, nodeId: string, depth = 0): JSX.Element | null => {
    const node = nodes[nodeId];
    if (!node) return null;

    if (node.level === "criterion") {
      const criterion = node.meta?.criterion_id ? criterionById.get(node.meta.criterion_id) : undefined;
      const criterionScore = criterionScores.find((scoreEntry) => scoreEntry.criterion_id === node.meta?.criterion_id);
      if (!criterion || !criterionScore) return null;
      return (
        <div key={node.id} className="rounded-md border p-2.5 space-y-2 ml-3">
          <div className="flex items-center justify-between gap-3">
            <div className="flex items-center gap-2">
              <span className="text-sm font-medium">{node.label}</span>
              {renderCriterionBadge(criterion, criterionScore.score, node.normalized_0_100)}
            </div>
            <div className="text-xs tabular-nums text-muted-foreground">
              {node.raw_points.toFixed(2)}/{node.max_points.toFixed(2)} · {Math.round(node.normalized_0_100)}
            </div>
          </div>
          <div className="flex items-start gap-2 text-xs text-muted-foreground">
            <MessageSquare className="h-3 w-3 mt-0.5 shrink-0" />
            <span>{criterionScore.reasoning}</span>
          </div>
        </div>
      );
    }

    return (
      <div key={node.id} className={depth === 0 ? "space-y-2" : "space-y-2 ml-4"}>
        <div className="rounded-md border p-2">
          <div className="flex items-center justify-between gap-3">
            <div className="text-sm font-medium">{node.label}</div>
            <div className="min-w-[220px]">
              <ScoreBar score={node.normalized_0_100} size="sm" showLabel />
            </div>
          </div>
          <div className="text-[11px] text-muted-foreground tabular-nums mt-1">
            {node.raw_points.toFixed(2)}/{node.max_points.toFixed(2)} points
          </div>
        </div>
        <div className="space-y-2">
          {node.children_ids.map((childId) => renderNestedTree(criterionScores, nodes, childId, depth + 1))}
        </div>
      </div>
    );
  };

  const renderMatrixTree = (nodes: Record<string, EvalRunScoreNode>) => {
    const levels: Array<{ key: EvalRunScoreNode["level"]; title: string }> = [
      { key: "context", title: "Context" },
      { key: "branch", title: "Branch" },
      { key: "content_type", title: "Content Type" },
      { key: "category", title: "Category" },
    ];
    return (
      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-3">
        {levels.map((level) => {
          const levelNodes = Object.values(nodes).filter((node) => node.level === level.key);
          return (
            <div key={level.key} className="rounded-md border p-2 space-y-2">
              <p className="text-xs font-semibold text-muted-foreground">{level.title}</p>
              {levelNodes.length === 0 ? (
                <p className="text-xs text-muted-foreground">No nodes</p>
              ) : (
                levelNodes.map((node) => (
                  <div key={node.id} className="rounded border p-2 space-y-1">
                    <div className="text-xs font-medium">{node.label}</div>
                    <ScoreBar score={node.normalized_0_100} size="sm" showLabel />
                    <div className="text-[11px] text-muted-foreground tabular-nums">
                      {node.raw_points.toFixed(2)}/{node.max_points.toFixed(2)}
                    </div>
                  </div>
                ))
              )}
            </div>
          );
        })}
      </div>
    );
  };

  const renderSectionedTree = (criterionScores: EvalRun["criterion_scores"], nodes: Record<string, EvalRunScoreNode>, rootNodeIds: string[]) => (
    <div className="space-y-3">
      {rootNodeIds.map((rootId) => {
        const root = nodes[rootId];
        if (!root) return null;
        return (
          <Card key={rootId} className="shadow-none border">
            <CardContent className="p-3 space-y-3">
              <div className="flex items-center justify-between">
                <h4 className="text-sm font-semibold">{root.label}</h4>
                <div className="w-52">
                  <ScoreBar score={root.normalized_0_100} size="sm" showLabel />
                </div>
              </div>
              <div className="space-y-2">
                {root.children_ids.map((childId) => renderNestedTree(criterionScores, nodes, childId, 0))}
              </div>
            </CardContent>
          </Card>
        );
      })}
    </div>
  );

  const renderVersion1Compact = (
    criterionScores: EvalRun["criterion_scores"],
    nodes: Record<string, EvalRunScoreNode>,
    rootNodeIds: string[],
    treeKey: string,
  ) => {
    const openNodes = getTreeOpenNodes(treeKey, nodes, rootNodeIds);
    const criterionScoresById = new Map(criterionScores.map((entry) => [entry.criterion_id, entry]));
    const levelTone: Record<EvalRunScoreNode["level"], string> = {
      context: "bg-blue-50 text-blue-700 border-blue-200",
      branch: "bg-indigo-50 text-indigo-700 border-indigo-200",
      content_type: "bg-violet-50 text-violet-700 border-violet-200",
      category: "bg-amber-50 text-amber-700 border-amber-200",
      criterion: "bg-slate-50 text-slate-700 border-slate-200",
    };

    const renderRows = (nodeId: string, depth: number): JSX.Element | null => {
      const node = nodes[nodeId];
      if (!node) return null;
      const indentPx = Math.min(depth, 5) * 16;
      const isCriterion = node.level === "criterion";
      const isExpandable = node.children_ids.length > 0;
      const isOpen = isExpandable && openNodes.has(node.id);
      const criterion = node.meta?.criterion_id ? criterionById.get(node.meta.criterion_id) : undefined;
      const criterionScore = node.meta?.criterion_id ? criterionScoresById.get(node.meta.criterion_id) : undefined;
      const criterionChildren = node.children_ids
        .map((childId) => nodes[childId])
        .filter((child): child is EvalRunScoreNode => Boolean(child && child.level === "criterion"));
      const nonCriterionChildren = node.children_ids
        .map((childId) => nodes[childId])
        .filter((child): child is EvalRunScoreNode => Boolean(child && child.level !== "criterion"));

      return (
        <div key={`${treeKey}-${node.id}`} className="space-y-1">
          <div className="grid grid-cols-[auto_minmax(0,1fr)_140px_84px] items-center gap-2 rounded border px-2 py-1" style={{ marginLeft: `${indentPx}px` }}>
            <button
              type="button"
              className="h-6 w-6 inline-flex items-center justify-center rounded border bg-background disabled:opacity-40"
              onClick={() => isExpandable && toggleTreeNode(treeKey, node.id, nodes, rootNodeIds)}
              disabled={!isExpandable}
              aria-label={isOpen ? "Collapse" : "Expand"}
            >
              {isExpandable ? (isOpen ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronRight className="h-3.5 w-3.5" />) : <span className="text-[10px]">•</span>}
            </button>
            <div className="min-w-0 flex items-center gap-1.5">
              <Badge variant="outline" className={`text-[10px] font-normal capitalize ${levelTone[node.level]}`}>
                {node.level.replace("_", " ")}
              </Badge>
              <span className="truncate text-xs font-medium">{node.label}</span>
              {isExpandable && (
                <span className="text-[10px] text-muted-foreground">({node.children_ids.length})</span>
              )}
              {isCriterion && criterion && criterionScore ? renderCriterionBadge(criterion, criterionScore.score, node.normalized_0_100) : null}
            </div>
            <div className="min-w-0">
              <ScoreBar score={node.normalized_0_100} size="sm" showLabel={false} />
            </div>
            <div className="justify-self-end">
              {renderNormalizedScoreBadge(node.max_points > 0 ? node.raw_points / node.max_points : 0.25)}
            </div>
          </div>
          {isCriterion && criterionScore ? (
            <div className="ml-9 text-[11px] text-muted-foreground truncate">
              {criterionScore.reasoning}
            </div>
          ) : null}
          {node.level === "category" && isOpen && criterionChildren.length > 0 ? (
            <div className="rounded-md border bg-muted/20 divide-y" style={{ marginLeft: `${indentPx + 44}px` }}>
              {criterionChildren.map((criterionNode) => {
                const criterionItem = criterionNode.meta?.criterion_id ? criterionById.get(criterionNode.meta.criterion_id) : undefined;
                const criterionItemScore = criterionNode.meta?.criterion_id ? criterionScoresById.get(criterionNode.meta.criterion_id) : undefined;
                if (!criterionItemScore) return null;
                return (
                  <div key={`${treeKey}-${criterionNode.id}`} className="grid grid-cols-[minmax(0,1fr)_140px_84px] items-center gap-2 px-2 py-1.5">
                    <div className="min-w-0 grid grid-cols-[auto_minmax(180px,240px)_96px_72px_minmax(0,1fr)] items-center gap-1.5 text-xs">
                      <Badge variant="outline" className="text-[10px] font-normal capitalize">
                        Criteria
                      </Badge>
                      <span className="font-medium truncate">{criterionNode.label}</span>
                      <span className="inline-flex items-center">
                        {criterionItem
                          ? renderCriterionBadge(criterionItem, criterionItemScore.score, criterionNode.normalized_0_100)
                          : renderFallbackCriterionBadge(criterionNode.normalized_0_100)}
                      </span>
                      <Badge variant="outline" className="text-[10px] font-medium min-w-[62px] justify-center tabular-nums">
                        Wt: {toWeightTier(criterionItem?.weight ?? criterionNode.max_points)}
                      </Badge>
                      <span className="min-w-0 text-muted-foreground truncate">
                        "{criterionItemScore.reasoning}"
                      </span>
                    </div>
                    <div className="min-w-0">
                      <ScoreBar score={criterionNode.normalized_0_100} size="sm" showLabel={false} />
                    </div>
                    <div className="justify-self-end">
                      {renderNormalizedScoreBadge(criterionNode.max_points > 0 ? criterionNode.raw_points / criterionNode.max_points : 0.25)}
                    </div>
                  </div>
                );
              })}
            </div>
          ) : null}
          {isExpandable && isOpen && nonCriterionChildren.length > 0 ? (
            <div className="space-y-1">
              {nonCriterionChildren.map((child) => renderRows(child.id, depth + 1))}
            </div>
          ) : null}
        </div>
      );
    };

    return (
      <div className="space-y-2">
        <div className="grid grid-cols-[auto_minmax(0,1fr)_140px_84px] gap-2 px-2 text-[10px] uppercase tracking-wide text-muted-foreground">
          <span />
          <span>Evaluation Hierarchy</span>
          <span />
          <span className="text-right">Score</span>
        </div>
        <div className="space-y-1">
          {rootNodeIds.map((rootId) => renderRows(rootId, 0))}
        </div>
      </div>
    );
  };

  const getRunProducts = (run: EvalRun) => {
    if (run.product_results && run.product_results.length > 0) {
      return run.product_results.map((result, index) => ({
        ...result,
        _key: `${run.id}::${result.product_copy_id}::${index}`,
      }));
    }
    return [
      {
        product_copy_id: run.product_copy_id,
        overall_score: run.overall_score,
        category_scores: run.category_scores,
        criterion_scores: run.criterion_scores,
        hierarchical_scores: run.hierarchical_scores,
        root_node_ids: run.root_node_ids,
        _key: `${run.id}::${run.product_copy_id}`,
      },
    ];
  };

  const toggleHistoryProduct = (productKey: string, nextOpen: boolean) => {
    setOpenHistoryProducts((prev) => ({
      ...prev,
      [productKey]: nextOpen,
    }));
  };

  const formatRunDateTime = (run: EvalRun) =>
    new Date(run.completed_at || run.started_at).toLocaleString(undefined, {
      dateStyle: "medium",
      timeStyle: "short",
    });

  const toggleRunInputSection = (runId: string) => {
    setOpenRunInputByRun((prev) => ({
      ...prev,
      [runId]: !(prev[runId] ?? false),
    }));
  };

  const renderRunInputHeaderControl = (run: EvalRun) => {
    const input = run.input_summary;
    if (!input) return null;

    if (input.source === "import") {
      if (!input.import_file_name) return null;
      return <Badge variant="outline" className="text-[10px]">{input.import_file_name}</Badge>;
    }

    const isOpen = openRunInputByRun[run.id] ?? false;
    return (
      <Button type="button" variant="outline" size="sm" className="h-7 px-2 text-[11px]" onClick={() => toggleRunInputSection(run.id)}>
        Content (pasted)
        {isOpen ? <ChevronUp className="h-3.5 w-3.5 ml-1" /> : <ChevronDown className="h-3.5 w-3.5 ml-1" />}
      </Button>
    );
  };

  const renderRunInputExpandedContent = (run: EvalRun) => {
    const input = run.input_summary;
    if (!input || input.source !== "paste") return null;
    const isOpen = openRunInputByRun[run.id] ?? false;
    if (!isOpen) return null;

    return (
      <Collapsible open={isOpen}>
        <CollapsibleContent forceMount className="rounded-md border p-2 space-y-2">
          {input.products.map((product, index) => (
            <div key={`${run.id}-input-${index}`} className="rounded border p-2 space-y-1">
              <p className="text-xs font-medium">{product.product_name}</p>
              <div className="space-y-1">
                {product.entries.map((entry, entryIndex) => (
                  <div key={`${run.id}-input-${index}-${entryIndex}`} className="flex items-start gap-1.5">
                    <Badge variant="outline" className="text-[10px] shrink-0">{entry.content_type}</Badge>
                    <span className="text-[11px] text-muted-foreground truncate">{entry.raw_text}</span>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </CollapsibleContent>
      </Collapsible>
    );
  };

  const buildAllProductsAggregate = (products: Array<ReturnType<typeof getRunProducts>[number]>) => {
    if (products.length <= 1) return null;

    const nodeMap: Record<string, EvalRunScoreNode> = {};
    const rootNodeOrder: string[] = [];
    const criterionAccumulator = new Map<
      string,
      { scoreTotal: number; normalizedTotal: number; count: number }
    >();

    products.forEach((product) => {
      const hierarchy = getRunHierarchy(product);
      hierarchy.rootNodeIds.forEach((rootId) => {
        if (!rootNodeOrder.includes(rootId)) rootNodeOrder.push(rootId);
      });

      Object.values(hierarchy.nodes).forEach((node) => {
        const existing = nodeMap[node.id];
        if (!existing) {
          nodeMap[node.id] = {
            ...node,
            children_ids: [...node.children_ids],
            raw_points: node.raw_points,
            max_points: node.max_points,
            normalized_0_100: 0,
          };
        } else {
          existing.raw_points += node.raw_points;
          existing.max_points += node.max_points;
        }
      });

      product.criterion_scores.forEach((entry) => {
        const existing = criterionAccumulator.get(entry.criterion_id);
        if (!existing) {
          criterionAccumulator.set(entry.criterion_id, {
            scoreTotal: entry.score,
            normalizedTotal: entry.normalized_score,
            count: 1,
          });
          return;
        }
        existing.scoreTotal += entry.score;
        existing.normalizedTotal += entry.normalized_score;
        existing.count += 1;
      });
    });

    Object.values(nodeMap).forEach((node) => {
      node.normalized_0_100 = node.max_points > 0 ? (node.raw_points / node.max_points) * 100 : 0;
    });

    const aggregatedCriterionScores: EvalRun["criterion_scores"] = Array.from(criterionAccumulator.entries()).map(
      ([criterionId, values]) => {
        const criterion = criterionById.get(criterionId);
        const avgNormalized = values.count > 0 ? values.normalizedTotal / values.count : 0;
        let averagedScore = values.count > 0 ? values.scoreTotal / values.count : 0;
        if (criterion?.criteria_type === "yes-no") averagedScore = avgNormalized >= 62.5 ? 1 : 0;
        if (criterion?.criteria_type === "numerical-scale") averagedScore = Math.max(1, Math.min(4, Math.round(avgNormalized / 25)));
        if (criterion?.criteria_type === "numerical-count") averagedScore = Math.max(0, Math.min(3, Math.round(avgNormalized / 25) - 1));
        return {
          criterion_id: criterionId,
          score: averagedScore,
          normalized_score: avgNormalized,
          reasoning: `Average across ${products.length} products in this batch.`,
        };
      },
    );

    const rootTotals = rootNodeOrder.reduce(
      (acc, rootId) => {
        const rootNode = nodeMap[rootId];
        if (!rootNode) return acc;
        return { raw: acc.raw + rootNode.raw_points, max: acc.max + rootNode.max_points };
      },
      { raw: 0, max: 0 },
    );
    const overallScore = rootTotals.max > 0 ? (rootTotals.raw / rootTotals.max) * 100 : null;

    return {
      product_copy_id: "all-products",
      overall_score: overallScore,
      criterion_scores: aggregatedCriterionScores,
      hierarchical_scores: nodeMap,
      root_node_ids: rootNodeOrder,
    };
  };

  const renderVersion1ProductList = (
    products: Array<ReturnType<typeof getRunProducts>[number]>,
    listKeyPrefix: string,
    defaultExpandFirst = false,
  ) => (
    <div className="space-y-2 w-full max-w-[1600px] mx-auto">
      {(() => {
        const aggregate = buildAllProductsAggregate(products);
        if (!aggregate) return null;
        const aggregateKey = `${listKeyPrefix}::all-products`;
        const isExpanded = openHistoryProducts[aggregateKey] ?? defaultExpandFirst;
        const aggregateHierarchy = getRunHierarchy(aggregate);
        return (
          <div key={aggregateKey} className="rounded-md border">
            <button
              type="button"
              onClick={() => toggleHistoryProduct(aggregateKey, !isExpanded)}
              className="w-full px-3 py-2"
            >
              <div className="flex items-center justify-between gap-3">
                <div className="flex items-center gap-2 text-left min-w-0">
                  {isExpanded ? <ChevronDown className="h-4 w-4 text-muted-foreground" /> : <ChevronRight className="h-4 w-4 text-muted-foreground" />}
                  <span className="text-base font-semibold truncate">All Products</span>
                </div>
                <div className="flex items-center gap-2">
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    className="h-8 w-8"
                    aria-label="Download All Products aggregate"
                    title="Download"
                    onClick={(event) => event.stopPropagation()}
                  >
                    <Download className="h-4 w-4 text-muted-foreground" />
                  </Button>
                  {aggregate.overall_score !== null ? (
                    <div className="h-9 w-9 rounded-full border-2 border-score-excellent bg-score-excellent/10 text-score-excellent text-sm font-bold tabular-nums flex items-center justify-center">
                      {Math.round(aggregate.overall_score)}
                    </div>
                  ) : null}
                </div>
              </div>
            </button>
            {isExpanded ? (
              <div className="px-3 pb-3 pt-1 border-t">
                {renderVersion1Compact(
                  aggregate.criterion_scores,
                  aggregateHierarchy.nodes,
                  aggregateHierarchy.rootNodeIds,
                  `${aggregateKey}::tree`,
                )}
              </div>
            ) : null}
          </div>
        );
      })()}
      {products.map((product, index) => {
        const productKey = `${listKeyPrefix}::${product._key}`;
        const isExpanded = openHistoryProducts[productKey] ?? (defaultExpandFirst && index === 0);
        const productCopy = MOCK_COPIES.find((candidate) => candidate.id === product.product_copy_id);
        const productHierarchy = getRunHierarchy(product);

        return (
          <div key={productKey} className="rounded-md border">
            <button
              type="button"
              onClick={() => toggleHistoryProduct(productKey, !isExpanded)}
              className="w-full px-3 py-2"
            >
              <div className="flex items-center justify-between gap-3">
                <div className="flex items-center gap-2 text-left min-w-0">
                  {isExpanded ? <ChevronDown className="h-4 w-4 text-muted-foreground" /> : <ChevronRight className="h-4 w-4 text-muted-foreground" />}
                  <span className="text-base font-semibold truncate">{productCopy?.product_name || product.product_copy_id}</span>
                </div>
                <div className="flex items-center gap-2">
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    className="h-8 w-8"
                    aria-label={`Download ${productCopy?.product_name || product.product_copy_id}`}
                    title="Download"
                    onClick={(event) => event.stopPropagation()}
                  >
                    <Download className="h-4 w-4 text-muted-foreground" />
                  </Button>
                  {product.overall_score !== null ? (
                    <div className="h-9 w-9 rounded-full border-2 border-score-excellent bg-score-excellent/10 text-score-excellent text-sm font-bold tabular-nums flex items-center justify-center">
                      {Math.round(product.overall_score)}
                    </div>
                  ) : null}
                </div>
              </div>
            </button>
            {isExpanded ? (
              <div className="px-3 pb-3 pt-1 border-t">
                {renderVersion1Compact(
                  product.criterion_scores,
                  productHierarchy.nodes,
                  productHierarchy.rootNodeIds,
                  `${productKey}::tree`,
                )}
              </div>
            ) : null}
          </div>
        );
      })}
    </div>
  );

  const historyBrandOptions = useMemo(
    () =>
      Array.from(
        new Set(
          MOCK_RUNS.map((run) => run.brand?.trim())
            .filter((brand): brand is string => Boolean(brand)),
        ),
      ).sort((a, b) => a.localeCompare(b)),
    [],
  );

  const historySuiteOptions = useMemo(
    () =>
      Array.from(new Set(MOCK_RUNS.map((run) => run.suite_id)))
        .map((suiteId) => ({
          id: suiteId,
          name: MOCK_SUITES.find((suite) => suite.id === suiteId)?.name || suiteId,
        }))
        .sort((a, b) => a.name.localeCompare(b.name)),
    [],
  );

  const filteredHistoryRuns = useMemo(() => {
    const normalizedTitleQuery = historyTitleQuery.trim().toLowerCase();
    return [...MOCK_RUNS]
      .filter((run) => {
        const title = (run.evaluation_title || "").toLowerCase();
        const titleMatches = normalizedTitleQuery.length === 0 || title.includes(normalizedTitleQuery);
        const brandMatches = historyBrandFilter === "all" || (run.brand || "") === historyBrandFilter;
        const suiteMatches = historySuiteFilter === "all" || run.suite_id === historySuiteFilter;
        return titleMatches && brandMatches && suiteMatches;
      })
      .sort((a, b) => {
        if (historySortBy === "date_desc") {
          return new Date(b.completed_at || b.started_at).getTime() - new Date(a.completed_at || a.started_at).getTime();
        }
        if (historySortBy === "date_asc") {
          return new Date(a.completed_at || a.started_at).getTime() - new Date(b.completed_at || b.started_at).getTime();
        }
        const titleA = (a.evaluation_title || "").toLowerCase();
        const titleB = (b.evaluation_title || "").toLowerCase();
        if (historySortBy === "title_asc") return titleA.localeCompare(titleB);
        return titleB.localeCompare(titleA);
      });
  }, [historyTitleQuery, historyBrandFilter, historySuiteFilter, historySortBy]);

  return (
    <div className="p-6 space-y-6 animate-fade-in">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Evaluate</h1>
      </div>

      {/* Run configuration */}
      <Card className="shadow-card">
        <CardHeader className="py-3">
          <button
            type="button"
            className="w-full h-8 flex items-center justify-between text-left"
            onClick={() => setIsNewEvaluationRunOpen((prev) => !prev)}
            aria-expanded={isNewEvaluationRunOpen}
            aria-label={isNewEvaluationRunOpen ? "Collapse New Evaluation Run" : "Expand New Evaluation Run"}
          >
            <CardTitle className="text-base">New Evaluation Run</CardTitle>
            {isNewEvaluationRunOpen ? <ChevronUp className="h-4 w-4 text-muted-foreground" /> : <ChevronDown className="h-4 w-4 text-muted-foreground" />}
          </button>
        </CardHeader>
        {isNewEvaluationRunOpen ? (
        <CardContent className="space-y-3">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
            <div className="space-y-1">
              <label className="text-[11px] font-semibold text-foreground">Evaluation Title</label>
              <Input
                className="h-9"
                placeholder="e.g. March PDP QA Evaluation"
                value={runName}
                onChange={(e) => setRunName(e.target.value)}
              />
            </div>
            <div className="space-y-1">
              <label className="text-[11px] font-semibold text-foreground">Brand</label>
              <Input
                className="h-9"
                placeholder="Type brand"
                value={runBrand}
                onChange={(e) => setRunBrand(e.target.value)}
              />
            </div>
          </div>

          {/* Product copy selection — always visible */}
          <div className="space-y-1.5">
            <label className="text-[11px] font-semibold text-foreground">Content for Evaluation</label>
            <Tabs value={copySource} onValueChange={(v) => setCopySource(v as "import" | "paste")}>
              <div className="flex items-center justify-between gap-2">
                <TabsList className="h-9">
                  <TabsTrigger value="import">Import</TabsTrigger>
                  <TabsTrigger value="paste">Paste</TabsTrigger>
                </TabsList>
                {copySource === "paste" ? (
                  <Button type="button" variant="outline" size="sm" onClick={addPasteProduct} className="h-9 gap-1.5 px-3">
                    <Plus className="h-3.5 w-3.5" />
                    Add product
                  </Button>
                ) : null}
              </div>

              <TabsContent value="import" className="mt-2">
                <div className="space-y-2 rounded-md border p-3">
                  <p className="text-xs text-muted-foreground">
                    Import column format: product name (required), title (optional), description (optional),
                    bullets/specs (optional), meta description (optional).
                  </p>
                  <Input
                    type="file"
                    accept=".txt,.md,.csv,.json"
                    onChange={handleImportFile}
                  />
                  {importFileName && <p className="text-xs text-muted-foreground">Loaded: {importFileName}</p>}
                  {importError && <p className="text-xs text-destructive">{importError}</p>}
                </div>
              </TabsContent>

              <TabsContent value="paste" className="mt-2 space-y-2">
                <div className="space-y-2">
                  {pasteProducts.map((product, productIndex) => (
                    <div key={product.id} className="rounded-md border">
                      <div className="w-full px-2.5 py-2 border-b flex items-center justify-between gap-2">
                        <button
                          type="button"
                          onClick={() => togglePasteProductExpanded(product.id)}
                          className="flex items-center gap-2 text-left min-w-0 flex-1"
                        >
                          {product.isExpanded ? <ChevronDown className="h-4 w-4 text-muted-foreground" /> : <ChevronRight className="h-4 w-4 text-muted-foreground" />}
                          <span className="text-sm font-medium truncate">
                            {product.name.trim() || `Product ${productIndex + 1}`}
                          </span>
                        </button>
                        <Button
                          type="button"
                          variant="outline"
                          size="icon"
                          onClick={() => removePasteProduct(product.id)}
                          disabled={pasteProducts.length === 1}
                          className="h-8 w-8"
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </Button>
                      </div>
                      {product.isExpanded ? (
                        <div className="space-y-2 p-2.5">
                          <div>
                            <Input
                              className="h-9"
                              placeholder="Product name"
                              value={product.name}
                              onChange={(e) => updatePasteProductName(product.id, e.target.value)}
                            />
                          </div>
                          <div className="space-y-2">
                            {product.contentEntries.map((entry, entryIndex) => (
                              <div key={entry.id} className={`space-y-2 ${entryIndex > 0 ? "pt-2 border-t" : ""}`}>
                                <div className="flex flex-wrap items-center gap-2">
                                  <div className="min-w-[220px] flex-1">
                                    <Select
                                      value={entry.contentType}
                                      onValueChange={(value) =>
                                        updateProductContentEntry(product.id, entry.id, { contentType: value as ContentType })
                                      }
                                    >
                                      <SelectTrigger className="h-9"><SelectValue placeholder="Content type" /></SelectTrigger>
                                      <SelectContent>
                                        {CONTENT_TYPES.map((ct) => (
                                          <SelectItem
                                            key={`paste-product-${product.id}-entry-${entry.id}-${ct}`}
                                            value={ct}
                                            disabled={contentTypeUsedByOtherEntry(product.id, entry.id, ct)}
                                          >
                                            {ct}
                                          </SelectItem>
                                        ))}
                                      </SelectContent>
                                    </Select>
                                  </div>
                                  <Button
                                    type="button"
                                    variant="outline"
                                    size="icon"
                                    onClick={() => addProductContentEntry(product.id)}
                                    className="h-9 w-9"
                                  >
                                    <Plus className="h-4 w-4" />
                                  </Button>
                                  <Button
                                    type="button"
                                    variant="outline"
                                    size="icon"
                                    onClick={() => removeProductContentEntry(product.id, entry.id)}
                                    disabled={product.contentEntries.length === 1}
                                    className="h-9 w-9"
                                  >
                                    <Trash2 className="h-4 w-4" />
                                  </Button>
                                </div>
                                <Textarea
                                  rows={3}
                                  placeholder={`Paste or type ${entry.contentType} content here...`}
                                  value={entry.text}
                                  onChange={(e) => updateProductContentEntry(product.id, entry.id, { text: e.target.value })}
                                />
                              </div>
                            ))}
                          </div>
                        </div>
                      ) : null}
                    </div>
                  ))}
                </div>
              </TabsContent>
            </Tabs>
          </div>

          {/* Tabs: Suite vs Hierarchy */}
          <Tabs value={selectionMode} onValueChange={setSelectionMode}>
            <label className="block text-[11px] font-semibold text-foreground mb-1">Criteria</label>
            <TabsList className="h-9">
              <TabsTrigger value="suite">Select Suite</TabsTrigger>
              <TabsTrigger value="hierarchy">Playground</TabsTrigger>
            </TabsList>

            <TabsContent value="suite" className="mt-3">
              <div className="space-y-1.5 max-w-md">
                <Select value={selectedSuite} onValueChange={setSelectedSuite}>
                  <SelectTrigger className="h-9"><SelectValue placeholder="Select suite" /></SelectTrigger>
                  <SelectContent>
                    {MOCK_SUITES.map(s => (
                      <SelectItem key={s.id} value={s.id}>{s.name}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </TabsContent>

            <TabsContent value="hierarchy" className="mt-3 space-y-4">
              <div className="space-y-4">
                <div className="space-y-2">
                  <label className="text-xs font-medium text-muted-foreground">Context</label>
                  <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
                    {runtimeTaxonomy.contexts.map((ctx) => (
                      <Button
                        key={ctx}
                        type="button"
                        variant={selectedContexts.has(ctx) ? "default" : "outline"}
                        className={`${contextButtonBase} ${selectedContexts.has(ctx) ? contextButtonActive : contextButtonInactive}`}
                        onClick={() => toggleSetValue(ctx, setSelectedContexts)}
                      >
                        {ctx}
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
                  <label className="text-xs font-medium text-muted-foreground">Content Type</label>
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
                  {displayedCategories.length === 0 ? (
                    <p className="text-xs text-muted-foreground">No categories available for the selected filters.</p>
                  ) : (
                    displayedCategories.map(category => {
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
                    })
                  )}
                </div>
              </div>
            </TabsContent>
          </Tabs>

          <Button
            onClick={handleRunEval}
            disabled={!canRun}
            className="h-9 gap-2"
          >
            <Play className="h-4 w-4" /> Run Evaluation
          </Button>
        </CardContent>
        ) : null}
      </Card>

      {/* Past runs */}
      <div className="space-y-3">
        <h2 className="text-lg font-semibold">Evaluation History</h2>
        <Card className="shadow-card">
          <CardContent className="p-3 grid grid-cols-1 md:grid-cols-4 gap-2">
            <Input
              className="h-9"
              placeholder="Search evaluation title"
              value={historyTitleQuery}
              onChange={(event) => setHistoryTitleQuery(event.target.value)}
            />
            <Select value={historyBrandFilter} onValueChange={setHistoryBrandFilter}>
              <SelectTrigger className="h-9">
                <SelectValue placeholder="Filter by brand" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All brands</SelectItem>
                {historyBrandOptions.map((brand) => (
                  <SelectItem key={`history-brand-${brand}`} value={brand}>
                    {brand}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Select value={historySuiteFilter} onValueChange={setHistorySuiteFilter}>
              <SelectTrigger className="h-9">
                <SelectValue placeholder="Filter by suite" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All suites</SelectItem>
                {historySuiteOptions.map((suite) => (
                  <SelectItem key={`history-suite-${suite.id}`} value={suite.id}>
                    {suite.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Select value={historySortBy} onValueChange={(value) => setHistorySortBy(value as "date_desc" | "date_asc" | "title_asc" | "title_desc")}>
              <SelectTrigger className="h-9">
                <SelectValue placeholder="Sort by" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="date_desc">Date: Most Recent to Oldest</SelectItem>
                <SelectItem value="date_asc">Date: Oldest to Most Recent</SelectItem>
                <SelectItem value="title_asc">Title: A to Z</SelectItem>
                <SelectItem value="title_desc">Title: Z to A</SelectItem>
              </SelectContent>
            </Select>
          </CardContent>
        </Card>
        {filteredHistoryRuns.length === 0 ? (
          <Card className="shadow-card">
            <CardContent className="p-4 text-sm text-muted-foreground">No evaluation runs match the current filters.</CardContent>
          </Card>
        ) : null}
        {filteredHistoryRuns.map((run, index) => {
          const runProducts = getRunProducts(run);
          const runDateLabel = run.completed_at ? "Ran" : "Started";

          return (
            <Card key={run.id} className="shadow-card">
              <CardContent className="p-4 space-y-3">
                <div className="space-y-1">
                  <div className="flex items-start justify-between gap-2">
                    <div className="flex items-center gap-1.5">
                      <p className="text-sm font-semibold">{run.evaluation_title || "Evaluation Run"}</p>
                      {run.brand ? (
                        <Badge variant="outline" className="text-[10px]">Brand: {run.brand}</Badge>
                      ) : null}
                    </div>
                    {renderRunInputHeaderControl(run)}
                  </div>
                  <p className="text-xs text-muted-foreground">
                    {runDateLabel} {formatRunDateTime(run)} · {runProducts.length} product{runProducts.length === 1 ? "" : "s"}
                  </p>
                </div>
                {renderRunInputExpandedContent(run)}
                {renderVersion1ProductList(runProducts, `${run.id}::history`, index === 0)}
              </CardContent>
            </Card>
          );
        })}
      </div>
    </div>
  );
};

export default EvaluatePage;
