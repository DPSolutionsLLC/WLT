"use client";

import { useState } from "react";
import { InviteForm, type InviteCandidate } from "@/app/(app)/admin/users/InviteForm";
import { Button } from "@/components/ui/Button";
import { Modal } from "@/components/ui/Modal";
import type { UnlinkedHolder } from "@/lib/callings/callingReview";
import type { SessionUser } from "@/types/domain";

// CALLINGS WITH NO LINKED ACCOUNT (ITER-058 cr4), beside the Calling review on Admin → Users.
//
// COLLAPSED BY DEFAULT, WITH A COUNT. Until every existing account is linked (D1) this lists most
// of a ward's leaders, so it must not push the review and the user list off the screen. A row whose
// roster email belongs to an existing unlinked account says so and has no Invite — the fix there is
// linking that account on its row, and an invite would make a second one.

export type CallingsWithoutAccountProps = {
  holders: UnlinkedHolder[];
  sessionUser: SessionUser;
  candidates: Readonly<Record<string, InviteCandidate>>;
  refusals: Readonly<Record<string, string>>;
  pickerNotes: Readonly<Record<string, string>>;
};

function stateText(holder: UnlinkedHolder): string | null {
  if (holder.state === "maybe_account") {
    return `${holder.possibleAccountName ?? "An account"} may be this person — link them on their row below.`;
  }
  if (holder.state === "invited") return "Invited — not registered yet.";
  if (holder.state === "declined") {
    return `Said this invite wasn't them${describeDeclinedDay(holder.declinedAt)}. Check the email, then invite again.`;
  }
  return null;
}

const DAY_IN_MILLISECONDS = 24 * 60 * 60 * 1000;

// Counted back in days rather than printed as a date, so no time zone is involved (CLAUDE.md rule 12).
function describeDeclinedDay(declinedAt: string | null): string {
  if (!declinedAt) return "";
  const days = Math.floor((Date.now() - new Date(declinedAt).getTime()) / DAY_IN_MILLISECONDS);
  if (days < 1) return " today";
  if (days === 1) return " yesterday";
  return ` ${days} days ago`;
}

export function CallingsWithoutAccount({
  holders,
  sessionUser,
  candidates,
  refusals,
  pickerNotes,
}: CallingsWithoutAccountProps) {
  const [invitingId, setInvitingId] = useState<string | null>(null);
  const inviting = holders.find((holder) => holder.memberId === invitingId) ?? null;

  if (holders.length === 0) return null;

  return (
    <section aria-labelledby="calling-no-account-heading">
      <details className="rounded-md border border-border bg-surface-raised">
        <summary className="flex min-h-11 cursor-pointer items-center px-3 text-sm font-semibold text-foreground">
          <span id="calling-no-account-heading">
            Callings with no linked account <span className="font-normal text-muted">({holders.length})</span>
          </span>
        </summary>
        <p className="px-3 text-xs text-muted">
          People the ward list gives a calling in the app whose record no account is linked to.
        </p>
        <ul className="mt-2 flex flex-col">
          {holders.map((holder) => {
            const note = stateText(holder);
            return (
              <li
                key={holder.memberId}
                className="flex flex-wrap items-center justify-between gap-2 border-t border-border px-3 py-2"
              >
                <div className="min-w-0">
                  <span className="block text-sm text-foreground">
                    {holder.memberName} <span className="text-muted">· {holder.callingLabel}</span>
                  </span>
                  {note && <span className="block text-xs text-muted">{note}</span>}
                </div>
                {holder.state !== "maybe_account" && (
                  <Button variant="secondary" onClick={() => setInvitingId(holder.memberId)}>
                    {holder.state === "invite" ? "Invite" : "Invite again"}
                  </Button>
                )}
              </li>
            );
          })}
        </ul>
      </details>

      {inviting && (
        <Modal isOpen onClose={() => setInvitingId(null)} title={`Invite ${inviting.memberName}`}>
          <InviteForm
            key={inviting.memberId}
            sessionUser={sessionUser}
            candidates={candidates}
            refusals={refusals}
            pickerNotes={pickerNotes}
            preset={{ memberId: inviting.memberId, memberName: inviting.memberName, email: inviting.email }}
            framed={false}
          />
        </Modal>
      )}
    </section>
  );
}
