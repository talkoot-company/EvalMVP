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
  bucket_titles?: Record<string, string>;
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
  notes?: string;
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

// One {token} interpolated into a prompt template.
export interface PromptPlaceholder {
  token: string;
  description: string;
  required: boolean;
}

// DB-backed, editable AI prompt template (eval grading, rewrite, extraction).
export interface PromptTemplate {
  id: string;
  name: string;
  description: string | null;
  category: string;
  template: string;
  placeholders: PromptPlaceholder[];
  // The built-in default template (for "reset to default"); server-provided.
  default_template: string;
  created_at: string;
  updated_at: string;
}

// DB-backed suite: a named collection of evaluation criteria.
export type WorkflowStepMode = "assess_only" | "rewrite_once" | "rewrite_until_pass";

export interface WorkflowStep {
  suite_id: string;
  mode: WorkflowStepMode;
}

export interface SuiteWorkflow {
  id: string;
  name: string;
  description: string | null;
  steps: WorkflowStep[];
  created_at: string;
  updated_at: string;
}

// One re-graded criterion at some point in a stage (same shape as RewriteFeedbackItem).
export interface WorkflowGrade {
  criterion_id: string;
  criterion_name: string;
  score: string;
  desired_score: string;
  rationale: string;
  evidence: string[];
}

export interface WorkflowRunIteration {
  content: string;
  thesis?: string;
  grades: WorkflowGrade[];
  created_at: string;
}

export interface WorkflowRunStage {
  position: number;
  suite_id: string;
  suite_name: string;
  mode: WorkflowStepMode;
  input_copy: string;
  initial_grades: WorkflowGrade[];
  iterations: WorkflowRunIteration[];
  output_copy: string;
  status: "pending" | "running" | "done" | "error";
  error?: string;
  // The deployment names actually used for this stage (resolved: run override →
  // suite's configured model → default). Recorded so a run shows what it ran on.
  eval_model?: string;
  rewrite_model?: string;
}

export interface SuiteWorkflowRunData {
  generation_id: string;
  original_copy: string;
  stages: WorkflowRunStage[];
  // Run-level model overrides. null/undefined → each step uses its suite's model.
  eval_model?: string | null;
  rewrite_model?: string | null;
}

export interface SuiteWorkflowRun {
  id: string;
  workflow_id: string;
  generation_id: string;
  status: "running" | "done" | "error";
  data: SuiteWorkflowRunData;
  created_at: string;
  updated_at: string;
}

export interface Suite {
  id: string;
  name: string;
  description: string | null;
  active: boolean;
  // Per-suite prompt that turns the criteria feedback into a coherence thesis
  // before the rewrite. null → the rewrite uses the built-in default.
  rewrite_orchestration_prompt: string | null;
  // Per-suite LLM deployment for assessment / rewrite. null → default (gpt-5).
  eval_model: string | null;
  rewrite_model: string | null;
  criteria_ids: string[];
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

export interface EvalRunTaxonomySnapshot {
  contexts: string[];
  contentTypes: string[];
  branchTagsByContext: {
    Industry: string[];
    Marketplace: string[];
    Brand: string[];
  };
  categoriesByPath: Record<string, string[]>;
}

export interface EvalRunScoreNode {
  id: string;
  label: string;
  level: "context" | "branch" | "content_type" | "category" | "criterion";
  parent_id: string | null;
  children_ids: string[];
  raw_points: number;
  max_points: number;
  normalized_0_100: number;
  meta?: {
    context?: string;
    branch_tag?: string;
    content_type?: string;
    category?: string;
    criterion_id?: string;
  };
}

export interface EvalRunProductResult {
  product_copy_id: string;
  overall_score: number | null;
  category_scores: Record<string, number>;
  criterion_scores: CriterionScore[];
  taxonomy_snapshot?: EvalRunTaxonomySnapshot;
  hierarchical_scores?: Record<string, EvalRunScoreNode>;
  root_node_ids?: string[];
}

export interface EvalRunInputEntry {
  content_type: ContentType;
  raw_text: string;
}

export interface EvalRunInputProduct {
  product_name: string;
  entries: EvalRunInputEntry[];
}

export interface EvalRunInputSummary {
  source: "import" | "paste";
  import_file_name?: string;
  products: EvalRunInputProduct[];
}

export interface EvalRun {
  id: string;
  evaluation_title?: string;
  brand?: string;
  suite_id: string;
  product_copy_id: string;
  status: EvalRunStatus;
  overall_score: number | null;
  category_scores: Record<string, number>;
  criterion_scores: CriterionScore[];
  taxonomy_snapshot?: EvalRunTaxonomySnapshot;
  hierarchical_scores?: Record<string, EvalRunScoreNode>;
  root_node_ids?: string[];
  product_results?: EvalRunProductResult[];
  input_summary?: EvalRunInputSummary;
  started_at: string;
  completed_at: string | null;
}
