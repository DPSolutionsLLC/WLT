"use client";

import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import {
  ATTENDEE_MUTATION_INVALIDATES,
  errorFrom,
  readJson,
} from "@/app/(app)/youth/youthQueries";
import { Button } from "@/components/ui/Button";
import { FormError } from "@/components/ui/FormError";
import type { ActivityAttendee } from "@/lib/youth/attendees";

// Who is going, and the three controls that change it.
//
// ---------------------------------------------------------------------------
// EVERY CONTROL IS DECIDED BY THE SAME GATE THE ROUTE ENFORCES
// ---------------------------------------------------------------------------
// This is the surface youth-a-D1 and visits-d both got wrong — twice now, a slice shipped Edit
// and Remove on work the caller could not change, RLS refused it safely, and a leader was still
// invited through a locked door. This component adds THREE controls behind TWO gates, so each one
// says which decides it:
//
//   "I'll go" / "I can't after all"   `youth_activities.view`, which everybody reading this page
//                                     already holds. Always shown. The route writes the caller's
//                                     own id and can write no other.
//   "Ask someone to go"               BISHOPRIC ONLY, and ABSENT for everybody else rather than
//                                     present-and-refusing. `canAssign` is resolved once on the
//                                     server and passed down; a client component never re-derives
//                                     a permission.
//
// ---------------------------------------------------------------------------
// AN ATTENDEE IS A USER, NOT A MEMBER
// ---------------------------------------------------------------------------
// `users` and `members` are UNRELATED ROWS in this schema — there is no users.member_id, and a
// leader and their own member record are two different things (lib/visits/participants.ts's
// header calls this the single most common wrong assumption in this codebase). So the picker is a
// plain select over ACCOUNTS, the shape the admin pages already use, and not MemberPicker
// however convenient that looks: MemberPicker picks members, and one cannot be put down for an
// event.

export type AttendeeControlsProps = {
  eventId: string;
  attendees: ActivityAttendee[];
  currentUserId: string;
  // Resolved ONCE on the server. See the header: a client component has no role access to resolve
  // against, and a second answer that disagreed with the route's would be a UI offering a control
  // the API refuses.
  canAssign: boolean;
  // Only ever populated for the bishopric, because only they can use it.
  assignableUsers: { id: string; label: string }[];
};

const SELECT_CLASSES =
  "min-h-11 rounded-md border border-border bg-surface-raised px-3 py-2 text-base " +
  "text-foreground focus-visible:outline-2 focus-visible:outline-offset-2 " +
  "focus-visible:outline-primary";

function attendeeLine(attendee: ActivityAttendee): string {
  // "· asked by ⟨name⟩" ONLY WHERE SOMEBODY WAS ASKED. A volunteer and an assignee read
  // differently to a leader deciding whether to step in, and `assignedBy` is the record of which
  // happened (null means they added themselves).
  return attendee.assignedByName === null
    ? attendee.displayName
    : `${attendee.displayName} · asked by ${attendee.assignedByName}`;
}

