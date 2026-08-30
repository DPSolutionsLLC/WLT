"use client";

import { useState } from "react";
import { Button } from "@/components/ui/Button";

// "This is the same game as…"
//
// ---------------------------------------------------------------------------
// EVERY OPTION NAMES THE YOUNG PERSON, NEVER THE TITLE ALONE
// ---------------------------------------------------------------------------
// Two rows reading "Game vs Roosevelt" and "Game against Roosevelt" are the exact case this whole
// design exists for: a title is what a school feed happened to write, and two feeds write it
// differently. The time, the young person and the activity are the three facts that actually
// distinguish two games on one evening, so an option carries all three.
//
// ---------------------------------------------------------------------------
// THE CANDIDATES ARE BOUNDED TO THE EVENT'S OWN DAY, IN THE WARD'S ZONE
// ---------------------------------------------------------------------------
// The page fetches them; lib/youth/occasionDay.ts argues the zone. The ROUTE deliberately does
// NOT enforce the same-day rule — an all-day tournament entry and a 7:30pm game genuinely can be
// one occasion, and youth-c's rule holds: a near-miss a clever matcher would catch is exactly the
// case where a person should be asked. This narrows what is OFFERED; it does not second-guess an
// answer somebody gave.
//
// An empty list renders a SENTENCE rather than an empty select, and the sentence says what to do
// instead. An empty control that cannot be used is a dead end wearing the clothes of a choice.

export type JoinCandidate = {
  eventId: string;
  label: string;
};

export type JoinOccasionPickerProps = {
  candidates: JoinCandidate[];
  disabled: boolean;
  onJoin: (otherEventId: string) => void;
};

// `w-full min-w-0` IS LOAD-BEARING, AND IT IS NOT WHAT THE OTHER PICKERS IN THIS MODULE CARRY.
//
// A <select> sizes itself to its WIDEST OPTION, and this one's options are the longest in the app
// by design — time · young person · activity · title, four facts because fewer could not tell two
// games apart. Walking scenario 059 at 375px measured the page at scrollWidth 393 against
// clientWidth 360: the select alone pushed the whole page into a sideways scroll.
//
// `min-w-0` is the half that actually does the work. A flex item's default `min-width: auto`
// refuses to shrink below its content, so `w-full` on its own would still have overflowed — this
// is the standard flexbox trap and it is why the fix looks redundant and is not. The browser
// truncates the rendered option text instead, which is the right trade: the full text is still
// there when the menu opens.
const SELECT_CLASSES =
  "w-full min-w-0 min-h-11 rounded-md border border-border bg-surface-raised px-3 py-2 " +
  "text-base text-foreground focus-visible:outline-2 focus-visible:outline-offset-2 " +
  "focus-visible:outline-primary";

export function JoinOccasionPicker({
  candidates,
  disabled,
  onJoin,
}: JoinOccasionPickerProps) {
  const [otherEventId, setOtherEventId] = useState("");

  return (
    <div className="flex flex-col gap-2">
      <label htmlFor="join-occasion" className="text-sm font-medium text-foreground">
        This is the same game as…
      </label>

      {candidates.length === 0 ? (
        <p className="text-sm text-muted">
          No other youth activity is scheduled that day. If somebody else was there, add them
          below instead.
        </p>
      ) : (
        <div className="flex flex-wrap items-end gap-2">
          <div className="min-w-0 flex-1 basis-64">
            <select
              id="join-occasion"
              className={SELECT_CLASSES}
              value={otherEventId}
              disabled={disabled}
              onChange={(input) => setOtherEventId(input.target.value)}
            >
              <option value="">Choose the other event…</option>
              {candidates.map((candidate) => (
                <option key={candidate.eventId} value={candidate.eventId}>
                  {candidate.label}
                </option>
              ))}
            </select>
          </div>
          <Button
            variant="secondary"
            disabled={disabled || otherEventId === ""}
            onClick={() => {
              onJoin(otherEventId);
              setOtherEventId("");
            }}
          >
            Same game
          </Button>
        </div>
      )}
    </div>
  );
}
