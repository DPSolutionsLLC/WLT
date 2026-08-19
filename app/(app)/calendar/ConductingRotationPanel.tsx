"use client";

import { useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/Button";
import { FormError } from "@/components/ui/FormError";
import { Input } from "@/components/ui/Input";
import type { BishopricUser } from "@/lib/calendar/queries";
import type { RotationEntry } from "@/lib/calendar/resolveConductingUser";
import { ROTATION_POSITIONS, type RotationPosition } from "@/types/domain";

export type ConductingRotationPanelProps = {
  bishopricUsers: BishopricUser[];
  bishopricNames: Record<string, string>;
  activeRotation: RotationEntry[];
  // The next Sunday, resolved on the server in UTC. A date input default computed in the browser
  // would offer yesterday to anyone west of UTC after 5pm.
  defaultEffectiveFrom: string;
};

const SELECT_CLASSES =
  "min-h-11 w-full rounded-md border border-border bg-surface-raised px-3 py-2 text-sm " +
  "text-foreground focus-visible:outline-2 focus-visible:outline-offset-2 " +
  "focus-visible:outline-primary";

const POSITION_LABELS: Record<RotationPosition, string> = {
  1: "First Sunday of the cycle",
  2: "Second Sunday of the cycle",
  3: "Third Sunday of the cycle",
};

// 03-calendar.md Step 3 requires the UI to say this, and it is not optional. A bishopric reordering
// the rotation has to be able to see that last month's programs are not about to be rewritten
// underneath them.
const FORWARD_ONLY_NOTE =
  "Changing the rotation applies from the effective date forward. Sundays already assigned keep " +
  "their current conductor.";

export function ConductingRotationPanel({
  bishopricUsers,
  bishopricNames,
  activeRotation,
  defaultEffectiveFrom,
}: ConductingRotationPanelProps) {
  const router = useRouter();

  const [positions, setPositions] = useState<Record<RotationPosition, string>>(() => ({
    1: activeRotation.find((entry) => entry.position === 1)?.userId ?? "",
    2: activeRotation.find((entry) => entry.position === 2)?.userId ?? "",
    3: activeRotation.find((entry) => entry.position === 3)?.userId ?? "",
  }));

  const [effectiveFrom, setEffectiveFrom] = useState(defaultEffectiveFrom);
  const [formError, setFormError] = useState<string>();
  const [statusMessage, setStatusMessage] = useState<string>();
  const [isSubmitting, setIsSubmitting] = useState(false);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setFormError(undefined);
    setStatusMessage(undefined);
    setIsSubmitting(true);

    try {
      const response = await fetch("/api/conducting-rotation", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          effectiveFrom,
          positions: ROTATION_POSITIONS.map((position) => ({
            position,
            userId: positions[position] === "" ? null : positions[position],
          })),
        }),
      });

      const body: { error?: string } = await response.json();

      // The unique-constraint 409 is the server telling the user that date already carries a
      // rotation. Its message is already the right sentence — translating it here would give the
      // user a vaguer version of something the server said precisely.
      if (!response.ok) {
        setFormError(body.error ?? "Could not save the rotation. Please try again.");
        return;
      }

      // Saying the notification happened is what makes shared bishopric authority feel shared
      // rather than surprising (CLAUDE.md §7).
      setStatusMessage(
        `Saved. The other members of the bishopric have been notified of the change.`,
      );
      router.refresh();
    } catch (error) {
      console.error("Could not save the conducting rotation", error);
      setFormError("Could not reach the server. Check your connection and try again.");
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="flex flex-col gap-4" noValidate>
      <p className="text-sm text-muted">{FORWARD_ONLY_NOTE}</p>

      {ROTATION_POSITIONS.map((position) => (
        <div key={position} className="flex flex-col gap-1.5">
          <label
            htmlFor={`rotation-position-${position}`}
            className="text-sm font-medium text-foreground"
          >
            {POSITION_LABELS[position]}
          </label>
          <select
            id={`rotation-position-${position}`}
            className={SELECT_CLASSES}
            value={positions[position]}
            onChange={(event) =>
              setPositions((current) => ({ ...current, [position]: event.target.value }))
            }
          >
            <option value="">Nobody</option>
            {bishopricUsers.map((user) => (
              <option key={user.id} value={user.id}>
                {bishopricNames[user.id]}
              </option>
            ))}
          </select>
        </div>
      ))}

      <Input
        id="rotation-effective-from"
        label="Effective from"
        type="date"
        value={effectiveFrom}
        onChange={(event) => setEffectiveFrom(event.target.value)}
      />

      <FormError message={formError} />

      {statusMessage && (
        <p role="status" className="text-sm text-muted">
          {statusMessage}
        </p>
      )}

      <Button type="submit" disabled={isSubmitting}>
        {isSubmitting ? "Saving…" : "Save rotation"}
      </Button>
    </form>
  );
}
