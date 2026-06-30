import { useQuery } from "@tanstack/react-query";
import { generationsApi } from "@/api/generations";

export function useGenerationCountsByType() {
  return useQuery<Record<string, number>>({
    queryKey: ["generations", "counts-by-type"],
    queryFn: () => fetch("/api/generations/counts-by-type").then((r) => r.json()),
    staleTime: 1000 * 60 * 5,
  });
}

export function useGenerations(params: { search?: string; model?: string; limit?: number; offset?: number; validProductData?: boolean } = {}) {
  return useQuery({
    queryKey: ["generations", params],
    queryFn: () => generationsApi.list(params),
    staleTime: 1000 * 60 * 5,
  });
}

export function useGeneration(id: string) {
  return useQuery({
    queryKey: ["generations", id],
    queryFn: () => generationsApi.get(id),
    enabled: !!id,
  });
}

export function useGenerationModels() {
  return useQuery({
    queryKey: ["generations", "models"],
    queryFn: generationsApi.models,
    staleTime: 1000 * 60 * 10,
  });
}
