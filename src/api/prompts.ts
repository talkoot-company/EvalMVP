import type { PromptTemplate } from "@/types";

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

export const promptsApi = {
  list: (): Promise<PromptTemplate[]> => apiFetch("/prompts"),

  get: (id: string): Promise<PromptTemplate> => apiFetch(`/prompts/${id}`),

  update: (id: string, patch: Partial<Pick<PromptTemplate, "name" | "description" | "template">>): Promise<PromptTemplate> =>
    apiFetch(`/prompts/${id}`, { method: "PUT", body: JSON.stringify(patch) }),

  reset: (id: string): Promise<PromptTemplate> =>
    apiFetch(`/prompts/${id}/reset`, { method: "POST" }),
};
