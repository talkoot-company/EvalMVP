export interface EvalCriterion {
  criteriaId: string;
  criteriaCode: string;
  criteriaName: string;
  criteriaDefinition: string;
}

export interface EvalResult {
  result_id: string;
  generation_id: string;
  criterion_id: string;
  criterion_name: string;
  desired_score: string;
  score: string;
  rationale: string;
  evidence: string[];
  product_name: string;
  run_at: string;
  html_report: string | null;
  // Set when no valid product data could be extracted to ground this eval.
  extraction_warning?: string | null;
}

async function apiFetch<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`/api${path}`, {
    headers: { "Content-Type": "application/json" },
    ...init,
  });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`${init?.method ?? "GET"} ${path} → ${res.status}: ${body}`);
  }
  if (res.status === 204) return undefined as T;
  return res.json() as Promise<T>;
}

export interface RegradeResult {
  generation_id: string;
  criterion_id: string;
  criterion_name: string;
  desired_score: string;
  score: string;
  rationale: string;
  evidence: string[];
  product_name: string;
}

// A graded score snapshot stored inside a refinement chain.
export interface ChainGrade {
  score: string;
  desired_score: string;
  rationale: string;
  evidence: string[];
  // Present on the chain's `original` so the eval result can be fully restored
  // without re-running it.
  criterion_name?: string;
  product_name?: string;
}

export interface ChainIteration {
  content: string;      // the post-edited copy
  comments: string;     // the (possibly user-edited) feedback that generated it
  regrade?: ChainGrade; // the score for this iteration, once re-graded
}

export interface RefinementChainData {
  original?: ChainGrade;          // the original eval that started the chain
  iterations: ChainIteration[];
}

export interface RefinementChain {
  id: string;
  generation_id: string;
  criterion_id: string;
  criterion_name: string | null;
  data: RefinementChainData;
  created_at: string;
  updated_at: string;
}

// One link in a SUITE rewrite chain: the rewritten copy plus its re-grade against
// every selected criterion (multi-criterion, unlike the single-criterion
// RefinementChain above), and the orchestration thesis that shaped it.
export interface RewriteIteration {
  content: string;
  created_at: string;
  grades: RewriteFeedbackItem[];
  thesis?: string;
}

export interface SuiteRewriteChainData {
  iterations: RewriteIteration[];
}

// A row from GET /api/suite/rewrite-chains (one per generation in the suite).
export interface SuiteRewriteChainRow {
  generation_id: string;
  data: SuiteRewriteChainData;
}

export interface PostEditRequest {
  generation_id: string;
  criterion_name: string;
  score: string;
  desired_score: string;
  rationale: string;
  evidence: string[];
  // Base copy to improve. Omit for the first edit (server uses the generation's
  // original output); pass a prior post-edit for iterative refinement.
  content?: string;
}

export interface ChatMessage {
  role: string;
  content: string;
}

// One criterion's feedback, aggregated into a multi-criteria rewrite prompt.
// `criterion_id` is carried so the client can re-grade each criterion on the
// rewritten copy (the server's rewrite prompt ignores it).
export interface RewriteFeedbackItem {
  criterion_id: string;
  criterion_name: string;
  score: string;
  desired_score: string;
  rationale: string;
  evidence: string[];
}

// Request to reconstruct the exact chat chain for an eval, a post-edit, or a
// rewrite, WITHOUT calling the LLM (used by the "view chat" modal).
export interface ChatMessagesRequest {
  generation_id: string;
  mode: "eval" | "postedit" | "rewrite";
  criterion_id?: string;
  criterion_name?: string;
  content?: string;
  // Only used for the post-edit chain (the feedback that drove the rewrite).
  score?: string;
  desired_score?: string;
  rationale?: string;
  evidence?: string[];
  // Only used for the rewrite chain (the aggregated per-criterion feedback).
  feedback?: RewriteFeedbackItem[];
  // Rewrite chain: the suite whose orchestration prompt precedes the rewrite, and
  // the thesis that orchestration produced (stored per iteration) so the
  // reconstructed chain shows the exact prompt+thesis that ran.
  suite_id?: string;
  thesis?: string;
}

