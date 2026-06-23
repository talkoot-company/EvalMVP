import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { evalsApi } from "@/api/evals";

export function useEvalCriteria() {
  return useQuery({
    queryKey: ["eval", "criteria"],
    queryFn: evalsApi.listCriteria,
    staleTime: 1000 * 60 * 30, // criteria don't change often
    retry: 1,
  });
}

export function useEvalResults(generationId: string) {
  return useQuery({
    queryKey: ["eval", "results", generationId],
    queryFn: () => evalsApi.getResults(generationId),
    enabled: !!generationId,
  });
}

export function useRunEval() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ generationId, criterionId }: { generationId: string; criterionId: string }) =>
      evalsApi.run(generationId, { criterion_id: criterionId }),
    onSuccess: (_data, vars) => {
      qc.invalidateQueries({ queryKey: ["eval", "results", vars.generationId] });
    },
  });
}
