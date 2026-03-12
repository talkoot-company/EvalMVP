import { useMemo, useState } from "react";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import type {
  ContentType,
  CriteriaCategory,
  CriteriaType,
  Criterion,
  EvalContext,
} from "@/types";
import { CONTENT_TYPES, CONTEXTS, DEFAULT_CATEGORIES } from "@/config/hierarchy";

interface UploadCriteriaDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onUpload: (criteria: Criterion[]) => void;
}

type FlatCriterionRow = Record<string, string | boolean | number | object | undefined | null>;

const parseList = (value: string): string[] =>
  value
    .split(/[|;]/)
    .map((item) => item.trim())
    .filter(Boolean);

const parseBoolean = (value: unknown, fallback = true): boolean => {
  if (typeof value === "boolean") return value;
  if (typeof value === "number") return value !== 0;
  if (typeof value === "string") {
    const normalized = value.trim().toLowerCase();
    if (["true", "1", "yes", "y", "active"].includes(normalized)) return true;
    if (["false", "0", "no", "n", "inactive"].includes(normalized)) return false;
  }
  return fallback;
};

const slugify = (value: string): string => value.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");

const parseCsvLine = (line: string): string[] => {
  const values: string[] = [];
  let current = "";
  let inQuotes = false;

  for (let i = 0; i < line.length; i += 1) {
    const char = line[i];
    const next = line[i + 1];

    if (char === '"') {
      if (inQuotes && next === '"') {
        current += '"';
        i += 1;
      } else {
        inQuotes = !inQuotes;
      }
      continue;
    }

    if (char === "," && !inQuotes) {
      values.push(current.trim());
      current = "";
      continue;
    }

    current += char;
  }

  values.push(current.trim());
  return values;
};

const parseCsvToRows = (text: string): FlatCriterionRow[] => {
  const lines = text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);

  if (lines.length < 2) return [];

  const headers = parseCsvLine(lines[0]).map((header) => header.trim());

  return lines.slice(1).map((line) => {
    const cells = parseCsvLine(line);
    const row: FlatCriterionRow = {};
    headers.forEach((header, index) => {
      row[header] = cells[index] ?? "";
    });
    return row;
  });
};

const normalizeCriteriaType = (value: unknown): CriteriaType => {
  const normalized = String(value || "").trim().toLowerCase();
  if (["yes-no", "yes/no", "yes no", "yes_no", "yn"].includes(normalized)) return "yes-no";
  if (["numerical-scale", "scale", "scale-1-4", "scale 1-4", "1-4"].includes(normalized)) return "numerical-scale";
  if (["numerical-count", "count"].includes(normalized)) return "numerical-count";
  return "yes-no";
};

const normalizeContext = (value: unknown): EvalContext => {
  const raw = String(value || "").trim();
  if (raw.toLowerCase() === "general") return "Universal";
  const found = CONTEXTS.find((ctx) => ctx.toLowerCase() === raw.toLowerCase());
  return found || "Universal";
};

const normalizeContentType = (value: unknown): ContentType => {
  const raw = String(value || "").trim();
  const found = CONTENT_TYPES.find((type) => type.toLowerCase() === raw.toLowerCase());
  return found || "Description";
};

const normalizeCategory = (value: unknown): CriteriaCategory => {
  const raw = String(value || "").trim();
  const found = DEFAULT_CATEGORIES.find((category) => category.toLowerCase() === raw.toLowerCase());
  return (found || "Product Identification") as CriteriaCategory;
};

const parseEvalDefinition = (value: unknown, criteriaType: CriteriaType) => {
  const parsedValue = typeof value === "string" ? value.trim() : value;

  if (typeof parsedValue === "string") {
    if (!parsedValue) throw new Error("Missing eval_definition");
    try {
      return JSON.parse(parsedValue);
    } catch {
      throw new Error("eval_definition must be valid JSON");
    }
  }

  if (parsedValue && typeof parsedValue === "object") return parsedValue;

  if (criteriaType === "yes-no") {
    return {
      definition_yes: "",
      definition_no: "",
      yes_examples: [],
      no_examples: [],
    };
  }

  if (criteriaType === "numerical-scale") {
    return {
      score_1: { title: "", definition: "" },
      score_2: { title: "", definition: "" },
      score_3: { title: "", definition: "" },
      score_4: { title: "", definition: "" },
    };
  }

  return {
    buckets: ["0", "1", "2-3", "4+"],
    bucket_definitions: { "0": "", "1": "", "2-3": "", "4+": "" },
    bucket_examples: { "0": [], "1": [], "2-3": [], "4+": [] },
  };
};

