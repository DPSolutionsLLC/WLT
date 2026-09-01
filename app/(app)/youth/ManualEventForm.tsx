"use client";

import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  YOUTH_EVENTS_QUERY_KEY,
  YOUTH_PROFILES_QUERY_KEY,
  errorFrom,
  fetchProfiles,
  readJson,
} from "@/app/(app)/youth/youthQueries";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { FormError } from "@/components/ui/FormError";
import { Input } from "@/components/ui/Input";
import { MAX_EVENT_LOCATION, MAX_EVENT_TITLE } from "@/lib/validation/youth";
import { toOffsetBearingInstant } from "@/lib/youth/eventInstant";
import type { ActivityProfile } from "@/lib/youth/queries";
import { EVENT_TYPES, EVENT_TYPE_LABELS, type EventType } from "@/types/domain";

// ONE GAME, ENTERED BY HAND. 08-youth-activities.md: "Manual entry — always available, always
// works. Build this first so the module is usable before any import exists." Slice B's ICS upload
// is a shortcut past this form, never a replacement for it: a feed goes down, a school changes
// its calendar software, and a leader still has to be able to type in Friday's game.
//
// THE DATE IS CONVERTED, NOT POSTED RAW. `<input type="datetime-local">` yields a FLOATING time —
// half past seven in no particular place — and lib/validation/youth.ts refuses one with a
// sentence naming the problem. toOffsetBearingInstant is the client half of that rule, and it is
// shared with EventList's edit control so the two cannot drift.

export type ManualEventFormProps = {
  // THE SERVER'S FIRST ANSWER, not the standing one. It seeds the shared profiles query below and
  // is then superseded by it.
  //
  // This was a plain `profiles` prop, read straight into the select, and that was defect
  // youth-a-D2: a Server Component prop never refetches, so adding an activity left this form
  // insisting "Add an activity first" until the page was reloaded — on the one flow the module
  // exists for. Reading the SAME query key ActivityProfileList reads means one invalidation
  // updates both.
  initialProfiles: ActivityProfile[];
};

const SELECT_CLASSES =
  "min-h-11 rounded-md border border-border bg-surface-raised px-3 py-2 text-base " +
  "text-foreground focus-visible:outline-2 focus-visible:outline-offset-2 " +
  "focus-visible:outline-primary";

