"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useQueryClient } from "@tanstack/react-query";
import { VISIT_PROGRESS_QUERY_KEY } from "@/app/(app)/visits/progressQueryKey";
import {
  recorderParticipant,
  toParticipantPayload,
  VisitParticipantsField,
  type LeaderOption,
  type ParticipantDraft,
} from "@/app/(app)/visits/VisitParticipantsField";
import { LOG_VISIT_ANCHOR } from "@/lib/visits/appointmentLink";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { FormError } from "@/components/ui/FormError";
import { Input } from "@/components/ui/Input";
import { MAX_PRIVATE_NOTES, MAX_SHARED_NOTES } from "@/lib/validation/visit";
import {
  VISIT_ARRANGEMENTS,
  VISIT_ARRANGEMENT_LABELS,
  VISIT_LOGGABLE_TYPES,
  VISIT_NEEDS_ANOTHER_REASONS,
  VISIT_NEEDS_ANOTHER_REASON_LABELS,
  VISIT_OUTCOME_LABELS,
  VISIT_PARTLY_REACHED_LABEL,
  VISIT_TYPE_LABELS,
  type SessionUser,
  type VisitArrangement,
  type VisitNeedsAnotherReason,
  type VisitOutcome,
  type VisitType,
} from "@/types/domain";

export type HouseholdOption = { id: string; label: string };

// The appointment this visit is being logged against, resolved by page.tsx from `?appointment=`
// and handed down. Absent for an ordinary visit.
export type AppointmentPrefill = {
  id: string;
  householdId: string;
  householdName: string;
  scheduledFor: string;
};

export type VisitLogFormProps = {
  households: HouseholdOption[];
  today: string;
  user: SessionUser;
  leaders: LeaderOption[];
  memberNames: Record<string, string>;
  appointment?: AppointmentPrefill;
  // The household a card's "Log visit" button opened the form for (ITER-055 bv2).
  initialHouseholdId?: string;
};

const SELECT_CLASSES =
  "min-h-11 rounded-md border border-border bg-surface-raised px-3 text-base text-foreground focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary";

const TEXTAREA_CLASSES =
  "min-h-24 rounded-md border border-border bg-surface-raised px-3 py-2 text-base text-foreground placeholder:text-muted focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary";

// Same box, different ink. The words a leader types into the shared field come out in the
// attention colour, so the thing that marks it out is the content itself rather than a panel
// drawn around it — you cannot type into this field without seeing that it is not the other one.
const SHARED_TEXTAREA_CLASSES =
  "min-h-24 rounded-md border border-warning bg-surface-raised px-3 py-2 text-base text-warning placeholder:text-muted focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary";

// WHAT HAPPENED, as the leader answers it (ITER-055 bv3). Three answers stored as two columns:
// "still needs a visit" is a completed visit with a reason (migration 101), never a third outcome.
export const VISIT_RECORD_CHOICES = ["done", "partly_reached", "attempted"] as const;
export type VisitRecordChoice = (typeof VISIT_RECORD_CHOICES)[number];

export const VISIT_RECORD_CHOICE_LABELS: Record<VisitRecordChoice, string> = {
  done: VISIT_OUTCOME_LABELS.completed,
  partly_reached: VISIT_PARTLY_REACHED_LABEL,
  attempted: VISIT_OUTCOME_LABELS.attempted,
};

const VISIT_RECORD_CHOICE_HELP: Record<VisitRecordChoice, string> = {
  done: "The visit happened.",
  partly_reached:
    "Somebody went, but the household still needs a visit. It stays on the list as partly " +
    "reached and does not count as done.",
  attempted:
    "Nobody was home, or the visit did not happen. It stays on the household's record and " +
    "counts towards no goal.",
};

export function outcomeForChoice(choice: VisitRecordChoice): VisitOutcome {
  return choice === "attempted" ? "attempted" : "completed";
}

