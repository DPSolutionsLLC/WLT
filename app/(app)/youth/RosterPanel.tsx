"use client";

import { useState } from "react";
import { MemberPicker } from "@/components/roster/MemberPicker";
import { Button } from "@/components/ui/Button";
import { PROFILE_MEMBER_CATEGORIES } from "@/lib/validation/youth";
import type { RosterMember } from "@/lib/youth/roster";
import type { SessionUser } from "@/types/domain";

// WHO IS ON A TEAM — the panel inside an activity card on /youth/profiles.
//
// ---------------------------------------------------------------------------
// AN EMPTY ROSTER IS LOUD HERE, AND THAT IS HALF OF ONE RULE
// ---------------------------------------------------------------------------
// The other half is lib/youth/roster.ts's branch 5, which puts a team with nobody on it into
// ORDINARY COVERAGE rather than into "no expectation" — so a freshly imported season reads
// "Nobody going" on the calendar instead of quietly vanishing from the coverage model. The two
// halves must agree: the computation makes the games loud, and this sentence says why they are.
//
// It is a NORMAL state, not an error. ITER-033's flow is import once, then assign, so every ward
// passes through it on every schedule they import. The sentence is written to be read by somebody
// who has just done the first half and has not yet done the second.
//
// ---------------------------------------------------------------------------
// "LEFT THE TEAM ON…" IS THE PRIMARY CONTROL; `Remove` IS THE MISTAKE-FIXER
// ---------------------------------------------------------------------------
// The same primary-is-non-destructive shape youth-h established for an activity, arrived at for a
// different reason (DELETE /api/youth/roster/[id]'s header argues it). Recording a leaving date
// KEEPS the record of the games they did play and stops counting the ones after; removing the row
// erases that they were ever on the team. A leader who means the first and presses the second has
// lost something, so the first is the one that reads as the ordinary action.
//
// ---------------------------------------------------------------------------
// EVERY CONTROL GATES ON `canManage` AND NOTHING NARROWER
// ---------------------------------------------------------------------------
// `activity_roster` carries ward-wide policies on all four verbs (migration 062f), so any holder
// of `youth_activities.manage` in this ward may genuinely write these rows. This is deliberately
// UNLIKE the Edit/Close/Remove controls on the activity itself, which go through
// canManageActivityProfile() because migration 054d's policies ARE org-scoped. Gating this panel
// on that helper too would hide a control the API allows, which is the mirror of youth-a-D1 and
// just as wrong (lib/youth/activityOwnership.ts).

export type RosterPanelProps = {
  profileId: string;
  activityName: string;
  roster: readonly RosterMember[];
  user: SessionUser;
  canManage: boolean;
  pending: boolean;
  onAdd: (profileId: string, memberId: string) => void;
  onSetLeavingDate: (rosterId: string, endedOn: string | null) => void;
  onRemove: (member: RosterMember) => void;
};

// A `date` COLUMN RENDERS IN UTC, NOT IN THE WARD'S ZONE, and the distinction is the one
// CLAUDE.md §9 draws: a turn-up-at `timestamptz` is the ward's zone, while a date-only value and a
// "when did this happen" stamp are UTC (lib/calendar/dates.ts, VersionHistory, ContactStagePanel).
// `started_on` and `ended_on` are days a person named — there is no hour in them to get wrong.
//
// THE `timeZone` IS EXPLICIT AND MUST STAY SO. tests/lib/explicitTimeZone.test.ts reads the source
// and fails on a bare toLocale* call, because no assertion about a formatted string can catch it:
// a test process has one zone and the bug only appears where the server's differs from the
// reader's (c24d52b, seven files).
const ROSTER_DATE_FORMAT = new Intl.DateTimeFormat("en-GB", {
  timeZone: "UTC",
  day: "numeric",
  month: "short",
  year: "numeric",
});

const DATE_ONLY_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

// Returns the raw string for anything unreadable rather than throwing or rendering a blank.
// lib/calendar/dates.ts's parseDateOnly() throws by design; this is a render path, where one bad
// value must not take a card down, and showing what is stored is more use than showing nothing.
function formatRosterDate(value: string): string {
  if (!DATE_ONLY_PATTERN.test(value)) return value;

  const parsed = new Date(`${value}T00:00:00Z`);
  if (!Number.isFinite(parsed.getTime())) return value;

  return ROSTER_DATE_FORMAT.format(parsed);
}

// The window, in a leader's words, or nothing at all when they have been on the team throughout.
//
// NOTHING AT ALL IS THE ORDINARY CASE — absent dates mean the whole schedule (migration 062a) —
// and a line reading "Joined: —" on every name would be noise on the row this panel is mostly
// made of. talks-c's render-nothing-rather-than-"Never" rule.
function describeWindow(member: RosterMember): string | null {
  const parts: string[] = [];

  if (member.startedOn !== null) parts.push(`Joined ${formatRosterDate(member.startedOn)}`);
  if (member.endedOn !== null) parts.push(`Left ${formatRosterDate(member.endedOn)}`);

  return parts.length === 0 ? null : parts.join(" · ");
}

// Today, as a `date` string in UTC — the default a leader is offered when they press "Left the
// team". UTC for the reason the formatter above is: this is a DAY going into a `date` column, and
// resolving "today" through a local-time Date is exactly what lib/calendar/dates.ts's header
// forbids ("never round-trip a calendar date through a local-time string").
function todayDateOnly(): string {
  return new Date().toISOString().slice(0, 10);
}

