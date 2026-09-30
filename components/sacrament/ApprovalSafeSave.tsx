"use client";

import { useId, useState } from "react";
import { Button } from "@/components/ui/Button";
import { describeInvalidation } from "@/lib/assignments/invalidation";

// Cancel / Save for any window that edits a talk. Every edit clears the talk's approvals
// (PATCH /api/assignments/[id]), so when there are any, the first press WARNS instead of saving —
// naming who approved — and the second press saves. The warning arrives before the write, never as
// a report afterwards (04-talks-pipeline.md §Step 3). The button is aria-describedby the sentence,
// not merely near it (calendar-b).

export type ApprovalSafeSaveProps = {
  onCancel: () => void;
  onSave: () => void | Promise<void>;
  isSaving: boolean;
  saveDisabled?: boolean;
  saveLabel?: string;
  approvedCount: number;
  approvedNames: readonly string[];
};

export function ApprovalSafeSave({
  onCancel,
  onSave,
  isSaving,
  saveDisabled = false,
  saveLabel = "Save",
  approvedCount,
  approvedNames,
}: ApprovalSafeSaveProps) {
  const warningId = useId();
  const [isConfirming, setIsConfirming] = useState(false);

  function handleSave(): void {
    if (approvedCount > 0 && !isConfirming) {
      setIsConfirming(true);
      return;
    }
    void onSave();
  }

  return (
    <div className="flex flex-col gap-2">
      {isConfirming && (
        <p id={warningId} role="status" className="text-sm text-warning">
          {describeInvalidation(approvedCount, approvedNames)}
        </p>
      )}
      <div className="flex flex-col gap-2 sm:flex-row sm:justify-end">
        <Button type="button" variant="secondary" onClick={onCancel} disabled={isSaving}>
          Cancel
        </Button>
        <Button
          type="button"
          onClick={handleSave}
          disabled={isSaving || saveDisabled}
          aria-describedby={isConfirming ? warningId : undefined}
        >
          {isSaving ? "Saving…" : isConfirming ? `${saveLabel} and reset approvals` : saveLabel}
        </Button>
      </div>
    </div>
  );
}
