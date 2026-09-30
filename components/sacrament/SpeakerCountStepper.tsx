"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/Button";
import { FormError } from "@/components/ui/FormError";

// "SPEAKERS THIS WEEK" (Topics rebuild t3, the prototype's speaker-count stepper). − / count / + /
// Save, 1 to 6 (or the Sunday's own count, if it is already higher).
//
// − STOPS AT A SLOT WITH A SPEAKER IN IT — the prototype's rule, with its hint. Lowering the count
// past somebody would cancel their talk from a number control; taking a talk out of the middle is
// what Delete is for.
//
// SAVE FOLLOWS PATCH /api/sundays/[id]'s WARN-THEN-CONFIRM PROTOCOL, never around it: when the
// change would cancel work the server answers 409 with a `warning`, which is shown in full, and
// only "Apply the change" resends it with `?confirm=true` (calendar-b's SundayEditor).
//
// AFTER A SAVE, somebody who holds `admin.manage_ward` is offered to make the new count the ward's
// default. The wording is honest about its reach: the setting shapes Sundays generated LATER, and
// changes no Sunday already on the calendar.

const MIN_SLOTS = 1;
const MAX_SLOTS = 6;

export type SpeakerCountStepperProps = {
  sundayId: string;
  count: number;
  wardDefault: number;
  // Index i is slot i + 1: whether a speaker is in it.
  slotHasSpeaker: readonly boolean[];
  canSetDefault: boolean;
};

async function readPayload(response: Response): Promise<{ error?: string; warning?: { message?: string } }> {
  try {
    return (await response.json()) as { error?: string; warning?: { message?: string } };
  } catch {
    return { error: "The server sent a response this page could not read." };
  }
}

export function SpeakerCountStepper({
  sundayId,
  count,
  wardDefault,
  slotHasSpeaker,
  canSetDefault,
}: SpeakerCountStepperProps) {
  const router = useRouter();
  const [pending, setPending] = useState(count);
  const [isSaving, setIsSaving] = useState(false);
  const [formError, setFormError] = useState<string>();
  const [warning, setWarning] = useState<string>();
  const [offerDefault, setOfferDefault] = useState<number | null>(null);
  const [defaultMessage, setDefaultMessage] = useState<string>();
  // THE COUNT FOLLOWS THE PAGE. Anything else that changes the Sunday — Delete on a talk, a save
  // here, another tab — refreshes the page with a new `count`, and the stepper starts again from it
  // (defect 083-D1: after a Delete it kept its old number with Save lit, so Save would have put the
  // removed slot back). Adjusted during render, React's pattern for state that follows a prop, so
  // the "make this the default" offer below survives the refresh its own save causes.
  const [followedCount, setFollowedCount] = useState(count);
  if (count !== followedCount) {
    setFollowedCount(count);
    setPending(count);
    setWarning(undefined);
  }

  const max = Math.max(MAX_SLOTS, count);
  const lastPendingHasSpeaker = slotHasSpeaker[pending - 1] === true;
  const lowerDisabled = pending <= MIN_SLOTS || lastPendingHasSpeaker;

  async function save(confirm: boolean): Promise<void> {
    setIsSaving(true);
    setFormError(undefined);
    setDefaultMessage(undefined);

    try {
      const response = await fetch(`/api/sundays/${sundayId}${confirm ? "?confirm=true" : ""}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ speakingSlots: pending }),
      });
      const payload = await readPayload(response);

      if (response.status === 409 && payload.warning?.message !== undefined) {
        setWarning(payload.warning.message);
        return;
      }
      if (!response.ok) {
        setFormError(payload.error ?? "Could not save the number of speakers. Please try again.");
        return;
      }

      setWarning(undefined);
      setOfferDefault(canSetDefault && pending !== wardDefault ? pending : null);
      router.refresh();
    } catch (error) {
      console.error("Could not save a Sunday's speaker count", error);
      setFormError("Could not reach the server. Check your connection and try again.");
    } finally {
      setIsSaving(false);
    }
  }

  async function makeDefault(slots: number): Promise<void> {
    setIsSaving(true);
    setFormError(undefined);
    try {
      const response = await fetch("/api/ward-settings/calendar", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ defaultSpeakingSlots: slots }),
      });
      if (!response.ok) {
        const payload = await readPayload(response);
        setFormError(payload.error ?? "Could not change the ward's default. Please try again.");
        return;
      }
      setOfferDefault(null);
      setDefaultMessage(`Sundays added from now on will have ${slots} speakers.`);
      router.refresh();
    } catch (error) {
      console.error("Could not save the ward's default speaker count", error);
      setFormError("Could not reach the server. Check your connection and try again.");
    } finally {
      setIsSaving(false);
    }
  }

  return (
    <div className="flex flex-col gap-3 rounded-md border border-border p-3">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="min-w-0">
          <p id={`speaker-count-${sundayId}`} className="text-sm font-medium text-foreground">
            Speakers this week{pending === wardDefault ? " (default)" : ""}
          </p>
          {lastPendingHasSpeaker && (
            <p className="text-xs text-muted">Clear one speaker slot to go lower.</p>
          )}
        </div>
        <div
          className="flex items-center gap-2"
          role="group"
          aria-labelledby={`speaker-count-${sundayId}`}
        >
          <Button
            type="button"
            variant="secondary"
            aria-label="One fewer speaker"
            disabled={lowerDisabled || isSaving}
            onClick={() => setPending((value) => Math.max(MIN_SLOTS, value - 1))}
            className="min-w-11"
          >
            −
          </Button>
          <span className="w-6 text-center font-semibold text-foreground" aria-live="polite">
            {pending}
          </span>
          <Button
            type="button"
            variant="secondary"
            aria-label="One more speaker"
            disabled={pending >= max || isSaving}
            onClick={() => setPending((value) => Math.min(max, value + 1))}
            className="min-w-11"
          >
            +
          </Button>
          <Button
            type="button"
            disabled={pending === count || isSaving}
            onClick={() => save(false)}
          >
            {isSaving ? "Saving…" : "Save"}
          </Button>
        </div>
      </div>

      {warning !== undefined && (
        <div className="flex flex-col gap-2 rounded-md border border-warning p-3" role="status">
          <p className="text-sm text-foreground">{warning}</p>
          <div className="flex flex-wrap gap-2">
            <Button type="button" onClick={() => save(true)} disabled={isSaving}>
              Apply the change
            </Button>
            <Button
              type="button"
              variant="secondary"
              onClick={() => {
                setWarning(undefined);
                setPending(count);
              }}
              disabled={isSaving}
            >
              Cancel
            </Button>
          </div>
        </div>
      )}

      {offerDefault !== null && (
        <div className="flex flex-wrap items-center gap-2" role="status">
          <p className="text-sm text-foreground">
            Make {offerDefault} the default for Sundays added from now on?
          </p>
          <Button type="button" onClick={() => makeDefault(offerDefault)} disabled={isSaving}>
            Yes
          </Button>
          <Button type="button" variant="secondary" onClick={() => setOfferDefault(null)} disabled={isSaving}>
            No
          </Button>
        </div>
      )}

      {defaultMessage !== undefined && <p className="text-sm text-muted">{defaultMessage}</p>}
      <FormError message={formError} />
    </div>
  );
}
