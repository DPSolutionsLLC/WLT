"use client";

import { useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/Button";
import { FormError } from "@/components/ui/FormError";
import { Input } from "@/components/ui/Input";

export type CalendarSettingsPanelProps = {
  defaultSpeakingSlots: number;
  maxSpeakingSlots: number;
  canManage: boolean;
};

// The ward's default number of speakers, editable in the app rather than in code. Every rule here
// already lives in PATCH /api/ward-settings/calendar — this is the control, not a second copy of
// the logic. Phase 11's admin settings page renders the same setting through the same route
// (03-calendar.md); do not duplicate the rule into that module.
//
// The initial values come from the server page rather than a GET on mount: the page is a Server
// Component that has already read them, so fetching again would only buy a loading state.
export function CalendarSettingsPanel({
  defaultSpeakingSlots,
  maxSpeakingSlots,
  canManage,
}: CalendarSettingsPanelProps) {
  const router = useRouter();

  const [value, setValue] = useState(String(defaultSpeakingSlots));
  const [maximum, setMaximum] = useState(maxSpeakingSlots);
  const [formError, setFormError] = useState<string>();
  const [note, setNote] = useState<string>();
  const [isSubmitting, setIsSubmitting] = useState(false);

  if (!canManage) {
    return (
      <p className="text-sm text-muted">
        New Sundays are created with {defaultSpeakingSlots}{" "}
        {defaultSpeakingSlots === 1 ? "speaker" : "speakers"}. A member of the bishopric can
        change this.
      </p>
    );
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setFormError(undefined);
    setNote(undefined);
    setIsSubmitting(true);

    try {
      const response = await fetch("/api/ward-settings/calendar", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ defaultSpeakingSlots: Number(value) }),
      });

      const body: {
        defaultSpeakingSlots?: number;
        maxSpeakingSlots?: number;
        note?: string;
        error?: string;
      } = await response.json();

      if (!response.ok || body.defaultSpeakingSlots === undefined) {
        setFormError(body.error ?? "Could not save the setting. Please try again.");
        return;
      }

      setValue(String(body.defaultSpeakingSlots));
      if (body.maxSpeakingSlots !== undefined) setMaximum(body.maxSpeakingSlots);

      // Rendered VERBATIM, the same rule the 409 dialog follows. The server owns this sentence,
      // and it says the one thing a bishopric will otherwise assume wrong: the calendar already
      // on screen is not being rewritten.
      setNote(body.note);
      router.refresh();
    } catch (error) {
      console.error("Could not save the calendar settings", error);
      setFormError("Could not reach the server. Check your connection and try again.");
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="flex flex-col gap-4" noValidate>
      <Input
        id="default-speaking-slots"
        label="Speakers on a new Sunday"
        type="number"
        inputMode="numeric"
        min={1}
        max={maximum}
        step={1}
        value={value}
        onChange={(event) => setValue(event.target.value)}
      />

      <FormError message={formError} />

      {note && (
        <p role="status" className="text-sm text-muted">
          {note}
        </p>
      )}

      <Button type="submit" disabled={isSubmitting}>
        {isSubmitting ? "Saving…" : "Save default"}
      </Button>
    </form>
  );
}
