import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { suitesApi, type NewSuite } from "@/api/suites";
import type { Suite } from "@/types";

export const SUITES_QUERY_KEY = ["suites"] as const;

export function useSuites() {
  return useQuery({
    queryKey: SUITES_QUERY_KEY,
    queryFn: suitesApi.list,
    staleTime: 1000 * 60 * 5,
  });
}

export function useCreateSuite() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (suite: NewSuite) => suitesApi.create(suite),
    onSuccess: () => qc.invalidateQueries({ queryKey: SUITES_QUERY_KEY }),
  });
}

export function useUpdateSuite() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, data }: { id: string; data: Partial<Pick<Suite, "name" | "description" | "active">> }) =>
      suitesApi.update(id, data),
    onSuccess: () => qc.invalidateQueries({ queryKey: SUITES_QUERY_KEY }),
  });
}

export function useDeleteSuite() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => suitesApi.delete(id),
    onSuccess: () => qc.invalidateQueries({ queryKey: SUITES_QUERY_KEY }),
  });
}

export function useToggleActiveSuite() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => suitesApi.toggleActive(id),
    onSuccess: () => qc.invalidateQueries({ queryKey: SUITES_QUERY_KEY }),
  });
}
