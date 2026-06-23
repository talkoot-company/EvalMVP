/**
 * Self-contained criterion form. Manages its own state and calls
 * onSave(criterion) or onCancel() when done.
 *
 * Rendered inline (CriteriaPage expanded row) OR inside AddCriterionDialog.
 */
import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Plus, Trash2 } from "lucide-react";
import type { Criterion, CriteriaType } from "@/types";
import { CONTEXTS, CONTENT_TYPES } from "@/config/hierarchy";

// ---------------------------------------------------------------------------
// Shared primitives
// ---------------------------------------------------------------------------
export interface ScaleEntry { title: string; definition: string; examples: string[] }
export const COUNT_BUCKETS = ["0", "1", "2", "3+"] as const;

const LABEL     = "text-sm font-medium";
const HINT      = "text-[11px] text-muted-foreground";
const FIELD     = "flex flex-col gap-1.5";
const CARD      = "rounded-md border p-3 space-y-2 bg-muted/20";
const SEC_LABEL = "text-[10px] font-semibold uppercase tracking-widest text-muted-foreground mb-3";

export function Field({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <div className={FIELD}>
      <Label className={LABEL}>{label}</Label>
      {hint && <p className={HINT}>{hint}</p>}
      {children}
    </div>
  );
}

export function ReadonlyField({ label, value }: { label: string; value?: string | null }) {
  return (
    <div className={FIELD}>
      <Label className={`${LABEL} text-muted-foreground`}>{label}</Label>
      <p className="font-mono text-xs text-muted-foreground bg-muted rounded-md px-3 py-2 break-all">{value || "—"}</p>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Eval-definition sub-forms
// ---------------------------------------------------------------------------
function ExampleList({ examples, placeholder, onAdd, onChange, onRemove }: {
  examples: string[]; placeholder: string;
  onAdd: () => void; onChange: (i: number, v: string) => void; onRemove: (i: number) => void;
}) {
  return (
    <div className="space-y-1.5">
      {examples.map((ex, i) => (
        <div key={i} className="flex gap-2">
          <Input className="text-xs" placeholder={placeholder} value={ex} onChange={(e) => onChange(i, e.target.value)} />
          <Button type="button" variant="ghost" size="icon" className="h-8 w-8 shrink-0" onClick={() => onRemove(i)}>
            <Trash2 className="h-3 w-3" />
          </Button>
        </div>
      ))}
      <Button type="button" variant="ghost" size="sm" className="h-7 text-xs gap-1" onClick={onAdd}>
        <Plus className="h-3 w-3" /> Add example
      </Button>
    </div>
  );
}

export function YesNoForm({ defYes, defNo, yesEx, noEx, setDefYes, setDefNo, setYesEx, setNoEx }: {
  defYes: string; defNo: string; yesEx: string[]; noEx: string[];
  setDefYes(v: string): void; setDefNo(v: string): void;
  setYesEx: React.Dispatch<React.SetStateAction<string[]>>;
  setNoEx: React.Dispatch<React.SetStateAction<string[]>>;
}) {
  return (
    <div className="space-y-3">
      {([
        { key: "yes", label: "Yes", def: defYes, setDef: setDefYes, ex: yesEx, setEx: setYesEx },
        { key: "no",  label: "No",  def: defNo,  setDef: setDefNo,  ex: noEx,  setEx: setNoEx  },
      ] as const).map(({ key, label, def, setDef, ex, setEx }) => (
        <div key={key} className={CARD}>
          <p className="text-xs font-semibold text-muted-foreground">Score: {label}</p>
          <Textarea rows={2} placeholder={`Definition for "${label}"`} value={def} onChange={(e) => setDef(e.target.value)} />
          <ExampleList
            examples={ex} placeholder={`${label} example`}
            onAdd={() => setEx((p) => [...p, ""])}
            onChange={(i, v) => setEx((p) => p.map((x, j) => j === i ? v : x))}
            onRemove={(i) => setEx((p) => p.filter((_, j) => j !== i))}
          />
        </div>
      ))}
    </div>
  );
}

export function ScaleForm({ scores, setScores }: {
  scores: ScaleEntry[];
  setScores: React.Dispatch<React.SetStateAction<ScaleEntry[]>>;
}) {
  return (
    <div className="space-y-3">
      {scores.map((score, idx) => (
        <div key={idx} className={CARD}>
          <p className="text-xs font-semibold text-muted-foreground">Score {idx + 1}</p>
          <div className="grid grid-cols-2 gap-2">
            <Input placeholder="Title" value={score.title}
              onChange={(e) => setScores((p) => p.map((s, i) => i === idx ? { ...s, title: e.target.value } : s))} />
            <Input placeholder="Definition" value={score.definition}
              onChange={(e) => setScores((p) => p.map((s, i) => i === idx ? { ...s, definition: e.target.value } : s))} />
          </div>
          <ExampleList
            examples={score.examples} placeholder="Example"
            onAdd={() => setScores((p) => p.map((s, i) => i === idx ? { ...s, examples: [...s.examples, ""] } : s))}
            onChange={(ei, v) => setScores((p) => p.map((s, i) => i === idx ? { ...s, examples: s.examples.map((x, j) => j === ei ? v : x) } : s))}
            onRemove={(ei) => setScores((p) => p.map((s, i) => i === idx ? { ...s, examples: s.examples.filter((_, j) => j !== ei) } : s))}
          />
        </div>
      ))}
    </div>
  );
}

export function CountForm({ titles, defs, examples, setTitles, setDefs, setExamples }: {
  titles: Record<string, string>; defs: Record<string, string>; examples: Record<string, string[]>;
  setTitles: React.Dispatch<React.SetStateAction<Record<string, string>>>;
  setDefs: React.Dispatch<React.SetStateAction<Record<string, string>>>;
  setExamples: React.Dispatch<React.SetStateAction<Record<string, string[]>>>;
}) {
  return (
    <div className="space-y-3">
      {COUNT_BUCKETS.map((b) => (
        <div key={b} className={CARD}>
          <p className="text-xs font-semibold text-muted-foreground">Count: {b}</p>
          <div className="grid grid-cols-2 gap-2">
            <Input placeholder="Title" value={titles[b] || ""} onChange={(e) => setTitles((p) => ({ ...p, [b]: e.target.value }))} />
            <Input placeholder="Definition" value={defs[b] || ""} onChange={(e) => setDefs((p) => ({ ...p, [b]: e.target.value }))} />
          </div>
          <ExampleList
            examples={examples[b] || []} placeholder="Example"
            onAdd={() => setExamples((p) => ({ ...p, [b]: [...(p[b] || []), ""] }))}
            onChange={(i, v) => setExamples((p) => ({ ...p, [b]: (p[b] || []).map((x, j) => j === i ? v : x) }))}
            onRemove={(i) => setExamples((p) => ({ ...p, [b]: (p[b] || []).filter((_, j) => j !== i) }))}
          />
        </div>
      ))}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main form component
// ---------------------------------------------------------------------------
export interface CriterionFormProps {
  initialCriterion?: Criterion | null;
  existingCategories?: string[];
  onSave: (criterion: Criterion) => void;
  onCancel: () => void;
  /** Show Save/Cancel buttons inside the form (true) or let parent render them (false) */
  showFooter?: boolean;
}

export function CriterionForm({
  initialCriterion, existingCategories = [], onSave, onCancel, showFooter = true,
}: CriterionFormProps) {
  const isEdit = !!initialCriterion;

  const [name, setName]                   = useState("");
  const [definition, setDefinition]       = useState("");
  const [active, setActive]               = useState(true);
  const [customer, setCustomer]           = useState("");
  const [brand, setBrand]                 = useState("");
  const [context, setContext]             = useState("");
  const [contentType, setContentType]     = useState("");
  const [category, setCategory]           = useState("");
  const [marketplaceTag, setMarketplaceTag] = useState("");
  const [brandTag, setBrandTag]           = useState("");
  const [industryTag, setIndustryTag]     = useState("");
  const [criteriaType, setCriteriaType]   = useState<CriteriaType>("yes-no");
  const [weight, setWeight]               = useState("1");
  const [defYes, setDefYes]               = useState("");
  const [defNo, setDefNo]                 = useState("");
  const [yesEx, setYesEx]                 = useState<string[]>([""]);
  const [noEx, setNoEx]                   = useState<string[]>([""]);
  const [scaleScores, setScaleScores]     = useState<ScaleEntry[]>([
    { title: "", definition: "", examples: [""] },
    { title: "", definition: "", examples: [""] },
    { title: "", definition: "", examples: [""] },
    { title: "", definition: "", examples: [] },
  ]);
  const [bucketTitles, setBucketTitles]   = useState<Record<string, string>>({ "0": "", "1": "", "2": "", "3+": "" });
  const [bucketDefs, setBucketDefs]       = useState<Record<string, string>>({ "0": "", "1": "", "2": "", "3+": "" });
  const [bucketExamples, setBucketExamples] = useState<Record<string, string[]>>({ "0": [""], "1": [""], "2": [""], "3+": [""] });
  const [showValidation, setShowValidation] = useState(false);
  const datalistId = useRef(`cat-${Math.random().toString(36).slice(2)}`).current;

  // Populate from initialCriterion whenever it changes
  useEffect(() => {
    if (!initialCriterion) {
      setName(""); setDefinition(""); setActive(true); setCustomer(""); setBrand("");
      setContext(""); setContentType(""); setCategory("");
      setMarketplaceTag(""); setBrandTag(""); setIndustryTag("");
      setCriteriaType("yes-no"); setWeight("1");
      setDefYes(""); setDefNo(""); setYesEx([""]); setNoEx([""]);
      setScaleScores([
        { title: "", definition: "", examples: [""] },
        { title: "", definition: "", examples: [""] },
        { title: "", definition: "", examples: [""] },
        { title: "", definition: "", examples: [] },
      ]);
      setBucketTitles({ "0": "", "1": "", "2": "", "3+": "" });
      setBucketDefs({ "0": "", "1": "", "2": "", "3+": "" });
      setBucketExamples({ "0": [""], "1": [""], "2": [""], "3+": [""] });
      setShowValidation(false);
      return;
    }
    const c = initialCriterion;
    setName(c.criteria_name); setDefinition(c.criteria_definition);
    setActive(c.active ?? true); setCustomer(c.customer || ""); setBrand(c.brand || "");
    setContext(c.context); setContentType(c.content_type); setCategory(c.criteria_category);
    setMarketplaceTag(c.marketplace_tag || ""); setBrandTag(c.brand_tag || ""); setIndustryTag(c.industry_tag || "");
    setCriteriaType(c.criteria_type); setWeight(String(c.weight ?? 1));
    setShowValidation(false);

    if (c.criteria_type === "yes-no") {
      const d = c.eval_definition as { definition_yes?: string; definition_no?: string; yes_examples?: string[]; no_examples?: string[] };
      setDefYes(d.definition_yes || ""); setDefNo(d.definition_no || "");
      setYesEx(d.yes_examples?.length ? d.yes_examples : [""]);
      setNoEx(d.no_examples?.length ? d.no_examples : [""]);
    } else if (c.criteria_type === "numerical-scale") {
      const d = c.eval_definition as Record<string, { title?: string; definition?: string; example_1?: string; example_2?: string }>;
      setScaleScores([1, 2, 3, 4].map((n) => {
        const e = d[`score_${n}`];
        const exs = [e?.example_1, e?.example_2].filter(Boolean) as string[];
        return { title: e?.title || "", definition: e?.definition || "", examples: exs.length ? exs : n < 4 ? [""] : [] };
      }));
    } else {
      const d = c.eval_definition as { buckets?: string[]; bucket_titles?: Record<string, string>; bucket_definitions?: Record<string, string>; bucket_examples?: Record<string, string[]> };
      const bkts = d.buckets?.length ? d.buckets : [...COUNT_BUCKETS];
      setBucketTitles(Object.fromEntries(bkts.map((b) => [b, d.bucket_titles?.[b] || ""])));
      setBucketDefs(Object.fromEntries(bkts.map((b) => [b, d.bucket_definitions?.[b] || ""])));
      setBucketExamples(Object.fromEntries(bkts.map((b) => [b, d.bucket_examples?.[b]?.length ? d.bucket_examples[b] : [""]])));
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialCriterion]);

  const buildEvalDefinition = (): Criterion["eval_definition"] => {
    if (criteriaType === "yes-no") {
      return {
        definition_yes: defYes, definition_no: defNo,
        yes_examples: yesEx.map((e) => e.trim()).filter(Boolean),
        no_examples: noEx.map((e) => e.trim()).filter(Boolean),
      };
    }
    if (criteriaType === "numerical-scale") {
      const result: Record<string, unknown> = {};
      scaleScores.forEach((s, i) => {
        const entry: Record<string, string> = { title: s.title, definition: s.definition };
        s.examples.forEach((ex, j) => { if (ex.trim()) entry[`example_${j + 1}`] = ex.trim(); });
        result[`score_${i + 1}`] = entry;
      });
      return result as Criterion["eval_definition"];
    }
    return {
      buckets: [...COUNT_BUCKETS],
      bucket_titles: bucketTitles,
      bucket_definitions: bucketDefs,
      bucket_examples: Object.fromEntries(
        COUNT_BUCKETS.map((b) => [b, (bucketExamples[b] || []).map((e) => e.trim()).filter(Boolean)]),
      ),
    };
  };

  const canSubmit = !!name.trim() && !!context && !!contentType && !!category.trim();

  const handleSubmit = () => {
    if (!canSubmit) { setShowValidation(true); return; }
    const now = new Date().toISOString();
    onSave({
      id: initialCriterion?.id || name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, ""),
      criteria_name: name.trim(),
      criteria_definition: definition.trim(),
      active,
      customer: customer.trim() || undefined,
      brand: brand.trim() || undefined,
      context,
      content_type: contentType,
      criteria_category: category.trim(),
      marketplace_tag: context === "Marketplace" ? (marketplaceTag.trim() || undefined) : undefined,
      brand_tag: context === "Brand" ? (brandTag.trim() || undefined) : undefined,
      industry_tag: context === "Industry" ? (industryTag.trim() || undefined) : undefined,
      criteria_type: criteriaType,
      weight: parseFloat(weight) || 1,
      eval_definition: buildEvalDefinition(),
      custom_tags: initialCriterion?.custom_tags,
      created_at: initialCriterion?.created_at || now,
      updated_at: now,
    });
  };

  return (
    <div className="space-y-6">
      {/* Active toggle + ID */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <span className="text-sm text-muted-foreground">Active</span>
          <Switch checked={active} onCheckedChange={setActive} />
        </div>
        {isEdit && <p className="font-mono text-[11px] text-muted-foreground">{initialCriterion?.id}</p>}
      </div>

      {/* ── Identity ──────────────────────────────────── */}
      <section className="space-y-3">
        <p className={SEC_LABEL}>Identity</p>
        <Field label="Criteria name *">
          <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Product type is stated" />
          {showValidation && !name.trim() && <p className="text-xs text-destructive">Required</p>}
        </Field>
        <Field label="Criteria definition" hint="What does this criterion measure?">
          <Textarea rows={3} value={definition} onChange={(e) => setDefinition(e.target.value)}
            placeholder="Describe what this criterion evaluates…" />
        </Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Customer" hint="customer column">
            <Input value={customer} onChange={(e) => setCustomer(e.target.value)} placeholder="e.g. Coca-Cola" />
          </Field>
          <Field label="Brand" hint="brand column">
            <Input value={brand} onChange={(e) => setBrand(e.target.value)} placeholder="e.g. Main Brand" />
          </Field>
        </div>
      </section>

      {/* ── Taxonomy ──────────────────────────────────── */}
      <section className="space-y-3">
        <p className={SEC_LABEL}>Taxonomy</p>
        <Field label="Context *" hint="context column">
          <div className="flex gap-2 flex-wrap">
            {CONTEXTS.map((opt) => (
              <Button key={opt} type="button" size="sm"
                variant={context === opt ? "default" : "outline"}
                onClick={() => { setContext(opt); setMarketplaceTag(""); setBrandTag(""); setIndustryTag(""); }}>
                {opt}
              </Button>
            ))}
          </div>
          {showValidation && !context && <p className="text-xs text-destructive">Required</p>}
        </Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Content type *" hint="content_type column">
            <Select value={contentType || "__none__"} onValueChange={(v) => setContentType(v === "__none__" ? "" : v)}>
              <SelectTrigger><SelectValue placeholder="Select…" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="__none__">Select…</SelectItem>
                {CONTENT_TYPES.map((opt) => <SelectItem key={opt} value={opt}>{opt}</SelectItem>)}
              </SelectContent>
            </Select>
            {showValidation && !contentType && <p className="text-xs text-destructive">Required</p>}
          </Field>
          <Field label="Category *" hint="criteria_category column">
            <datalist id={datalistId}>
              {existingCategories.map((c) => <option key={c} value={c} />)}
            </datalist>
            <Input list={datalistId} value={category} onChange={(e) => setCategory(e.target.value)}
              placeholder="Type or pick from list…" />
            {showValidation && !category.trim() && <p className="text-xs text-destructive">Required</p>}
          </Field>
        </div>
        {context === "Marketplace" && (
          <Field label="Marketplace tag" hint="marketplace_tag column">
            <Input value={marketplaceTag} onChange={(e) => setMarketplaceTag(e.target.value)} placeholder="e.g. Amazon" />
          </Field>
        )}
        {context === "Brand" && (
          <Field label="Brand tag" hint="brand_tag column">
            <Input value={brandTag} onChange={(e) => setBrandTag(e.target.value)} placeholder="e.g. Nike" />
          </Field>
        )}
        {context === "Industry" && (
          <Field label="Industry tag" hint="industry_tag column">
            <Input value={industryTag} onChange={(e) => setIndustryTag(e.target.value)} placeholder="e.g. Consumer Electronics" />
          </Field>
        )}
      </section>

      {/* ── Scoring ───────────────────────────────────── */}
      <section className="space-y-3">
        <p className={SEC_LABEL}>Scoring</p>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Score type" hint="criteria_type column">
            <Select value={criteriaType} onValueChange={(v) => setCriteriaType(v as CriteriaType)}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="yes-no">Yes / No</SelectItem>
                <SelectItem value="numerical-scale">Scale 1–4</SelectItem>
                <SelectItem value="numerical-count">Count</SelectItem>
              </SelectContent>
            </Select>
          </Field>
          <Field label="Weight" hint="weight column">
            <Input type="number" min="0" step="0.1" value={weight} onChange={(e) => setWeight(e.target.value)} />
          </Field>
        </div>
        <Field label="Evaluation definitions" hint="eval_definition column">
          {criteriaType === "yes-no" && (
            <YesNoForm defYes={defYes} defNo={defNo} yesEx={yesEx} noEx={noEx}
              setDefYes={setDefYes} setDefNo={setDefNo} setYesEx={setYesEx} setNoEx={setNoEx} />
          )}
          {criteriaType === "numerical-scale" && <ScaleForm scores={scaleScores} setScores={setScaleScores} />}
          {criteriaType === "numerical-count" && (
            <CountForm titles={bucketTitles} defs={bucketDefs} examples={bucketExamples}
              setTitles={setBucketTitles} setDefs={setBucketDefs} setExamples={setBucketExamples} />
          )}
        </Field>
      </section>

      {/* ── Metadata (read-only when editing) ─────────── */}
      {isEdit && (
        <section className="space-y-3">
          <p className={SEC_LABEL}>Metadata</p>
          <div className="grid grid-cols-2 gap-3">
            <ReadonlyField label="created_at" value={initialCriterion?.created_at} />
            <ReadonlyField label="updated_at" value={initialCriterion?.updated_at} />
          </div>
          <ReadonlyField label="id" value={initialCriterion?.id} />
        </section>
      )}

      {/* Footer buttons (optional) */}
      {showFooter && (
        <div className="flex justify-end gap-2 pt-2 border-t">
          <Button variant="outline" onClick={onCancel}>Cancel</Button>
          <Button onClick={handleSubmit}>{isEdit ? "Save changes" : "Add criterion"}</Button>
        </div>
      )}
    </div>
  );
}
