export interface Generation {
  generation_id: string;
  model: string | null;
  created_at: number | null;
  system_prompt: string | null;
  last_user_message: string | null;
  few_shot_count: number | null;
  temperature: number | null;
  max_tokens: number | null;
  response_content: string | null;
  prompt_tokens: number | null;
  completion_tokens: number | null;
  total_tokens: number | null;
  finish_reason: string | null;
  is_valid: boolean | null;
  req_json: Record<string, unknown> | null;
  resp_json: Record<string, unknown> | null;
}

export interface GenerationsPage {
  total: number;
  limit: number;
  offset: number;
  items: Generation[];
}

async function apiFetch<T>(path: string): Promise<T> {
  const res = await fetch(`/api${path}`);
  if (!res.ok) throw new Error(`GET ${path} → ${res.status}`);
  return res.json() as Promise<T>;
}

export const generationsApi = {
  list: (params: { search?: string; model?: string; limit?: number; offset?: number } = {}): Promise<GenerationsPage> => {
    const qs = new URLSearchParams();
    if (params.search) qs.set("search", params.search);
    if (params.model) qs.set("model", params.model);
    if (params.limit !== undefined) qs.set("limit", String(params.limit));
    if (params.offset !== undefined) qs.set("offset", String(params.offset));
    return apiFetch(`/generations?${qs}`);
  },

  get: (id: string): Promise<Generation> => apiFetch(`/generations/${id}`),

  models: (): Promise<string[]> => apiFetch("/generations/models"),
};
