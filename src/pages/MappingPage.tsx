import { useState } from "react";
import { useTypeMapping, useGenerationTypes, useUpdateMapping } from "@/hooks/useMapping";
import type { TypeMapping } from "@/api/mapping";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Save, RotateCcw, Loader2 } from "lucide-react";

const CRITERIA_CONTENT_TYPES = ["Title", "Description", "Bullets/Specs", "Meta Description"] as const;

const CONTENT_TYPE_COLORS: Record<string, string> = {
  "Title":            "border-blue-200   bg-blue-50   text-blue-700",
  "Description":      "border-violet-200 bg-violet-50 text-violet-700",
  "Bullets/Specs":    "border-amber-200  bg-amber-50  text-amber-700",
  "Meta Description": "border-green-200  bg-green-50  text-green-700",
};

const MappingPage = () => {
  const { data: serverMapping, isLoading: loadingMapping } = useTypeMapping();
  const { data: generationTypes = [], isLoading: loadingTypes } = useGenerationTypes();
  const updateMapping = useUpdateMapping();

  /**
   * `pending` holds the user's in-progress edits.
   * null = no edits yet; we render from serverMapping directly.
   * non-null = user has made changes; we render from pending.
   */
  const [pending, setPending] = useState<TypeMapping | null>(null);

  // What we actually render from
  const effective: TypeMapping = pending ?? serverMapping ?? {};
  const isDirty = pending !== null;

  const toggle = (contentType: string, genType: string) => {
    const base = pending ?? serverMapping ?? {};
    const current = base[contentType] ?? [];
    const next = current.includes(genType)
      ? current.filter((t) => t !== genType)
      : [...current, genType];
    setPending({ ...base, [contentType]: next });
  };

  const handleSave = () => {
    if (!pending) return;
    updateMapping.mutate(pending, {
      onSuccess: () => setPending(null),
    });
  };

  const handleReset = () => setPending(null);

  const isLoading = loadingMapping || loadingTypes;

  return (
    <div className="p-6 space-y-6 animate-fade-in">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Criteria → Generation mapping</h1>
          <p className="text-sm text-muted-foreground mt-1">
            Which generation types each criteria content type applies to.
            Used to filter criteria in the eval panel and the test view.
          </p>
        </div>
        <div className="flex gap-2">
          {isDirty && (
            <Button variant="outline" size="sm" onClick={handleReset} disabled={updateMapping.isPending}>
              <RotateCcw className="h-4 w-4 mr-1.5" /> Reset
            </Button>
          )}
          <Button size="sm" disabled={!isDirty || updateMapping.isPending} onClick={handleSave}>
            {updateMapping.isPending
              ? <><Loader2 className="h-4 w-4 mr-1.5 animate-spin" /> Saving…</>
              : <><Save className="h-4 w-4 mr-1.5" /> Save</>}
          </Button>
        </div>
      </div>

      {/* Matrix */}
      <div className="border rounded-lg overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b bg-muted/40">
              <th className="text-left px-4 py-3 font-semibold text-muted-foreground w-48">
                Criteria content type
              </th>
              {isLoading
                ? <th className="px-4 py-3 text-muted-foreground">Loading…</th>
                : generationTypes.map((gt) => (
                  <th key={gt} className="px-4 py-3 font-semibold text-muted-foreground text-center min-w-[80px]">
                    {gt}
                  </th>
                ))}
            </tr>
          </thead>
          <tbody>
            {CRITERIA_CONTENT_TYPES.map((ct, i) => {
              const mapped = effective[ct] ?? [];
              return (
                <tr key={ct} className={i % 2 === 0 ? "" : "bg-muted/20"}>
                  <td className="px-4 py-3">
                    <Badge variant="outline" className={`text-xs font-medium ${CONTENT_TYPE_COLORS[ct]}`}>
                      {ct}
                    </Badge>
                  </td>
                  {isLoading
                    ? <td className="px-4 py-3 text-center text-muted-foreground text-xs">—</td>
                    : generationTypes.map((gt) => {
                      const active = mapped.includes(gt);
                      return (
                        <td key={gt} className="px-4 py-3 text-center">
                          <button
                            type="button"
                            onClick={() => toggle(ct, gt)}
                            aria-label={`${active ? "Remove" : "Add"} ${ct} → ${gt}`}
                            className={[
                              "w-8 h-8 rounded-md border-2 mx-auto flex items-center justify-center",
                              "transition-colors cursor-pointer",
                              active
                                ? "border-primary bg-primary text-primary-foreground"
                                : "border-input bg-background hover:border-primary/60 hover:bg-muted",
                            ].join(" ")}
                          >
                            {active && (
                              <svg className="w-4 h-4 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={3}>
                                <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                              </svg>
                            )}
                          </button>
                        </td>
                      );
                    })}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {/* Unsaved changes banner */}
      {isDirty && (
        <p className="text-xs text-amber-600 font-medium">
          You have unsaved changes — click Save to apply them.
        </p>
      )}

      {/* Legend */}
      <div className="text-xs text-muted-foreground space-y-1">
        <p className="font-medium">How this works</p>
        <ul className="list-disc list-inside space-y-0.5 ml-1">
          <li>Rows = criteria <strong>content type</strong> (from the criteria database).</li>
          <li>Columns = <strong>generation type</strong> (inferred from the generation's system prompt).</li>
          <li>A checked cell means: when evaluating a generation of that type, show criteria of that content type in the eval dropdown.</li>
        </ul>
      </div>
    </div>
  );
};

export default MappingPage;
