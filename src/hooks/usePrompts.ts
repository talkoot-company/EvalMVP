import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { promptsApi } from "@/api/prompts";
import type { PromptTemplate } from "@/types";

export const PROMPTS_QUERY_KEY = ["prompts"] as const;

export function usePrompts() {
  return useQuery({
    queryKey: PROMPTS_QUERY_KEY,
    queryFn: promptsApi.list,
    staleTime: 1000 * 60 * 5,
  });
}

export function useUpdatePrompt() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, data }: { id: string; data: Partial<Pick<PromptTemplate, "name" | "description" | "template">> }) =>
      promptsApi.update(id, data),
    onSuccess: () => qc.invalidateQueries({ queryKey: PROMPTS_QUERY_KEY }),
  });
}

export function useResetPrompt() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => promptsApi.reset(id),
    onSuccess: () => qc.invalidateQueries({ queryKey: PROMPTS_QUERY_KEY }),
  });
}
