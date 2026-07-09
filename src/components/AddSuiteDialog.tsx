import { useState, useEffect } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import type { NewSuite } from "@/api/suites";

interface AddSuiteDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onAdd: (suite: NewSuite) => void;
  saving?: boolean;
}

export function AddSuiteDialog({ open, onOpenChange, onAdd, saving = false }: AddSuiteDialogProps) {
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");

  // Reset the form each time the dialog opens.
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
          <DialogTitle>New suite</DialogTitle>
        </DialogHeader>
        <div className="space-y-4 py-1">
          <div className="flex flex-col gap-1.5">
            <Label className="text-sm font-medium">Suite name *</Label>
            <Input
              autoFocus
              value={name}
              onChange={(e) => setName(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter") submit(); }}
              placeholder="e.g. Amazon compliance pack"
            />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label className="text-sm font-medium">Description</Label>
            <Textarea
              rows={3}
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="What is this suite for?"
            />
          </div>
        </div>
        <div className="flex justify-end gap-2 pt-2 border-t">
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button onClick={submit} disabled={!canSubmit}>Create suite</Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
