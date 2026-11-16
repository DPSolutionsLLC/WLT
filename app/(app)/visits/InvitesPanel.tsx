"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Card } from "@/components/ui/Card";
import { FormError } from "@/components/ui/FormError";
import { SmallButton } from "@/app/(app)/todos/SmallButton";
import { describeInvite } from "@/lib/visits/companionText";
import { formatAppointmentInstant } from "@/lib/visits/visitDates";
import type { VisitInvite } from "@/types/domain";

// PENDING VISIT INVITES (ITER-055 bv6, P13): at the top of My Appointments, and above the tabs on
// Visits whatever tab is open (the prototype's place). Renders nothing when there are none, so a
// leader who was never invited never sees an empty box.
//
// Accept or decline, once. Accepting puts the visit on My Appointments; declining takes it off the
// invitee's screens and, for a visit booked from a "Visit the ___ family" to-do, tells the booker
// there. The time is the WARD's (rule 12).

export type InvitesPanelProps = {
  invites: VisitInvite[];
  wardTimeZone: string;
};

async function readPayload(response: Response): Promise<{ error?: unknown; warning?: unknown }> {
  try {
    return (await response.json()) as { error?: unknown; warning?: unknown };
  } catch {
    return { error: "The server sent a response this page could not read." };
  }
}

export function InvitesPanel({ invites, wardTimeZone }: InvitesPanelProps) {
  const router = useRouter();
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | undefined>(undefined);
  const [warning, setWarning] = useState<string | undefined>(undefined);

  if (invites.length === 0 && warning === undefined) return null;

  async function answer(invite: VisitInvite, accept: boolean): Promise<void> {
    setError(undefined);
    setWarning(undefined);
    setBusyId(invite.companionId);

    try {
      const response = await fetch(`/api/visit-invites/${invite.companionId}`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ accept }),
      });
      const payload = await readPayload(response);

      if (!response.ok) {
        setError(typeof payload.error === "string" ? payload.error : "Could not save your answer.");
        return;
      }

      if (typeof payload.warning === "string") setWarning(payload.warning);
      router.refresh();
    } catch {
      setError("Could not reach the server. Check your connection and try again.");
    } finally {
      setBusyId(null);
    }
  }

  return (
    <Card className="flex flex-col gap-2 p-3">
      <h2 className="text-base font-semibold text-foreground">
        {invites.length === 1 ? "A visit invite" : `${invites.length} visit invites`}
      </h2>

      {invites.length === 0 ? null : (
        <ul className="flex flex-col gap-2">
          {invites.map((invite) => {
            const sentence = describeInvite(invite);
            return (
              <li
                key={invite.companionId}
                className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-border bg-surface px-3 py-2"
              >
                <div className="min-w-0">
                  <p className="break-words text-sm font-medium text-foreground">{sentence}</p>
                  <p className="text-xs text-muted">
                    {formatAppointmentInstant(invite.scheduledFor, wardTimeZone)}
                  </p>
                </div>
                <span className="flex items-center gap-0.5">
                  <SmallButton
                    label="Accept"
                    accessibleName={`Accept — ${sentence}`}
                    onClick={() => void answer(invite, true)}
                    disabled={busyId !== null}
                  />
                  <SmallButton
                    label="Decline"
                    accessibleName={`Decline — ${sentence}`}
                    onClick={() => void answer(invite, false)}
                    disabled={busyId !== null}
                  />
                </span>
              </li>
            );
          })}
        </ul>
      )}

      <FormError message={error} />
      {warning === undefined ? null : (
        <p role="status" className="text-sm text-warning">
          {warning}
        </p>
      )}
    </Card>
  );
}
