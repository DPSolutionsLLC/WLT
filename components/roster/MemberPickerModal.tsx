"use client";

import type { ReactNode } from "react";
import { Button } from "@/components/ui/Button";
import { Modal } from "@/components/ui/Modal";

export type MemberPickerModalProps = {
  label: string;
  triggerLabel?: string;
  selectedCount: number;
  isOpen: boolean;
  onOpen: () => void;
  onClose: () => void;
  disabled?: boolean;
  children: ReactNode;
};

// Extracted so `mode: "inline"` does not carry dialog logic it never uses. An inline picker is
// a form field; a modal picker is a trigger plus a dialog, and the only thing they share is the
// list itself — which is what MemberPicker passes in as children.
export function MemberPickerModal({
  label,
  triggerLabel,
  selectedCount,
  isOpen,
  onOpen,
  onClose,
  disabled = false,
  children,
}: MemberPickerModalProps) {
  // The count is on the trigger so the current selection is legible without opening the dialog.
  // Inside, the same selection is a row of removable chips.
  const summary =
    selectedCount === 0
      ? (triggerLabel ?? label)
      : `${triggerLabel ?? label} · ${selectedCount} selected`;

  return (
    <div className="flex flex-col gap-2">
      <Button type="button" variant="secondary" onClick={onOpen} disabled={disabled}>
        {summary}
      </Button>

      <Modal isOpen={isOpen} onClose={onClose} title={label}>
        {children}
      </Modal>
    </div>
  );
}
