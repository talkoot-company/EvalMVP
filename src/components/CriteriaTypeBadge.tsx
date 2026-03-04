import { cn } from "@/lib/utils";
import type { CriteriaType } from "@/types";

const typeConfig: Record<CriteriaType, { label: string; className: string }> = {
  "yes-no": { label: "Yes / No", className: "bg-accent text-accent-foreground" },
  "numerical-scale": { label: "Scale 1–4", className: "bg-secondary/20 text-secondary" },
  "numerical-count": { label: "Count", className: "bg-info/15 text-info" },
};

export function CriteriaTypeBadge({ type }: { type: CriteriaType }) {
  const config = typeConfig[type];
  return (
    <span className={cn("inline-flex items-center rounded-md px-2 py-0.5 text-xs font-medium", config.className)}>
      {config.label}
    </span>
  );
}
