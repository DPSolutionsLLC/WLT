"use client";

import { useState } from "react";
import {
  draftToBody,
  EMPTY_INVITEE_DRAFT,
  InviteeFields,
  type InviteeDraft,
} from "@/app/(app)/zoom/InviteeFields";
import { LinkHandoff } from "@/app/(app)/zoom/LinkHandoff";
import { Button } from "@/components/ui/Button";
import { FormError } from "@/components/ui/FormError";
import { Modal } from "@/components/ui/Modal";
import type { ZoomInvitee } from "@/lib/zoom/invitees";
import type { PoolLevel } from "@/lib/zoom/joinLinkPool";
import type { SessionUser } from "@/types/domain";

// GIVE A ZOOM LINK — the phone-first hand-out a bishopric member does on a visit (ITER-053, z2b).
//
// Step 1 is the person; step 2 is the link, handed over with Text it / Share / Show QR. An empty
// pool still saves the person, as waiting with a to-do on the leader's list (D1, z2c), and step 2
// says so in a sentence.

export type HandOutResult = {
  invitee: ZoomInvitee;
  joinUrl: string | null;
  pool: PoolLevel;
};

async function readError(response: Response, fallback: string): Promise<string> {
  try {
    const parsed = (await response.json()) as { error?: unknown };
    return typeof parsed.error === "string" ? parsed.error : fallback;
  } catch {
    return "The server sent a response this page could not read.";
  }
}

export function waitingSentence(displayName: string): string {
  return (
    `${displayName} is saved, but there are no free links. ` +
    "They're on the Invitees list as waiting, and there's a to-do on your list to give them one."
  );
}

export type HandOutModalProps = {
  isOpen: boolean;
  onClose: () => void;
  onSaved: () => void;
  user: SessionUser;
  wardName: string | null;
};

export function HandOutModal({ isOpen, onClose, onSaved, user, wardName }: HandOutModalProps) {
  const [draft, setDraft] = useState<InviteeDraft>(EMPTY_INVITEE_DRAFT);
  const [personMode, setPersonMode] = useState<"roster" | "typed">("roster");
  const [error, setError] = useState<string | undefined>();
  const [isSaving, setIsSaving] = useState(false);
  const [result, setResult] = useState<HandOutResult | null>(null);

  const giverName = [user.firstName, user.lastName].filter(Boolean).join(" ") || "You";
  const canSave = draft.displayName.trim().length > 0 && !isSaving;

  function close() {
    setDraft(EMPTY_INVITEE_DRAFT);
    setPersonMode("roster");
    setError(undefined);
    setResult(null);
    onClose();
  }

  async function save() {
    setIsSaving(true);
    setError(undefined);
    try {
      const response = await fetch("/api/zoom/invitees", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(draftToBody(draft)),
      });
      if (!response.ok) {
        throw new Error(await readError(response, "Could not give the link. Please try again."));
      }
      setResult((await response.json()) as HandOutResult);
      onSaved();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Could not give the link.");
    } finally {
      setIsSaving(false);
    }
  }

  return (
    <Modal isOpen={isOpen} onClose={close} title="Give a Zoom link">
      {result ? (
        <div className="flex flex-col gap-4">
          {result.joinUrl ? (
            <>
              <p className="text-sm text-foreground">
                <span className="font-semibold">{result.invitee.displayName}</span> has{" "}
                {result.invitee.placeholderName ?? "a link"}. Send it to them now:
              </p>
              <LinkHandoff
                displayName={result.invitee.displayName}
                phone={result.invitee.phone}
                wardName={wardName}
                joinUrl={result.joinUrl}
              />
              {result.pool.sentence ? (
                <p role="status" className="text-sm text-warning">
                  {result.pool.sentence}
                </p>
              ) : null}
            </>
          ) : (
            <p role="status" className="text-sm text-foreground">
              {waitingSentence(result.invitee.displayName)}
            </p>
          )}
          <div className="flex justify-end">
            <Button variant="secondary" onClick={close}>
              Done
            </Button>
          </div>
        </div>
      ) : (
        <form
          className="flex flex-col gap-4"
          onSubmit={(event) => {
            event.preventDefault();
            if (canSave) void save();
          }}
        >
          <InviteeFields
            idPrefix="zoom-handout"
            user={user}
            draft={draft}
            onChange={setDraft}
            personMode={personMode}
            onPersonModeChange={setPersonMode}
            disabled={isSaving}
          />

          <p className="text-sm text-muted">Given by {giverName}</p>

          <FormError message={error} />

          <div className="flex justify-end gap-2">
            <Button variant="secondary" onClick={close} disabled={isSaving}>
              Cancel
            </Button>
            <Button type="submit" disabled={!canSave}>
              {isSaving ? "Giving…" : "Give link"}
            </Button>
          </div>
        </form>
      )}
    </Modal>
  );
}
