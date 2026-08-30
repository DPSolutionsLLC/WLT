"use client";

import { useState } from "react";
import { Button } from "@/components/ui/Button";
import type { ActivityProfile } from "@/lib/youth/queries";

// "Another young person was at this."
//
// ---------------------------------------------------------------------------
// ONE REQUEST, WHETHER OR NOT THE OCCASION EXISTS YET
// ---------------------------------------------------------------------------
// The submit is a single POST /api/youth/events carrying the source row's title, date and
// location plus `occasionWithEventId` — the id of the event being viewed. The client NEVER HOLDS
// AN OCCASION ID and never makes two calls that could half-succeed; the route resolves or creates
// the occasion and stamps both rows in the same request (lib/validation/youth.ts argues the
// shape). This component's only job is to prefill the three copied fields and name the event it
// is joining.
//
// ---------------------------------------------------------------------------
// NO `eventType` IS SENT, AND THAT IS THE POINT
// ---------------------------------------------------------------------------
// Absent means "decide from the location", so the new row is classified from the location it was
// given rather than inheriting the source row's answer. If that location matches no venue on the
// ward's list the row comes out `tbd` and renders "Home or away?", which asks a person. `away` IS
// ALWAYS A HUMAN'S WORD (youth-c): spreading one leader's hand correction onto a row they never
// looked at would silently remove the new young person from the coverage model, and nothing
// anywhere would say so.
//
// ---------------------------------------------------------------------------
// AN OPTION NAMES THE ACTIVITY AS WELL AS THE YOUNG PERSON
// ---------------------------------------------------------------------------
// `youth_activity_profiles` has no uniqueness on `member_id`, so one young person may be in two
// activities at once — which is youth-f's whole reason for existing. The row being created
// belongs to exactly one of them.

export type AddYouthToOccasionProps = {
  profiles: ActivityProfile[];
  disabled: boolean;
  onAdd: (profileId: string) => void;
};

// `w-full min-w-0`, for the reason JoinOccasionPicker's copy of this states in full: a <select>
// sizes to its widest option, and a flex item's default `min-width: auto` refuses to shrink below
// its content, so both halves are needed to keep the page off a sideways scroll at 375px.
//
// These options are shorter than the join picker's — young person · activity, not four facts — so
// this one was not the element that overflowed when scenario 059 was walked. It is guarded anyway:
// a long family name and a long activity name would reach the same place, and two pickers sitting
// in the same card behaving differently at the same width is the kind of thing nobody finds until
// a ward with long names uses it.
const SELECT_CLASSES =
  "w-full min-w-0 min-h-11 rounded-md border border-border bg-surface-raised px-3 py-2 " +
  "text-base text-foreground focus-visible:outline-2 focus-visible:outline-offset-2 " +
  "focus-visible:outline-primary";

export function AddYouthToOccasion({ profiles, disabled, onAdd }: AddYouthToOccasionProps) {
  const [profileId, setProfileId] = useState("");

  return (
    <div className="flex flex-col gap-2">
      <label htmlFor="add-youth-occasion" className="text-sm font-medium text-foreground">
        Another young person was at this
      </label>

      {profiles.length === 0 ? (
        <p className="text-sm text-muted">
          Every activity in the ward is already part of this game.
        </p>
      ) : (
        <div className="flex flex-wrap items-end gap-2">
          <div className="min-w-0 flex-1 basis-64">
            <select
              id="add-youth-occasion"
              className={SELECT_CLASSES}
              value={profileId}
              disabled={disabled}
              onChange={(input) => setProfileId(input.target.value)}
            >
              <option value="">Choose a young person…</option>
              {profiles.map((profile) => (
                <option key={profile.id} value={profile.id}>
                  {`${profile.memberName} · ${profile.activityName}`}
                </option>
              ))}
            </select>
          </div>
          <Button
            variant="secondary"
            disabled={disabled || profileId === ""}
            onClick={() => {
              onAdd(profileId);
              setProfileId("");
            }}
          >
            They were there too
          </Button>
        </div>
      )}
    </div>
  );
}
