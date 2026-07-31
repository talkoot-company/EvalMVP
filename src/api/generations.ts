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
  dataset: string | null;
  req_json: Record<string, unknown> | null;
  resp_json: Record<string, unknown> | null;
  // True when the generation has a non-empty stored product_json record. Present
  // on list responses (computed server-side); may be undefined on single GETs.
  has_product_data?: boolean;
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
  list: (params: { search?: string; model?: string; dataset?: string; limit?: number; offset?: number; validProductData?: boolean; genTypes?: string[]; minLen?: number; maxLen?: number } = {}): Promise<GenerationsPage> => {
    const qs = new URLSearchParams();
    if (params.search) qs.set("search", params.search);
    if (params.model) qs.set("model", params.model);
    if (params.dataset && params.dataset !== "all") qs.set("dataset", params.dataset);
    if (params.limit !== undefined) qs.set("limit", String(params.limit));
    if (params.offset !== undefined) qs.set("offset", String(params.offset));
    if (params.validProductData) qs.set("valid_product_data", "1");
    if (params.genTypes && params.genTypes.length) qs.set("gen_types", params.genTypes.join(","));
    if (params.minLen != null) qs.set("min_len", String(params.minLen));
    if (params.maxLen != null) qs.set("max_len", String(params.maxLen));
    return apiFetch(`/generations?${qs}`);
  },

  get: (id: string): Promise<Generation> => apiFetch(`/generations/${id}`),

  models: (): Promise<string[]> => apiFetch("/generations/models"),

  datasets: (): Promise<string[]> => apiFetch("/generations/datasets"),

  lengthPercentiles: (params: { dataset?: string; genTypes?: string[] } = {}): Promise<LengthPercentiles> => {
    const qs = new URLSearchParams();
    if (params.dataset && params.dataset !== "all") qs.set("dataset", params.dataset);
    if (params.genTypes && params.genTypes.length) qs.set("gen_types", params.genTypes.join(","));
    return apiFetch(`/generations/length-percentiles?${qs}`);
  },
};

// Character-length percentiles of response_content over the reference types
// (Description+Title by default) — used to seed the length-filter bands.
export interface LengthPercentiles {
  count: number;
  p10: number;
  p25: number;
  p50: number;
  p75: number;
  p90: number;
}
