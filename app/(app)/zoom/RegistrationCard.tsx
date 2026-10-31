"use client";

import { useState } from "react";
import { DeclineRegistrationModal } from "@/app/(app)/zoom/DeclineRegistrationModal";
import { MatchRegistrationModal } from "@/app/(app)/zoom/MatchRegistrationModal";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { FormError } from "@/components/ui/FormError";
import { approvalLine, type ApprovalState, type RegistrationRow } from "@/lib/zoom/registrationRow";
import type { SessionUser } from "@/types/domain";

// ONE SIGN-UP ON ZOOM → SIGN-UPS (ITER-052). The readers are the ward's leaders, so the phone, the
// email and the answers are shown; the status token never reaches this page. The decline note is
// passed in only for the bishopric (migration 098) — the clerk and the executive secretary get the
// same cards with no buttons and no note.

async function readError(response: Response, fallback: string): Promise<string> {
  try {
    const parsed = (await response.json()) as { error?: unknown };
    return typeof parsed.error === "string" ? parsed.error : fallback;
  } catch {
    return "The server sent a response this page could not read.";
  }
}

type RespondAction = "approve" | "talk_first" | "finish";

export type RegistrationCardProps = {
  row: RegistrationRow;
  // Null on a decided sign-up: there is nobody left to wait on.
  approval: ApprovalState | null;
  saysMember: boolean;
  memberId: string | null;
  isDeclined: boolean;
  canManage: boolean;
  declineNote: string | null;
  user: SessionUser;
  onChanged: () => void;
};

export function RegistrationCard({
  row,
  approval,
  saysMember,
  memberId,
  isDeclined,
  canManage,
  declineNote,
  user,
  onChanged,
}: RegistrationCardProps) {
  const [busy, setBusy] = useState<RespondAction | null>(null);
  const [error, setError] = useState<string | undefined>();
  const [isDeclining, setIsDeclining] = useState(false);
  const [isMatching, setIsMatching] = useState(false);

  const line = approval ? approvalLine(approval) : null;
  const canMatch = canManage && saysMember && !isDeclined;

  async function respond(action: RespondAction) {
    setBusy(action);
    setError(undefined);
    try {
      const response = await fetch(`/api/zoom/registrations/${row.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action }),
      });
      if (!response.ok) {
        throw new Error(await readError(response, "Could not save your answer. Please try again."));
      }
      onChanged();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Could not save your answer.");
    } finally {
      setBusy(null);
    }
  }

  return (
    <Card className="flex flex-col gap-1 px-3 py-2">
      <div className="flex flex-wrap items-baseline justify-between gap-x-2 gap-y-0.5">
        <span className="min-w-0 break-words text-sm font-medium text-foreground">{row.displayName}</span>
        <span className={`text-xs ${row.isWaiting ? "text-warning" : "text-muted"}`}>{row.statusLine}</span>
      </div>
      {line ? <span className="break-words text-xs text-foreground">{line}</span> : null}
      {approval?.finishReason ? (
        <span className="break-words text-xs text-foreground">{approval.finishReason}</span>
      ) : null}
      <span className="text-xs text-muted">{row.memberLine}</span>
      <span className="break-words text-xs text-muted">
        {row.phone}
        {row.email ? ` · ${row.email}` : ""}
      </span>
      {row.answerLines.map((answer, index) => (
        <span key={index} className="break-words text-xs text-foreground">
          {answer}
        </span>
      ))}
      {row.referrerLine ? <span className="text-xs text-muted">{row.referrerLine}</span> : null}
      {row.flagLines.map((flag) => (
        <span key={flag} className="text-xs text-warning">
          {flag}
        </span>
      ))}
      {declineNote ? (
        <span className="break-words text-xs text-muted">Private note: {declineNote}</span>
      ) : null}
      <span className="text-xs text-muted">{row.stamp}</span>

      {canManage && (approval || canMatch) ? (
        <div className="mt-1 flex flex-wrap gap-2">
          {approval?.canFinish ? (
            <Button onClick={() => void respond("finish")} disabled={busy !== null}>
              {busy === "finish" ? "Finishing…" : "Finish approval"}
            </Button>
          ) : null}
          {approval ? (
            <>
              <Button
                  variant={approval.ownResponse === "approve" ? "primary" : "secondary"}
                aria-pressed={approval.ownResponse === "approve"}
                onClick={() => void respond("approve")}
                disabled={busy !== null || approval.ownResponse === "approve"}
              >
                {busy === "approve" ? "Approving…" : "Approve"}
              </Button>
              <Button
                  variant={approval.ownResponse === "talk_first" ? "primary" : "secondary"}
                aria-pressed={approval.ownResponse === "talk_first"}
                onClick={() => void respond("talk_first")}
                disabled={busy !== null || approval.ownResponse === "talk_first"}
              >
                {busy === "talk_first" ? "Saving…" : "Let's talk first"}
              </Button>
              <Button
                  variant="secondary"
                onClick={() => setIsDeclining(true)}
                disabled={busy !== null}
              >
                Not this time
              </Button>
            </>
          ) : null}
          {canMatch ? (
            <Button
              variant="secondary"
              onClick={() => setIsMatching(true)}
              disabled={busy !== null}
            >
              {memberId ? "Change match" : "Match to roster"}
            </Button>
          ) : null}
        </div>
      ) : null}

      <FormError message={error} />

      {isDeclining ? (
        <DeclineRegistrationModal
          registrationId={row.id}
          displayName={row.displayName}
          onClose={() => setIsDeclining(false)}
          onDeclined={() => {
            setIsDeclining(false);
            onChanged();
          }}
        />
      ) : null}

      {isMatching ? (
        <MatchRegistrationModal
          registrationId={row.id}
          displayName={row.displayName}
          currentMemberId={memberId}
          user={user}
          onClose={() => setIsMatching(false)}
          onMatched={() => {
            setIsMatching(false);
            onChanged();
          }}
        />
      ) : null}
    </Card>
  );
}
