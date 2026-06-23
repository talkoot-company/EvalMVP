/** mapping: { criteria_content_type → generation_type[] } */
export type TypeMapping = Record<string, string[]>;

async function apiFetch<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`/api${path}`, {
    headers: { "Content-Type": "application/json" },
    ...init,
  });
  if (!res.ok) throw new Error(`${init?.method ?? "GET"} ${path} → ${res.status}`);
  return res.json() as Promise<T>;
}

export const mappingApi = {
  get: (): Promise<TypeMapping> => apiFetch("/mapping"),
  update: (mapping: TypeMapping): Promise<TypeMapping> =>
    apiFetch("/mapping", { method: "PUT", body: JSON.stringify(mapping) }),
  generationTypes: (): Promise<string[]> => apiFetch("/mapping/generation-types"),
};
