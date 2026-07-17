import { useEffect, useMemo, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter,
} from "@/components/ui/dialog";
import { usePrompts, useUpdatePrompt } from "@/hooks/usePrompts";
import type { PromptTemplate } from "@/types";
import { cn } from "@/lib/utils";
import { Loader2, Save, RotateCcw, Undo2, AlertTriangle, FileText, CheckCircle2, Minus, GripVertical } from "lucide-react";
import { toast } from "sonner";

const CATEGORY_ORDER = ["Evaluation", "Rewrite", "Extraction"];

// Split a template into text + {token} segments for the highlighted preview.
function segments(text: string): { text: string; token: string | null }[] {
  const out: { text: string; token: string | null }[] = [];
  const re = /\{([a-z0-9_]+)\}/gi;
  let last = 0;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    if (m.index > last) out.push({ text: text.slice(last, m.index), token: null });
    out.push({ text: m[0], token: m[1] });
    last = m.index + m[0].length;
  }
  if (last < text.length) out.push({ text: text.slice(last), token: null });
  return out;
}

// Identical text metrics for the highlight backdrop and the (transparent-text)
// textarea layered over it, so the visible highlighting lines up with the caret.
const EDITOR_TEXT_STYLE: React.CSSProperties = {
  fontFamily: "ui-monospace, SFMono-Regular, Menlo, Consolas, monospace",
  fontSize: "12px",
  lineHeight: "1.625",
  padding: "12px",
  margin: 0,
  whiteSpace: "pre-wrap",
  wordBreak: "break-word",
  tabSize: 2,
};

type DiffRow = { type: "add" | "del" | "ctx"; text: string };

// Line-based (LCS) diff for the git-style confirmation view.
function diffLines(oldStr: string, newStr: string): DiffRow[] {
  const a = oldStr.split("\n"), b = newStr.split("\n");
  const n = a.length, m = b.length;
  const dp: number[][] = Array.from({ length: n + 1 }, () => new Array(m + 1).fill(0));
  for (let i = n - 1; i >= 0; i--)
    for (let j = m - 1; j >= 0; j--)
      dp[i][j] = a[i] === b[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1]);
  const out: DiffRow[] = [];
  let i = 0, j = 0;
  while (i < n && j < m) {
    if (a[i] === b[j]) { out.push({ type: "ctx", text: a[i] }); i++; j++; }
    else if (dp[i + 1][j] >= dp[i][j + 1]) { out.push({ type: "del", text: a[i] }); i++; }
    else { out.push({ type: "add", text: b[j] }); j++; }
  }
  while (i < n) out.push({ type: "del", text: a[i++] });
  while (j < m) out.push({ type: "add", text: b[j++] });
  return out;
}

function DiffView({ oldText, newText }: { oldText: string; newText: string }) {
  const rows = useMemo(() => diffLines(oldText, newText), [oldText, newText]);
  const changed = rows.some((r) => r.type !== "ctx");
  if (!changed) return <p className="text-sm text-muted-foreground">No changes to the template text.</p>;
  return (
    <div className="max-h-[50vh] overflow-auto rounded-md border">
      <pre className="text-xs font-mono leading-relaxed m-0">
        {rows.map((r, i) => (
          <div
            key={i}
            className={cn(
              "px-3 whitespace-pre-wrap break-words",
              r.type === "add" && "bg-green-50 text-green-800",
              r.type === "del" && "bg-red-50 text-red-800",
              r.type === "ctx" && "text-muted-foreground",
            )}
          >
            <span className="select-none opacity-50">{r.type === "add" ? "+ " : r.type === "del" ? "- " : "  "}</span>
            {r.text || " "}
          </div>
        ))}
      </pre>
    </div>
  );
}

