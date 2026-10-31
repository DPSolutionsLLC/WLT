"use client";

import { useState } from "react";
import { MemberPicker } from "@/components/roster/MemberPicker";
import { Button } from "@/components/ui/Button";
import { FormError } from "@/components/ui/FormError";
import { Modal } from "@/components/ui/Modal";
import type { SessionUser } from "@/types/domain";

// MATCH A SIGN-UP TO THE ROSTER (ITER-052 z3b, plan D3). The picker offers ACTIVE members of the
// whole ward — the same picker and filter as the Invitees hand-out (ITER-053 D4). Matching closes
// every "Match ___ to the roster" to-do, on every bishopric member's list.

async function readError(response: Response, fallback: string): Promise<string> {
  try {
    const parsed = (await response.json()) as { error?: unknown };
    return typeof parsed.error === "string" ? parsed.error : fallback;
  } catch {
    return "The server sent a response this page could not read.";
  }
}

export type MatchRegistrationModalProps = {
  registrationId: string;
  displayName: string;
  currentMemberId: string | null;
  user: SessionUser;
  onClose: () => void;
  onMatched: () => void;
};

// Rendered only while open, so the choice starts from the current match each time.
export function MatchRegistrationModal({
  registrationId,
  displayName,
  currentMemberId,
  user,
  onClose,
  onMatched,
}: MatchRegistrationModalProps) {
  const [memberId, setMemberId] = useState<string | null>(currentMemberId);
  const [error, setError] = useState<string | undefined>();
  const [isSaving, setIsSaving] = useState(false);

  const canSave = memberId !== null && memberId !== currentMemberId && !isSaving;

  async function save() {
    setIsSaving(true);
    setError(undefined);
    try {
      const response = await fetch(`/api/zoom/registrations/${registrationId}/match`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ memberId }),
      });
      if (!response.ok) {
        throw new Error(await readError(response, "Could not save the match. Please try again."));
      }
      onMatched();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Could not save the match.");
      setIsSaving(false);
    }
  }

  return (
    <Modal isOpen onClose={onClose} title={`Match ${displayName} to the roster`}>
      <form
        className="flex flex-col gap-4"
        onSubmit={(event) => {
          event.preventDefault();
          if (canSave) void save();
        }}
      >
        <MemberPicker
          value={memberId === null ? [] : [memberId]}
          onChange={(ids) => setMemberId(ids[0] ?? null)}
          user={user}
          multiple={false}
          wholeWard
          mode="inline"
          label="Who is it on the roster?"
          disabled={isSaving}
        />

        <FormError message={error} />

        <div className="flex justify-end gap-2">
          <Button variant="secondary" onClick={onClose} disabled={isSaving}>
            Cancel
          </Button>
          <Button type="submit" disabled={!canSave}>
            {isSaving ? "Saving…" : "Match"}
          </Button>
        </div>
      </form>
    </Modal>
  );
}
