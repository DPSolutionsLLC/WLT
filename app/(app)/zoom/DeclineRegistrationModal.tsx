"use client";

import { useState } from "react";
import { Button } from "@/components/ui/Button";
import { FormError } from "@/components/ui/FormError";
import { Modal } from "@/components/ui/Modal";
import { DECLINED_STATUS_SENTENCE } from "@/lib/zoom/registrationRow";

// "NOT THIS TIME" ON A PUBLIC SIGN-UP (ITER-052 z3b, plan D2). Any one member of the bishopric may
// decline. The note is optional and private: the database hides it from everybody but the
// bishopric (migration 098), and the person is shown exactly the sentence quoted here — no reason.

async function readError(response: Response, fallback: string): Promise<string> {
  try {
    const parsed = (await response.json()) as { error?: unknown };
    return typeof parsed.error === "string" ? parsed.error : fallback;
  } catch {
    return "The server sent a response this page could not read.";
  }
}

export type DeclineRegistrationModalProps = {
  registrationId: string;
  displayName: string;
  onClose: () => void;
  onDeclined: () => void;
};

// Rendered only while open, so the note starts empty each time.
export function DeclineRegistrationModal({
  registrationId,
  displayName,
  onClose,
  onDeclined,
}: DeclineRegistrationModalProps) {
  const [note, setNote] = useState("");
  const [error, setError] = useState<string | undefined>();
  const [isSaving, setIsSaving] = useState(false);
  const noteId = `zoom-decline-note-${registrationId}`;

  async function decline() {
    setIsSaving(true);
    setError(undefined);
    try {
      const response = await fetch(`/api/zoom/registrations/${registrationId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "decline", note }),
      });
      if (!response.ok) {
        throw new Error(await readError(response, "Could not decline the sign-up. Please try again."));
      }
      onDeclined();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Could not decline the sign-up.");
      setIsSaving(false);
    }
  }

  return (
    <Modal isOpen onClose={onClose} title={`Not this time: ${displayName}`}>
      <form
        className="flex flex-col gap-4"
        onSubmit={(event) => {
          event.preventDefault();
          if (!isSaving) void decline();
        }}
      >
        <div className="flex flex-col gap-1">
          <span className="text-sm font-medium text-foreground">What they will see</span>
          <p className="rounded-md border border-border bg-surface px-3 py-2 text-sm text-foreground">
            {DECLINED_STATUS_SENTENCE}
          </p>
        </div>

        <div className="flex flex-col gap-1">
          <label htmlFor={noteId} className="text-sm font-medium text-foreground">
            Private note (optional)
          </label>
          <textarea
            id={noteId}
            rows={3}
            maxLength={500}
            value={note}
            onChange={(event) => setNote(event.target.value)}
            disabled={isSaving}
            aria-describedby={`${noteId}-hint`}
            className="min-h-11 rounded-md border border-border bg-surface-raised px-3 py-2 text-base text-foreground focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
          />
          <span id={`${noteId}-hint`} className="text-xs text-muted">
            Only the bishopric sees this.
          </span>
        </div>

        <FormError message={error} />

        <div className="flex justify-end gap-2">
          <Button variant="secondary" onClick={onClose} disabled={isSaving}>
            Cancel
          </Button>
          <Button type="submit" variant="danger" disabled={isSaving}>
            {isSaving ? "Declining…" : "Decline"}
          </Button>
        </div>
      </form>
    </Modal>
  );
}
