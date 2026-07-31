import { useState, useEffect } from "react";
import { evalsApi, type ChatMessagesRequest } from "@/api/evals";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription,
} from "@/components/ui/dialog";
import { Loader2, ChevronRight, ChevronDown } from "lucide-react";

// The data for one rewrite step's flow. `request` is used to reconstruct the
// (un-stored) orchestration prompt via /api/eval/messages. Memoize this object in
// the parent so the fetch effect doesn't re-run on every render.
export interface RewriteFlowData {
  title: string;
  originalLabel: string;
  originalCopy: string;
  request: ChatMessagesRequest;
  thesis?: string;
  resultCopy: string;
}

type Tone = "muted" | "green" | "amber" | "blue";
const TONE: Record<Tone, string> = {
  muted: "bg-muted/40 border",
  green: "bg-green-50/50 border border-green-200",
  amber: "bg-amber-50/50 border border-amber-200",
  blue: "bg-blue-50/50 border border-blue-200",
};

function FlowBox({ label, text, tone, defaultOpen = false }: { label: string; text: string; tone: Tone; defaultOpen?: boolean }) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div className="border rounded-md">
      <button
        className="w-full flex items-center gap-2 px-3 py-2 text-left hover:bg-muted/40 transition-colors"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
      >
        {open ? <ChevronDown className="h-3.5 w-3.5 shrink-0 text-muted-foreground" /> : <ChevronRight className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />}
        <span className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground shrink-0">{label}</span>
        {!open && <span className="flex-1 min-w-0 truncate text-xs text-muted-foreground">{text || "(empty)"}</span>}
      </button>
      {open && (
        <pre className={`mx-3 mb-3 whitespace-pre-wrap break-words rounded-md p-2 text-xs leading-relaxed font-sans ${TONE[tone]}`}>
          {text || "(empty)"}
        </pre>
      )}
    </div>
  );
}

// Shows one rewrite step as a clearly-labeled, box-by-box flow:
// original copy → orchestration prompt → orchestration result (thesis) → new
// rewrite result. Each box expands independently so the flow is easy to follow.
export function RewriteFlowModal({ open, onOpenChange, flow }: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  flow: RewriteFlowData | null;
}) {
  const [orchPrompt, setOrchPrompt] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  // Fetch keyed on a STABLE identifier for the flow step, not the `flow` object
  // identity — the parent rebuilds `flow` on every render (baseFeedback is a fresh
  // array each time), so depending on the object would refetch forever ("Building
  // orchestration prompt…" that never settles).
  const flowKey = flow ? `${flow.request.generation_id}::${flow.title}` : null;
  useEffect(() => {
    if (!open || !flow) return;
    let cancelled = false;
    setLoading(true);
    setError(null);
    setOrchPrompt(null);
    evalsApi
      .messages(flow.request)
      .then((r) => { if (!cancelled) setOrchPrompt(r.messages[0]?.content ?? ""); })
      .catch((e) => { if (!cancelled) setError(String(e)); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- keyed on flowKey; `flow` identity is intentionally unstable
  }, [open, flowKey]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-3xl max-h-[85vh] flex flex-col gap-3">
        <DialogHeader>
          <DialogTitle className="text-base">{flow?.title ?? "Rewrite flow"}</DialogTitle>
          <DialogDescription>
            The rewrite flow, step by step — expand each box to see the detail.
          </DialogDescription>
        </DialogHeader>

        <div className="overflow-y-auto flex-1 space-y-2 pr-1">
          {flow && (
            <>
              <FlowBox label={flow.originalLabel} text={flow.originalCopy} tone="muted" />

              {loading ? (
                <p className="text-sm text-muted-foreground flex items-center gap-1.5">
                  <Loader2 className="h-3.5 w-3.5 animate-spin" /> Building orchestration prompt…
                </p>
              ) : error ? (
                <p className="text-sm text-destructive whitespace-pre-wrap">{error}</p>
              ) : (
                <FlowBox label="Rewrite orchestration prompt" text={orchPrompt ?? ""} tone="blue" />
              )}

              <FlowBox
                label="Orchestration result (thesis)"
                text={flow.thesis || "(no thesis — the orchestration produced none)"}
                tone="amber"
              />
              <FlowBox label="New rewrite result" text={flow.resultCopy} tone="green" defaultOpen />
            </>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
