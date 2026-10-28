"use client";

import { useState } from "react";
import { draftToBody, InviteeFields, type InviteeDraft } from "@/app/(app)/zoom/InviteeFields";
import { Button } from "@/components/ui/Button";
import { FormError } from "@/components/ui/FormError";
import { Modal } from "@/components/ui/Modal";
import type { ZoomInvitee } from "@/lib/zoom/invitees";
import type { SessionUser } from "@/types/domain";

// EDIT AN INVITEE (ITER-053, D3) — the bishopric only. The same fields as the hand-out, including
// changing or clearing the roster match. The server compares and audits only the field NAMES.

function draftFrom(invitee: ZoomInvitee): InviteeDraft {
  return {
    memberId: invitee.memberId,
    displayName: invitee.displayName,
    phone: invitee.phone ?? "",
    email: invitee.email ?? "",
    notes: invitee.notes ?? "",
  };
}

async function readError(response: Response, fallback: string): Promise<string> {
  try {
    const parsed = (await response.json()) as { error?: unknown };
    return typeof parsed.error === "string" ? parsed.error : fallback;
  } catch {
    return "The server sent a response this page could not read.";
  }
}

export type EditInviteeModalProps = {
  invitee: ZoomInvitee;
  user: SessionUser;
  onClose: () => void;
  onSaved: () => void;
};

// Rendered only while open, so its state starts fresh from the invitee each time.
export function EditInviteeModal({ invitee, user, onClose, onSaved }: EditInviteeModalProps) {
  const [draft, setDraft] = useState<InviteeDraft>(() => draftFrom(invitee));
  const [personMode, setPersonMode] = useState<"roster" | "typed">(
    invitee.memberId ? "roster" : "typed",
  );
  const [error, setError] = useState<string | undefined>();
  const [isSaving, setIsSaving] = useState(false);

  const canSave = draft.displayName.trim().length > 0 && !isSaving;

  async function save() {
    setIsSaving(true);
    setError(undefined);
    try {
      const response = await fetch(`/api/zoom/invitees/${invitee.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(draftToBody(draft)),
      });
      if (!response.ok) {
        throw new Error(await readError(response, "Could not save the changes. Please try again."));
      }
      onSaved();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Could not save the changes.");
      setIsSaving(false);
    }
  }

  return (
    <Modal isOpen onClose={onClose} title={`Edit ${invitee.displayName}`}>
      <form
        className="flex flex-col gap-4"
        onSubmit={(event) => {
          event.preventDefault();
          if (canSave) void save();
        }}
      >
        <InviteeFields
          idPrefix={`zoom-edit-${invitee.id}`}
          user={user}
          draft={draft}
          onChange={setDraft}
          personMode={personMode}
          onPersonModeChange={setPersonMode}
          disabled={isSaving}
        />

        <FormError message={error} />

        <div className="flex justify-end gap-2">
          <Button variant="secondary" onClick={onClose} disabled={isSaving}>
            Cancel
          </Button>
          <Button type="submit" disabled={!canSave}>
            {isSaving ? "Saving…" : "Save"}
          </Button>
        </div>
      </form>
    </Modal>
  );
}
