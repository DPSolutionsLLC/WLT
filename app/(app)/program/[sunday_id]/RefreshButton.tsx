"use client";

import { useState } from "react";
import { DraftDiff } from "@/components/program/DraftDiff";
import { Button } from "@/components/ui/Button";
import { FormError } from "@/components/ui/FormError";
import { Modal } from "@/components/ui/Modal";
import type { DraftChange } from "@/lib/program/diff";
import type { ProgramDraft } from "@/lib/program/draft";
import { messageFromPayload, readJsonPayload } from "@/lib/program/requests";

// "What has moved upstream since this was built?" — asked, read, and only then taken.
//
// TWO CALLS, NEVER ONE. `apply: false` is the question and writes nothing; `apply: true` is the
// answer. A refresh that applied as it reported would turn the diff into a receipt for something
// already done, which is the opposite of the choice it exists to offer (app/api/programs/[id]/
// refresh/route.ts).
//
// THE CONFIRM BUTTON IS WORDED BY CONSEQUENCE, not by mechanism: "Apply these 4 changes", not
// "Confirm" and not "Overwrite draft_data" (plans/retros/calendar-b-*.md).
//
// This component is HIDDEN, not disabled, once the program is approved or distributed — the
// caller decides that. The route refuses it with a 409 anyway, and a UI should not offer a thing
// it knows will be refused.

export function applyChangesLabel(count: number): string {
  return `Apply ${count === 1 ? "this change" : `these ${count} changes`}`;
}

export type RefreshButtonProps = {
  programId: string;
  // Called with the draft the server stored. The caller RESETS ITS FORM STATE from it — see
  // ProgramBuilder.applyDraft for why a router.refresh() is not enough.
  onApplied: (draft: ProgramDraft) => void;
  disabled: boolean;
};

export function RefreshButton({ programId, onApplied, disabled }: RefreshButtonProps) {
  const [changes, setChanges] = useState<DraftChange[] | null>(null);
  const [isWorking, setIsWorking] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string>();

  async function call(apply: boolean): Promise<Record<string, unknown> | null> {
    setErrorMessage(undefined);
    setIsWorking(true);

    try {
      const response = await fetch(`/api/programs/${programId}/refresh`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ apply }),
      });

      const payload = await readJsonPayload(response);

      if (!response.ok) {
        // The panel keeps whatever it was showing. Nothing is cleared on a failure
        // (plans/retros/ai-c-feature-routes.md).
        setErrorMessage(
          messageFromPayload(payload, "Could not check for changes. Please try again."),
        );
        return null;
      }

      return payload;
    } catch (error) {
      console.error("Could not refresh a program", error);
      setErrorMessage("Could not reach the server. Check your connection and try again.");
      return null;
    } finally {
      setIsWorking(false);
    }
  }

  async function check(): Promise<void> {
    const payload = await call(false);
    if (payload === null) return;

    setChanges((payload.changes ?? []) as DraftChange[]);
  }

  async function apply(): Promise<void> {
    const payload = await call(true);
    if (payload === null) return;

    const program = payload.program as { draft?: ProgramDraft } | undefined;
    const draft = program?.draft;

    // A 200 with no draft in it is the silent failure rule 7 forbids — it looks like an answer
    // and it is not one. The route's own errors cover every real cause, so this is a backstop.
    if (!draft) {
      setErrorMessage(
        "The refresh completed but sent back no program. Reload the page to see where it is.",
      );
      return;
    }

    setChanges(null);
    onApplied(draft);
  }

  return (
    <div className="flex flex-col gap-2">
      <Button
        type="button"
        variant="secondary"
        className="self-start"
        disabled={disabled || isWorking}
        onClick={() => void check()}
      >
        {isWorking && changes === null ? "Checking…" : "Check for changes"}
      </Button>

      <p className="text-sm text-muted">
        Compares this program against the speakers, prayers and hymns as they stand today. It
        shows you what has moved before it changes anything.
      </p>

      <FormError message={errorMessage} />

      <Modal
        isOpen={changes !== null}
        onClose={() => setChanges(null)}
        title="What has changed since this was built"
      >
        <div className="flex flex-col gap-4">
          <DraftDiff changes={changes ?? []} />

          <div className="flex flex-col gap-2 sm:flex-row">
            {/* Offered only when there IS something to apply. A button that would write the same
                draft back over itself is a button that does nothing. */}
            {changes !== null && changes.length > 0 && (
              <Button type="button" disabled={isWorking} onClick={() => void apply()}>
                {isWorking ? "Applying…" : applyChangesLabel(changes.length)}
              </Button>
            )}
            <Button type="button" variant="secondary" onClick={() => setChanges(null)}>
              {changes !== null && changes.length > 0 ? "Leave it as it is" : "Close"}
            </Button>
          </div>
        </div>
      </Modal>
    </div>
  );
}
