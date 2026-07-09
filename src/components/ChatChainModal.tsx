import { useState, useEffect } from "react";
import { evalsApi, type ChatMessage, type ChatMessagesRequest } from "@/api/evals";
import { Button } from "@/components/ui/button";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription,
} from "@/components/ui/dialog";
import { Loader2 } from "lucide-react";

// Reconstructs and displays the exact chat chain that was/would be sent to the
// model for an eval, post-edit, or rewrite (no LLM call — uses the dry-run
// /api/eval/messages endpoint). Shared by the criterion test page and the suite
// test panel so the "view chat" experience stays identical.
export function ChatChainModal({
  open,
  onOpenChange,
  request,
  title,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  request: ChatMessagesRequest | null;
  title: string;
}) {
  const [messages, setMessages] = useState<ChatMessage[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [raw, setRaw] = useState(false);

  useEffect(() => {
    if (!open || !request) return;
    let cancelled = false;
    setLoading(true);
    setError(null);
    setMessages(null);
    evalsApi
      .messages(request)
      .then((r) => { if (!cancelled) setMessages(r.messages); })
      .catch((e) => { if (!cancelled) setError(String(e)); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [open, request]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-3xl max-h-[85vh] flex flex-col gap-3">
        <DialogHeader>
          <DialogTitle className="text-base">{title}</DialogTitle>
          <DialogDescription>
            The exact chat chain sent to the model — {messages?.length ?? 0} message{messages?.length === 1 ? "" : "s"}.
          </DialogDescription>
        </DialogHeader>

        <div className="flex items-center justify-end -mt-1">
          <Button
            size="sm" variant="ghost" className="h-6 text-[11px]"
            onClick={() => setRaw((v) => !v)}
            disabled={!messages}
          >
            {raw ? "Readable view" : "Raw JSON"}
          </Button>
        </div>

        <div className="overflow-y-auto flex-1 space-y-3 pr-1">
          {loading && (
            <p className="text-sm text-muted-foreground flex items-center gap-1.5">
              <Loader2 className="h-3.5 w-3.5 animate-spin" /> Building chat…
            </p>
          )}
          {error && <p className="text-sm text-destructive whitespace-pre-wrap">{error}</p>}

          {messages && !raw && messages.map((m, i) => (
            <div key={i} className="space-y-1">
              <p className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground">
                {m.role}
              </p>
              <pre className="whitespace-pre-wrap break-words rounded-md border bg-muted/40 p-3 text-xs leading-relaxed font-sans">
                {m.content}
              </pre>
            </div>
          ))}

          {messages && raw && (
            <pre className="whitespace-pre-wrap break-words rounded-md border bg-muted/40 p-3 text-xs leading-relaxed">
              {JSON.stringify(messages, null, 2)}
            </pre>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
