import { useModels } from "@/hooks/useModels";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";

// Sentinel for "no explicit choice → inherit the default" (Radix Select values
// must be non-empty strings, so null can't be a SelectItem value directly).
const DEFAULT_VALUE = "__default__";

// Model picker backed by the curated /api/models catalog. `value` is a deployment
// name or null (= inherit default). Emits null when the "Default" option is chosen.
export function ModelSelect({
  value,
  onChange,
  disabled,
  className,
  defaultOptionLabel,
}: {
  value: string | null;
  onChange: (value: string | null) => void;
  disabled?: boolean;
  className?: string;
  // Override the first ("inherit") option's label, e.g. "Suite default (GPT-5)".
  defaultOptionLabel?: string;
}) {
  const { data } = useModels();
  const models = data?.models ?? [];
  const defaultModel = data?.default ?? "gpt-5";
  const defaultLabel = defaultOptionLabel ?? `Default (${defaultModel})`;

  return (
    <Select
      value={value ?? DEFAULT_VALUE}
      onValueChange={(v) => onChange(v === DEFAULT_VALUE ? null : v)}
      disabled={disabled}
    >
      <SelectTrigger className={className}>
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        <SelectItem value={DEFAULT_VALUE}>{defaultLabel}</SelectItem>
        {models.map((m) => (
          <SelectItem key={m.value} value={m.value}>
            {m.label}{m.note ? ` · ${m.note}` : ""}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
