import type { Suite } from "@/types";

const BASE = "/api";

async function apiFetch<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${BASE}${path}`, {
    headers: { "Content-Type": "application/json" },
    ...init,
  });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`API ${init?.method ?? "GET"} ${path} → ${res.status}: ${body}`);
  }
  if (res.status === 204) return undefined as T;
  return res.json() as Promise<T>;
}

export interface NewSuite {
  name: string;
  description?: string | null;
  active?: boolean;
}

export const suitesApi = {
  list: (): Promise<Suite[]> => apiFetch("/suites"),

  get: (id: string): Promise<Suite> => apiFetch(`/suites/${id}`),

  create: (suite: NewSuite): Promise<Suite> =>
    apiFetch("/suites", { method: "POST", body: JSON.stringify(suite) }),

  update: (id: string, patch: Partial<Pick<Suite, "name" | "description" | "active" | "rewrite_orchestration_prompt">>): Promise<Suite> =>
    apiFetch(`/suites/${id}`, { method: "PUT", body: JSON.stringify(patch) }),

  delete: (id: string): Promise<void> =>
    apiFetch(`/suites/${id}`, { method: "DELETE" }),

  toggleActive: (id: string): Promise<Suite> =>
    apiFetch(`/suites/${id}/toggle-active`, { method: "PUT" }),

  // suite ↔ criteria association (junction table)
  addCriterion: (id: string, criterionId: string): Promise<void> =>
    apiFetch(`/suites/${id}/criteria`, { method: "POST", body: JSON.stringify({ criterion_id: criterionId }) }),

  removeCriterion: (id: string, criterionId: string): Promise<void> =>
    apiFetch(`/suites/${id}/criteria/${encodeURIComponent(criterionId)}`, { method: "DELETE" }),
};

export interface OrchestrationPlaceholder {
  token: string;
  description: string;
  required: boolean;
}

export interface RewriteOrchestrationDefault {
  template: string;
  placeholders: OrchestrationPlaceholder[];
}

// The built-in default rewrite-orchestration prompt + its available parameters,
// used to prefill the suite editor when a suite has no custom prompt and to render
// the parameter legend.
export const getRewriteOrchestrationDefault = (): Promise<RewriteOrchestrationDefault> =>
  apiFetch("/rewrite-orchestration/default");