export default function PromptsPage() {
  const { data: prompts = [], isLoading } = usePrompts();
  const updateMutation = useUpdatePrompt();

  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [templateDraft, setTemplateDraft] = useState("");
  const [descDraft, setDescDraft] = useState("");
  const [confirmOpen, setConfirmOpen] = useState(false);
  // Live drop caret (position + character index) while dragging a token in.
  const [dragCaret, setDragCaret] = useState<{ index: number; left: number; top: number; height: number } | null>(null);
  const templateRef = useRef<HTMLTextAreaElement>(null);
  const editorRef = useRef<HTMLDivElement>(null);
  const backdropRef = useRef<HTMLPreElement>(null);
  // The template/description as first loaded this session, per prompt id — the
  // "initial state" the user can revert to (distinct from the built-in default).
  const initialRef = useRef<Map<string, { template: string; description: string }>>(new Map());

  const selected: PromptTemplate | undefined = useMemo(
    () => prompts.find((p) => p.id === selectedId) ?? prompts[0],
    [prompts, selectedId],
  );

  // Sync drafts when the selection or the underlying row changes (e.g. after a
  // save). Also capture the initial snapshot the first time each prompt is seen.
  useEffect(() => {
    const id = selected?.id;
    if (!id) return;
    const template = selected?.template ?? "";
    const description = selected?.description ?? "";
    if (!initialRef.current.has(id)) {
      initialRef.current.set(id, { template, description });
    }
    setTemplateDraft(template);
    setDescDraft(description);
  }, [selected?.id, selected?.template, selected?.description]);

  const grouped = useMemo(() => {
    const byCat = new Map<string, PromptTemplate[]>();
    for (const p of prompts) {
      const c = p.category || "Other";
      if (!byCat.has(c)) byCat.set(c, []);
      byCat.get(c)!.push(p);
    }
    const cats = [...byCat.keys()].sort((a, b) => {
      const ia = CATEGORY_ORDER.indexOf(a), ib = CATEGORY_ORDER.indexOf(b);
      return (ia === -1 ? 99 : ia) - (ib === -1 ? 99 : ib) || a.localeCompare(b);
    });
    return cats.map((c) => ({ category: c, items: byCat.get(c)! }));
  }, [prompts]);

  const initial = selected ? initialRef.current.get(selected.id) : undefined;
  const dirty = !!selected && (templateDraft !== selected.template || descDraft !== (selected.description ?? ""));
  const descChanged = !!selected && descDraft !== (selected.description ?? "");
  const canRevertInitial = !!initial && (templateDraft !== initial.template || descDraft !== initial.description);
  const canResetDefault = !!selected && templateDraft !== selected.default_template;

  const missingRequired = useMemo(() => {
    if (!selected) return [];
    return selected.placeholders.filter((p) => p.required && !templateDraft.includes(`{${p.token}}`)).map((p) => p.token);
  }, [selected, templateDraft]);

  // Map mouse coordinates to a character index + on-screen caret rect by
  // hit-testing the highlight backdrop (it has real text nodes with the same
  // layout as the textarea). The textarea is momentarily made non-interactive so
  // the hit-test resolves to the backdrop text rather than the textarea box.
  function caretFromPoint(clientX: number, clientY: number) {
    const root = backdropRef.current, cont = editorRef.current, ta = templateRef.current;
    if (!root || !cont) return null;
    const d = document as Document & {
      caretPositionFromPoint?: (x: number, y: number) => { offsetNode: Node; offset: number } | null;
      caretRangeFromPoint?: (x: number, y: number) => Range | null;
    };
    const prevPE = ta ? ta.style.pointerEvents : "";
    if (ta) ta.style.pointerEvents = "none";
    let node: Node | null = null, offset = 0;
    try {
      if (d.caretPositionFromPoint) {
        const p = d.caretPositionFromPoint(clientX, clientY);
        if (p) { node = p.offsetNode; offset = p.offset; }
      } else if (d.caretRangeFromPoint) {
        const r = d.caretRangeFromPoint(clientX, clientY);
        if (r) { node = r.startContainer; offset = r.startOffset; }
      }
    } finally {
      if (ta) ta.style.pointerEvents = prevPE;
    }
    if (!node || !root.contains(node)) return null;
    const prefix = document.createRange();
    prefix.setStart(root, 0);
    prefix.setEnd(node, offset);
    const index = Math.min(prefix.toString().length, templateDraft.length);
    const caret = document.createRange();
    caret.setStart(node, offset);
    caret.collapse(true);
    const rect = caret.getBoundingClientRect();
    const cr = cont.getBoundingClientRect();
    return { index, left: rect.left - cr.left, top: rect.top - cr.top, height: rect.height || 19.5 };
  }

  function onEditorDragOver(e: React.DragEvent<HTMLDivElement>) {
    e.preventDefault();
    e.dataTransfer.dropEffect = "copy";
    setDragCaret(caretFromPoint(e.clientX, e.clientY));
  }

  function onEditorDragLeave(e: React.DragEvent<HTMLDivElement>) {
    if (!editorRef.current?.contains(e.relatedTarget as Node)) setDragCaret(null);
  }

  function onEditorDrop(e: React.DragEvent<HTMLDivElement>) {
    e.preventDefault();
    const token = e.dataTransfer.getData("text/plain");
    const at = caretFromPoint(e.clientX, e.clientY) ?? dragCaret;
    setDragCaret(null);
    if (!token) return;
    const el = templateRef.current;
    const index = at ? at.index : (el?.selectionStart ?? templateDraft.length);
    setTemplateDraft(templateDraft.slice(0, index) + token + templateDraft.slice(index));
    requestAnimationFrame(() => {
      if (!el) return;
      el.focus();
      const pos = index + token.length;
      el.setSelectionRange(pos, pos);
    });
  }

  function confirmSave() {
    if (!selected) return;
    setConfirmOpen(false);
    toast.promise(
      updateMutation.mutateAsync({ id: selected.id, data: { template: templateDraft, description: descDraft } }),
      { loading: "Saving…", success: "Prompt saved", error: (e) => `Save failed: ${e instanceof Error ? e.message : String(e)}` },
    );
  }

  if (isLoading) {
    return <div className="p-6 flex items-center justify-center h-64 text-muted-foreground text-sm">Loading prompts…</div>;
  }

  return (
    <div className="p-6 animate-fade-in">
      <div className="mb-4">
        <h1 className="text-2xl font-bold tracking-tight flex items-center gap-2">
          <FileText className="h-5 w-5" /> Prompts
        </h1>
        <p className="text-sm text-muted-foreground mt-1">
          The prompt templates used to run evaluations and rewrites. Edit the text around the{" "}
          <code className="text-xs bg-muted px-1 rounded">{"{placeholder}"}</code> tokens — those are filled in at run time.
        </p>
      </div>

      <div className="flex gap-6 items-start">
        {/* master list */}
        <div className="w-72 shrink-0 space-y-4">
          {grouped.map((g) => (
            <div key={g.category} className="space-y-1">
              <p className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground px-1">{g.category}</p>
              <div className="space-y-1">
                {g.items.map((p) => {
                  const active = selected?.id === p.id;
                  return (
                    <button
                      key={p.id}
                      onClick={() => setSelectedId(p.id)}
                      className={cn(
                        "w-full text-left rounded-md border px-3 py-2 transition-colors",
                        active ? "border-primary bg-primary/5" : "hover:bg-muted/40",
                      )}
                    >
                      <span className="text-sm font-medium block">{p.name}</span>
                      {p.description && <span className="text-xs text-muted-foreground line-clamp-2 mt-0.5 block">{p.description}</span>}
                    </button>
                  );
                })}
              </div>
            </div>
          ))}
        </div>

        {/* detail editor */}
        {selected && (
          <div className="flex-1 min-w-0 space-y-4">
            <div className="flex items-center justify-between gap-3 flex-wrap">
              <div>
                <h2 className="text-lg font-semibold">{selected.name}</h2>
                <p className="font-mono text-[11px] text-muted-foreground">{selected.id}</p>
              </div>
              <div className="flex items-center gap-2">
                <Button variant="ghost" size="sm" className="gap-1.5" onClick={() => { if (initial) { setTemplateDraft(initial.template); setDescDraft(initial.description); } }} disabled={!canRevertInitial}>
                  <Undo2 className="h-3.5 w-3.5" /> Revert to initial
                </Button>
                <Button variant="outline" size="sm" className="gap-1.5" onClick={() => setTemplateDraft(selected.default_template)} disabled={!canResetDefault}>
                  <RotateCcw className="h-3.5 w-3.5" /> Reset to default
                </Button>
                <Button size="sm" className="gap-1.5" onClick={() => setConfirmOpen(true)} disabled={!dirty || updateMutation.isPending}>
                  {updateMutation.isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Save className="h-3.5 w-3.5" />} Save
                </Button>
              </div>
            </div>

            {/* description */}
            <div className="space-y-1">
              <p className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground">Description</p>
              <Textarea
                value={descDraft}
                onChange={(e) => setDescDraft(e.target.value)}
                rows={2}
                className="text-sm"
                placeholder="What this prompt does…"
              />
            </div>

            {/* template editor */}
            <div className="space-y-1">
              <p className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground">Template</p>
              {/* highlight backdrop + transparent-text textarea overlay */}
              <div
                ref={editorRef}
                onDragOver={onEditorDragOver}
                onDragLeave={onEditorDragLeave}
                onDrop={onEditorDrop}
                className="relative min-h-[320px] rounded-md border bg-background focus-within:ring-2 focus-within:ring-ring focus-within:ring-offset-2"
              >
                <pre ref={backdropRef} aria-hidden="true" className="text-slate-600" style={EDITOR_TEXT_STYLE}>
                  {segments(templateDraft).map((s, i) =>
                    s.token
                      ? <span key={i} className="rounded bg-blue-100 font-semibold text-blue-700">{s.text}</span>
                      : <span key={i}>{s.text}</span>,
                  )}
                  {templateDraft.endsWith("\n") ? " " : ""}
                </pre>
                <textarea
                  ref={templateRef}
                  value={templateDraft}
                  onChange={(e) => setTemplateDraft(e.target.value)}
                  spellCheck={false}
                  className="absolute inset-0 h-full w-full resize-none bg-transparent text-transparent caret-slate-900 outline-none selection:bg-blue-200/50"
                  style={EDITOR_TEXT_STYLE}
                />
                {dragCaret && (
                  <div
                    className="pointer-events-none absolute z-10 w-[2px] bg-blue-600"
                    style={{ left: dragCaret.left, top: dragCaret.top, height: dragCaret.height }}
                  />
                )}
              </div>
              {missingRequired.length > 0 && (
                <div className="flex items-start gap-2 rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">
                  <AlertTriangle className="h-4 w-4 shrink-0 mt-0.5" />
                  <span>
                    Missing required placeholder{missingRequired.length > 1 ? "s" : ""}:{" "}
                    {missingRequired.map((t) => <code key={t} className="mx-0.5 bg-amber-100 px-1 rounded">{`{${t}}`}</code>)}
                    — the prompt will still save, but that value won't be included when it runs.
                  </span>
                </div>
              )}
            </div>

            {/* placeholder legend — drag a token into the editor to insert it */}
            <div className="space-y-1.5">
              <p className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground">
                Placeholders <span className="normal-case font-normal">— drag a token into the editor to insert it</span>
              </p>
              <div className="border rounded-md divide-y">
                {selected.placeholders.map((ph) => {
                  const present = templateDraft.includes(`{${ph.token}}`);
                  return (
                    <div key={ph.token} className="flex items-start gap-2.5 px-3 py-2">
                      {present ? (
                        <CheckCircle2 className="h-4 w-4 shrink-0 mt-0.5 text-green-600" aria-label="included" />
                      ) : ph.required ? (
                        <AlertTriangle className="h-4 w-4 shrink-0 mt-0.5 text-amber-500" aria-label="required, missing" />
                      ) : (
                        <Minus className="h-4 w-4 shrink-0 mt-0.5 text-muted-foreground/40" aria-label="not used" />
                      )}
                      <span
                        draggable
                        onDragStart={(e) => { e.dataTransfer.setData("text/plain", `{${ph.token}}`); e.dataTransfer.effectAllowed = "copy"; }}
                        title="Drag into the editor"
                        className="flex items-center gap-1 font-mono text-[11px] bg-muted px-1.5 py-0.5 rounded shrink-0 cursor-grab active:cursor-grabbing hover:bg-muted-foreground/20"
                      >
                        <GripVertical className="h-3 w-3 text-muted-foreground/60" />
                        {`{${ph.token}}`}
                      </span>
                      <span className="flex-1 min-w-0 text-xs text-muted-foreground">{ph.description}</span>
                      {ph.required && <Badge variant="outline" className="text-[10px] border-amber-200 bg-amber-50 text-amber-700 shrink-0">required</Badge>}
                    </div>
                  );
                })}
              </div>
            </div>

            <p className="text-[11px] text-muted-foreground">
              To see a prompt with real values filled in, run an eval or rewrite and use the “View prompt” button on a result.
            </p>
          </div>
        )}
      </div>

      {/* save confirmation with a git-style diff */}
      <Dialog open={confirmOpen} onOpenChange={setConfirmOpen}>
        <DialogContent className="max-w-3xl max-h-[85vh] flex flex-col gap-3">
          <DialogHeader>
            <DialogTitle className="text-base">Save changes to {selected?.name}?</DialogTitle>
            <DialogDescription>
              Review the changes below. This updates the prompt used for every future run.
            </DialogDescription>
          </DialogHeader>
          {selected && <DiffView oldText={selected.template} newText={templateDraft} />}
          {descChanged && <p className="text-xs text-muted-foreground">The description will also be updated.</p>}
          {missingRequired.length > 0 && (
            <p className="flex items-start gap-1.5 text-xs text-amber-700">
              <AlertTriangle className="h-3.5 w-3.5 shrink-0 mt-0.5" />
              Saving without required placeholder{missingRequired.length > 1 ? "s" : ""} {missingRequired.map((t) => `{${t}}`).join(", ")}.
            </p>
          )}
          <DialogFooter>
            <Button variant="outline" size="sm" onClick={() => setConfirmOpen(false)}>Cancel</Button>
            <Button size="sm" className="gap-1.5" onClick={confirmSave}>
              <Save className="h-3.5 w-3.5" /> Save changes
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
