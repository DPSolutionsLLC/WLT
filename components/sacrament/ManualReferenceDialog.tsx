"use client";

import { useId, useState, type FormEvent } from "react";
import { talkHeading, type AddReferences } from "@/components/sacrament/referenceShared";
import { Button } from "@/components/ui/Button";
import { FormError } from "@/components/ui/FormError";
import { Input } from "@/components/ui/Input";
import { Modal } from "@/components/ui/Modal";
import { MAX_CITATION } from "@/lib/validation/references";
import {
  MANUAL_REFERENCE_KINDS,
  MANUAL_REFERENCE_KIND_LABELS,
  type ManualReferenceKind,
  type ReferencesTalk,
} from "@/types/domain";

// TYPING A REFERENCE IN BY HAND — opened from the talk's "Add manually" button (decided with the
// user walking scenario 074). A scripture or a general conference talk, nothing else: those are
// the two kinds the user named, and `other` only ever arrives from search.

export type ManualReferenceDialogProps = {
  talk: ReferencesTalk;
  onAdd: AddReferences;
  onClose: () => void;
};

export function ManualReferenceDialog({ talk, onAdd, onClose }: ManualReferenceDialogProps) {
  const kindId = useId();
  const citationId = useId();
  const [kind, setKind] = useState<ManualReferenceKind>("scripture");
  const [citation, setCitation] = useState("");
  const [isAdding, setIsAdding] = useState(false);
  const [error, setError] = useState<string>();

  async function submit(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    setIsAdding(true);
    setError(undefined);

    const failure = await onAdd([
      { assignmentId: talk.assignmentId, kind, citation, source: "manual" },
    ]);

    setIsAdding(false);
    if (failure !== null) {
      setError(failure);
      return;
    }

    onClose();
  }

  return (
    <Modal isOpen onClose={onClose} title={`Add manually — ${talkHeading(talk)}`}>
      <form onSubmit={submit} className="flex flex-col gap-4">
        <div className="flex flex-col gap-1.5">
          <label htmlFor={kindId} className="text-sm font-medium text-foreground">
            Kind
          </label>
          <select
            id={kindId}
            value={kind}
            onChange={(event) => setKind(event.target.value as ManualReferenceKind)}
            className="min-h-11 rounded-md border border-border bg-surface-raised px-3 py-2 text-base text-foreground focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
          >
            {MANUAL_REFERENCE_KINDS.map((option) => (
              <option key={option} value={option}>
                {MANUAL_REFERENCE_KIND_LABELS[option]}
              </option>
            ))}
          </select>
        </div>

        <Input
          id={citationId}
          label="Reference"
          placeholder={kind === "scripture" ? "Alma 32:21" : "Title — Speaker, April 2025"}
          value={citation}
          maxLength={MAX_CITATION}
          onChange={(event) => setCitation(event.target.value)}
          className="w-full min-w-0"
        />

        <FormError message={error} />

        <div className="flex flex-wrap justify-end gap-2">
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" disabled={isAdding || citation.trim() === ""}>
            {isAdding ? "Adding…" : "Add"}
          </Button>
        </div>
      </form>
    </Modal>
  );
}
