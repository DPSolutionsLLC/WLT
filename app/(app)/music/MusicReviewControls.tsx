"use client";

import { useId, useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/Button";
import { FormError } from "@/components/ui/FormError";
import { Modal } from "@/components/ui/Modal";
import { messageFromPayload, readJsonPayload } from "@/lib/program/requests";
import { MAX_MUSIC_RETURN_NOTE_LENGTH } from "@/lib/validation/music";

// The conductor's decision on submitted music (ITER-038 slice mb): Approve, or Send back with a
// note. The card renders this for a holder of `topics.manage` — the whole bishopric, not only the
// conductor (plan A2) — while the music is submitted.
//
// SOMEBODY WHO SUBMITTED IT SEES THE BUTTONS DISABLED WITH THE REASON (A3), not hidden: a bishop
// who submitted the music and looks for Approve should learn why it is not theirs to press.
//
// AN EMAIL THAT COULD NOT GO IS SAID IN THE WINDOW BEFORE IT CLOSES (slice mc). Refreshing returns
// the card to draft and unmounts this component, so a sentence shown anywhere else would vanish with
// it; the refresh waits until the window is closed.

const FIELD_CLASSES =
  "min-h-11 rounded-md border border-border bg-surface-raised px-3 py-2 text-base text-foreground focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary";

const OWN_SUBMISSION = "You submitted this music, so another member of the bishopric approves it.";

export type MusicReviewControlsProps = {
  sundayId: string;
  isOwnSubmission: boolean;
};

export function MusicReviewControls({ sundayId, isOwnSubmission }: MusicReviewControlsProps) {
  const router = useRouter();
  const noteId = useId();
  const [sendingBack, setSendingBack] = useState(false);
  const [note, setNote] = useState("");
  const [isSaving, setIsSaving] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string>();
  const [emailProblem, setEmailProblem] = useState<string>();

  async function decide(body: { decision: "approve" } | { decision: "return"; note: string }) {
    setErrorMessage(undefined);
    setIsSaving(true);
    try {
      const response = await fetch(`/api/sundays/${sundayId}/music/review`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const payload = await readJsonPayload(response);
      if (!response.ok) {
        setErrorMessage(messageFromPayload(payload, "Could not save your decision. Please try again."));
        return;
      }
      const problem = readEmailProblem(payload);
      if (problem !== null) {
        setEmailProblem(problem);
        return;
      }
      setSendingBack(false);
      setNote("");
      router.refresh();
    } catch (error) {
      console.error("Could not save a decision on a Sunday's music", error);
      setErrorMessage("Could not reach the server. Check your connection and try again.");
    } finally {
      setIsSaving(false);
    }
  }

  function closeAfterSentBack() {
    setEmailProblem(undefined);
    setSendingBack(false);
    setNote("");
    router.refresh();
  }

  return (
    <div className="flex flex-col gap-1">
      <div className="flex flex-wrap items-center gap-2">
        <Button
          disabled={isSaving || isOwnSubmission}
          onClick={() => void decide({ decision: "approve" })}
        >
          Approve
        </Button>
        <Button
          variant="secondary"
          disabled={isSaving || isOwnSubmission}
          onClick={() => {
            setErrorMessage(undefined);
            setSendingBack(true);
          }}
        >
          Send back
        </Button>
      </div>
      {isOwnSubmission ? <p className="text-sm text-muted">{OWN_SUBMISSION}</p> : null}
      {sendingBack ? null : <FormError message={errorMessage} />}

      {sendingBack && (
        <Modal
          isOpen
          onClose={() => {
            setErrorMessage(undefined);
            setSendingBack(false);
            if (emailProblem !== undefined) closeAfterSentBack();
          }}
          title="Send the music back"
        >
          {emailProblem !== undefined ? (
            <div className="flex flex-col gap-3">
              <p role="status" className="text-sm text-foreground">
                Sent back. {emailProblem}
              </p>
              <div className="flex justify-end">
                <Button onClick={closeAfterSentBack}>Close</Button>
              </div>
            </div>
          ) : (
            <div className="flex flex-col gap-3">
              <div className="flex flex-col gap-1">
                <label htmlFor={noteId} className="text-sm font-medium text-foreground">
                  What should change?
                </label>
                <textarea
                  id={noteId}
                  rows={3}
                  maxLength={MAX_MUSIC_RETURN_NOTE_LENGTH}
                  value={note}
                  autoFocus
                  disabled={isSaving}
                  onChange={(event) => setNote(event.target.value)}
                  className={FIELD_CLASSES}
                />
              </div>
              <p className="text-xs text-muted">
                The music coordinator gets this on their To Do, and the music goes back to draft.
              </p>
              <FormError message={errorMessage} />
              <div className="flex flex-wrap justify-end gap-2">
                <Button
                  variant="secondary"
                  disabled={isSaving}
                  onClick={() => {
                    setErrorMessage(undefined);
                    setSendingBack(false);
                  }}
                >
                  Cancel
                </Button>
                <Button
                  disabled={isSaving || note.trim() === ""}
                  onClick={() => void decide({ decision: "return", note })}
                >
                  {isSaving ? "Sending…" : "Send back"}
                </Button>
              </div>
            </div>
          )}
        </Modal>
      )}
    </div>
  );
}

function readEmailProblem(payload: unknown): string | null {
  if (typeof payload !== "object" || payload === null || !("emailProblem" in payload)) return null;
  const { emailProblem } = payload;
  return typeof emailProblem === "string" && emailProblem !== "" ? emailProblem : null;
}
