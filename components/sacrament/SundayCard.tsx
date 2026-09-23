import Link from "next/link";
import { SundayTypeBadge } from "@/components/calendar/SundayTypeBadge";
import { StatusPill } from "@/components/sacrament/StatusPill";
import { Card } from "@/components/ui/Card";
import { formatSundayLabel, type DateOnly } from "@/lib/calendar/dates";
import {
  sundayHasPills,
  type SundayPill,
  type SundayPillKey,
} from "@/lib/sacrament/sundayStatus";
import { SUNDAY_TYPE_LABELS, type SundayType } from "@/types/domain";

// ONE SUNDAY ON THE HUB: the date, what kind of Sunday it is, who is conducting, and a row of
// pills each opening the module that owns it for THIS date.
//
// PROPS ARE PLAIN DATA. No queries, no client hooks, no clock. Everything on this card was
// computed by lib/sacrament/sundayStatus.ts on the server and handed down, which is what lets one
// function be the only definition of each count (that module's header).
//
// ---------------------------------------------------------------------------
// THE CARD ITSELF OPENS THE PROGRAMME — AND THAT IS WHY THERE IS NO PROGRAMME PILL
// ---------------------------------------------------------------------------
// The user's model, given while walking scenario 072: pressing a Sunday shows "what the program
// is going to look like for that day… if there are things incomplete in that day then it would
// show to be true in the program". The programme is the SUM of everything else on this card, not
// one more item beside its parts, so it is the card's own destination rather than a sixth pill.
//
// IMPLEMENTED AS A STRETCHED LINK, NOT A WRAPPING ANCHOR. An <a> around the whole card would
// nest the pill anchors inside it, which is invalid HTML and leaves a screen reader with no way
// to reach the inner links. Instead ONE anchor on the heading grows a pseudo-element over the
// card, and the interactive parts sit above it on the z-axis. The document still has exactly one
// link per destination and the heading is what a screen reader announces.
//
// ---------------------------------------------------------------------------
// THE DATE RENDERS IN UTC, AND THAT IS NOT AN OVERSIGHT
// ---------------------------------------------------------------------------
// `sundays.date` is a Postgres `date` — a day with no time and no zone — so it goes through
// lib/calendar/dates.ts, whose every formatter passes `timeZone: "UTC"` explicitly (CLAUDE.md
// rule 12). Do NOT reach for readWardTimezone here: that is for a turn-up-at `timestamptz`, and
// using it on a date column is the reverse of the bug it exists to prevent.
// tests/lib/explicitTimeZone.test.ts reads this file's source and fails on a bare
// toLocaleDateString.

export type SundayCardProps = {
  sundayId: string;
  date: DateOnly;
  type: SundayType;
  // Null means nobody has been assigned. It is rendered as the word "open" and never as a blank,
  // and never as a guess (decisions.md §1.11 — never fabricate a name for an unfilled role). The
  // rotation can SUGGEST who is next, but the card reports what is stored.
  conductingName: string | null;
  pills: readonly SundayPill[];
  hrefs: Record<SundayPillKey, string>;
  // The whole card's destination — this Sunday's programme.
  programHref: string;
  // The Sunday editor, which is where the conducting override already lives. Null withholds the
  // link from somebody who cannot open that page: it gates on `calendar.view`, which the hub's
  // own `talks.view` does not imply, and offering a link that refuses on arrival is worse than
  // rendering the name as plain text.
  conductingHref: string | null;
  // `topics.manage`, which PATCH /api/sundays/[id]/topics-finalized asserts. False withholds the
  // finalize checkmark from the Topics pill entirely — absent, never disabled, the same rule the
  // conducting link above follows and the one StatusPill's header states for the pills.
  canFinalizeTopics: boolean;
};

export function SundayCard({
  sundayId,
  date,
  type,
  conductingName,
  pills,
  hrefs,
  programHref,
  conductingHref,
  canFinalizeTopics,
}: SundayCardProps) {
  const sundayLabel = formatSundayLabel(date);
  const holdsMeeting = sundayHasPills(type);

  return (
    <Card id={`sunday-${sundayId}`} className="relative flex flex-col gap-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        {/* min-w-0 so a long label wraps instead of pushing the card wider than 375px
            (plans/retros/youth-g-occasions-and-event-detail.md). */}
        <h3 className="min-w-0 font-display text-base font-semibold text-foreground">
          <Link
            href={programHref}
            aria-label={`${sundayLabel} — open this Sunday's programme`}
            className="rounded-sm after:absolute after:inset-0 after:content-[''] hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
          >
            {sundayLabel}
          </Link>
        </h3>
        {/* z-10 so the badge is not swallowed by the stretched link's overlay. It is not
            interactive, but a pseudo-element covering it would block text selection on it. */}
        <span className="relative z-10">
          <SundayTypeBadge type={type} />
        </span>
      </div>

      {holdsMeeting ? (
        <>
          <p className="relative z-10 text-sm text-muted">
            Conducting:{" "}
            {conductingHref === null ? (
              <span className="text-foreground">{conductingName ?? "open"}</span>
            ) : (
              <Link
                href={conductingHref}
                className="inline-flex min-h-11 items-center rounded-sm text-foreground underline underline-offset-4 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
              >
                {conductingName ?? "open"}
              </Link>
            )}
          </p>

          {/* EVERY PILL RENDERS, INCLUDING THE ZEROES. program-c made this reversal once already
              and the reason holds here: an omitted empty slot reads as "failed to load", which
              looks correct enough that nobody reports it, where `Topics 0/3` is a Sunday asking
              to be worked on. The row is never conditional on a count.

              What IS conditional is which pills exist at all — a Sunday with no speaking slots
              carries no talk pills, because there is no work there to count. That decision lives
              in sundayPills(), not here; this component renders what it is given. */}
          <ul className="relative z-10 flex flex-wrap items-center gap-1.5">
            {pills.map((pill) => (
              <li key={pill.key}>
                <StatusPill
                  pill={pill}
                  href={hrefs[pill.key]}
                  sundayLabel={sundayLabel}
                  sundayId={sundayId}
                  canFinalizeTopics={canFinalizeTopics}
                />
              </li>
            ))}
          </ul>
        </>
      ) : (
        // A stake- or general-conference Sunday holds no sacrament meeting at all
        // (NO_MEETING_SUNDAY_TYPES). Six pills reading 0/3 on it would invite somebody to plan a
        // meeting that is not happening, so the card says so in a sentence — the way the
        // prototype renders "No sacrament meeting — {title}" — and renders no pill row.
        <p className="relative z-10 text-sm text-muted">
          No sacrament meeting — {SUNDAY_TYPE_LABELS[type]}.
        </p>
      )}
    </Card>
  );
}
