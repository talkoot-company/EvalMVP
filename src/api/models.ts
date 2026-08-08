const BASE = "/api";

async function apiFetch<T>(path: string): Promise<T> {
  const res = await fetch(`${BASE}${path}`);
  if (!res.ok) throw new Error(`API GET ${path} → ${res.status}`);
  return res.json() as Promise<T>;
}

export interface ModelOption {
  value: string; // Azure deployment name (sent as the `model` field)
  label: string;
  note?: string;
}

export interface ModelsResponse {
  default: string;
  models: ModelOption[];
}

// The curated list of LLM deployments available for eval/rewrite selection.
export const modelsApi = {
  list: (): Promise<ModelsResponse> => apiFetch("/models"),
};