type Draft = {
  householdId: string;
  visitDate: string;
  visitType: VisitType;
  choice: VisitRecordChoice;
  needsAnotherReason: VisitNeedsAnotherReason | "";
  arrangement: VisitArrangement;
  sharedNotes: string;
  privateNotes: string;
};

async function readJson(response: Response): Promise<Record<string, unknown>> {
  try {
    return (await response.json()) as Record<string, unknown>;
  } catch {
    throw new Error("The server sent a response this page could not read.");
  }
}

function errorFrom(payload: Record<string, unknown>, fallback: string): string {
  return typeof payload.error === "string" ? payload.error : fallback;
}

// Logging a visit is where the notes rule becomes visible to a human.
//
// ---------------------------------------------------------------------------
// THE EMPHASIS IS ON THE SHARED FIELD, NOT THE PRIVATE ONE
// ---------------------------------------------------------------------------
// This reverses the first build, and the reason is worth keeping. Marking the PRIVATE box out as
// special says "be careful here" about the one field that is already safe — nobody but its author
// can ever read it. The field that deserves a person's caution is the SHARED one, because that is
// the text other leaders will read. Highlighting the private box also read as an error state:
// a tinted panel with a heavy border is how a form signals a validation failure.
//
// So the shared field carries the attention: its label, its helper text, AND THE TEXT BEING TYPED
// INTO IT are all in the attention colour. Seeing your own words come out in a different colour
// from everything else on the page is the reminder — this is the part somebody else reads. The
// private field is styled as an ordinary field, because writing privately is the ordinary case.
//
// Both sit inside ONE "Notes" section with two named categories, so the choice reads as two kinds
// of the same thing rather than as two unrelated boxes.
//
// Colour tokens carry both themes on their own: app/globals.css defines every --color-* on :root
// and redefines them under a `.dark` class on <html>, which components/layout/ThemeToggle sets.
// So there is no parallel set of dark: classes here for somebody to keep in step.
//
// The helper text is ALWAYS VISIBLE — never a placeholder, never a tooltip. A placeholder
// disappears the moment somebody starts typing, which is exactly when a leader writing a
// pastoral observation most needs to know who will read it.
//
// ---------------------------------------------------------------------------
// THE OUTCOME CONTROL IS FIRST, AND IT IS TWO BUTTONS
// ---------------------------------------------------------------------------
// It comes before everything because it changes what the rest of the form MEANS: shared notes on
// a visit are what happened, and shared notes on an attempt are usually what to try next. A
// leader answers it before anything else, so it sits where they will answer it.
//
// Two buttons rather than a dropdown, because a binary in a select is a binary you have to open
// to see. Requirement 1 asks for one action, and "change one control" is the difference between
// recording an attempt and working around the form by typing "no answer" into the notes.
//
// CHOOSING "ATTEMPTED" HIDES NOTHING. A leader who got no answer often has something worth
// recording — a car on the drive, a neighbour who said they had moved — and a form that
// rearranges itself under a click is harder to trust than one that does not.
export function VisitLogForm({
  households,
  today,
  user,
  leaders,
  memberNames,
  appointment,
  initialHouseholdId,
}: VisitLogFormProps) {
  const router = useRouter();
  const queryClient = useQueryClient();

  const emptyDraft: Draft = {
    // Prefilled from the appointment when one is being kept, so "log the visit we arranged" does
    // not ask which household twice. `arrangement` follows: it WAS an appointment, by definition.
    householdId: appointment?.householdId ?? initialHouseholdId ?? "",
    visitDate: today,
    visitType: "in_home",
    choice: "done",
    needsAnotherReason: "",
    arrangement: appointment === undefined ? "drop_in" : "appointment",
    sharedNotes: "",
    privateNotes: "",
  };

  const [draft, setDraft] = useState<Draft>(emptyDraft);
  // The recorder starts on the list and can be taken off. `undefined` is never sent — the form
  // always states an answer, and it is the ROUTE that treats an absent key as "the recorder
  // went" for callers that are not this form.
  const [participants, setParticipants] = useState<ParticipantDraft[]>([
    recorderParticipant(user),
  ]);
  const [error, setError] = useState<string | undefined>(undefined);
  const [notice, setNotice] = useState<string | undefined>(undefined);
  const [saving, setSaving] = useState(false);

  function update<K extends keyof Draft>(key: K, value: Draft[K]): void {
    setDraft((current) => ({ ...current, [key]: value }));
  }

  async function submit(): Promise<void> {
    setError(undefined);
    setNotice(undefined);

    if (draft.householdId === "") {
      setError("Choose which household this visit was to.");
      return;
    }

    if (draft.visitDate > today) {
      setError("A visit cannot be logged for a date in the future.");
      return;
    }

    if (draft.choice === "partly_reached" && draft.needsAnotherReason === "") {
      setError("Choose why the household still needs a visit.");
      return;
    }

    setSaving(true);

    try {
      // The visit first. The private note is NEVER a field on this payload — it goes to its own
      // endpoint, in its own request, after the log exists, so the wire format carries the
      // boundary too and no server-side mistake could write it onto the log.
      const response = await fetch("/api/visits", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          householdId: draft.householdId,
          visitDate: draft.visitDate,
          visitType: draft.visitType,
          outcome: outcomeForChoice(draft.choice),
          ...(draft.choice === "partly_reached" && draft.needsAnotherReason !== ""
            ? { needsAnotherReason: draft.needsAnotherReason }
            : {}),
          arrangement: draft.arrangement,
          sharedNotes: draft.sharedNotes.trim() === "" ? null : draft.sharedNotes,
          // Always sent, even when empty. An empty list means "nobody is recorded as having
          // gone", which is a real answer this form can express — the route only defaults to the
          // caller when the key is ABSENT.
          participants: toParticipantPayload(participants),
          ...(appointment === undefined ? {} : { appointmentId: appointment.id }),
        }),
      });

      const payload = await readJson(response);

      if (!response.ok) {
        setError(errorFrom(payload, "Could not save that visit."));
        return;
      }

      const visit = payload.visit as { id: string } | undefined;
      const privateNotes = draft.privateNotes.trim();

      // A private note that failed to save is reported as its own sentence rather than rolled
      // into "could not save the visit" — the visit DID save, and telling somebody their note is
      // stored when it is not is the one failure this feature cannot afford.
      if (visit !== undefined && privateNotes !== "") {
        const noteResponse = await fetch(`/api/visits/${visit.id}/private-note`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ notes: privateNotes }),
        });

        if (!noteResponse.ok) {
          const notePayload = await readJson(noteResponse);
          setDraft({ ...emptyDraft, privateNotes });
          router.refresh();
          setError(
            `${errorFrom(notePayload, "Could not save your private note.")} The visit itself was saved.`,
          );
          return;
        }
      }

      setDraft(emptyDraft);
      setParticipants([recorderParticipant(user)]);
      setNotice(
        draft.choice === "attempted"
          ? "Attempt recorded. It stays on the household's record and counts towards no goal."
          : draft.choice === "partly_reached"
            ? "Visit logged. The household stays on the list as partly reached."
            : "Visit logged.",
      );

      // Clears `?appointment=` so a second visit logged straight afterwards is not silently
      // attached to the appointment the first one kept.
      if (appointment !== undefined) router.replace("/visits");

      // BOTH, because they refresh different things, and the second one is not optional.
      //
      // router.refresh() re-renders the Server Component, which is what updates the appointment
      // panel and the recent-visits list. It does NOT touch the progress dashboard: that table
      // reads a TanStack query, and `initialData` is consulted only on FIRST MOUNT, so a fresh
      // server payload arriving as a new prop is ignored.
      //
      // Without the invalidation the headline number goes stale on the most common action on this
      // page — a leader logs a visit and the banner still reports the household as unvisited until
      // a full reload. Found walking scenario 040.
      router.refresh();
      await queryClient.invalidateQueries({ queryKey: [VISIT_PROGRESS_QUERY_KEY] });
    } catch {
      setError("Could not reach the server. Check your connection and try again.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <Card>
      {/* The id the appointments panel links to. Taken from the module that BUILDS that link,
          so a rename cannot leave "Log this visit" scrolling to nowhere. */}
      <h2 id={LOG_VISIT_ANCHOR} className="text-base font-semibold text-foreground">
        Log a visit
      </h2>

      {appointment === undefined ? null : (
        <p className="mt-1 text-sm text-muted">
          Logging the visit arranged with {appointment.householdName}. Saving this marks that
          appointment as kept.
        </p>
      )}

      <div className="mt-4 flex flex-col gap-4">
        {/* FIRST, because it changes what the rest of the form means. */}
        <div className="flex flex-col gap-1.5">
          <span className="text-sm font-medium text-foreground">What happened</span>
          <div className="flex flex-wrap gap-2">
            {VISIT_RECORD_CHOICES.map((choice) => (
              <Button
                key={choice}
                variant={draft.choice === choice ? "primary" : "secondary"}
                aria-pressed={draft.choice === choice}
                onClick={() => update("choice", choice)}
              >
                {VISIT_RECORD_CHOICE_LABELS[choice]}
              </Button>
            ))}
          </div>
          <p className="text-sm text-muted">{VISIT_RECORD_CHOICE_HELP[draft.choice]}</p>
        </div>

        {draft.choice === "partly_reached" ? (
          <div className="flex flex-col gap-1.5">
            <label htmlFor="visit-needs-another" className="text-sm font-medium text-foreground">
              Why it still needs a visit
            </label>
            <select
              id="visit-needs-another"
              aria-describedby="visit-needs-another-help"
              className={SELECT_CLASSES}
              value={draft.needsAnotherReason}
              onChange={(event) =>
                update("needsAnotherReason", event.target.value as VisitNeedsAnotherReason | "")
              }
            >
              <option value="">Choose a reason…</option>
              {VISIT_NEEDS_ANOTHER_REASONS.map((reason) => (
                <option key={reason} value={reason}>
                  {VISIT_NEEDS_ANOTHER_REASON_LABELS[reason]}
                </option>
              ))}
            </select>
            <p id="visit-needs-another-help" className="text-sm text-muted">
              Say more in the shared notes below.
            </p>
          </div>
        ) : null}

        <div className="flex flex-col gap-1.5">
          <span className="text-sm font-medium text-foreground">How it was arranged</span>
          <div className="flex flex-wrap gap-2">
            {VISIT_ARRANGEMENTS.map((arrangement) => (
              <Button
                key={arrangement}
                variant={draft.arrangement === arrangement ? "primary" : "secondary"}
                aria-pressed={draft.arrangement === arrangement}
                onClick={() => update("arrangement", arrangement)}
              >
                {VISIT_ARRANGEMENT_LABELS[arrangement]}
              </Button>
            ))}
          </div>
        </div>

        <div className="flex flex-col gap-1.5">
          <label htmlFor="visit-household" className="text-sm font-medium text-foreground">
            Household
          </label>
          <select
            id="visit-household"
            className={SELECT_CLASSES}
            value={draft.householdId}
            onChange={(event) => update("householdId", event.target.value)}
          >
            <option value="">Choose a household…</option>
            {households.map((household) => (
              <option key={household.id} value={household.id}>
                {household.label}
              </option>
            ))}
          </select>
        </div>

        <Input
          id="visit-date"
          label="Visit date"
          type="date"
          max={today}
          value={draft.visitDate}
          onChange={(event) => update("visitDate", event.target.value)}
        />

        <div className="flex flex-col gap-1.5">
          <label htmlFor="visit-type" className="text-sm font-medium text-foreground">
            Visit type
          </label>
          <select
            id="visit-type"
            className={SELECT_CLASSES}
            value={draft.visitType}
            onChange={(event) => update("visitType", event.target.value as VisitType)}
          >
            {VISIT_LOGGABLE_TYPES.map((visitType) => (
              <option key={visitType} value={visitType}>
                {VISIT_TYPE_LABELS[visitType]}
              </option>
            ))}
          </select>
        </div>

        <VisitParticipantsField
          value={participants}
          onChange={setParticipants}
          user={user}
          leaders={leaders}
          memberNames={memberNames}
          outcome={outcomeForChoice(draft.choice)}
          disabled={saving}
        />

        <fieldset className="m-0 flex flex-col gap-4 border-0 p-0">
          {/* A legend does not participate in the fieldset's flex layout, so its spacing is set
              here rather than left to the container's gap. */}
          <legend className="mb-2 text-sm font-semibold text-foreground">Notes</legend>

          <div className="flex flex-col gap-1.5">
            <label htmlFor="visit-shared-notes" className="text-sm font-medium text-warning">
              Shared
            </label>
            <p id="visit-shared-notes-help" className="text-sm text-warning">
              Anyone who reviews this visit will read these.
            </p>
            <textarea
              id="visit-shared-notes"
              aria-describedby="visit-shared-notes-help"
              className={SHARED_TEXTAREA_CLASSES}
              maxLength={MAX_SHARED_NOTES}
              value={draft.sharedNotes}
              onChange={(event) => update("sharedNotes", event.target.value)}
            />
          </div>

          <div className="flex flex-col gap-1.5">
            <label htmlFor="visit-private-notes" className="text-sm font-medium text-foreground">
              Private
            </label>
            <p id="visit-private-notes-help" className="text-sm text-muted">
              Only you will ever see these — for your own recollection later.
            </p>
            <textarea
              id="visit-private-notes"
              aria-describedby="visit-private-notes-help"
              className={TEXTAREA_CLASSES}
              maxLength={MAX_PRIVATE_NOTES}
              value={draft.privateNotes}
              onChange={(event) => update("privateNotes", event.target.value)}
            />
          </div>
        </fieldset>

        <FormError message={error} />
        {notice ? (
          <p role="status" className="text-sm text-success">
            {notice}
          </p>
        ) : null}

        <div>
          <Button onClick={() => void submit()} disabled={saving}>
            {saving
              ? "Saving…"
              : draft.choice === "attempted"
                ? "Record attempt"
                : "Log visit"}
          </Button>
        </div>
      </div>
    </Card>
  );
}

