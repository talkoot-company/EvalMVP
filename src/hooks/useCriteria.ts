import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { criteriaApi } from "@/api/criteria";
import type { Criterion } from "@/types";

export const CRITERIA_QUERY_KEY = ["criteria"] as const;

export function useCriteria() {
  return useQuery({
    queryKey: CRITERIA_QUERY_KEY,
    queryFn: criteriaApi.list,
    staleTime: 1000 * 60 * 5,
  });
}

export function useCreateCriterion() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (criterion: Criterion | Omit<Criterion, "created_at" | "updated_at">) =>
      criteriaApi.create(criterion),
    onSuccess: () => qc.invalidateQueries({ queryKey: CRITERIA_QUERY_KEY }),
  });
}

export function useUpdateCriterion() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, data }: { id: string; data: Partial<Criterion> }) =>
      criteriaApi.update(id, data),
    onSuccess: () => qc.invalidateQueries({ queryKey: CRITERIA_QUERY_KEY }),
  });
}

export function useDeleteCriterion() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => criteriaApi.delete(id),
    onSuccess: () => qc.invalidateQueries({ queryKey: CRITERIA_QUERY_KEY }),
  });
}

export function useToggleActiveCriterion() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => criteriaApi.toggleActive(id),
    onSuccess: () => qc.invalidateQueries({ queryKey: CRITERIA_QUERY_KEY }),
  });
}

export function useSaveCriteria() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (criteria: Criterion[]) => {
      const existing = qc.getQueryData<Criterion[]>(CRITERIA_QUERY_KEY) ?? [];
      const existingIds = new Set(existing.map((c) => c.id));
      const newIds = new Set(criteria.map((c) => c.id));

      const toCreate = criteria.filter((c) => !existingIds.has(c.id));
      const toUpdate = criteria.filter((c) => existingIds.has(c.id));
      const toDelete = existing.filter((c) => !newIds.has(c.id));

      await Promise.all([
        ...toCreate.map((c) => criteriaApi.create(c)),
        ...toUpdate.map((c) => criteriaApi.update(c.id, c)),
        ...toDelete.map((c) => criteriaApi.delete(c.id)),
      ]);
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: CRITERIA_QUERY_KEY }),
  });
}
