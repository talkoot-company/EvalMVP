// Human-readable labels for the generation `dataset` discriminator. The stored
// values are lowercase slugs (e.g. "cocacola", "puma"); unknown datasets fall
// back to a title-cased version of the slug so new datasets render sensibly
// without a code change.
const DATASET_LABELS: Record<string, string> = {
  cocacola: "Coca-Cola",
  puma: "PUMA",
};

export function datasetLabel(value: string): string {
  if (!value) return "Unknown";
  return DATASET_LABELS[value] ?? value.charAt(0).toUpperCase() + value.slice(1);
}
