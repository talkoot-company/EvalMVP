// Single source of truth for the four editable AI prompt templates.
//
// Each template is stored in the DB (table `prompt_templates`) and rendered at
// call time by substituting {token} placeholders with computed values. These
// DEFAULT_PROMPTS are used to (a) seed the table and (b) fall back in code when a
// row is missing or blank, so behavior is byte-identical to the old hardcoded
// prompts until someone edits one.
//
// Token rule: only `{snake_case}` identifiers present in the value map are
// replaced. Literal JSON braces in the prompts (e.g. `{"score": 3, ...}` and the
// `{}` empty-object example) are NOT identifiers, so they are left untouched.

export const DEFAULT_PROMPTS = [
  {
    id: "eval_grading",
    name: "Evaluation grading",
    description: "Grades a piece of product copy against one criterion and returns a JSON score, rationale, and evidence.",
    category: "Evaluation",
    template: `You are an expert evaluator of ecommerce product copy. Evaluate the copy below against the provided criterion and return a JSON object.

CRITERION: {criterion_name}
DESCRIPTION: {criterion_description}

{rubric}

PRODUCT DATA:
{product_data}

COPY TO EVALUATE:
{copy}

Return ONLY a JSON object with these exact fields:
- "score": {score_instruction}
- "rationale": 1-3 sentences explaining the score with reference to the rubric
- "evidence": a list of 1-3 short quoted phrases from the copy that support your score

Example: {"score": 3, "rationale": "The copy speaks directly to the reader.", "evidence": ["Fuel your moments", "feel good about your choice"]}`,
    placeholders: [
      { token: "criterion_name", description: "The criterion's name.", required: false },
      { token: "criterion_description", description: "The criterion's prose definition.", required: false },
      { token: "rubric", description: "Computed scoring rubric built from the criterion's structured definition.", required: true },
      { token: "product_data", description: "Computed grounding block (extracted product fields or the creative brief).", required: true },
      { token: "copy", description: "The copy being graded (the generation's output, or supplied content).", required: true },
      { token: "score_instruction", description: "Type-specific score instruction (Yes/No, 1-4, or count bucket).", required: true },
    ],
  },
  {
    id: "post_edit",
    name: "Rewrite — single criterion (post-edit)",
    description: "Improves a piece of copy using one criterion's evaluation feedback.",
    category: "Rewrite",
    template: `You are an expert product copy editor. Your task is to improve a piece of product copy based on evaluation feedback.

--- ORIGINAL TASK ---
{system_prompt}

--- PRODUCT DATA ---
{product_data}

--- ORIGINAL COPY ---
{original_copy}

--- EVALUATION FEEDBACK ---
Criterion: {criterion_name}
Score: {score} (target: {desired_score})
Feedback: {rationale}{evidence}

--- INSTRUCTIONS ---
Rewrite the copy to address the evaluation feedback and achieve the target score.
- Keep the same format and approximate length as the original.
- Only change what is needed to address the specific feedback.
- Do not add commentary or explanations — output only the improved copy.
`,
    placeholders: [
      { token: "system_prompt", description: "The generation's original task/system prompt.", required: false },
      { token: "product_data", description: "Computed grounding block for the generation.", required: false },
      { token: "original_copy", description: "The copy to improve (prior post-edit or the original output).", required: true },
      { token: "criterion_name", description: "The criterion being addressed.", required: false },
      { token: "score", description: "The current score.", required: false },
      { token: "desired_score", description: "The target score for a pass.", required: false },
      { token: "rationale", description: "The evaluation feedback driving the rewrite.", required: false },
      { token: "evidence", description: "Computed block of flagged passages (may be empty).", required: false },
    ],
  },
  {
    id: "rewrite_aggregate",
    name: "Rewrite — aggregate (suite)",
    description: "Improves copy using the aggregated feedback from every criterion in a suite, preserving passes while fixing failures.",
    category: "Rewrite",
    template: `You are an expert product copy editor. Improve the copy below based on evaluation feedback from multiple criteria.

--- ORIGINAL TASK ---
{system_prompt}

--- PRODUCT DATA ---
{product_data}

--- ORIGINAL COPY ---
{original_copy}

--- EVALUATION FEEDBACK ({criteria_count}) ---
{feedback}

--- INSTRUCTIONS ---
Rewrite the copy to satisfy every "NEEDS IMPROVEMENT" criterion while preserving the qualities that already "PASS" — do not regress them.
- Keep the same format and approximate length as the original.
- Only change what is needed to fix the failing criteria without breaking the passing ones.
- Do not add commentary or explanations — output only the improved copy.
`,
    placeholders: [
      { token: "system_prompt", description: "The generation's original task/system prompt.", required: false },
      { token: "product_data", description: "Computed grounding block for the generation.", required: false },
      { token: "original_copy", description: "The copy to improve (latest rewrite or the original output).", required: true },
      { token: "criteria_count", description: "Computed label, e.g. \"3 criteria\" / \"1 criterion\".", required: false },
      { token: "feedback", description: "Computed per-criterion feedback blocks (PASS / NEEDS IMPROVEMENT + rationale + flagged passages).", required: true },
    ],
  },
  {
    id: "product_extraction",
    name: "Product data extraction",
    description: "Extracts a flat JSON object of concrete product attributes from a generation's request messages (grounding data).",
    category: "Extraction",
    template: `You are a data-extraction tool. From the content below, extract ALL concrete product information into a single flat JSON object. Use the original field labels where present (e.g. "Title", "Brand Name", "Description", "Keywords", "Ingredients", "Flavor", "Pack Size"). Include every product attribute you can find.

If the content contains NO concrete product data — for example only generic writing instructions, brand-voice/tone guidance, or image descriptions — return exactly {} (an empty object).

Return ONLY the JSON object, no commentary.

CONTENT:
{content}`,
    placeholders: [
      { token: "content", description: "The generation's user messages, joined together.", required: true },
    ],
  },
];

const BY_ID = new Map(DEFAULT_PROMPTS.map((p) => [p.id, p]));

// The default template string for an id (used as the fallback when no DB row).
export function defaultTemplate(id) {
  return BY_ID.get(id)?.template ?? "";
}

// Substitute {token} placeholders with values[token]. Unknown tokens and literal
// JSON braces are left as-is.
export function renderTemplate(template, values) {
  if (typeof template !== "string" || !template) return "";
  return template.replace(/\{([a-z0-9_]+)\}/gi, (match, token) =>
    Object.prototype.hasOwnProperty.call(values, token) ? String(values[token] ?? "") : match,
  );
}

// The required placeholder tokens for a prompt id.
export function requiredTokens(id) {
  return (BY_ID.get(id)?.placeholders ?? []).filter((p) => p.required).map((p) => p.token);
}

// Which required tokens are absent from a template string (for the warn-but-allow
// check). Returns [] when the id is unknown.
export function missingRequired(id, template) {
  const text = typeof template === "string" ? template : "";
  return requiredTokens(id).filter((tok) => !text.includes(`{${tok}}`));
}
