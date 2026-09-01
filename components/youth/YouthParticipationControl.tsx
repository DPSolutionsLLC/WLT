"use client";

import { useState } from "react";
import { Button } from "@/components/ui/Button";
import { YouthAbsenceChip } from "@/components/youth/YouthAbsenceChip";
import type { EventParticipation, RosterMember } from "@/lib/youth/roster";

// RECORDING THAT ONE YOUNG PERSON IS NOT TAKING PART — SHAPED AS AN EXCEPTION.
//
// ---------------------------------------------------------------------------
// THIS COMPONENT IS WHY ITER-033 EXISTS
// ---------------------------------------------------------------------------
// youth-i rendered a fieldset on EVERY event card reading "Is Ethan taking part?" with an
// unselected Yes and an unselected No. It was optional and it never blocked anything — and the
// user, seeing one screenshot, asked: "it appears that we are going to have to confirm every
// connection between an individual youth and an event?"
//
// It never did require that. BUT A CONTROL THAT HAS TO BE EXPLAINED IS A CONTROL THAT IS WRONG.
// A standing unanswered question on every card reads as work owed, whatever the docs say, and on
// a team of eight it would have read as eight questions per game.
//
// ---------------------------------------------------------------------------
// NOTHING RENDERS UNTIL SOMEBODY ASKS FOR IT
// ---------------------------------------------------------------------------
// The default state of this component is ONE QUIET LINK and, where somebody has already been
// marked, their chip. No question, no fieldset, no unselected radio, ever. That is success
// criterion 5, and tests/components/youth/YouthParticipationControl.test.tsx asserts it directly
// because it is the only place a test rather than a walk can catch it regressing.
//
// The storage is what makes this honest rather than cosmetic: migration 062d's third state is the
// ABSENCE OF THE ROW, so "nobody has said" is genuinely nothing rather than an unanswered field
// somebody has to clear.
//
// ---------------------------------------------------------------------------
// THE CHIP LIVES OUTSIDE THE DISCLOSURE
// ---------------------------------------------------------------------------
// A recorded absence is a FACT ABOUT THE GAME and must be visible without opening anything —
// exactly as a cancelled game is marked on its card. Only the CONTROLS hide.

export type YouthParticipationControlProps = {
  eventId: string;
  // Everybody on this team whose window covers this event. An empty list renders NOTHING AT ALL:
  // there is nobody to ask about, and a disclosure over an empty list is a control whose only
  // outcome is an empty panel.
  //
  // WHOLE RosterMember OBJECTS, never ids — youth-e's rule. The chip needs the name, the write
  // needs the id, and both come off the one value the caller decided on.
  expectedMembers: readonly RosterMember[];
  participation: readonly EventParticipation[];
  // `youth_activities.manage`, resolved ONCE on the server. A client component never re-derives a
  // permission (AttendeeControls' header states the rule).
  //
  // THE PERMISSION ALONE, AND THAT IS NOT AN OVERSIGHT. `activity_roster` and
  // `activity_event_participation` both carry ward-wide policies on all four verbs (migration
  // 062f), so any holder of `youth_activities.manage` in this ward may genuinely write this.
  // Hiding a control the API would allow is the mirror of youth-a-D1 and just as wrong.
  canManage: boolean;
  pending: boolean;
  // `null` CLEARS the row. See the buttons below: pressing the active answer again sends it.
  onSet: (memberId: string, takingPart: boolean | null) => void;
};

