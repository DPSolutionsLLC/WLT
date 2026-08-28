"use client";

import { useEffect, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import {
  FOLLOW_UP_MUTATION_INVALIDATES,
  errorFrom,
  readJson,
} from "@/app/(app)/youth/youthQueries";
import { Button } from "@/components/ui/Button";
import { FormError } from "@/components/ui/FormError";
import type { ActivityLog } from "@/lib/youth/queries";
import {
  MAX_ACTIVITY_PRIVATE_NOTES,
  MAX_ACTIVITY_SHARED_NOTES,
} from "@/lib/validation/youth";
import { YOUTH_SHARED_NOTE_AUDIENCE } from "@/types/domain";

// What happened at the game, in one form: whether the reader went, what they will say out loud,
// what they will not, and whether the ward council should hear about it.
//
// ---------------------------------------------------------------------------
// THE PRIVATE NOTE POSTS TO ITS OWN ENDPOINT. IT IS NEVER A FIELD ON THE LOG BODY.
// ---------------------------------------------------------------------------
// That is what keeps CLAUDE.md rule 5's "separate table, separate module, separate route" true at
// every layer including the wire format. A leader typing into both boxes produces TWO requests,
// and the second one is the only request in this module that carries private text.
//
// A NEW follow-up therefore saves in two steps: the log first, then the note against the id it
// came back with. There is nothing to hang a private note on until the log exists, and inventing
// an id client-side to save one round trip would put the two writes out of order.
//
// ---------------------------------------------------------------------------
// THE CAUTION GOES ON THE SHARED FIELD, NOT THE PRIVATE ONE
// ---------------------------------------------------------------------------
// visits-a moved this emphasis after walking it: a leader hesitating over the private box has it
// backwards, because that one is safe. The shared note is the one other people read — and after
// migration 057 WHICH people depends on a ward setting, so the label says who rather than "be
// careful". YOUTH_SHARED_NOTE_AUDIENCE carries both sentences and each is true in its own mode.

const TEXTAREA_CLASSES =
  "min-h-24 w-full rounded-md border border-border bg-surface-raised px-3 py-2 text-base " +
  "text-foreground focus-visible:outline-2 focus-visible:outline-offset-2 " +
  "focus-visible:outline-primary";

export type FollowUpFormProps = {
  eventId: string;
  eventTitle: string;
  // The reader's OWN follow-up, when they have already written one. Null means this form creates.
  existingLog: ActivityLog | null;
  // Whether the reader has an attendee row on this event. NO ROW, NO QUESTION — see below.
  isAttendee: boolean;
  // From the reader's own attendee row. Null means they have never said either way.
  confirmedAttendance: boolean | null;
  // Mirrors migration 057c's UPDATE policy through lib/youth/activityOwnership.ts. False hides the
  // flag control rather than offering it and having the API refuse — visits-c called that "a
  // locked door somebody was invited through", and youth-a hit it a second time.
  canFlag: boolean;
  // The ward's cross-organization visibility setting, resolved once on the server. A client
  // component never re-derives it (AttendeeControls' header states the same rule).
  crossOrgVisibility: boolean;
  onClose: () => void;
};

type SaveResult = { logId: string };

export function FollowUpForm({
  eventId,
  eventTitle,
  existingLog,
  isAttendee,
  confirmedAttendance,
  canFlag,
  crossOrgVisibility,
  onClose,
}: FollowUpFormProps) {
  const queryClient = useQueryClient();

  const [attended, setAttended] = useState<boolean | null>(confirmedAttendance);
  const [sharedNotes, setSharedNotes] = useState(existingLog?.sharedNotes ?? "");
  const [flagged, setFlagged] = useState(existingLog?.flaggedForWardCouncil ?? false);

  const [privateNotes, setPrivateNotes] = useState("");
  // What the server last told us the private note was, so an empty box that was empty to begin
  // with does not fire a DELETE against a note that never existed.
  const [savedPrivateNotes, setSavedPrivateNotes] = useState("");
  const [privateNoteError, setPrivateNoteError] = useState<string | undefined>(undefined);
  const [saveError, setSaveError] = useState<string | undefined>(undefined);

  // Loaded only when editing: a new follow-up has no id to hang a note on yet.
  //
  // The GET writes no audit row (the route says why), so opening this form leaves no record that
  // somebody read their own private note — which is the very record the table exists to avoid
  // keeping.
  useEffect(() => {
    if (existingLog === null) return;

    let cancelled = false;

    void (async () => {
      try {
        const response = await fetch(`/api/youth/logs/${existingLog.id}/private-note`);
        const payload = await readJson(response);

        if (!response.ok) {
          throw new Error(errorFrom(payload, "Could not load your private note."));
        }

        const note = payload.note as { notes: string } | null;
        if (cancelled) return;

        setPrivateNotes(note?.notes ?? "");
        setSavedPrivateNotes(note?.notes ?? "");
      } catch (error) {
        if (cancelled) return;
        // SURFACED, never swallowed (CLAUDE.md rule 7). A private box that silently failed to
        // load reads as a note that was never written, and the leader would type it again.
        setPrivateNoteError(
          error instanceof Error ? error.message : "Could not load your private note.",
        );
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [existingLog]);

  async function writePrivateNote(logId: string): Promise<void> {
    const trimmed = privateNotes.trim();

    if (trimmed === savedPrivateNotes.trim()) return;

    const response =
      trimmed === ""
        ? await fetch(`/api/youth/logs/${logId}/private-note`, { method: "DELETE" })
        : await fetch(`/api/youth/logs/${logId}/private-note`, {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ notes: trimmed }),
          });

    const payload = await readJson(response);

    if (!response.ok) {
      throw new Error(errorFrom(payload, "Could not save your private note."));
    }

    setSavedPrivateNotes(trimmed);
  }

  const save = useMutation<SaveResult, Error, void>({
    mutationFn: async () => {
      const trimmedShared = sharedNotes.trim();

      // `attended` is sent ONLY when the reader was actually asked. Absent means "leave the
      // attendee row exactly as it is", which is the distinction createActivityLogSchema draws on
      // purpose — a default would make "the control was never shown" and "they answered no" the
      // same value, and the second is a fact somebody stated.
      const attendedField = isAttendee && attended !== null ? { attended } : {};

      if (existingLog === null) {
        const response = await fetch("/api/youth/logs", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            eventId,
            sharedNotes: trimmedShared === "" ? null : trimmedShared,
            ...attendedField,
          }),
        });

        const payload = await readJson(response);

        if (!response.ok) {
          throw new Error(errorFrom(payload, "Could not save that follow-up."));
        }

        const created = payload.log as ActivityLog;
        await writePrivateNote(created.id);

        return { logId: created.id };
      }

      const response = await fetch(`/api/youth/logs/${existingLog.id}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          sharedNotes: trimmedShared === "" ? null : trimmedShared,
          flaggedForWardCouncil: flagged,
          ...attendedField,
        }),
      });

      const payload = await readJson(response);

      if (!response.ok) {
        throw new Error(errorFrom(payload, "Could not save that follow-up."));
      }

      await writePrivateNote(existingLog.id);

      return { logId: existingLog.id };
    },
    onSuccess: async () => {
      setSaveError(undefined);

      // ALL THREE KEYS, from the shared module — see FOLLOW_UP_MUTATION_INVALIDATES' comment for
      // why the answer is not "the follow-ups". A component holding its own key is defect
      // youth-a-D2, which is what app/(app)/youth/youthQueries.ts exists to prevent.
      await Promise.all(
        FOLLOW_UP_MUTATION_INVALIDATES.map((queryKey) =>
          queryClient.invalidateQueries({ queryKey }),
        ),
      );

      onClose();
    },
    onError: (error) => setSaveError(error.message),
  });

  const isBusy = save.isPending;

  return (
    <div className="flex flex-col gap-4 border-t border-border pt-4">
      <h3 className="text-sm font-semibold text-foreground">
        {existingLog === null ? "Record what happened" : "Change what you wrote"} —{" "}
        {eventTitle}
      </h3>

      {/* ---------------------------------------------------------------
          1. DID YOU GO? — RENDERED ONLY IF THE READER HAS AN ATTENDEE ROW
          ---------------------------------------------------------------
          No row, no question. Somebody who never said they were going has nothing to confirm or
          deny, and asking would invite an answer that writes to a row the app would then have to
          create — which is a different action from filing a follow-up.

          They may still write the follow-up itself: any `youth_activities.log` holder may, and a
          leader who turned up without putting themselves down beforehand is exactly the person
          whose account is worth having (app/api/youth/logs/route.ts argues it). */}
      {isAttendee ? (
        <fieldset className="flex flex-col gap-2">
          <legend className="text-sm font-medium text-foreground">Did you go?</legend>
          <div className="flex flex-wrap gap-2">
            <Button
              variant={attended === true ? "primary" : "secondary"}
              disabled={isBusy}
              onClick={() => setAttended(true)}
            >
              I went
            </Button>
            <Button
              variant={attended === false ? "primary" : "secondary"}
              disabled={isBusy}
              onClick={() => setAttended(false)}
            >
              I did not go
            </Button>
          </div>
          {attended === null ? (
            <p className="text-xs text-muted">
              You have not said either way. Leaving it is fine — the follow-up saves without it.
            </p>
          ) : null}
        </fieldset>
      ) : null}

      {/* 2. THE SHARED NOTE, labelled with WHO CAN READ IT. */}
      <div className="flex flex-col gap-1.5">
        <label htmlFor={`follow-up-shared-${eventId}`} className="text-sm font-medium text-foreground">
          What happened
        </label>
        <p className="text-xs text-muted">
          {crossOrgVisibility
            ? YOUTH_SHARED_NOTE_AUDIENCE.on
            : YOUTH_SHARED_NOTE_AUDIENCE.off}
        </p>
        <textarea
          id={`follow-up-shared-${eventId}`}
          className={TEXTAREA_CLASSES}
          maxLength={MAX_ACTIVITY_SHARED_NOTES}
          value={sharedNotes}
          disabled={isBusy}
          onChange={(input) => setSharedNotes(input.target.value)}
        />
      </div>

      {/* ---------------------------------------------------------------
          3. THE PRIVATE NOTE — A VISUALLY DISTINCT BLOCK, ON ITS OWN ENDPOINT
          ---------------------------------------------------------------
          Its own bordered block rather than a third field in a row, because the boundary is the
          point and a form where the two boxes look alike is a form that invites a leader to type
          the wrong thing into the wrong one. */}
      <div className="flex flex-col gap-1.5 rounded-md border border-dashed border-border bg-surface p-3">
        <label
          htmlFor={`follow-up-private-${eventId}`}
          className="text-sm font-medium text-foreground"
        >
          Private note
        </label>
        <p className="text-xs text-muted">
          Yours alone. Not the bishop, not an administrator, not anybody else — ever. Saved
          separately from what you wrote above.
        </p>
        <textarea
          id={`follow-up-private-${eventId}`}
          className={TEXTAREA_CLASSES}
          maxLength={MAX_ACTIVITY_PRIVATE_NOTES}
          value={privateNotes}
          disabled={isBusy}
          onChange={(input) => setPrivateNotes(input.target.value)}
        />
        <FormError message={privateNoteError} />
      </div>

      {/* ---------------------------------------------------------------
          4. THE WARD-COUNCIL FLAG, WITH WHO HEARS ABOUT IT AND WHAT THEY GET
          ---------------------------------------------------------------
          ABSENT rather than present-and-refusing when the reader could not write the log at all —
          the mirror of migration 057c's UPDATE policy, through
          lib/youth/activityOwnership.ts. visits-c found /visits offering this control on other
          organizations' visits where RLS refused it, and youth-a hit the same shape a second time.

          It appears only when EDITING, because there is nothing to flag until the follow-up
          exists — the transition the route implements is `false -> true` on a stored row.

          The sentence names the recipient AND what reaches them, because visits-c found a silent
          star inviting the reader to wonder whether they had summoned somebody. */}
      {canFlag && existingLog !== null ? (
        <div className="flex flex-col gap-1.5">
          <label className="flex min-h-11 items-center gap-2 text-sm text-foreground">
            <input
              type="checkbox"
              className="size-5 accent-primary"
              checked={flagged}
              disabled={isBusy}
              onChange={(input) => setFlagged(input.target.checked)}
            />
            Ask for this to go on the ward council agenda
          </label>
          <p className="text-xs text-muted">
            The executive secretary is told which activity and which event, and nothing else — not
            what you wrote above, and never your private note.
          </p>
        </div>
      ) : null}

      <FormError message={saveError} />

      <div className="flex flex-wrap gap-2">
        <Button disabled={isBusy} onClick={() => save.mutate()}>
          {isBusy ? "Saving…" : "Save follow-up"}
        </Button>
        <Button variant="secondary" disabled={isBusy} onClick={onClose}>
          Cancel
        </Button>
      </div>
    </div>
  );
}