const rowToCriterion = (row: FlatCriterionRow, index: number): Criterion => {
  const now = new Date().toISOString();
  const criteriaType = normalizeCriteriaType(row.criteria_type);
  const criteriaName = String(row.criteria_name || row.name || "").trim();

  if (!criteriaName) {
    throw new Error(`Row ${index + 2}: criteria_name is required`);
  }

  const criteriaDefinition = String(row.criteria_definition || row.definition || "").trim();

  const evalDefinition = parseEvalDefinition(row.eval_definition, criteriaType);
  if (criteriaType === "yes-no" && row.yes_examples && typeof evalDefinition === "object") {
    evalDefinition.yes_examples = parseList(String(row.yes_examples));
  }
  if (criteriaType === "yes-no" && row.no_examples && typeof evalDefinition === "object") {
    evalDefinition.no_examples = parseList(String(row.no_examples));
  }

  let customTags: Record<string, string[]> | undefined;
  if (row.custom_tags) {
    try {
      const parsedCustomTags = typeof row.custom_tags === "string" ? JSON.parse(row.custom_tags) : row.custom_tags;
      if (parsedCustomTags && typeof parsedCustomTags === "object") {
        customTags = Object.fromEntries(
          Object.entries(parsedCustomTags as Record<string, unknown>)
            .map(([categoryName, tags]) => [categoryName, Array.isArray(tags) ? tags.map(String).map((item) => item.trim()).filter(Boolean) : []])
            .filter(([, tags]) => tags.length > 0),
        );
      }
    } catch {
      throw new Error(`Row ${index + 2}: custom_tags must be valid JSON when provided.`);
    }
  }

  return {
    id: String(row.id || slugify(`${criteriaName}-${Date.now()}-${index}`)),
    customer: String(row.customer || "").trim() || undefined,
    brand: String(row.brand || "").trim() || undefined,
    context: normalizeContext(row.context),
    content_type: normalizeContentType(row.content_type),
    criteria_category: normalizeCategory(row.criteria_category),
    criteria_name: criteriaName,
    criteria_definition: criteriaDefinition,
    criteria_type: criteriaType,
    eval_definition: evalDefinition,
    custom_tags: customTags,
    weight: Number(row.weight) > 0 ? Number(row.weight) : 1,
    active: parseBoolean(row.active, true),
    created_at: String(row.created_at || now),
    updated_at: String(row.updated_at || now),
  };
};

const parseJsonCriteria = (text: string): Criterion[] => {
  const parsed = JSON.parse(text);
  const rows = Array.isArray(parsed) ? parsed : Array.isArray(parsed?.criteria) ? parsed.criteria : [];

  if (!rows.length) {
    throw new Error("JSON must be an array of criteria objects, or an object with a criteria array.");
  }

  return rows.map((row, index) => rowToCriterion(row, index));
};

export const UploadCriteriaDialog = ({ open, onOpenChange, onUpload }: UploadCriteriaDialogProps) => {
  const [file, setFile] = useState<File | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isUploading, setIsUploading] = useState(false);

  const acceptedTypes = useMemo(() => ".csv,.json,.xlsx,.xls", []);

  const handleImport = async () => {
    if (!file) {
      setError("Please select a file before importing.");
      return;
    }

    setError(null);
    setIsUploading(true);

    try {
      const extension = file.name.split(".").pop()?.toLowerCase();

      if (extension === "xlsx" || extension === "xls") {
        throw new Error("Excel files are supported via CSV export in this build. Please save/export the sheet as .csv and upload it.");
      }

      const fileText = await file.text();
      let imported: Criterion[] = [];

      if (extension === "json") {
        imported = parseJsonCriteria(fileText);
      } else if (extension === "csv") {
        const rows = parseCsvToRows(fileText);
        if (!rows.length) throw new Error("CSV file has no data rows.");
        imported = rows.map((row, index) => rowToCriterion(row, index));
      } else {
        throw new Error("Unsupported file type. Use .csv or .json. For Excel, export to CSV first.");
      }

      onUpload(imported);
      setFile(null);
      onOpenChange(false);
    } catch (uploadError) {
      setError(uploadError instanceof Error ? uploadError.message : "Unable to import criteria from file.");
    } finally {
      setIsUploading(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-3xl">
        <DialogHeader>
          <DialogTitle>Upload Criteria</DialogTitle>
          <DialogDescription>
            Import criteria in bulk from CSV, JSON, or Excel-exported CSV.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3">
          <Input
            type="file"
            accept={acceptedTypes}
            onChange={(event) => {
              setError(null);
              setFile(event.target.files?.[0] ?? null);
            }}
          />

          <Alert>
            <AlertTitle>Expected file format</AlertTitle>
            <AlertDescription className="space-y-2 text-xs leading-relaxed">
              <p>
                Required columns: <code>criteria_name</code>, <code>context</code>, <code>content_type</code>, <code>criteria_category</code>,
                <code> criteria_type</code>, <code>criteria_definition</code>, <code>weight</code>, <code>eval_definition</code>.
              </p>
              <p>
                Optional columns: <code>id</code>, <code>customer</code>, <code>brand</code>, <code>active</code>, <code>created_at</code>, <code>updated_at</code>.
              </p>
              <p>
                Optional <code>custom_tags</code> should be JSON object by category, e.g.
                <code>{` {"Channel":["Email","PDP"],"Region":["US"]} `}</code>
              </p>
              <p>
                <code>eval_definition</code> must be JSON and depends on <code>criteria_type</code>:
                <code>{` {"definition_yes":"...","definition_no":"...","yes_examples":["..."],"no_examples":["..."]} `}</code>
                for yes/no;
                <code>{` {"score_1":{"title":"...","definition":"..."},"score_2":...,"score_3":...,"score_4":...} `}</code>
                for scale;
                <code>{` {"buckets":["0","1","2-3","4+"],"bucket_definitions":{"0":"..."},"bucket_examples":{"0":["..."]}} `}</code>
                for count.
              </p>
            </AlertDescription>
          </Alert>

          {error && <p className="text-sm text-destructive">{error}</p>}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button onClick={handleImport} disabled={!file || isUploading}>
            {isUploading ? "Importing..." : "Import Criteria"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};
