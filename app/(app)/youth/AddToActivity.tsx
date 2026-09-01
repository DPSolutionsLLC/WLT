"use client";

import { useState } from "react";
import Link from "next/link";
import { Button } from "@/components/ui/Button";
import type { ActivityProfile } from "@/lib/youth/queries";

// PUTTING ONE YOUNG PERSON ON A TEAM, FROM THEIR OWN CARD.
//
// ---------------------------------------------------------------------------
// THIS IS THE USER'S OWN FLOW, IN THEIR OWN WORDS
// ---------------------------------------------------------------------------
// ITER-033: "someone simply has to go through each individual youth in the app and assign them to
// an activity. then the app knows what events to tie the youth to." That is a YOUTH-FIRST pass
// down /youth, and this is the control it needs — the team-first half lives in RosterPanel on
// /youth/profiles, which is where a roster is read.
//
// ONE ROUTE, TWO ENTRY POINTS. Both POST to /api/youth/profiles/[id]/roster. Two implementations
// of one decision is how the two come to disagree about what "already on the roster" means
// (visits-b, visits-f), and the route's header says the same thing from the other side.
//
// ---------------------------------------------------------------------------
// A SELECT, NOT A MemberPicker
// ---------------------------------------------------------------------------
// The young person is already decided — this control is on THEIR card. What is being chosen is
// the TEAM, so the list is of activities. MemberPicker is the wrong control here however much it
// looks like the sibling of RosterPanel's, which is the mirror of lib/youth/attendees.ts's
// standing warning that an attendee is a USER and not a member.

export type AddToActivityProps = {
  memberName: string;
  // Every team in the ward this young person is NOT already on, resolved by the caller from the
  // shared profiles cache. OFFERING ONE THEY ARE ALREADY ON would be a control whose only outcome
  // is the route's 409 — the route still answers it, because the boundary is the route and not
  // this list (CLAUDE.md rule 2), but a person should not be invited to press it.
  //
  // CLOSED SEASONS ARE INCLUDED, deliberately. A leader entering last winter's squad after the
  // fact is doing something legitimate, and the window function is what decides whether any of
  // its games count (lib/youth/roster.ts) — not this list.
  available: readonly ActivityProfile[];
  pending: boolean;
  onAdd: (profileId: string) => void;
};

const SELECT_CLASSES =
  "min-h-11 w-full rounded-md border border-border bg-surface-raised px-3 py-2 text-base " +
  "text-foreground focus-visible:outline-2 focus-visible:outline-offset-2 " +
  "focus-visible:outline-primary";

// THE ACTIVITY AND ITS SCHOOL, never the activity alone. A ward can easily run "Basketball" in
// two organizations, and two identical options is a choice nobody can make. The young person's
// name is deliberately NOT in the label — this control is already on their card, and repeating it
// in every option is the noise ManualEventForm's label carried until a profile stopped being one
// young person's.
function labelFor(profile: ActivityProfile): string {
  const suffix = profile.schoolOrg === null ? "" : ` — ${profile.schoolOrg}`;
  const closed = profile.closedAt === null ? "" : " (season closed)";

  return `${profile.activityName}${suffix}${closed}`;
}

export function AddToActivity({
  memberName,
  available,
  pending,
  onAdd,
}: AddToActivityProps) {
  const [profileId, setProfileId] = useState("");

  return (
    <div className="mt-3 border-t border-border pt-3">
      <label
        htmlFor={`add-to-activity-${memberName}`}
        className="text-sm font-medium text-foreground"
      >
        Put {memberName} on an activity
      </label>

      {available.length === 0 ? (
        // TWO SENTENCES FOR TWO SITUATIONS, and only one of them is something the reader can fix
        // here. An empty state that renders nothing reads as something that failed to load
        // (youth-c).
        <p className="mt-1 text-sm text-muted">
          They are already on every activity the ward has entered.{" "}
          <Link href="/youth/profiles" className="text-primary underline underline-offset-4">
            Add a new one
          </Link>
          .
        </p>
      ) : (
        <div className="mt-1 flex flex-col gap-2">
          <div className="flex flex-wrap items-end gap-2">
            <div className="min-w-0 flex-1 basis-64">
              <select
                id={`add-to-activity-${memberName}`}
                className={SELECT_CLASSES}
                value={profileId}
                disabled={pending}
                onChange={(input) => setProfileId(input.target.value)}
              >
                <option value="">Choose an activity…</option>
                {available.map((profile) => (
                  <option key={profile.id} value={profile.id}>
                    {labelFor(profile)}
                  </option>
                ))}
              </select>
            </div>
            <Button
              disabled={pending || profileId === ""}
              onClick={() => {
                onAdd(profileId);
                setProfileId("");
              }}
            >
              Add them
            </Button>
          </div>

          {/* THE WAY OUT WHEN THE TEAM DOES NOT EXIST YET. Without it, a leader working down this
              page hits a dead end on the first young person whose activity nobody has entered —
              and the whole point of the youth-first pass is that it can be done in one sitting. */}
          <p className="text-sm text-muted">
            Not listed?{" "}
            <Link href="/youth/profiles" className="text-primary underline underline-offset-4">
              Add a new activity
            </Link>
            .
          </p>
        </div>
      )}
    </div>
  );
}
