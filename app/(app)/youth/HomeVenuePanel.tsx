"use client";

import { useState } from "react";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { FormError } from "@/components/ui/FormError";
// From the VALIDATION module, never from lib/ward/homeVenues.ts — that one is server-only, and
// importing a constant out of it here would pull next/headers into the browser bundle and fail
// the production build while every other check stayed green.
import { MAX_HOME_VENUES } from "@/lib/validation/visit";

// Which places count as the ward's own, as a list a bishopric member edits.
//
// ---------------------------------------------------------------------------
// A TEXTAREA, ONE VENUE PER LINE
// ---------------------------------------------------------------------------
// A repeating add/remove row list is four times the code for a list a ward edits twice a year,
// and it is worse to use on a phone. One line per place is a shape everybody already knows.
//
// ---------------------------------------------------------------------------
// IT SAYS OUT LOUD THAT EXISTING EVENTS ARE NOT RECLASSIFIED
// ---------------------------------------------------------------------------
// A leader who adds their school, sees nothing change, and is told nothing will assume the
// feature is broken. Reclassifying in bulk is a real feature with its own confirm and it is not
// this slice, so the panel names the limit rather than hiding it.
//
// RENDERED ONLY FOR THE BISHOPRIC. /youth's page decides that and does not render this component
// otherwise — ABSENT rather than present-and-refusing, which is defect youth-a-D1 and visits-d's
// mistake both. The route enforces the same rule again in its own right.

export type HomeVenuePanelProps = {
  initialVenues: string[];
};

const TEXTAREA_CLASSES =
  "min-h-32 w-full rounded-md border border-border bg-surface-raised px-3 py-2 text-base " +
  "text-foreground focus-visible:outline-2 focus-visible:outline-offset-2 " +
  "focus-visible:outline-primary";

function toLines(venues: readonly string[]): string {
  return venues.join("\n");
}

function toVenues(text: string): string[] {
  return text
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line !== "");
}

function venueCount(count: number): string {
  // Pluralised rather than "place(s)". youth-b shipped three copy defects with a green suite and
  // one of them was exactly this.
  return count === 1 ? "1 place" : `${count} places`;
}

export function HomeVenuePanel({ initialVenues }: HomeVenuePanelProps) {
  const [venues, setVenues] = useState<string[]>(initialVenues);
  const [draft, setDraft] = useState(toLines(initialVenues));
  const [isOpen, setIsOpen] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string>();
  const [notice, setNotice] = useState<string>();

  async function save(): Promise<void> {
    const next = toVenues(draft);

    if (next.length > MAX_HOME_VENUES) {
      setErrorMessage(`Keep the list to ${MAX_HOME_VENUES} places.`);
      return;
    }

    setIsSaving(true);
    setErrorMessage(undefined);
    setNotice(undefined);

    try {
      // The body key is the name lib/validation/visit.ts parses, checked against that file rather
      // than assumed (plans/retros/roster-b-picker-and-orgs.md).
      const response = await fetch("/api/ward-settings/home-venues", {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ homeVenues: next }),
      });

      const payload = (await response.json().catch(() => ({}))) as {
        homeVenues?: string[];
        error?: string;
      };

      if (!response.ok) {
        throw new Error(payload.error ?? "Could not save the home venues.");
      }

      // THE SERVER'S ANSWER, not the value that was asked for. writeHomeVenues trims, lower-cases
      // and de-duplicates, so what comes back is frequently not what was typed — and showing the
      // typed version would leave the panel disagreeing with what the classifier actually uses.
      const saved = payload.homeVenues ?? next;
      setVenues(saved);
      setDraft(toLines(saved));
      setNotice("Saved. Events already on the schedule are unchanged.");
    } catch (error) {
      setErrorMessage(
        error instanceof Error
          ? error.message
          : "Could not save the home venues. Please try again.",
      );
    } finally {
      setIsSaving(false);
    }
  }

  return (
    <Card>
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="text-base font-semibold text-foreground">Home venues</h2>
        <Button variant="secondary" onClick={() => setIsOpen((current) => !current)}>
          {isOpen ? "Close" : "Edit"}
        </Button>
      </div>

      <p className="mt-2 text-sm text-foreground">
        Events at these places are marked <span className="font-medium">Home</span>{" "}
        automatically when a schedule is imported. Everything else waits for somebody to say.
      </p>

      <p className="mt-2 text-sm text-muted">
        {venues.length === 0
          ? "No places are set yet, so every imported event arrives as “Home or away?” for somebody to settle."
          : `${venueCount(venues.length)}: ${venues.join(", ")}.`}
      </p>

      {isOpen ? (
        <div className="mt-3 flex flex-col gap-3 border-t border-border pt-3">
          <div className="flex flex-col gap-1.5">
            <label htmlFor="home-venues" className="text-sm font-medium text-foreground">
              One place per line
            </label>
            <textarea
              id="home-venues"
              className={TEXTAREA_CLASSES}
              value={draft}
              disabled={isSaving}
              placeholder={"Lincoln High School\nWard building"}
              onChange={(input) => setDraft(input.target.value)}
            />
            <p className="text-sm text-muted">
              A match is on any part of the location, so &ldquo;Lincoln High School&rdquo; also
              catches &ldquo;Lincoln High School gym&rdquo;. Capitals do not matter.
            </p>
          </div>

          {/* SAID BEFORE THE SAVE, NOT AFTER. A leader who adds their school and then sees every
              existing game still reading "Home or away?" would otherwise conclude the setting did
              nothing. */}
          <p className="text-sm text-muted">
            Saving this does <span className="font-medium">not</span> change events that are
            already on the schedule &mdash; it only affects the next import. Change an existing
            event with its own Edit control.
          </p>

          <FormError message={errorMessage} />
          {notice === undefined ? null : (
            <p role="status" className="text-sm text-success">
              {notice}
            </p>
          )}

          <div>
            <Button onClick={save} disabled={isSaving}>
              {isSaving ? "Saving…" : "Save home venues"}
            </Button>
          </div>
        </div>
      ) : null}
    </Card>
  );
}