export function YouthParticipationControl({
  eventId,
  expectedMembers,
  participation,
  canManage,
  pending,
  onSet,
}: YouthParticipationControlProps) {
  const [open, setOpen] = useState(false);

  const answerFor = new Map(
    participation.map((entry) => [entry.memberId, entry.takingPart]),
  );

  // MARKED PEOPLE ARE SHOWN EVEN WHEN THEY ARE NO LONGER IN THE WINDOW... is deliberately NOT
  // what happens. `expectedMembers` is already the window-filtered list, and somebody who has
  // left the team is not somebody this game can ask about. Their historical answer stays in the
  // database and simply stops being rendered, which is the same thing their percentage does.
  const absentMembers = expectedMembers.filter(
    (member) => answerFor.get(member.memberId) === false,
  );

  // NOTHING TO ASK ABOUT. A ward-wide event, or a team with nobody assigned yet — the state
  // ITER-033's flow passes through — renders no control at all rather than an empty panel.
  if (expectedMembers.length === 0) return null;

  const panelId = `participation-${eventId}`;

  return (
    <div className="mt-2 flex flex-col gap-2">
      {/* ALWAYS VISIBLE, OUTSIDE THE DISCLOSURE. One chip per absent young person, which is new
          with youth-j: an event belongs to a TEAM, so a game can carry several. describeYouthAbsence()
          words all of them, so three chips on one card cannot be worded three ways. */}
      {absentMembers.length === 0 ? null : (
        <div className="flex flex-wrap gap-2">
          {absentMembers.map((member) => (
            <YouthAbsenceChip
              key={member.memberId}
              youthAttended={false}
              memberName={member.memberName}
            />
          ))}
        </div>
      )}

      {/* ONE QUIET LINE, AND ONLY FOR SOMEBODY WHO CAN ACT ON IT. Link-styled rather than a
          button, because it is not an action — it reveals the actions. The wording is a QUESTION
          ABOUT AN EXCEPTION ("Somebody wasn't there?") rather than a standing question about
          everybody, which is the whole difference from what it replaces. */}
      {canManage ? (
        <div>
          <button
            type="button"
            className="min-h-11 text-left text-sm text-primary underline underline-offset-4 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
            aria-expanded={open}
            aria-controls={panelId}
            onClick={() => setOpen((current) => !current)}
          >
            {open ? "Never mind" : "Somebody wasn't there?"}
          </button>
        </div>
      ) : null}

      {canManage && open ? (
        <ul id={panelId} className="flex flex-col gap-2 border-t border-border pt-2">
          {expectedMembers.map((member) => {
            const answer = answerFor.get(member.memberId) ?? null;

            return (
              <li key={member.memberId} className="flex flex-wrap items-center gap-2">
                <span className="text-sm text-foreground">{member.memberName}</span>

                {/* ---------------------------------------------------------------
                    PRESSING THE ACTIVE ANSWER AGAIN SENDS `null`
                    ---------------------------------------------------------------
                    A CONTROL THAT CAN SET A VALUE AND NOT UNSET IT IS A ONE-WAY DOOR ON A METRIC.
                    Marking the wrong game — or the right game for the wrong young person — must be
                    undoable, and it must be undoable to "NOBODY HAS SAID" rather than to "they
                    were there", which is a different claim nobody made. Migration 060a's rule for
                    `closed_at`, kept verbatim by youth-i and kept again here.

                    `aria-pressed` ON BOTH BUTTONS IN EVERY STATE, mirroring FollowUpForm's "Did
                    you go?": the answer must be conveyed by more than colour (ITER-022), and the
                    attribute on ONE and not the other is worse than neither. */}
                <Button
                  variant={answer === false ? "primary" : "secondary"}
                  aria-pressed={answer === false}
                  disabled={pending}
                  onClick={() => onSet(member.memberId, answer === false ? null : false)}
                >
                  Not taking part
                </Button>

                {/* THE QUIETER OF THE TWO, DELIBERATELY. `true` changes no number today — it
                    behaves exactly like no-row in the arithmetic — and it exists so that
                    "confirmed taking part" stays distinguishable from "nobody has said". It is
                    also the second way back: a leader who marked the wrong person can say what
                    was actually true rather than only erasing what they said. */}
                <Button
                  variant={answer === true ? "primary" : "secondary"}
                  aria-pressed={answer === true}
                  disabled={pending}
                  onClick={() => onSet(member.memberId, answer === true ? null : true)}
                >
                  They were there
                </Button>
              </li>
            );
          })}
        </ul>
      ) : null}
    </div>
  );
}
