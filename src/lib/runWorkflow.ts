import { evalsApi, type RewriteFeedbackItem } from "@/api/evals";
import type { Criterion, Suite, WorkflowStep, WorkflowStepMode, WorkflowRunStage, WorkflowGrade } from "@/types";

const isPass = (g: WorkflowGrade) => String(g.score) === String(g.desired_score);

const DEFAULT_MODEL = "gpt-5";
// Effective deployment: run-level override → suite's configured model → default.
const resolveModel = (override: string | null | undefined, suiteModel: string | null | undefined) =>
  override ?? suiteModel ?? DEFAULT_MODEL;

// Rewrite iterations allowed per mode: none, exactly one, or up to three (pass-gated).
function maxIterationsFor(mode: WorkflowStepMode): number {
  if (mode === "rewrite_once") return 1;
  if (mode === "rewrite_until_pass") return 3;
  return 0;
}

// Assess a piece of copy against every criterion in the step's suite. Grounding
// stays tied to the source generation (regrade re-uses its product_json).
async function assess(generationId: string, criteria: Criterion[], content: string, suiteId: string, model: string): Promise<WorkflowGrade[]> {
  return Promise.all(criteria.map(async (c) => {
    // Pass the resolved eval model explicitly (suite_id kept for grounding parity).
    const r = await evalsApi.regrade(generationId, { criterion_id: c.id, content, suite_id: suiteId, model });
    return {
      criterion_id: c.id,
      criterion_name: r.criterion_name,
      score: r.score,
      desired_score: r.desired_score,
      rationale: r.rationale,
      evidence: r.evidence,
    } satisfies WorkflowGrade;
  }));
}

// Push one generation's copy through the ordered chain of suites. Each stage
// assesses the incoming copy against its suite's criteria and (per mode) rewrites,
// feeding the output copy into the next stage. `onStages` fires after every
// meaningful step so the UI can render progress and the run can be persisted.
export async function runWorkflow({
  steps, generationId, originalCopy, suites, criteria, onStages, evalModel, rewriteModel,
}: {
  steps: WorkflowStep[];
  generationId: string;
  originalCopy: string;
  suites: Suite[];
  criteria: Criterion[];
  onStages: (stages: WorkflowRunStage[]) => void;
  // Run-level overrides (null/undefined → each step uses its suite's model).
  evalModel?: string | null;
  rewriteModel?: string | null;
}): Promise<WorkflowRunStage[]> {
  const stages: WorkflowRunStage[] = [];
  let inputCopy = originalCopy;

  for (let position = 0; position < steps.length; position++) {
    const step = steps[position];
    const suite = suites.find((s) => s.id === step.suite_id);
    const stepCriteria = suite ? criteria.filter((c) => suite.criteria_ids.includes(c.id)) : [];

    // Resolve the models this stage actually runs on and record them on the stage.
    const stageEval = resolveModel(evalModel, suite?.eval_model);
    const stageRewrite = resolveModel(rewriteModel, suite?.rewrite_model);

    const stage: WorkflowRunStage = {
      position,
      suite_id: step.suite_id,
      suite_name: suite?.name ?? step.suite_id,
      mode: step.mode,
      input_copy: inputCopy,
      initial_grades: [],
      iterations: [],
      output_copy: inputCopy,
      status: "running",
      eval_model: stageEval,
      rewrite_model: stageRewrite,
    };
    stages.push(stage);
    onStages([...stages]);

    try {
      // 1) Assess the incoming copy.
      stage.initial_grades = await assess(generationId, stepCriteria, inputCopy, step.suite_id, stageEval);
      onStages([...stages]);

      // 2) Rewrite per mode, feeding each rewrite forward and re-grading.
      const maxIters = maxIterationsFor(step.mode);
      let base = inputCopy;
      let feedback: RewriteFeedbackItem[] = stage.initial_grades;
      for (let i = 0; i < maxIters; i++) {
        const { improved_content, thesis } = await evalsApi.rewrite(generationId, feedback, base, step.suite_id, stageRewrite);
        const grades = await assess(generationId, stepCriteria, improved_content, step.suite_id, stageEval);
        stage.iterations.push({ content: improved_content, thesis, grades, created_at: new Date().toISOString() });
        stage.output_copy = improved_content;
        onStages([...stages]);
        base = improved_content;
        feedback = grades;
        // "Rewrite until pass" stops early once every criterion passes.
        if (step.mode === "rewrite_until_pass" && grades.length > 0 && grades.every(isPass)) break;
      }

      stage.status = "done";
    } catch (e) {
      stage.status = "error";
      stage.error = e instanceof Error ? e.message : String(e);
      onStages([...stages]);
      throw e; // stop the pipeline; the caller marks the run errored
    }

    onStages([...stages]);
    inputCopy = stage.output_copy; // hand off to the next stage
  }

  return stages;
}
