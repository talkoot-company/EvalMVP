import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { suiteWorkflowsApi, type NewSuiteWorkflow } from "@/api/suiteWorkflows";
import type { SuiteWorkflow } from "@/types";

export const SUITE_WORKFLOWS_QUERY_KEY = ["suite-workflows"] as const;

export function useSuiteWorkflows() {
  return useQuery({
    queryKey: SUITE_WORKFLOWS_QUERY_KEY,
    queryFn: suiteWorkflowsApi.list,
    staleTime: 1000 * 60 * 5,
  });
}

export function useCreateSuiteWorkflow() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (workflow: NewSuiteWorkflow) => suiteWorkflowsApi.create(workflow),
    onSuccess: () => qc.invalidateQueries({ queryKey: SUITE_WORKFLOWS_QUERY_KEY }),
  });
}

export function useUpdateSuiteWorkflow() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, data }: { id: string; data: Partial<Pick<SuiteWorkflow, "name" | "description" | "steps">> }) =>
      suiteWorkflowsApi.update(id, data),
    onSuccess: () => qc.invalidateQueries({ queryKey: SUITE_WORKFLOWS_QUERY_KEY }),
  });
}

export function useSuiteWorkflowRuns(workflowId: string) {
  return useQuery({
    queryKey: ["suite-workflow-runs", workflowId],
    queryFn: () => suiteWorkflowsApi.runs.list(workflowId),
    enabled: !!workflowId,
    staleTime: 1000 * 30,
  });
}

export function useSuiteWorkflowRun(runId: string) {
  return useQuery({
    queryKey: ["suite-workflow-run", runId],
    queryFn: () => suiteWorkflowsApi.runs.get(runId),
    enabled: !!runId,
    staleTime: 1000 * 30,
  });
}

export function useDeleteSuiteWorkflow() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => suiteWorkflowsApi.delete(id),
    onSuccess: () => qc.invalidateQueries({ queryKey: SUITE_WORKFLOWS_QUERY_KEY }),
  });
}