export const evalsApi = {
  listCriteria: (): Promise<EvalCriterion[]> => apiFetch("/eval/criteria"),

  // Reconstruct the chat chain (no LLM call) for the "view chat" modal.
  messages: (req: ChatMessagesRequest): Promise<{ mode: string; messages: ChatMessage[] }> =>
    apiFetch("/eval/messages", { method: "POST", body: JSON.stringify(req) }),

  run: (generation_id: string, opts: { criterion_id?: string; criterion_name?: string }): Promise<EvalResult> =>
    apiFetch("/eval/run", {
      method: "POST",
      body: JSON.stringify({ generation_id, ...opts }),
    }),

  getResults: (generation_id: string): Promise<EvalResult[]> =>
    apiFetch(`/eval/results/${generation_id}`),

  postEdit: (req: PostEditRequest): Promise<{ improved_content: string }> =>
    apiFetch("/post-edit", {
      method: "POST",
      body: JSON.stringify(req),
    }),

  // Rewrite a generation's copy using the aggregated feedback from every
  // criterion it was evaluated against. `suite_id` selects which suite's rewrite
  // orchestration prompt drives the coherence-thesis step (default otherwise).
  // Returns the improved copy plus the thesis the orchestration produced.
  rewrite: (generation_id: string, feedback: RewriteFeedbackItem[], content?: string, suite_id?: string): Promise<{ improved_content: string; thesis?: string }> =>
    apiFetch("/rewrite", {
      method: "POST",
      body: JSON.stringify({ generation_id, feedback, content, suite_id }),
    }),

  // Re-grade arbitrary content (e.g. the post-edited copy) against a criterion,
  // reusing the generation's product data for grounding/hallucination checks.
  regrade: (generation_id: string, opts: { criterion_id?: string; criterion_name?: string; content: string }): Promise<RegradeResult> =>
    apiFetch("/eval/regrade", {
      method: "POST",
      body: JSON.stringify({ generation_id, ...opts }),
    }),

  // Saved refinement chains (post-edit / re-grade history per generation+criterion).
  chain: {
    get: (criterionId: string, generationId: string): Promise<RefinementChain | null> =>
      apiFetch(`/eval/chain?criterion_id=${encodeURIComponent(criterionId)}&generation_id=${encodeURIComponent(generationId)}`),
    save: (req: { criterion_id: string; generation_id: string; criterion_name?: string; data: RefinementChainData }): Promise<RefinementChain> =>
      apiFetch("/eval/chain", { method: "PUT", body: JSON.stringify(req) }),
    remove: (criterionId: string, generationId: string): Promise<void> =>
      apiFetch(`/eval/chain?criterion_id=${encodeURIComponent(criterionId)}&generation_id=${encodeURIComponent(generationId)}`, { method: "DELETE" }),
    generationIds: (criterionId: string): Promise<string[]> =>
      apiFetch(`/eval/chains?criterion_id=${encodeURIComponent(criterionId)}`),
  },

  // Suite rewrite chains (aggregate-rewrite iterations, persisted per suite+generation).
  suiteRewriteChain: {
    list: (suiteId: string): Promise<SuiteRewriteChainRow[]> =>
      apiFetch(`/suite/rewrite-chains?suite_id=${encodeURIComponent(suiteId)}`),
    save: (suiteId: string, generationId: string, data: SuiteRewriteChainData): Promise<unknown> =>
      apiFetch("/suite/rewrite-chain", {
        method: "PUT",
        body: JSON.stringify({ suite_id: suiteId, generation_id: generationId, data }),
      }),
    remove: (suiteId: string, generationId: string): Promise<void> =>
      apiFetch(`/suite/rewrite-chain?suite_id=${encodeURIComponent(suiteId)}&generation_id=${encodeURIComponent(generationId)}`, { method: "DELETE" }),
  },
};
