import { useState, useEffect } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import type { NewSuiteWorkflow } from "@/api/suiteWorkflows";

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onAdd: (workflow: NewSuiteWorkflow) => void;
  saving?: boolean;
}

export function AddSuiteWorkflowDialog({ open, onOpenChange, onAdd, saving = false }: Props) {
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");

  useEffect(() => {
    if (open) { setName(""); setDescription(""); }
  }, [open]);

  const canSubmit = !!name.trim() && !saving;
  const submit = () => {
    if (!canSubmit) return;
    onAdd({ name: name.trim(), description: description.trim() || null });
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>New workflow</DialogTitle>
        </DialogHeader>
        <div className="space-y-4 py-1">
          <div className="flex flex-col gap-1.5">
            <Label className="text-sm font-medium">Workflow name *</Label>
            <Input
              autoFocus
              value={name}
              onChange={(e) => setName(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter") submit(); }}
              placeholder="e.g. Weekly PDP refresh"
            />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label className="text-sm font-medium">Description</Label>
            <Textarea
              rows={3}
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="What does this workflow do?"
            />
          </div>
        </div>
        <div className="flex justify-end gap-2 pt-2 border-t">
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button onClick={submit} disabled={!canSubmit}>Create workflow</Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
