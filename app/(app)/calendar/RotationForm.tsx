"use client";

import { useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/Button";
import { FormError } from "@/components/ui/FormError";
import { Input } from "@/components/ui/Input";
import type { RotationEntry } from "@/lib/calendar/resolveConductingUser";
import {
  ROTATION_CADENCES,
  ROTATION_CADENCE_LABELS,
  ROTATION_POSITIONS,
  type RotationCadence,
  type RotationPosition,
} from "@/types/domain";

// The one rotation form. ConductingRotationPanel and OrgRotationPanel both render it, differing
// only in who may be picked, which rotation is posted, and who gets told afterwards — a copy
// would be two places to keep the forward-only sentence and the 409 handling in step.

export type RotationCandidate = {
  id: string;
  name: string;
};

export type RotationFormProps = {
  // Null posts the bishopric's sacrament-meeting rotation; a uuid posts that organization's.
  orgId: string | null;
  candidates: RotationCandidate[];
  activeRotation: RotationEntry[];
  activeCadence: RotationCadence;
  // The next Sunday, resolved on the server in UTC. A date input default computed in the browser
  // would offer yesterday to anyone west of UTC after 5pm.
  defaultEffectiveFrom: string;
  // Who the server notifies on a successful save. Saying so is what makes shared authority feel
  // shared rather than surprising (CLAUDE.md §7), and the sentence differs between a bishopric of
  // three and a presidency of three.
  notifiedDescription: string;
  idPrefix: string;
};

const SELECT_CLASSES =
  "min-h-11 w-full rounded-md border border-border bg-surface-raised px-3 py-2 text-sm " +
  "text-foreground focus-visible:outline-2 focus-visible:outline-offset-2 " +
  "focus-visible:outline-primary";

// The labels change with the cadence because "First Sunday of the cycle" is actively wrong under
// a monthly rotation — that person takes every Sunday of the first MONTH.
const POSITION_LABELS: Record<RotationCadence, Record<RotationPosition, string>> = {
  weekly: {
    1: "First Sunday of the cycle",
    2: "Second Sunday of the cycle",
    3: "Third Sunday of the cycle",
  },
  monthly: {
    1: "First month of the cycle",
    2: "Second month of the cycle",
    3: "Third month of the cycle",
  },
};

// 03-calendar.md Step 3 requires the UI to say this, and it is not optional. A bishopric changing
// the rotation has to be able to see that last month's programs are not about to be rewritten
// underneath them — and the CADENCE is named too, because switching to monthly is the change most
// likely to be expected to re-shuffle a month that is already generated. It does not.
const FORWARD_ONLY_NOTE =
  "Changing the rotation or its cadence applies from the effective date forward. Sundays " +
  "already assigned keep their current conductor.";

export function RotationForm({
  orgId,
  candidates,
  activeRotation,
  activeCadence,
  defaultEffectiveFrom,
  notifiedDescription,
  idPrefix,
}: RotationFormProps) {
  const router = useRouter();

  const [positions, setPositions] = useState<Record<RotationPosition, string>>(() => ({
    1: activeRotation.find((entry) => entry.position === 1)?.userId ?? "",
    2: activeRotation.find((entry) => entry.position === 2)?.userId ?? "",
    3: activeRotation.find((entry) => entry.position === 3)?.userId ?? "",
  }));

  const [cadence, setCadence] = useState<RotationCadence>(activeCadence);
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
          orgId,
          cadence,
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

      setStatusMessage(`Saved. ${notifiedDescription}`);
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

      <div className="flex flex-col gap-1.5">
        <label
          htmlFor={`${idPrefix}-cadence`}
          className="text-sm font-medium text-foreground"
        >
          How the rotation advances
        </label>
        <select
          id={`${idPrefix}-cadence`}
          className={SELECT_CLASSES}
          value={cadence}
          onChange={(event) => setCadence(event.target.value as RotationCadence)}
        >
          {/* Sentences, not "Weekly" and "Monthly". "Monthly" alone does not distinguish "one
              person per month" from "the rotation restarts monthly", and this is the control
              most likely to be set wrong by somebody who has not read a plan. */}
          {ROTATION_CADENCES.map((value) => (
            <option key={value} value={value}>
              {ROTATION_CADENCE_LABELS[value]}
            </option>
          ))}
        </select>
      </div>

      {ROTATION_POSITIONS.map((position) => (
        <div key={position} className="flex flex-col gap-1.5">
          <label
            htmlFor={`${idPrefix}-position-${position}`}
            className="text-sm font-medium text-foreground"
          >
            {POSITION_LABELS[cadence][position]}
          </label>
          <select
            id={`${idPrefix}-position-${position}`}
            className={SELECT_CLASSES}
            value={positions[position]}
            onChange={(event) =>
              setPositions((current) => ({ ...current, [position]: event.target.value }))
            }
          >
            <option value="">Nobody</option>
            {candidates.map((candidate) => (
              <option key={candidate.id} value={candidate.id}>
                {candidate.name}
              </option>
            ))}
          </select>
        </div>
      ))}

      <Input
        id={`${idPrefix}-effective-from`}
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
