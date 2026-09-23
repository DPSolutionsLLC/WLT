import { Card } from "@/components/ui/Card";
import { Pill } from "@/components/ui/Pill";
import { formatSundayLabelWithYear } from "@/lib/calendar/dates";
// TYPE-ONLY. A VALUE import of a queries.ts from a client component pulls in next/headers, which
// lint and typecheck both pass and only `npm run build` catches
// (plans/retros/roster-b-picker-and-orgs.md). This file has no "use client" and does not need
// one — it holds no state and no handlers — but the rule is cheap to keep and the file sits
// beside TopicList, which does.
import type { TopicUsage } from "@/lib/topics/queries";
import { RECENT_MONTHS } from "@/lib/topics/topicRotation";

// WHAT THIS WARD HAS ACTUALLY TALKED ABOUT — p4-sacrament-b3.
//
// The user's ask: "just be able to see a quick overview of topics that have been used recently —
// make sure that you're [not] duplicating something that's been used recently."
//
// ---------------------------------------------------------------------------
// IT IS NOT THE LIBRARY, AND IT IS ABOVE THE LIBRARY FOR THAT REASON
// ---------------------------------------------------------------------------
// The library below answers "which subjects are stale" — one row per TOPIC, sorted by staleness,
// badged "Used recently". This answers a different question with the same words in it: "what did
// we actually do, on which Sunday, and who gave it". One row per USAGE, so a topic used twice
// appears twice — collapsing them would throw away the dates, which are the whole answer.
//
// ---------------------------------------------------------------------------
// THE DATE RENDERS IN UTC
// ---------------------------------------------------------------------------
// `sundays.date` is a Postgres `date` — a day with no time and no zone — so it goes through
// lib/calendar/dates.ts, whose every formatter passes `timeZone: "UTC"` explicitly (CLAUDE.md
// rule 12). Do NOT reach for readWardTimezone here: that is for a turn-up-at `timestamptz`, and
// using it on a date column is the reverse of the bug it exists to prevent.
//
// ---------------------------------------------------------------------------
// A READ. NOTHING HERE IS A CONTROL.
// ---------------------------------------------------------------------------
// No links, no buttons, no filters. A conductor glances at it while choosing what to plan, and
// every row of it is already reachable from the Sacrament hub. Adding a control would make this
// a second way to edit assignments, which is the drift the hub exists to undo.

export type RecentTopicUsageProps = {
  usage: readonly TopicUsage[];
};

export function RecentTopicUsage({ usage }: RecentTopicUsageProps) {
  return (
    <Card>
      <h2 className="font-display text-base font-semibold text-foreground">
        Recently used
      </h2>

      {usage.length === 0 ? (
        // A FACT, AND NO ACTION OFFERED. A ward that has just started has none of these, and
        // that is not a problem for anybody to go and fix — so this says what is true and stops.
        // The empty states on /music and /visits are worded the same way and for the same reason.
        <p className="mt-1 text-sm text-muted">
          No topics have been used in the last six months.
        </p>
      ) : (
        <>
          {/* Correctly pluralised, in a BRANCH rather than a template. "1 topics" is the plural
              bug plans/retros/ai-b-knowledge-and-retrieval.md recorded and scenario 031 exists to
              catch. The window is named from the same constant the library's "Used recently"
              badge uses, so the two sentences on this page cannot disagree about what "recently"
              means. */}
          <p className="mt-1 text-sm text-muted">
            {usage.length === 1
              ? `One talk in the ${RECENT_MONTHS} months either side of today.`
              : `${usage.length} talks in the ${RECENT_MONTHS} months either side of today.`}
          </p>

          <ul className="mt-3 flex flex-col divide-y divide-border">
            {usage.map((entry) => (
              // ---------------------------------------------------------------------------
              // ⚠️ IT STACKS BELOW `sm:`, AND THAT IS A FIX RATHER THAN A PREFERENCE
              // ---------------------------------------------------------------------------
              // This shipped as three columns at every width, with the date on a fixed `w-36`.
              // At 375px that 144px column left the title 17-41px, and the title text painted
              // straight over the speaker's name — "Ministering as the Savior Did" rendered as
              // "MinisBrothering Elias Hale" (defect 073-D1, found by walking scenario 073).
              //
              // Three columns need about 560px to hold their content. Below that the row is one
              // column and the speaker sits under the topic, which is the reading order anyway.
              <li
                key={`${entry.sundayId}-${entry.topicId}-${entry.speakerName ?? ""}`}
                // `items-start` on the stacked axis, because a flex column stretches its children
                // by default and the "Coming up" pill would run the full width of the card —
                // a pill is a badge, and a full-bleed one reads as a banner.
                className="flex flex-col items-start gap-y-0.5 py-2 first:pt-0 last:pb-0 sm:flex-row sm:flex-wrap sm:items-baseline sm:gap-x-2"
              >
                {/* tabular-nums so a column of dates lines up rather than jittering by digit. The
                    fixed width applies only where there IS a column to line up. */}
                <span className="text-xs tabular-nums text-muted sm:w-36 sm:shrink-0">
                  {formatSundayLabelWithYear(entry.date)}
                </span>

                {/* `break-words` so a long single word cannot push past its track even once the
                    track is the full width of the card. Clipped text is a bug. */}
                <span className="min-w-0 break-words text-sm text-foreground sm:flex-1">
                  {entry.topicTitle}
                </span>

                {/* AN ABSENCE RENDERS AS AN ABSENCE (talks-c). A slot with a topic and nobody in
                    it yet is the ordinary state in this ward's workflow — topics first, speakers
                    after — so it says "no speaker yet" rather than "None", which would read as a
                    decision somebody made. */}
                <span className="text-sm text-muted">
                  {entry.speakerName ?? "no speaker yet"}
                </span>

                {/* MARKED, because including it widens what was asked for. The user said "has
                    been used"; a topic already on the calendar for a future Sunday is here too,
                    and it must be tellable apart at a glance rather than quietly counted as
                    history (lib/topics/queries.ts states the widening and its reason). */}
                {entry.isUpcoming && <Pill tone="pending">Coming up</Pill>}
              </li>
            ))}
          </ul>
        </>
      )}
    </Card>
  );
}
