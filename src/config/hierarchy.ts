import type { EvalContext, ContentType, CriteriaType } from "@/types";

export const CONTEXTS: EvalContext[] = ["Universal", "Industry", "Marketplace", "Brand"];

export const CONTENT_TYPES: ContentType[] = ["Description", "Title", "Bullets/Specs", "Meta Description"];

export const CRITERIA_TYPES: { value: CriteriaType; label: string }[] = [
  { value: "yes-no", label: "Yes / No" },
  { value: "numerical-scale", label: "Scale 1–4" },
  { value: "numerical-count", label: "Count" },
];

export const DEFAULT_CATEGORIES = [
  "Product Identification",
  "Relevant Product Attributes",
  "Structure and Readability",
  "Claim Integrity",
] as const;

/** Derive unique categories from existing criteria data */
export const deriveCategoriesFromCriteria = (
  criteria: { criteria_category: string }[]
): string[] => [...new Set(criteria.map(c => c.criteria_category))];
