import { useEffect, useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectSeparator, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Plus, Trash2 } from "lucide-react";
import type { Criterion, CriteriaType, ContentType } from "@/types";

interface AddCriterionDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onAdd: (criterion: Criterion) => void;
  onUpdate?: (criterion: Criterion) => void;
  initialCriterion?: Criterion | null;
  contextOptions: string[];
  contentTypeOptions: string[];
  criteriaCategoriesByContextAndContentType: Record<string, Record<string, string[]>>;
  criteriaCategoriesByContextBranchAndContentType: Record<string, Record<string, Record<string, string[]>>>;
  branchTags: {
    brands: string[];
    industries: string[];
    marketplaces: string[];
  };
  onAddBranchTag: (branchType: "brands" | "industries" | "marketplaces", tag: string) => void;
  onAddCategoryForContextAndContentType: (context: string, contentType: string, category: string, branchTag?: string) => void;
}

interface ScaleExample {
  title: string;
  definition: string;
  examples: string[];
}

type AddTagTarget =
  | { type: "branch"; branchType: "brands" | "industries" | "marketplaces" }
  | { type: "category"; context: string; contentType: string; branchTag?: string };

const COUNT_BUCKETS = ["0", "1", "2", "3+"] as const;

const getAddTagTargetLabel = (target: AddTagTarget) => {
  if (target.type === "branch") {
    if (target.branchType === "brands") return "Brand";
    if (target.branchType === "industries") return "Industry";
    return "Marketplace";
  }
  return "Category";
};