export function AttendeeControls({
  eventId,
  attendees,
  currentUserId,
  canAssign,
  assignableUsers,
}: AttendeeControlsProps) {
  const queryClient = useQueryClient();

  const [assigneeId, setAssigneeId] = useState("");
  const [errorMessage, setErrorMessage] = useState<string>();
  const [notice, setNotice] = useState<string>();

  const isAttending = attendees.some((attendee) => attendee.userId === currentUserId);

  // INVALIDATES BOTH THE ATTENDEE KEY AND THE EVENTS KEY, because the coverage badge on the card
  // is derived from both. The list lives in youthQueries.ts as a named constant for the same
  // reason PROFILE_MUTATION_INVALIDATES does — this is the THIRD time this module has had to
  // learn that a partial invalidation leaves two things on screen disagreeing.
  async function refresh(): Promise<void> {
    await Promise.all(
      ATTENDEE_MUTATION_INVALIDATES.map((queryKey) =>
        queryClient.invalidateQueries({ queryKey: [...queryKey] }),
      ),
    );
  }

  const mutation = useMutation({
    mutationFn: async (request: { url: string; method: string; body?: unknown }) => {
      const response = await fetch(request.url, {
        method: request.method,
        headers: request.body === undefined ? {} : { "content-type": "application/json" },
        body: request.body === undefined ? undefined : JSON.stringify(request.body),
      });

      const payload = await readJson(response);
      if (!response.ok) {
        throw new Error(errorFrom(payload, "Could not update who is going."));
      }

      // A 200 carrying a `notice` is the route saying "you were already down for this one" —
      // which is the state the caller wanted, not a fault. Surfaced as a plain sentence rather
      // than as an error, so a double tap on a slow phone does not read as a failure.
      return typeof payload.notice === "string" ? payload.notice : undefined;
    },
    onSuccess: async (message) => {
      setErrorMessage(undefined);
      setNotice(message);
      setAssigneeId("");
      await refresh();
    },
    onError: (error: Error) => {
      setNotice(undefined);
      setErrorMessage(error.message);
    },
  });

  const alreadyDown = new Set(attendees.map((attendee) => attendee.userId));
  const pickable = assignableUsers.filter((candidate) => !alreadyDown.has(candidate.id));

  return (
    <div className="mt-3 flex flex-col gap-2 border-t border-border pt-3">
      <p className="text-sm text-muted">
        {attendees.length === 0
          ? "Nobody is down for this yet."
          : `Going: ${attendees.map(attendeeLine).join(", ")}`}
      </p>

      <div className="flex flex-wrap gap-2">
        <Button
          variant={isAttending ? "secondary" : "primary"}
          disabled={mutation.isPending}
          onClick={() =>
            mutation.mutate({
              url: `/api/youth/events/${eventId}/attend`,
              method: isAttending ? "DELETE" : "POST",
            })
          }
        >
          {isAttending ? "I can't after all" : "I'll go"}
        </Button>
      </div>

      {canAssign ? (
        <div className="flex flex-col gap-2">
          <label htmlFor={`assign-${eventId}`} className="text-sm font-medium text-foreground">
            Ask someone to go
          </label>
          {pickable.length === 0 ? (
            <p className="text-sm text-muted">
              Everybody with an account is already down for this one.
            </p>
          ) : (
            <div className="flex flex-wrap items-end gap-2">
              <select
                id={`assign-${eventId}`}
                className={SELECT_CLASSES}
                value={assigneeId}
                disabled={mutation.isPending}
                onChange={(input) => setAssigneeId(input.target.value)}
              >
                <option value="">Choose someone…</option>
                {pickable.map((candidate) => (
                  <option key={candidate.id} value={candidate.id}>
                    {candidate.label}
                  </option>
                ))}
              </select>
              <Button
                variant="secondary"
                disabled={mutation.isPending || assigneeId === ""}
                onClick={() =>
                  mutation.mutate({
                    url: `/api/youth/events/${eventId}/assign`,
                    method: "POST",
                    body: { userId: assigneeId },
                  })
                }
              >
                Ask them
              </Button>
            </div>
          )}

          {/* Withdrawing an ask is bishopric-only too, and it is offered per person rather than as
              one control, because "un-ask" needs to name who. A person removing THEMSELVES uses
              the button above, which needs no permission beyond reading the page. */}
          {attendees
            .filter((attendee) => attendee.assignedBy !== null)
            .map((attendee) => (
              <div key={attendee.id}>
                <Button
                  variant="secondary"
                  disabled={mutation.isPending}
                  onClick={() =>
                    mutation.mutate({
                      url: `/api/youth/events/${eventId}/assign?userId=${encodeURIComponent(attendee.userId)}`,
                      method: "DELETE",
                    })
                  }
                >
                  Withdraw the request to {attendee.displayName}
                </Button>
              </div>
            ))}
        </div>
      ) : null}

      <FormError message={errorMessage} />
      {notice === undefined ? null : (
        <p role="status" className="text-sm text-muted">
          {notice}
        </p>
      )}
    </div>
  );
}
