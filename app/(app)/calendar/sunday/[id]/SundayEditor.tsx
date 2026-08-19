"use client";

import { useId, useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/Button";
import { FormError } from "@/components/ui/FormError";
import { Input } from "@/components/ui/Input";
import { Modal } from "@/components/ui/Modal";
import type {
  BishopricUser,
  CalendarChangeReason,
  CalendarChangeWarning,
  Sunday,
} from "@/lib/calendar/queries";
import { MAX_SPEAKING_SLOTS } from "@/lib/validation/calendar";
import { SUNDAY_TYPES, SUNDAY_TYPE_LABELS, type SundayType } from "@/types/domain";

export type SundayEditorProps = {
  sunday: Sunday;
  bishopricUsers: BishopricUser[];
  bishopricNames: Record<string, string>;
};

const SELECT_CLASSES =
  "min-h-11 w-full rounded-md border border-border bg-surface-raised px-3 py-2 text-sm " +
  "text-foreground focus-visible:outline-2 focus-visible:outline-offset-2 " +
  "focus-visible:outline-primary";

// The dialog TITLE, and nothing else, comes from `reason`. "This cancels a meeting" reads very
// differently from "Fast Sunday is moving", and a single generic heading over four different
// consequences is how somebody confirms the wrong thing. The BODY is always the server's own
// sentence, verbatim.
const WARNING_TITLES: Record<CalendarChangeReason, string> = {
  fast_sunday_moved: "Fast Sunday is moving",
  meeting_cancelled: "This cancels a sacrament meeting",
  fast_sunday_set: "This Sunday becomes Fast Sunday",
  slots_reduced: "Fewer speaking slots than speakers",
};

type PatchResponse = {
  sunday?: Sunday;
  assignmentsReverted?: number;
  warning?: CalendarChangeWarning;
  error?: string;
};

export function SundayEditor({ sunday, bishopricUsers, bishopricNames }: SundayEditorProps) {
  const router = useRouter();
  const warningTextId = useId();

  const [type, setType] = useState<SundayType>(sunday.type);
  const [notes, setNotes] = useState(sunday.notes ?? "");
  const [conductingUserId, setConductingUserId] = useState(sunday.conductingUserId ?? "");
  const [speakingSlots, setSpeakingSlots] = useState(String(sunday.speakingSlots));
  const [presidingOverride, setPresidingOverride] = useState(sunday.presidingOverride ?? "");
  const [fastSundayPinned, setFastSundayPinned] = useState(sunday.fastSundayPinned);

  const [warning, setWarning] = useState<CalendarChangeWarning>();
  const [formError, setFormError] = useState<string>();
  const [statusMessage, setStatusMessage] = useState<string>();
  const [isSubmitting, setIsSubmitting] = useState(false);

  async function submit(confirm: boolean): Promise<void> {
    setFormError(undefined);
    setStatusMessage(undefined);
    setIsSubmitting(true);

    try {
      const response = await fetch(
        `/api/sundays/${sunday.id}${confirm ? "?confirm=true" : ""}`,
        {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            type,
            notes: notes.trim() === "" ? null : notes.trim(),
            conductingUserId: conductingUserId === "" ? null : conductingUserId,
            speakingSlots: Number(speakingSlots),
            presidingOverride:
              presidingOverride.trim() === "" ? null : presidingOverride.trim(),
            fastSundayPinned,
          }),
        },
      );

      const body: PatchResponse = await response.json();

      // 409 is checked BEFORE any generic handler. It is a SUCCESSFUL response with a meaningful
      // body, not a failure — a catch-all that mapped every non-OK status to one message would
      // turn the phase's most important conversation into "something went wrong" (roster-c).
      if (response.status === 409 && body.warning) {
        setWarning(body.warning);
        return;
      }

      if (!response.ok || !body.sunday) {
        setFormError(body.error ?? "Could not save that Sunday. Please try again.");
        return;
      }

      setWarning(undefined);

      // A silent success after that warning is worse than the warning. "Moved back to planning",
      // never "removed" or "cancelled" — those assignments still exist and Phase 4 must not count
      // them as talks that were given (04-talks-pipeline.md §Step 2).
      const reverted = body.assignmentsReverted ?? 0;
      setStatusMessage(
        reverted > 0
          ? `Saved. ${reverted} ${reverted === 1 ? "speaker" : "speakers"} moved back to the planning stage.`
          : "Saved.",
      );

      // The saved row comes back AFTER the month was re-resolved, so the form has to take its new
      // state from the response — apply_fast_sunday may have changed this Sunday's own type and
      // speaking slots.
      setType(body.sunday.type);
      setSpeakingSlots(String(body.sunday.speakingSlots));
      setFastSundayPinned(body.sunday.fastSundayPinned);

      // The page is a Server Component and the month behind it must re-read.
      router.refresh();
    } catch (error) {
      console.error("Could not save the Sunday", error);
      setFormError("Could not reach the server. Check your connection and try again.");
    } finally {
      setIsSubmitting(false);
    }
  }

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    void submit(false);
  }

  return (
    <>
      <form onSubmit={handleSubmit} className="flex flex-col gap-4" noValidate>
        <div className="flex flex-col gap-1.5">
          <label htmlFor="sunday-type" className="text-sm font-medium text-foreground">
            Type
          </label>
          <select
            id="sunday-type"
            className={SELECT_CLASSES}
            value={type}
            onChange={(event) => setType(event.target.value as SundayType)}
          >
            {SUNDAY_TYPES.map((option) => (
              <option key={option} value={option}>
                {SUNDAY_TYPE_LABELS[option]}
              </option>
            ))}
          </select>
        </div>

        <div className="flex flex-col gap-1.5">
          <label htmlFor="sunday-conducting" className="text-sm font-medium text-foreground">
            Conducting
          </label>
          <select
            id="sunday-conducting"
            className={SELECT_CLASSES}
            value={conductingUserId}
            onChange={(event) => setConductingUserId(event.target.value)}
          >
            <option value="">Not set</option>
            {bishopricUsers.map((user) => (
              <option key={user.id} value={user.id}>
                {bishopricNames[user.id]}
              </option>
            ))}
          </select>
        </div>

        {/* A free number input, never a three-option select. The bishopric sets the count per
            Sunday: a testimony-style meeting or a farewell with the whole family speaking is a
            real Sunday, and the ward default is only a starting value (03-calendar.md). */}
        <Input
          id="sunday-speaking-slots"
          label="Speaking slots"
          type="number"
          inputMode="numeric"
          min={0}
          max={MAX_SPEAKING_SLOTS}
          step={1}
          value={speakingSlots}
          onChange={(event) => setSpeakingSlots(event.target.value)}
        />

        <div className="flex flex-col gap-1.5">
          <label htmlFor="sunday-notes" className="text-sm font-medium text-foreground">
            Notes
          </label>
          <textarea
            id="sunday-notes"
            rows={3}
            maxLength={500}
            className="rounded-md border border-border bg-surface-raised px-3 py-2 text-base text-foreground placeholder:text-muted focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
            value={notes}
            onChange={(event) => setNotes(event.target.value)}
          />
        </div>

        <Input
          id="sunday-presiding"
          label="Presiding (override)"
          value={presidingOverride}
          onChange={(event) => setPresidingOverride(event.target.value)}
          maxLength={120}
          autoComplete="off"
        />

        <div className="flex flex-col gap-1.5">
          <label
            htmlFor="sunday-fast-pinned"
            className="flex min-h-11 items-center gap-2 text-sm font-medium text-foreground"
          >
            <input
              id="sunday-fast-pinned"
              type="checkbox"
              aria-describedby="sunday-fast-pinned-help"
              checked={fastSundayPinned}
              onChange={(event) => setFastSundayPinned(event.target.checked)}
            />
            Pin as Fast Sunday
          </label>
          {/* The least obvious control in the phase, so it gets the one line that explains it. */}
          <p id="sunday-fast-pinned-help" className="text-sm text-muted">
            Keeps this Sunday as Fast Sunday even if a conference is added earlier in the month.
          </p>
        </div>

        <FormError message={formError} />

        {statusMessage && (
          <p role="status" className="text-sm text-muted">
            {statusMessage}
          </p>
        )}

        <Button type="submit" disabled={isSubmitting}>
          {isSubmitting ? "Saving…" : "Save Sunday"}
        </Button>
      </form>

      <Modal
        isOpen={warning !== undefined}
        // Cancelling changes nothing and leaves the form exactly as the user left it, so they can
        // adjust rather than retype.
        onClose={() => setWarning(undefined)}
        title={warning ? WARNING_TITLES[warning.reason] : ""}
      >
        {warning && (
          <div className="flex flex-col gap-4">
            {/* The server's sentence, verbatim. Rebuilding it here from the counts is how
                roster-c's preview and result screens drifted apart. */}
            <p id={warningTextId} className="text-sm text-foreground">
              {warning.message}
            </p>

            <div className="flex flex-col gap-2 md:flex-row">
              <Button
                type="button"
                variant="danger"
                // Tied to the text that explains the consequence, so a screen-reader user meets
                // the reason and the control together (roster-c shipped these apart).
                aria-describedby={warningTextId}
                disabled={isSubmitting}
                onClick={() => void submit(true)}
              >
                {isSubmitting ? "Applying…" : "Apply the change"}
              </Button>
              <Button
                type="button"
                variant="secondary"
                onClick={() => setWarning(undefined)}
              >
                Cancel
              </Button>
            </div>
          </div>
        )}
      </Modal>
    </>
  );
}