export const AddCriterionDialog = ({
  open,
  onOpenChange,
  onAdd,
  onUpdate,
  initialCriterion,
  contextOptions,
  contentTypeOptions,
  criteriaCategoriesByContextAndContentType,
  criteriaCategoriesByContextBranchAndContentType,
  branchTags,
  onAddBranchTag,
  onAddCategoryForContextAndContentType,
}: AddCriterionDialogProps) => {
  const [name, setName] = useState("");
  const [criteriaType, setCriteriaType] = useState<CriteriaType>("yes-no");
  const [context, setContext] = useState<string>("");
  const [branchTag, setBranchTag] = useState("");
  const [contentType, setContentType] = useState<ContentType | "">("");
  const [category, setCategory] = useState<string>("");
  const [definition, setDefinition] = useState("");
  const [weight, setWeight] = useState("1");
  const [showTagValidation, setShowTagValidation] = useState(false);

  const [addTagOpen, setAddTagOpen] = useState(false);
  const [addTagTarget, setAddTagTarget] = useState<AddTagTarget>({ type: "branch", branchType: "brands" });
  const [newTagName, setNewTagName] = useState("");

  const [definitionYes, setDefinitionYes] = useState("");
  const [definitionNo, setDefinitionNo] = useState("");
  const [yesExamples, setYesExamples] = useState<string[]>([""]);
  const [noExamples, setNoExamples] = useState<string[]>([""]);

  const [scaleScores, setScaleScores] = useState<ScaleExample[]>([
    { title: "", definition: "", examples: [""] },
    { title: "", definition: "", examples: [""] },
    { title: "", definition: "", examples: [""] },
    { title: "", definition: "", examples: [] },
  ]);

  const [buckets] = useState<string[]>([...COUNT_BUCKETS]);
  const [bucketTitles, setBucketTitles] = useState<Record<string, string>>({
    "0": "",
    "1": "",
    "2": "",
    "3+": "",
  });
  const [bucketDefs, setBucketDefs] = useState<Record<string, string>>({ "0": "", "1": "", "2": "", "3+": "" });
  const [bucketExamples, setBucketExamples] = useState<Record<string, string[]>>({
    "0": [""],
    "1": [""],
    "2": [""],
    "3+": [""],
  });

  const resetForm = () => {
    setName("");
    setCriteriaType("yes-no");
    setContext("");
    setBranchTag("");
    setContentType("");
    setCategory("");
    setDefinition("");
    setWeight("1");
    setShowTagValidation(false);
    setAddTagOpen(false);
    setAddTagTarget({ type: "branch", branchType: "brands" });
    setNewTagName("");

    setDefinitionYes("");
    setDefinitionNo("");
    setYesExamples([""]);
    setNoExamples([""]);
    setScaleScores([
      { title: "", definition: "", examples: [""] },
      { title: "", definition: "", examples: [""] },
      { title: "", definition: "", examples: [""] },
      { title: "", definition: "", examples: [] },
    ]);
    setBucketTitles({ "0": "", "1": "", "2": "", "3+": "" });
    setBucketDefs({ "0": "", "1": "", "2": "", "3+": "" });
    setBucketExamples({ "0": [""], "1": [""], "2": [""], "3+": [""] });
  };

  const requiresBranch = context === "Brand" || context === "Industry" || context === "Marketplace";
  const selectedBranchType =
    context === "Brand"
      ? "brands"
      : context === "Industry"
        ? "industries"
        : context === "Marketplace"
          ? "marketplaces"
          : null;

  useEffect(() => {
    if (!open) return;

    if (!initialCriterion) {
      resetForm();
      return;
    }

    setName(initialCriterion.criteria_name);
    setCriteriaType(initialCriterion.criteria_type);
    setContext(initialCriterion.context);
    setContentType(initialCriterion.content_type);
    setCategory(initialCriterion.criteria_category);
    setDefinition(initialCriterion.criteria_definition);
    setWeight(String(Math.min(3, Math.max(1, Math.round(initialCriterion.weight)))));
    setShowTagValidation(false);

    if (initialCriterion.context === "Brand") {
      setBranchTag(initialCriterion.brand_tag || initialCriterion.custom_tags?.Brand?.[0] || "");
    } else if (initialCriterion.context === "Industry") {
      setBranchTag(initialCriterion.industry_tag || initialCriterion.custom_tags?.Industry?.[0] || "");
    } else if (initialCriterion.context === "Marketplace") {
      setBranchTag(initialCriterion.marketplace_tag || initialCriterion.custom_tags?.Marketplace?.[0] || "");
    } else {
      setBranchTag("");
    }

    if (initialCriterion.criteria_type === "yes-no") {
      const yesNo = initialCriterion.eval_definition as {
        definition_yes?: string;
        definition_no?: string;
        yes_examples?: string[];
        no_examples?: string[];
      };
      setDefinitionYes(yesNo.definition_yes || "");
      setDefinitionNo(yesNo.definition_no || "");
      setYesExamples(yesNo.yes_examples?.length ? yesNo.yes_examples : [""]);
      setNoExamples(yesNo.no_examples?.length ? yesNo.no_examples : [""]);
      return;
    }

    if (initialCriterion.criteria_type === "numerical-scale") {
      const scale = initialCriterion.eval_definition as Record<
        string,
        { title?: string; definition?: string; example_1?: string; example_2?: string }
      >;
      setScaleScores([1, 2, 3, 4].map((score) => {
        const entry = scale[`score_${score}`];
        const examples = [entry?.example_1, entry?.example_2].filter(Boolean) as string[];
        return {
          title: entry?.title || "",
          definition: entry?.definition || "",
          examples: examples.length ? examples : score < 4 ? [""] : [],
        };
      }));
      return;
    }

    const count = initialCriterion.eval_definition as {
      buckets?: string[];
      bucket_titles?: Record<string, string>;
      bucket_definitions?: Record<string, string>;
      bucket_examples?: Record<string, string[]>;
    };
    const nextBuckets = count.buckets?.length ? count.buckets : [...COUNT_BUCKETS];
    setBucketTitles(Object.fromEntries(nextBuckets.map((bucket) => [bucket, count.bucket_titles?.[bucket] || ""])));
    setBucketDefs(Object.fromEntries(nextBuckets.map((bucket) => [bucket, count.bucket_definitions?.[bucket] || ""])));
    setBucketExamples(
      Object.fromEntries(nextBuckets.map((bucket) => [bucket, count.bucket_examples?.[bucket]?.length ? count.bucket_examples[bucket] : [""]])),
    );
  }, [open, initialCriterion, contextOptions, contentTypeOptions, criteriaCategoriesByContextAndContentType]);

  useEffect(() => {
    if (!open) return;
    if (context && !contextOptions.includes(context)) setContext("");
    if (contentType && !contentTypeOptions.includes(contentType)) setContentType("");
    const activeCategories = requiresBranch && branchTag
      ? criteriaCategoriesByContextBranchAndContentType[context]?.[branchTag]?.[contentType] || []
      : criteriaCategoriesByContextAndContentType[context]?.[contentType] || [];
    if (
      contentType &&
      category &&
      !activeCategories.includes(category)
    ) {
      setCategory("");
    }
  }, [
    open,
    context,
    contentType,
    category,
    branchTag,
    requiresBranch,
    contextOptions,
    contentTypeOptions,
    criteriaCategoriesByContextAndContentType,
    criteriaCategoriesByContextBranchAndContentType,
  ]);

  const isAddTagValue = (value: string) => value.startsWith("__add_tag__");

  const openAddTagDialog = (target: AddTagTarget) => {
    setAddTagTarget(target);
    setNewTagName("");
    setAddTagOpen(true);
  };

  const handleContextChange = (value: string) => {
    if (value === context) return;
    setContext(value);
    setBranchTag("");
    if (contentType) {
      const nextCategoryOptions = criteriaCategoriesByContextAndContentType[value]?.[contentType] || [];
      if (!nextCategoryOptions.includes(category)) setCategory("");
    } else {
      setCategory("");
    }
  };

  const handleAddTagSubmit = () => {
    const tag = newTagName.trim();
    if (!tag) return;

    if (addTagTarget.type === "branch") {
      onAddBranchTag(addTagTarget.branchType, tag);
      setBranchTag(tag);
    } else {
      onAddCategoryForContextAndContentType(addTagTarget.context, addTagTarget.contentType, tag, addTagTarget.branchTag);
      setCategory(tag);
    }

    setAddTagOpen(false);
    setNewTagName("");
  };

  const updateScaleScore = (index: number, field: "title" | "definition", value: string) => {
    setScaleScores((prev) => prev.map((score, i) => (i === index ? { ...score, [field]: value } : score)));
  };

  const addScaleExample = (index: number) => {
    setScaleScores((prev) => prev.map((score, i) => (i === index ? { ...score, examples: [...score.examples, ""] } : score)));
  };

  const updateScaleExample = (scoreIdx: number, exIdx: number, value: string) => {
    setScaleScores((prev) =>
      prev.map((score, i) =>
        i === scoreIdx ? { ...score, examples: score.examples.map((example, j) => (j === exIdx ? value : example)) } : score,
      ),
    );
  };

  const removeScaleExample = (scoreIdx: number, exIdx: number) => {
    setScaleScores((prev) =>
      prev.map((score, i) => (i === scoreIdx ? { ...score, examples: score.examples.filter((_, j) => j !== exIdx) } : score)),
    );
  };

  const addYesNoExample = (field: "yes" | "no") => {
    if (field === "yes") {
      setYesExamples((prev) => [...prev, ""]);
      return;
    }
    setNoExamples((prev) => [...prev, ""]);
  };

  const updateYesNoExample = (field: "yes" | "no", index: number, value: string) => {
    if (field === "yes") {
      setYesExamples((prev) => prev.map((example, i) => (i === index ? value : example)));
      return;
    }
    setNoExamples((prev) => prev.map((example, i) => (i === index ? value : example)));
  };

  const removeYesNoExample = (field: "yes" | "no", index: number) => {
    if (field === "yes") {
      setYesExamples((prev) => prev.filter((_, i) => i !== index));
      return;
    }
    setNoExamples((prev) => prev.filter((_, i) => i !== index));
  };

  const addBucketExample = (bucket: string) => {
    setBucketExamples((prev) => ({ ...prev, [bucket]: [...(prev[bucket] || []), ""] }));
  };

  const updateBucketExample = (bucket: string, index: number, value: string) => {
    setBucketExamples((prev) => ({
      ...prev,
      [bucket]: (prev[bucket] || []).map((example, i) => (i === index ? value : example)),
    }));
  };

  const removeBucketExample = (bucket: string, index: number) => {
    setBucketExamples((prev) => ({
      ...prev,
      [bucket]: (prev[bucket] || []).filter((_, i) => i !== index),
    }));
  };

  const branchLabel =
    selectedBranchType === "brands"
      ? "Brand"
      : selectedBranchType === "industries"
        ? "Industry"
        : selectedBranchType === "marketplaces"
          ? "Marketplace"
          : "";
  const branchOptions = selectedBranchType ? branchTags[selectedBranchType] || [] : [];
  const categoryOptions = context && contentType
    ? (requiresBranch && branchTag
      ? criteriaCategoriesByContextBranchAndContentType[context]?.[branchTag]?.[contentType] || []
      : criteriaCategoriesByContextAndContentType[context]?.[contentType] || [])
    : [];
  const canSubmit =
    !!name.trim() &&
    !!context.trim() &&
    !!contentType.trim() &&
    !!category.trim() &&
    (!requiresBranch || !!branchTag.trim());

  const buildEvalDefinition = () => {
    if (criteriaType === "yes-no") {
      return {
        definition_yes: definitionYes,
        definition_no: definitionNo,
        yes_examples: yesExamples.map((example) => example.trim()).filter(Boolean),
        no_examples: noExamples.map((example) => example.trim()).filter(Boolean),
      };
    }

    if (criteriaType === "numerical-scale") {
      const result: Record<string, unknown> = {};
      scaleScores.forEach((score, i) => {
        const key = `score_${i + 1}`;
        const entry: Record<string, string> = { title: score.title, definition: score.definition };
        score.examples.forEach((example, j) => {
          if (example) entry[`example_${j + 1}`] = example;
        });
        result[key] = entry;
      });
      return result;
    }

    return {
      buckets,
      bucket_titles: bucketTitles,
      bucket_definitions: bucketDefs,
      bucket_examples: Object.fromEntries(
        buckets.map((bucket) => [
          bucket,
          (bucketExamples[bucket] || []).map((example) => example.trim()).filter(Boolean),
        ]),
      ),
    };
  };

  const handleSubmit = () => {
    if (!name.trim()) return;
    if (!canSubmit) {
      setShowTagValidation(true);
      return;
    }

    const now = new Date().toISOString();
    const criterion: Criterion = {
      id: initialCriterion?.id || name.toLowerCase().replace(/\s+/g, "-").replace(/[^a-z0-9-]/g, ""),
      customer: undefined,
      brand: undefined,
      context,
      brand_tag: context === "Brand" ? branchTag : undefined,
      industry_tag: context === "Industry" ? branchTag : undefined,
      marketplace_tag: context === "Marketplace" ? branchTag : undefined,
      content_type: contentType,
      criteria_category: category,
      criteria_name: name,
      criteria_definition: definition,
      criteria_type: criteriaType,
      eval_definition: buildEvalDefinition() as Criterion["eval_definition"],
      custom_tags: initialCriterion?.custom_tags,
      weight: Number(weight) || 1,
      active: initialCriterion?.active ?? true,
      created_at: initialCriterion?.created_at || now,
      updated_at: now,
    };

    if (initialCriterion && onUpdate) onUpdate(criterion);
    else onAdd(criterion);

    resetForm();
    onOpenChange(false);
  };

  return (
    <>
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className="max-w-2xl max-h-[85vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{initialCriterion ? "Edit Criterion" : "Add New Criterion"}</DialogTitle>
          </DialogHeader>

          <div className="space-y-4 py-2">
            <div className="space-y-1.5">
              <Label>Criteria Name</Label>
              <Input placeholder="e.g. Product Type Stated" value={name} onChange={(e) => setName(e.target.value)} />
            </div>

            <div className="space-y-1.5">
              <Label>Criteria Definition</Label>
              <Textarea
                placeholder="Describe what this criterion evaluates..."
                value={definition}
                onChange={(e) => setDefinition(e.target.value)}
              />
            </div>

            <div className="space-y-3 rounded-lg border p-4">
              <Label className="text-sm font-semibold">Managed Taxonomy Tags</Label>

              <div className="space-y-2">
                <Label>Context</Label>
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                  {contextOptions.map((option) => (
                    <Button
                      key={option}
                      type="button"
                      variant={context === option ? "default" : "outline"}
                      onClick={() => handleContextChange(option)}
                    >
                      {option}
                    </Button>
                  ))}
                </div>
                {showTagValidation && !context && (
                  <p className="text-xs text-destructive">Context is required.</p>
                )}
              </div>

              {requiresBranch && selectedBranchType && (
                <div className="space-y-1.5">
                  <Label>{branchLabel}</Label>
                  <Select
                    value={branchTag || "__none__"}
                    onValueChange={(value) => {
                      if (isAddTagValue(value)) {
                        openAddTagDialog({ type: "branch", branchType: selectedBranchType });
                        return;
                      }
                      setBranchTag(value === "__none__" ? "" : value);
                    }}
                  >
                    <SelectTrigger><SelectValue placeholder={`Select ${branchLabel}`} /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="__none__">Select {branchLabel}</SelectItem>
                      {branchOptions.map((option) => <SelectItem key={option} value={option}>{option}</SelectItem>)}
                      <SelectSeparator />
                      <SelectItem value={`__add_tag__${selectedBranchType}`}>+ Add {branchLabel} tag</SelectItem>
                    </SelectContent>
                  </Select>
                  {showTagValidation && !branchTag && (
                    <p className="text-xs text-destructive">{branchLabel} is required for {context} context.</p>
                  )}
                </div>
              )}

              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-1.5">
                  <Label>Content Type</Label>
                  <Select
                    value={contentType || "__none__"}
                    disabled={!context || (requiresBranch && !branchTag)}
                    onValueChange={(value) => {
                      const nextContentType = value === "__none__" ? "" : value;
                      const nextCategoryOptions = nextContentType
                        ? (requiresBranch && branchTag
                          ? criteriaCategoriesByContextBranchAndContentType[context]?.[branchTag]?.[nextContentType] || []
                          : criteriaCategoriesByContextAndContentType[context]?.[nextContentType] || [])
                        : [];
                      setContentType(nextContentType);
                      if (!nextContentType || !nextCategoryOptions.includes(category)) {
                        setCategory("");
                      }
                    }}
                  >
                    <SelectTrigger><SelectValue placeholder="Select content type" /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="__none__">Select content type</SelectItem>
                      {contentTypeOptions.map((option) => <SelectItem key={option} value={option}>{option}</SelectItem>)}
                    </SelectContent>
                  </Select>
                  {showTagValidation && !contentType && (
                    <p className="text-xs text-destructive">Content type is required.</p>
                  )}
                </div>
                <div className="space-y-1.5">
                  <Label>Category</Label>
                  <Select
                    value={category || "__none__"}
                    disabled={!context || !contentType}
                    onValueChange={(value) => {
                      if (isAddTagValue(value)) {
                        if (context && contentType) {
                          openAddTagDialog({
                            type: "category",
                            context,
                            contentType,
                            branchTag: requiresBranch ? branchTag : undefined,
                          });
                        }
                        return;
                      }
                      setCategory(value === "__none__" ? "" : value);
                    }}
                  >
                    <SelectTrigger><SelectValue placeholder="Select category" /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="__none__">Select category</SelectItem>
                      {categoryOptions.map((option) => <SelectItem key={option} value={option}>{option}</SelectItem>)}
                      <SelectSeparator />
                      <SelectItem value="__add_tag__category">+ Add category</SelectItem>
                    </SelectContent>
                  </Select>
                  {showTagValidation && !category && (
                    <p className="text-xs text-destructive">Category is required.</p>
                  )}
                </div>
              </div>
            </div>

            <div className="grid grid-cols-3 gap-4">
              <div className="col-span-2 space-y-1.5">
                <Label>Score Type</Label>
                <Select value={criteriaType} onValueChange={(value) => setCriteriaType(value as CriteriaType)}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="yes-no">Yes / No</SelectItem>
                    <SelectItem value="numerical-scale">Scale 1-4</SelectItem>
                    <SelectItem value="numerical-count">Count</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label>Weight</Label>
                <Select value={weight} onValueChange={setWeight}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="1">1 - Less important</SelectItem>
                    <SelectItem value="2">2 - Important</SelectItem>
                    <SelectItem value="3">3 - Most important</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>

            <div className="border rounded-lg p-4 space-y-4 bg-muted/30">
              <h4 className="text-sm font-semibold">Evaluation Definitions</h4>

              {criteriaType === "yes-no" && (
                <div className="space-y-3">
                  <div className="space-y-1.5">
                    <Label className="text-xs">Definition for "Yes"</Label>
                    <Textarea rows={2} placeholder="When should the score be Yes?" value={definitionYes} onChange={(e) => setDefinitionYes(e.target.value)} />
                    <div className="space-y-1.5">
                      {yesExamples.map((example, index) => (
                        <div key={`yes-${index}`} className="flex items-center gap-2">
                          <Input className="flex-1 text-xs" placeholder={`Yes example ${index + 1}`} value={example} onChange={(e) => updateYesNoExample("yes", index, e.target.value)} />
                          <Button type="button" variant="ghost" size="icon" className="h-7 w-7 shrink-0" onClick={() => removeYesNoExample("yes", index)}>
                            <Trash2 className="h-3 w-3" />
                          </Button>
                        </div>
                      ))}
                      <Button type="button" variant="ghost" size="sm" className="h-7 text-xs gap-1" onClick={() => addYesNoExample("yes")}>
                        <Plus className="h-3 w-3" /> Add Yes Example
                      </Button>
                    </div>
                  </div>
                  <div className="space-y-1.5">
                    <Label className="text-xs">Definition for "No"</Label>
                    <Textarea rows={2} placeholder="When should the score be No?" value={definitionNo} onChange={(e) => setDefinitionNo(e.target.value)} />
                    <div className="space-y-1.5">
                      {noExamples.map((example, index) => (
                        <div key={`no-${index}`} className="flex items-center gap-2">
                          <Input className="flex-1 text-xs" placeholder={`No example ${index + 1}`} value={example} onChange={(e) => updateYesNoExample("no", index, e.target.value)} />
                          <Button type="button" variant="ghost" size="icon" className="h-7 w-7 shrink-0" onClick={() => removeYesNoExample("no", index)}>
                            <Trash2 className="h-3 w-3" />
                          </Button>
                        </div>
                      ))}
                      <Button type="button" variant="ghost" size="sm" className="h-7 text-xs gap-1" onClick={() => addYesNoExample("no")}>
                        <Plus className="h-3 w-3" /> Add No Example
                      </Button>
                    </div>
                  </div>
                </div>
              )}

              {criteriaType === "numerical-scale" && (
                <div className="space-y-4">
                  {scaleScores.map((score, idx) => (
                    <div key={idx} className="space-y-2 border-b pb-3 last:border-0 last:pb-0">
                      <p className="text-xs font-medium text-muted-foreground">Score {idx + 1}</p>
                      <div className="grid grid-cols-2 gap-2">
                        <Input placeholder="Title (e.g. Excellent)" value={score.title} onChange={(e) => updateScaleScore(idx, "title", e.target.value)} />
                        <Input placeholder="Definition" value={score.definition} onChange={(e) => updateScaleScore(idx, "definition", e.target.value)} />
                      </div>
                      <div className="space-y-1.5">
                        {score.examples.map((example, exIdx) => (
                          <div key={exIdx} className="flex items-center gap-2">
                            <Input className="flex-1 text-xs" placeholder={`Example ${exIdx + 1}`} value={example} onChange={(e) => updateScaleExample(idx, exIdx, e.target.value)} />
                            <Button type="button" variant="ghost" size="icon" className="h-7 w-7 shrink-0" onClick={() => removeScaleExample(idx, exIdx)}>
                              <Trash2 className="h-3 w-3" />
                            </Button>
                          </div>
                        ))}
                        <Button type="button" variant="ghost" size="sm" className="h-7 text-xs gap-1" onClick={() => addScaleExample(idx)}>
                          <Plus className="h-3 w-3" /> Add Example
                        </Button>
                      </div>
                    </div>
                  ))}
                </div>
              )}

              {criteriaType === "numerical-count" && (
                <div className="space-y-4">
                  {buckets.map((bucket) => (
                    <div key={bucket} className="space-y-1.5 border-b pb-3 last:border-0 last:pb-0">
                      <p className="text-xs font-medium text-muted-foreground">Count {bucket}</p>
                      <div className="grid grid-cols-2 gap-2">
                        <Input
                          placeholder="Title (e.g. Excellent)"
                          value={bucketTitles[bucket] || ""}
                          onChange={(e) => setBucketTitles((prev) => ({ ...prev, [bucket]: e.target.value }))}
                        />
                        <Input
                          placeholder="Definition"
                          value={bucketDefs[bucket] || ""}
                          onChange={(e) => setBucketDefs((prev) => ({ ...prev, [bucket]: e.target.value }))}
                        />
                      </div>
                      <div className="space-y-1.5">
                        {(bucketExamples[bucket] || []).map((example, index) => (
                          <div key={`${bucket}-${index}`} className="flex items-center gap-2">
                            <Input
                              className="flex-1 text-xs"
                              placeholder={`Example ${index + 1}`}
                              value={example}
                              onChange={(e) => updateBucketExample(bucket, index, e.target.value)}
                            />
                            <Button type="button" variant="ghost" size="icon" className="h-7 w-7 shrink-0" onClick={() => removeBucketExample(bucket, index)}>
                              <Trash2 className="h-3 w-3" />
                            </Button>
                          </div>
                        ))}
                        <Button type="button" variant="ghost" size="sm" className="h-7 text-xs gap-1" onClick={() => addBucketExample(bucket)}>
                          <Plus className="h-3 w-3" /> Add Example
                        </Button>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
            <Button onClick={handleSubmit} disabled={!canSubmit}>
              {initialCriterion ? "Save Changes" : "Add Criterion"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={addTagOpen} onOpenChange={setAddTagOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>
              {addTagTarget.type === "category"
                ? `Add Category for ${addTagTarget.context}${addTagTarget.branchTag ? ` / ${addTagTarget.branchTag}` : ""} / ${addTagTarget.contentType}`
                : `Add ${getAddTagTargetLabel(addTagTarget)} Tag`}
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-2 py-2">
            <Label>
              {addTagTarget.type === "category"
                ? "Category name"
                : `${getAddTagTargetLabel(addTagTarget)} tag name`}
            </Label>
            <Input
              placeholder={
                addTagTarget.type === "category"
                  ? "Enter category"
                  : `Enter ${getAddTagTargetLabel(addTagTarget).toLowerCase()} tag`
              }
              value={newTagName}
              onChange={(e) => setNewTagName(e.target.value)}
            />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setAddTagOpen(false)}>Cancel</Button>
            <Button onClick={handleAddTagSubmit} disabled={!newTagName.trim()}>Add Tag</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
};
