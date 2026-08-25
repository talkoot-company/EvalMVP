import type { SuiteWorkflow, SuiteWorkflowRun, SuiteWorkflowRunData, WorkflowStep } from "@/types";

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

export interface NewSuiteWorkflow {
  name: string;
  description?: string | null;
}

export const suiteWorkflowsApi = {
  list: (): Promise<SuiteWorkflow[]> => apiFetch("/suite-workflows"),

  get: (id: string): Promise<SuiteWorkflow> => apiFetch(`/suite-workflows/${id}`),

  create: (workflow: NewSuiteWorkflow): Promise<SuiteWorkflow> =>
    apiFetch("/suite-workflows", { method: "POST", body: JSON.stringify(workflow) }),

  update: (id: string, patch: Partial<Pick<SuiteWorkflow, "name" | "description" | "steps">>): Promise<SuiteWorkflow> =>
    apiFetch(`/suite-workflows/${id}`, { method: "PUT", body: JSON.stringify(patch) }),

  delete: (id: string): Promise<void> =>
    apiFetch(`/suite-workflows/${id}`, { method: "DELETE" }),

  // Run history (one run = one workflow × one generation).
  runs: {
    list: (workflowId: string): Promise<SuiteWorkflowRun[]> =>
      apiFetch(`/suite-workflows/${workflowId}/runs`),
    create: (workflowId: string, generationId: string, data?: Partial<SuiteWorkflowRunData>): Promise<SuiteWorkflowRun> =>
      apiFetch(`/suite-workflows/${workflowId}/runs`, {
        method: "POST",
        body: JSON.stringify({ generation_id: generationId, data }),
      }),
    get: (runId: string): Promise<SuiteWorkflowRun> => apiFetch(`/suite-workflow-runs/${runId}`),
    update: (runId: string, patch: { status?: SuiteWorkflowRun["status"]; data?: SuiteWorkflowRunData }): Promise<SuiteWorkflowRun> =>
      apiFetch(`/suite-workflow-runs/${runId}`, { method: "PUT", body: JSON.stringify(patch) }),
    delete: (runId: string): Promise<void> =>
      apiFetch(`/suite-workflow-runs/${runId}`, { method: "DELETE" }),
  },
};

export type { WorkflowStep };