export function RosterPanel({
  profileId,
  activityName,
  roster,
  user,
  canManage,
  pending,
  onAdd,
  onSetLeavingDate,
  onRemove,
}: RosterPanelProps) {
  const [adding, setAdding] = useState(false);
  const [leavingFor, setLeavingFor] = useState<string | null>(null);
  const [leavingDate, setLeavingDate] = useState(todayDateOnly());

  const memberIdsOnRoster = roster.map((member) => member.memberId);

  return (
    <div className="mt-3 border-t border-border pt-3">
      <h4 className="text-sm font-medium text-foreground">Who is on this</h4>

      {roster.length === 0 ? (
        // LOUD, IN A SENTENCE, AND IT SAYS WHAT THE CONSEQUENCE IS. A blank space here would read
        // as a panel that failed to load (youth-c), and a bare "Nobody yet" would not tell a
        // leader that their imported schedule is currently raising an alarm on every game.
        <p className="mt-1 text-sm text-muted">
          Nobody is on this team yet. Its games will show as needing somebody until you add the
          young people who play.
        </p>
      ) : (
        <ul className="mt-2 flex flex-col gap-2">
          {roster.map((member) => {
            const window = describeWindow(member);

            return (
              <li
                key={member.rosterId}
                className="rounded-md border border-border bg-surface p-2"
              >
                <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
                  <span className="text-sm text-foreground">{member.memberName}</span>
                  {window === null ? null : (
                    <span className="text-xs text-muted">{window}</span>
                  )}
                </div>

                {canManage ? (
                  leavingFor === member.rosterId ? (
                    <div className="mt-2 flex flex-wrap items-end gap-2">
                      <div className="flex flex-col gap-1.5">
                        <label
                          htmlFor={`roster-left-${member.rosterId}`}
                          className="text-xs font-medium text-foreground"
                        >
                          Last day on the team
                        </label>
                        {/* A `date` INPUT, NOT `datetime-local`. The column is a day and the
                            question is a day — "she left on the 15th" — so asking for an hour
                            would be asking for a fact nobody has. */}
                        <input
                          id={`roster-left-${member.rosterId}`}
                          type="date"
                          className="min-h-11 rounded-md border border-border bg-surface-raised px-3 py-2 text-base text-foreground focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
                          value={leavingDate}
                          disabled={pending}
                          onChange={(input) => setLeavingDate(input.target.value)}
                        />
                      </div>
                      <Button
                        disabled={pending || leavingDate === ""}
                        onClick={() => {
                          onSetLeavingDate(member.rosterId, leavingDate);
                          setLeavingFor(null);
                        }}
                      >
                        Save
                      </Button>
                      <Button
                        variant="secondary"
                        disabled={pending}
                        onClick={() => setLeavingFor(null)}
                      >
                        Cancel
                      </Button>
                    </div>
                  ) : (
                    <div className="mt-2 flex flex-wrap gap-2">
                      <Button
                        variant="secondary"
                        disabled={pending}
                        onClick={() => {
                          setLeavingDate(member.endedOn ?? todayDateOnly());
                          setLeavingFor(member.rosterId);
                        }}
                      >
                        {member.endedOn === null ? "Left the team" : "Change the date"}
                      </Button>

                      {/* THE WAY BACK FROM A LEAVING DATE, and it is a clear rather than a delete
                          — the same reversibility rule migration 060a states for `closed_at` and
                          migration 062d states for a participation row. Somebody who came back
                          after all should not have to be removed and re-added, which would lose
                          their `started_on` and their place in the record. */}
                      {member.endedOn === null ? null : (
                        <Button
                          variant="secondary"
                          disabled={pending}
                          onClick={() => onSetLeavingDate(member.rosterId, null)}
                        >
                          Still on the team
                        </Button>
                      )}

                      {/* NOT "Remove", WHICH IS THE WORD ON THE ACTIVITY'S OWN CONTROL A FEW
                          lines up the card. Two buttons reading "Remove" inside one card is
                          ambiguous to anybody and identical to a screen reader, and the two do
                          very different things: one takes a young person off a team, the other
                          destroys the whole activity. Naming the object is what keeps them
                          apart. */}
                      <Button
                        variant="danger"
                        disabled={pending}
                        onClick={() => onRemove(member)}
                      >
                        Remove from this activity
                      </Button>
                    </div>
                  )
                ) : null}
              </li>
            );
          })}
        </ul>
      )}

      {canManage ? (
        <div className="mt-3">
          {adding ? (
            <div className="flex flex-col gap-2">
              {/* THE FILTER COMES FROM lib/validation/youth.ts, never a literal here.
                  PROFILE_MEMBER_CATEGORIES is the single answer to "which member may be on a youth
                  activity", and POST /api/youth/profiles/[id]/roster checks the SAME constant — a
                  picker that offers a name the route then refuses is the two-places-disagreeing
                  failure this project keeps a rule about.

                  `excludeIds` IS WHAT STOPS THE 409 BEING REACHABLE FROM HERE. The route still
                  answers one, because the boundary is the route and not this list (rule 2), but a
                  control whose only outcome is a refusal is a control that should not have been
                  offered. */}
              <MemberPicker
                value={[]}
                onChange={(memberIds) => {
                  const chosen = memberIds[0];
                  if (chosen === undefined) return;

                  onAdd(profileId, chosen);
                  setAdding(false);
                }}
                user={user}
                multiple={false}
                filter={{ categories: PROFILE_MEMBER_CATEGORIES }}
                excludeIds={memberIdsOnRoster}
                mode="inline"
                label={`Add a young person to ${activityName}`}
                emptyMessage="Every young person on the roster is already on this team."
                disabled={pending}
              />
              <div>
                <Button variant="secondary" disabled={pending} onClick={() => setAdding(false)}>
                  Cancel
                </Button>
              </div>
            </div>
          ) : (
            <Button variant="secondary" disabled={pending} onClick={() => setAdding(true)}>
              Add a young person
            </Button>
          )}
        </div>
      ) : null}
    </div>
  );
}
