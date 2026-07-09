import { useState, useEffect, useRef } from "react";
import { Loader2, Pencil } from "lucide-react";

// ---------------------------------------------------------------------------
// Inline editable field — click to edit, blur/Enter to save, Escape to cancel.
// Multiline uses an auto-growing textarea so the edit box matches the wrapped
// display height. Shared by the criterion and suite detail pages.
// ---------------------------------------------------------------------------
export interface InlineEditProps {
  value: string;
  onSave: (next: string) => void;
  multiline?: boolean;
  minRows?: number;
  placeholder?: string;
  className?: string;
  saving?: boolean;
}

export function InlineEdit({ value, onSave, multiline = false, minRows = 3, placeholder = "—", className = "", saving = false }: InlineEditProps) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(value);
  const [hovered, setHovered] = useState(false);
  const ref = useRef<HTMLTextAreaElement & HTMLInputElement>(null);

  useEffect(() => { setDraft(value); }, [value]);

  const autosize = (el: HTMLTextAreaElement | null) => {
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${el.scrollHeight}px`;
  };

  useEffect(() => {
    if (!editing) return;
    ref.current?.focus();
    if (multiline) autosize(ref.current);
  }, [editing, multiline]);

  function commit() {
    setEditing(false);
    if (draft !== value) onSave(draft);
  }

  function handleKeyDown(e: React.KeyboardEvent) {
    if (!multiline && e.key === "Enter") { e.preventDefault(); commit(); }
    if (e.key === "Escape") { setDraft(value); setEditing(false); }
  }

  if (editing) {
    const shared = {
      value: draft,
      onBlur: commit,
      onKeyDown: handleKeyDown,
      className: `w-full rounded border border-blue-400 bg-blue-50/30 px-2 py-1 text-sm outline-none ring-1 ring-blue-400 resize-none ${className}`,
    };
    return multiline
      ? (
        <textarea
          {...shared}
          ref={ref}
          rows={minRows}
          onChange={(e) => { setDraft(e.target.value); autosize(e.target); }}
          style={{ minHeight: `${minRows * 1.6}rem`, overflow: "hidden" }}
        />
      )
      : (
        <input
          {...shared}
          ref={ref}
          onChange={(e) => setDraft(e.target.value)}
        />
      );
  }

  return (
    <span
      className={`group relative inline-block w-full cursor-text rounded px-1 py-0.5 transition-colors ${hovered ? "bg-muted/60 ring-1 ring-muted-foreground/20" : ""} ${className}`}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      onClick={() => { setDraft(value); setEditing(true); }}
    >
      {saving
        ? <Loader2 className="inline h-3 w-3 animate-spin text-muted-foreground mr-1" />
        : null}
      {value?.trim()
        ? <span className="whitespace-pre-wrap">{value}</span>
        : <span className="text-muted-foreground italic">{placeholder}</span>}
      {hovered && !saving && (
        <Pencil className="absolute right-1 top-1 h-3 w-3 text-muted-foreground/60 opacity-80" />
      )}
    </span>
  );
}
