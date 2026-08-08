import { useQuery } from "@tanstack/react-query";
import { modelsApi } from "@/api/models";

// Available LLM deployments for eval/rewrite model selection. Rarely changes, so
// cache it for the session.
export function useModels() {
  return useQuery({
    queryKey: ["models"],
    queryFn: () => modelsApi.list(),
    staleTime: Infinity,
  });
}
