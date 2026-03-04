import { useEffect, useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Plus, Trash2 } from "lucide-react";
import type { Criterion, CriteriaType, EvalContext, ContentType, CriteriaCategory } from "@/types";
import { CONTEXTS, CONTENT_TYPES, CRITERIA_TYPES, DEFAULT_CATEGORIES } from "@/config/hierarchy";

const CUSTOMERS = ["Adidas", "Puma", "Nike", "Under Armour", "Reebok", "New Balance"];
const BRANDS = ["Main Brand", "Sub-Brand A", "Sub-Brand B", "Private Label"];

interface AddCriterionDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onAdd: (criterion: Criterion) => void;
  onUpdate?: (criterion: Criterion) => void;
  initialCriterion?: Criterion | null;
}

interface ScaleExample {
  title: string;
  definition: string;
  examples: string[];
}

export const AddCriterionDialog = ({ open, onOpenChange, onAdd, onUpdate, initialCriterion }: AddCriterionDialogProps) => {
  const [name, setName] = useState("");
  const [customer, setCustomer] = useState("");
  const [brand, setBrand] = useState("");
  const [criteriaType, setCriteriaType] = useState<CriteriaType>("yes-no");
  const [context, setContext] = useState<EvalContext>("General");
  const [contentType, setContentType] = useState<ContentType>("Title");
  const [category, setCategory] = useState<CriteriaCategory>("Product Identification");
  const [definition, setDefinition] = useState("");
  const [weight, setWeight] = useState("1.0");

  // Yes/No fields
  const [definitionYes, setDefinitionYes] = useState("");
  const [definitionNo, setDefinitionNo] = useState("");
  const [yesExamples, setYesExamples] = useState<string[]>([""]);
  const [noExamples, setNoExamples] = useState<string[]>([""]);

  // Scale 1-4 fields
  const [scaleScores, setScaleScores] = useState<ScaleExample[]>([
    { title: "", definition: "", examples: [""] },
    { title: "", definition: "", examples: [""] },
    { title: "", definition: "", examples: [""] },
    { title: "", definition: "", examples: [] },
  ]);

  // Count fields
  const [buckets, setBuckets] = useState(["0", "1", "2-3", "4+"]);
  const [bucketDefs, setBucketDefs] = useState<Record<string, string>>({ "0": "", "1": "", "2-3": "", "4+": "" });
  const [bucketExamples, setBucketExamples] = useState<Record<string, string[]>>({
    "0": [""],
    "1": [""],
    "2-3": [""],
    "4+": [""],
  });

  const resetForm = () => {
    setName("");
    setCustomer("");
    setBrand("");
    setCriteriaType("yes-no");
    setContext("General");
    setContentType("Title");
    setCategory("Product Identification");
    setDefinition("");
    setWeight("1.0");
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
    setBucketDefs({ "0": "", "1": "", "2-3": "", "4+": "" });
    setBucketExamples({ "0": [""], "1": [""], "2-3": [""], "4+": [""] });
  };

  useEffect(() => {
    if (!open) return;

    if (!initialCriterion) {
      resetForm();
      return;
    }

    setName(initialCriterion.criteria_name);
    setCustomer(initialCriterion.customer || "");
    setBrand(initialCriterion.brand || "");
    setCriteriaType(initialCriterion.criteria_type);
    setContext(initialCriterion.context);
    setContentType(initialCriterion.content_type);
    setCategory(initialCriterion.criteria_category);
    setDefinition(initialCriterion.criteria_definition);
    setWeight(String(initialCriterion.weight));

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
      bucket_definitions?: Record<string, string>;
      bucket_examples?: Record<string, string[]>;
    };
    const nextBuckets = count.buckets?.length ? count.buckets : ["0", "1", "2-3", "4+"];
    setBuckets(nextBuckets);
    setBucketDefs(
      Object.fromEntries(nextBuckets.map(bucket => [bucket, count.bucket_definitions?.[bucket] || ""])),
    );
    setBucketExamples(
      Object.fromEntries(nextBuckets.map(bucket => [bucket, count.bucket_examples?.[bucket]?.length ? count.bucket_examples[bucket] : [""]])),
    );
  }, [open, initialCriterion]);

  const updateScaleScore = (index: number, field: "title" | "definition", value: string) => {
    setScaleScores(prev => prev.map((s, i) => i === index ? { ...s, [field]: value } : s));
  };

  const addScaleExample = (index: number) => {
    setScaleScores(prev => prev.map((s, i) => i === index ? { ...s, examples: [...s.examples, ""] } : s));
  };

  const updateScaleExample = (scoreIdx: number, exIdx: number, value: string) => {
    setScaleScores(prev => prev.map((s, i) =>
      i === scoreIdx ? { ...s, examples: s.examples.map((e, j) => j === exIdx ? value : e) } : s
    ));
  };

  const removeScaleExample = (scoreIdx: number, exIdx: number) => {
    setScaleScores(prev => prev.map((s, i) =>
      i === scoreIdx ? { ...s, examples: s.examples.filter((_, j) => j !== exIdx) } : s
    ));
  };

  const addYesNoExample = (field: "yes" | "no") => {
    if (field === "yes") {
      setYesExamples(prev => [...prev, ""]);
      return;
    }
    setNoExamples(prev => [...prev, ""]);
  };

  const updateYesNoExample = (field: "yes" | "no", index: number, value: string) => {
    if (field === "yes") {
      setYesExamples(prev => prev.map((example, i) => (i === index ? value : example)));
      return;
    }
    setNoExamples(prev => prev.map((example, i) => (i === index ? value : example)));
  };

  const removeYesNoExample = (field: "yes" | "no", index: number) => {
    if (field === "yes") {
      setYesExamples(prev => prev.filter((_, i) => i !== index));
      return;
    }
    setNoExamples(prev => prev.filter((_, i) => i !== index));
  };

  const addBucketExample = (bucket: string) => {
    setBucketExamples(prev => ({
      ...prev,
      [bucket]: [...(prev[bucket] || []), ""],
    }));
  };

  const updateBucketExample = (bucket: string, index: number, value: string) => {
    setBucketExamples(prev => ({
      ...prev,
      [bucket]: (prev[bucket] || []).map((example, i) => (i === index ? value : example)),
    }));
  };

  const removeBucketExample = (bucket: string, index: number) => {
    setBucketExamples(prev => ({
      ...prev,
      [bucket]: (prev[bucket] || []).filter((_, i) => i !== index),
    }));
  };

  const buildEvalDefinition = () => {
    if (criteriaType === "yes-no") {
      return {
        definition_yes: definitionYes,
        definition_no: definitionNo,
        yes_examples: yesExamples.map(example => example.trim()).filter(Boolean),
        no_examples: noExamples.map(example => example.trim()).filter(Boolean),
      };
    }
    if (criteriaType === "numerical-scale") {
      const result: Record<string, any> = {};
      scaleScores.forEach((s, i) => {
        const key = `score_${i + 1}`;
        const entry: Record<string, string> = { title: s.title, definition: s.definition };
        s.examples.forEach((ex, j) => { if (ex) entry[`example_${j + 1}`] = ex; });
        result[key] = entry;
      });
      return result;
    }
    return {
      buckets,
      bucket_definitions: bucketDefs,
      bucket_examples: Object.fromEntries(
        buckets.map(bucket => [
          bucket,
          (bucketExamples[bucket] || []).map(example => example.trim()).filter(Boolean),
        ]),
      ),
    };
  };

  const handleSubmit = () => {
    if (!name.trim()) return;
    const now = new Date().toISOString();
    const criterion: Criterion = {
      id: initialCriterion?.id || name.toLowerCase().replace(/\s+/g, "-").replace(/[^a-z0-9-]/g, ""),
      customer: customer || undefined,
      brand: brand || undefined,
      context,
      content_type: contentType,
      criteria_category: category,
      criteria_name: name,
      criteria_definition: definition,
      criteria_type: criteriaType,
      eval_definition: buildEvalDefinition() as any,
      weight: parseFloat(weight) || 1.0,
      active: initialCriterion?.active ?? true,
      created_at: initialCriterion?.created_at || now,
      updated_at: now,
    };
    if (initialCriterion && onUpdate) {
      onUpdate(criterion);
    } else {
      onAdd(criterion);
    }
    resetForm();
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{initialCriterion ? "Edit Criterion" : "Add New Criterion"}</DialogTitle>
        </DialogHeader>

        <div className="space-y-4 py-2">
          {/* Name */}
          <div className="space-y-1.5">
            <Label>Criteria Name</Label>
            <Input placeholder="e.g. Product Type Stated" value={name} onChange={e => setName(e.target.value)} />
          </div>

          {/* Customer & Brand */}
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-1.5">
              <Label>Customer</Label>
              <Select value={customer} onValueChange={setCustomer}>
                <SelectTrigger><SelectValue placeholder="Select customer" /></SelectTrigger>
                <SelectContent>
                  {CUSTOMERS.map(c => <SelectItem key={c} value={c}>{c}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label>Brand</Label>
              <Select value={brand} onValueChange={setBrand}>
                <SelectTrigger><SelectValue placeholder="Select brand" /></SelectTrigger>
                <SelectContent>
                  {BRANDS.map(b => <SelectItem key={b} value={b}>{b}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
          </div>

          {/* Score Type & Context */}
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-1.5">
              <Label>Score Type</Label>
              <Select value={criteriaType} onValueChange={v => setCriteriaType(v as CriteriaType)}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="yes-no">Yes / No</SelectItem>
                  <SelectItem value="numerical-scale">Scale 1–4</SelectItem>
                  <SelectItem value="numerical-count">Count</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label>Context</Label>
              <Select value={context} onValueChange={v => setContext(v as EvalContext)}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {CONTEXTS.map(ctx => <SelectItem key={ctx} value={ctx}>{ctx}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
          </div>

          {/* Content Type & Category */}
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-1.5">
              <Label>Content Type</Label>
              <Select value={contentType} onValueChange={v => setContentType(v as ContentType)}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {CONTENT_TYPES.map(ct => <SelectItem key={ct} value={ct}>{ct}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label>Category</Label>
              <Select value={category} onValueChange={v => setCategory(v as CriteriaCategory)}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {DEFAULT_CATEGORIES.map(cat => <SelectItem key={cat} value={cat}>{cat}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
          </div>

          {/* Definition */}
          <div className="space-y-1.5">
            <Label>Criteria Definition</Label>
            <Textarea placeholder="Describe what this criterion evaluates..." value={definition} onChange={e => setDefinition(e.target.value)} />
          </div>

          {/* Weight */}
          <div className="space-y-1.5 max-w-[120px]">
            <Label>Weight</Label>
            <Input type="number" step="0.1" min="0" value={weight} onChange={e => setWeight(e.target.value)} />
          </div>

          {/* Dynamic scoring fields */}
          <div className="border rounded-lg p-4 space-y-4 bg-muted/30">
            <h4 className="text-sm font-semibold">Evaluation Definitions</h4>

            {criteriaType === "yes-no" && (
              <div className="space-y-3">
                <div className="space-y-1.5">
                  <Label className="text-xs">Definition for "Yes"</Label>
                  <Textarea rows={2} placeholder="When should the score be Yes?" value={definitionYes} onChange={e => setDefinitionYes(e.target.value)} />
                  <div className="space-y-1.5">
                    {yesExamples.map((example, index) => (
                      <div key={`yes-${index}`} className="flex items-center gap-2">
                        <Input
                          className="flex-1 text-xs"
                          placeholder={`Yes example ${index + 1}`}
                          value={example}
                          onChange={e => updateYesNoExample("yes", index, e.target.value)}
                        />
                        <Button
                          type="button"
                          variant="ghost"
                          size="icon"
                          className="h-7 w-7 shrink-0"
                          onClick={() => removeYesNoExample("yes", index)}
                        >
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
                  <Textarea rows={2} placeholder="When should the score be No?" value={definitionNo} onChange={e => setDefinitionNo(e.target.value)} />
                  <div className="space-y-1.5">
                    {noExamples.map((example, index) => (
                      <div key={`no-${index}`} className="flex items-center gap-2">
                        <Input
                          className="flex-1 text-xs"
                          placeholder={`No example ${index + 1}`}
                          value={example}
                          onChange={e => updateYesNoExample("no", index, e.target.value)}
                        />
                        <Button
                          type="button"
                          variant="ghost"
                          size="icon"
                          className="h-7 w-7 shrink-0"
                          onClick={() => removeYesNoExample("no", index)}
                        >
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
                      <Input placeholder="Title (e.g. Excellent)" value={score.title} onChange={e => updateScaleScore(idx, "title", e.target.value)} />
                      <Input placeholder="Definition" value={score.definition} onChange={e => updateScaleScore(idx, "definition", e.target.value)} />
                    </div>
                    {/* Examples */}
                    <div className="space-y-1.5">
                      {score.examples.map((ex, exIdx) => (
                        <div key={exIdx} className="flex items-center gap-2">
                          <Input className="flex-1 text-xs" placeholder={`Example ${exIdx + 1}`} value={ex} onChange={e => updateScaleExample(idx, exIdx, e.target.value)} />
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
              <div className="space-y-3">
                {buckets.map(bucket => (
                  <div key={bucket} className="space-y-1.5 border-b pb-3 last:border-0 last:pb-0">
                    <Label className="text-xs">Bucket: {bucket}</Label>
                    <Input placeholder={`Definition for "${bucket}"`} value={bucketDefs[bucket] || ""} onChange={e => setBucketDefs(prev => ({ ...prev, [bucket]: e.target.value }))} />
                    <div className="space-y-1.5">
                      {(bucketExamples[bucket] || []).map((example, index) => (
                        <div key={`${bucket}-${index}`} className="flex items-center gap-2">
                          <Input
                            className="flex-1 text-xs"
                            placeholder={`Example ${index + 1} for "${bucket}"`}
                            value={example}
                            onChange={e => updateBucketExample(bucket, index, e.target.value)}
                          />
                          <Button
                            type="button"
                            variant="ghost"
                            size="icon"
                            className="h-7 w-7 shrink-0"
                            onClick={() => removeBucketExample(bucket, index)}
                          >
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
          <Button onClick={handleSubmit} disabled={!name.trim()}>
            {initialCriterion ? "Save Changes" : "Add Criterion"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};
