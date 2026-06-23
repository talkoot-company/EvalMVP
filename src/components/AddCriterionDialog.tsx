import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { CriterionForm } from "@/components/CriterionForm";
import type { Criterion } from "@/types";

interface AddCriterionDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onAdd: (criterion: Criterion) => void;
  existingCategories?: string[];
}

export const AddCriterionDialog = ({ open, onOpenChange, onAdd, existingCategories }: AddCriterionDialogProps) => (
  <Dialog open={open} onOpenChange={onOpenChange}>
    <DialogContent className="max-w-2xl max-h-[90vh] flex flex-col gap-0 p-0">
      <DialogHeader className="px-6 pt-5 pb-4 border-b shrink-0">
        <DialogTitle>New criterion</DialogTitle>
      </DialogHeader>
      <div className="flex-1 overflow-y-auto px-6 py-5">
        <CriterionForm
          existingCategories={existingCategories}
          onSave={(c) => { onAdd(c); onOpenChange(false); }}
          onCancel={() => onOpenChange(false)}
        />
      </div>
    </DialogContent>
  </Dialog>
);
