import { useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import { Plus, Search, Trash2, ArrowRight, Workflow } from "lucide-react";
import { toast } from "sonner";
import { AddSuiteWorkflowDialog } from "@/components/AddSuiteWorkflowDialog";
import { useSuiteWorkflows, useCreateSuiteWorkflow, useDeleteSuiteWorkflow } from "@/hooks/useSuiteWorkflows";

function formatDate(iso: string): string {
  const d = new Date(iso);
  return isNaN(d.getTime()) ? "—" : d.toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });
}

const SuiteWorkflowsPage = () => {
  const navigate = useNavigate();
  const { data: workflows = [], isLoading } = useSuiteWorkflows();
  const createMutation = useCreateSuiteWorkflow();
  const deleteMutation = useDeleteSuiteWorkflow();

  const [search, setSearch] = useState("");
  const [addOpen, setAddOpen] = useState(false);

  const filtered = useMemo(() => workflows.filter((w) => {
    if (!search) return true;
    const q = search.toLowerCase();
    return w.name.toLowerCase().includes(q) || (w.description ?? "").toLowerCase().includes(q);
  }), [workflows, search]);

  const handleCreate = (workflow: { name: string; description?: string | null }) => {
    toast.promise(
      createMutation.mutateAsync(workflow).then((created) => { setAddOpen(false); navigate(`/suite-workflows/${created.id}`); return created; }),
      {
        loading: "Creating workflow…",
        success: "Workflow created",
        error: (e) => `Create failed: ${e instanceof Error ? e.message : String(e)}`,
      },
    );
  };

  if (isLoading) {
    return <div className="p-6 flex items-center justify-center h-64 text-muted-foreground text-sm">Loading workflows…</div>;
  }

  return (
    <div className="p-6 space-y-5 animate-fade-in">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Workflow className="h-5 w-5 text-muted-foreground" />
          <h1 className="text-2xl font-bold tracking-tight">Suite Workflows</h1>
        </div>
        <Button className="gap-2" onClick={() => setAddOpen(true)}>
          <Plus className="h-4 w-4" /> New workflow
        </Button>
      </div>

      {/* Filters */}
      <div className="flex flex-wrap gap-2 items-center">
        <div className="relative flex-1 min-w-48 max-w-sm">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input placeholder="Search workflows…" value={search} onChange={(e) => setSearch(e.target.value)} className="pl-9" />
        </div>
        <span className="text-xs text-muted-foreground self-center ml-1">{filtered.length} of {workflows.length}</span>
      </div>

      {/* Table */}
      <div className="border rounded-md overflow-hidden">
        <Table>
          <TableHeader>
            <TableRow className="hover:bg-transparent">
              <TableHead>Name</TableHead>
              <TableHead className="w-56">Updated</TableHead>
              <TableHead className="w-28" />
            </TableRow>
          </TableHeader>
          <TableBody>
            {filtered.length === 0 ? (
              <TableRow>
                <TableCell colSpan={3} className="text-center text-muted-foreground py-10">
                  {workflows.length === 0 ? "No workflows yet — create one to get started." : "No workflows match your search."}
                </TableCell>
              </TableRow>
            ) : (
              filtered.map((w) => (
                <TableRow
                  key={w.id}
                  className="cursor-pointer hover:bg-muted/40 transition-colors group"
                  onClick={() => navigate(`/suite-workflows/${w.id}`)}
                >
                  <TableCell>
                    <span className="text-sm font-medium">{w.name}</span>
                    {w.description?.trim() && (
                      <span className="block text-xs text-muted-foreground truncate max-w-md">{w.description}</span>
                    )}
                  </TableCell>
                  <TableCell className="text-xs text-muted-foreground tabular-nums">{formatDate(w.updated_at)}</TableCell>
                  <TableCell className="text-right pr-4">
                    <div className="flex items-center justify-end gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                      <Button
                        variant="ghost" size="sm" className="h-7 px-2 text-xs text-muted-foreground gap-1"
                        onClick={(e) => { e.stopPropagation(); navigate(`/suite-workflows/${w.id}`); }}
                      >
                        Open <ArrowRight className="h-3.5 w-3.5" />
                      </Button>
                      <Button
                        variant="ghost" size="icon"
                        className="h-7 w-7 text-muted-foreground hover:text-destructive"
                        onClick={(e) => { e.stopPropagation(); deleteMutation.mutate(w.id); }}
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </Button>
                    </div>
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </div>

      <AddSuiteWorkflowDialog open={addOpen} onOpenChange={setAddOpen} onAdd={handleCreate} saving={createMutation.isPending} />
    </div>
  );
};

export default SuiteWorkflowsPage;