export function ManualEventForm({ initialProfiles }: ManualEventFormProps) {
  const queryClient = useQueryClient();

  // The same key ActivityProfileList reads, so both components share one cache entry and one
  // invalidation reaches both.
  const profilesQuery = useQuery({
    queryKey: [YOUTH_PROFILES_QUERY_KEY],
    queryFn: fetchProfiles,
    initialData: initialProfiles,
  });

  // THE ACTIVITY AND ITS SCHOOL, and no member name — a profile is a TEAM now (migration 062),
  // so there is no single young person to name and the roster is what answers "who". The school
  // is what keeps two options apart where a ward runs "Basketball" in two organizations, which is
  // the job the member name used to do.
  const profiles = (profilesQuery.data ?? []).map((profile) => ({
    id: profile.id,
    label:
      profile.schoolOrg === null
        ? profile.activityName
        : `${profile.activityName} — ${profile.schoolOrg}`,
  }));

  const [profileId, setProfileId] = useState("");
  const [title, setTitle] = useState("");
  const [localDate, setLocalDate] = useState("");
  const [location, setLocation] = useState("");
  // "" IS "DECIDE FROM THE LOCATION" AND IS THE DEFAULT. It is not an EventType, deliberately:
  // the whole point is that this state has to be distinguishable from an explicit "tbd", and a
  // third EventType value would put the distinction in the type where the database would then
  // have to store it. Empty means "send no eventType at all".
  const [eventType, setEventType] = useState<EventType | "">("");
  const [error, setError] = useState<string | undefined>(undefined);
  const [notice, setNotice] = useState<string | undefined>(undefined);

  const createMutation = useMutation({
    mutationFn: async (body: Record<string, unknown>) => {
      const response = await fetch("/api/youth/events", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      });

      const payload = await readJson(response);
      if (!response.ok) throw new Error(errorFrom(payload, "Could not save that event."));
    },
    onSuccess: async () => {
      setTitle("");
      setLocalDate("");
      setLocation("");
      setEventType("");
      setNotice("Event added.");
      setError(undefined);
      // INVALIDATE BOTH VIEWS. The key prefix matches `[YOUTH_EVENTS_QUERY_KEY, includePast]` for
      // either value of the flag, so an event added while "show past events" is on appears
      // without a reload. Writing into the cache by hand would race a refetch already in flight
      // (plans/retros/program-b-*).
      await queryClient.invalidateQueries({ queryKey: [YOUTH_EVENTS_QUERY_KEY] });
    },
    onError: (mutationError: Error) => {
      setNotice(undefined);
      setError(mutationError.message);
    },
  });

  function submit(): void {
    setNotice(undefined);

    if (profileId === "") {
      setError("Choose which activity this event belongs to.");
      return;
    }

    if (title.trim() === "") {
      setError("Give the event a name.");
      return;
    }

    const eventDate = toOffsetBearingInstant(localDate);

    if (eventDate === null) {
      setError("Give the date and time of the event.");
      return;
    }

    setError(undefined);
    createMutation.mutate({
      profileId,
      title: title.trim(),
      eventDate,
      location: location.trim() === "" ? null : location.trim(),
      // OMITTED ENTIRELY when the leader left it alone, never sent as "tbd". The route reads
      // absent as "classify from the location" and present as "a person decided", and
      // createActivityEventSchema dropped its default so the two are distinguishable at all.
      ...(eventType === "" ? {} : { eventType }),
    });
  }

  if (profiles.length === 0) {
    return (
      <Card>
        <p className="text-sm text-muted">
          Add an activity first. A game belongs to a season, and a season belongs to a young
          person — so there is nowhere to put one yet.
        </p>
      </Card>
    );
  }

  return (
    <Card>
      <div className="flex flex-col gap-4">
        <div className="flex flex-col gap-1.5">
          <label htmlFor="event-profile" className="text-sm font-medium text-foreground">
            Which activity
          </label>
          <select
            id="event-profile"
            className={SELECT_CLASSES}
            value={profileId}
            disabled={createMutation.isPending}
            onChange={(input) => setProfileId(input.target.value)}
          >
            <option value="">Choose an activity…</option>
            {profiles.map((profile) => (
              <option key={profile.id} value={profile.id}>
                {profile.label}
              </option>
            ))}
          </select>
        </div>

        <Input
          id="event-title"
          label="Event"
          value={title}
          maxLength={MAX_EVENT_TITLE}
          disabled={createMutation.isPending}
          placeholder="Game against Lincoln"
          onChange={(input) => setTitle(input.target.value)}
        />

        <Input
          id="event-date"
          type="datetime-local"
          label="Date and time"
          value={localDate}
          disabled={createMutation.isPending}
          onChange={(input) => setLocalDate(input.target.value)}
        />

        <Input
          id="event-location"
          label="Where"
          value={location}
          maxLength={MAX_EVENT_LOCATION}
          disabled={createMutation.isPending}
          placeholder="Lincoln High School gym"
          onChange={(input) => setLocation(input.target.value)}
        />

        <div className="flex flex-col gap-1.5">
          <label htmlFor="event-type" className="text-sm font-medium text-foreground">
            Home or away
          </label>
          {/* THE FIRST OPTION IS THE DEFAULT AND SENDS NOTHING. The three explicit choices remain
              beneath it, and choosing one of them is a decision nothing may overwrite — including
              "Not yet known", which is a person saying they do not know rather than a person not
              having looked.

              It still never guesses "Home": with no venues configured, or a location that matches
              none of them, classification returns `tbd` and the card says so loudly. An unmatched
              location is a question for a person, never evidence of an away game
              (lib/youth/classifyLocation.ts). */}
          <select
            id="event-type"
            className={SELECT_CLASSES}
            value={eventType}
            disabled={createMutation.isPending}
            onChange={(input) => setEventType(input.target.value as EventType | "")}
          >
            <option value="">Decide from the location</option>
            {EVENT_TYPES.map((type) => (
              <option key={type} value={type}>
                {EVENT_TYPE_LABELS[type]}
              </option>
            ))}
          </select>
          <p className="text-sm text-muted">
            Chosen automatically from the location, or left for somebody to set.
          </p>
        </div>

        <FormError message={error} />
        {notice === undefined ? null : (
          <p role="status" className="text-sm text-success">
            {notice}
          </p>
        )}

        <div>
          <Button onClick={submit} disabled={createMutation.isPending}>
            {createMutation.isPending ? "Saving…" : "Add event"}
          </Button>
        </div>
      </div>
    </Card>
  );
}
