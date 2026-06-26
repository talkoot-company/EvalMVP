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

export interface PostEditRequest {
  generation_id: string;
  criterion_name: string;
  score: string;
  desired_score: string;
  rationale: string;
  evidence: string[];
}

export const evalsApi = {
  listCriteria: (): Promise<EvalCriterion[]> => apiFetch("/eval/criteria"),

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

  // Re-grade arbitrary content (e.g. the post-edited copy) against a criterion,
  // reusing the generation's product data for grounding/hallucination checks.
  regrade: (generation_id: string, opts: { criterion_id?: string; criterion_name?: string; content: string }): Promise<RegradeResult> =>
    apiFetch("/eval/regrade", {
      method: "POST",
      body: JSON.stringify({ generation_id, ...opts }),
    }),
};
