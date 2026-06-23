import type { Criterion } from "@/types";

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

export const criteriaApi = {
  list: (): Promise<Criterion[]> => apiFetch("/criteria"),

  get: (id: string): Promise<Criterion> => apiFetch(`/criteria/${id}`),

  create: (criterion: Criterion | Omit<Criterion, "created_at" | "updated_at">): Promise<Criterion> =>
    apiFetch("/criteria", { method: "POST", body: JSON.stringify(criterion) }),

  update: (id: string, criterion: Partial<Criterion>): Promise<Criterion> =>
    apiFetch(`/criteria/${id}`, { method: "PUT", body: JSON.stringify(criterion) }),

  delete: (id: string): Promise<void> =>
    apiFetch(`/criteria/${id}`, { method: "DELETE" }),

  toggleActive: (id: string): Promise<Criterion> =>
    apiFetch(`/criteria/${id}/toggle-active`, { method: "PUT" }),
};
