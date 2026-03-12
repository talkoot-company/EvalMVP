// Core data types for the Product Copy Evaluation Platform

export type CriteriaType = "yes-no" | "numerical-scale" | "numerical-count";

// Content/context/category are managed taxonomy dimensions.
// They start from system defaults, but are extensible with custom tags.
export type ContentType = string;

export type EvalContext = string;

export type CriteriaCategory = string;

export interface CustomTagCategory {
  name: string;
  tags: string[];
}

export interface ScaleDefinition {
  score_1: { title: string; definition: string; example_1?: string; example_2?: string };
  score_2: { title: string; definition: string; example_1?: string; example_2?: string };
  score_3: { title: string; definition: string; example_1?: string; example_2?: string };
  score_4: { title: string; definition: string };
}

export interface YesNoDefinition {
  definition_yes: string;
  definition_no: string;
  yes_examples?: string[];
  no_examples?: string[];
}

export interface CountDefinition {
  buckets: string[];
  bucket_definitions: Record<string, string>;
  bucket_examples?: Record<string, string[]>;
}

export type EvalDefinition = ScaleDefinition | YesNoDefinition | CountDefinition;

export interface Criterion {
  id: string;
  customer?: string;
  brand?: string;
  context: EvalContext;
  brand_tag?: string;
  industry_tag?: string;
  marketplace_tag?: string;
  content_type: ContentType;
  criteria_category: CriteriaCategory;
  criteria_name: string;
  criteria_definition: string;
  criteria_type: CriteriaType;
  eval_definition: EvalDefinition;
  custom_tags?: Record<string, string[]>;
  weight: number;
  active: boolean;
  created_at: string;
  updated_at: string;
}

export interface Category {
  id: string;
  name: string;
}

export interface EvalSuite {
  id: string;
  name: string;
  comment: string;
  criteria_ids: string[];
  config: Record<string, unknown>;
  created_at: string;
  updated_at: string;
}

export interface ProductCopy {
  id: string;
  product_name: string;
  content_type: ContentType;
  raw_text: string;
  metadata?: Record<string, unknown>;
  created_at: string;
  updated_at: string;
}

export interface CriterionScore {
  criterion_id: string;
  score: number;
  normalized_score: number;
  reasoning: string;
}

export type EvalRunStatus = "pending" | "running" | "completed" | "failed";

export interface EvalRun {
  id: string;
  suite_id: string;
  product_copy_id: string;
  status: EvalRunStatus;
  overall_score: number | null;
  category_scores: Record<string, number>;
  criterion_scores: CriterionScore[];
  started_at: string;
  completed_at: string | null;
}
