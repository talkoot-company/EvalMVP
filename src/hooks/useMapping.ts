import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { mappingApi, type TypeMapping } from "@/api/mapping";

export const MAPPING_KEY = ["type_mapping"] as const;
export const GEN_TYPES_KEY = ["generation_types"] as const;

export function useTypeMapping() {
  return useQuery({
    queryKey: MAPPING_KEY,
    queryFn: mappingApi.get,
    staleTime: 1000 * 60 * 10,
  });
}

export function useGenerationTypes() {
  return useQuery({
    queryKey: GEN_TYPES_KEY,
    queryFn: mappingApi.generationTypes,
    staleTime: Infinity,
  });
}

export function useUpdateMapping() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (mapping: TypeMapping) => mappingApi.update(mapping),
    onSuccess: (data) => qc.setQueryData(MAPPING_KEY, data),
  });
}