export type VisitFlagButtonProps = {
  visitId: string;
  familyName: string;
  flagged: boolean;
};

// The other write control on a visit log, living beside the form because both write to
// visit_logs through the same two endpoints and visits-b replaces this whole surface anyway.
//
// The confirm NAMES WHO WILL BE TOLD. Flagging is the one action on this page that sends
// something to somebody who cannot open the visit, and a leader deciding whether to raise a
// family in ward council should be told that before they do it, not discover it afterwards.
export function VisitFlagButton({ visitId, familyName, flagged }: VisitFlagButtonProps) {
  const router = useRouter();

  const [error, setError] = useState<string | undefined>(undefined);
  const [saving, setSaving] = useState(false);

  async function toggle(): Promise<void> {
    const confirmed = window.confirm(
      flagged
        ? `Remove the ward council flag from ${familyName}?`
        : `Flag ${familyName} for ward council? The executive secretary will be notified — ` +
            "they will see the household name and nothing else, not your notes.",
    );

    if (!confirmed) return;

    setError(undefined);
    setSaving(true);

    try {
      const response = await fetch(`/api/visits/${visitId}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ flaggedForWardCouncil: !flagged }),
      });

      if (!response.ok) {
        const payload = await readJson(response);
        setError(errorFrom(payload, "Could not change that flag."));
        return;
      }

      router.refresh();
    } catch {
      setError("Could not reach the server. Check your connection and try again.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="flex flex-col gap-1">
      <Button variant="secondary" onClick={() => void toggle()} disabled={saving}>
        {flagged ? "Remove ward council flag" : "Flag for ward council"}
      </Button>
      <FormError message={error} />
    </div>
  );
}
