"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import {
  VisitParticipantsField,
  toParticipantPayload,
  type LeaderOption,
  type ParticipantDraft,
} from "@/app/(app)/visits/VisitParticipantsField";
import type { HouseholdOption } from "@/app/(app)/visits/VisitLogForm";
import { Button } from "@/components/ui/Button";
import { FormError } from "@/components/ui/FormError";
import { Input } from "@/components/ui/Input";
import { Modal } from "@/components/ui/Modal";
import { wardInputsToInstant } from "@/lib/todos/scheduleInstant";
import {
  MAX_SHARED_NOTES,
  MAX_VISIT_COMPANIONS,
  TOO_MANY_COMPANIONS_MESSAGE,
} from "@/lib/validation/visit";
import type { SessionUser } from "@/types/domain";

// BOOKING A VISIT — the one scheduling form (ITER-055 bv6). The Appointments window shows it under
// its list, and a "Visit the ___ family" to-do opens it in a window of its own (P11), so a visit is
// booked one way wherever it starts.
//
// THE DAY AND TIME ARE THE WARD'S WALL CLOCK (lib/todos/scheduleInstant.ts), never
// `new Date("…T19:30")`, which reads the digits in whatever zone the browser happens to be in. The
// form it replaced did exactly that.
//
// COMPANIONS: a leader is INVITED and answers on their own My Appointments; a roster member or a
// typed name is RECORDED. The booker is never on the list — they are going because they booked it.

const TEXTAREA_CLASSES =
  "min-h-20 rounded-md border border-border bg-surface-raised px-3 py-2 text-base text-foreground placeholder:text-muted focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary";

const SELECT_CLASSES =
  "min-h-11 rounded-md border border-border bg-surface-raised px-3 text-base text-foreground focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary";

const COMPANION_COPY = {
  legend: "Going with you (optional)",
  intro:
    "A leader gets an invite to accept or decline. A member or someone else is noted on the visit " +
    "and gets nothing.",
  empty: "Just you.",
  capacityMessage: TOO_MANY_COMPANIONS_MESSAGE,
};

export type ScheduleVisitFormProps = {
  households: HouseholdOption[];
  initialHouseholdId?: string;
  // From a visit to-do: the household is fixed and the appointment carries the assignment.
  assignmentId?: string;
  wardTimeZone: string;
  user: SessionUser;
  leaders: LeaderOption[];
  memberNames: Record<string, string>;
  onBooked?: (confirmation: string) => void;
};

export function bookedConfirmation(invitedCount: number): string {
  if (invitedCount === 0) return "Visit booked.";
  return `Visit booked. ${invitedCount === 1 ? "The invite has" : `${invitedCount} invites have`} been sent.`;
}

async function readError(response: Response, fallback: string): Promise<string> {
  try {
    const payload = (await response.json()) as { error?: unknown };
    return typeof payload.error === "string" ? payload.error : fallback;
  } catch {
    return "The server sent a response this page could not read.";
  }
}

export function ScheduleVisitForm({
  households,
  initialHouseholdId,
  assignmentId,
  wardTimeZone,
  user,
  leaders,
  memberNames,
  onBooked,
}: ScheduleVisitFormProps) {
  const router = useRouter();
  const [householdId, setHouseholdId] = useState(initialHouseholdId ?? "");
  const [date, setDate] = useState("");
  const [time, setTime] = useState("");
  const [companions, setCompanions] = useState<ParticipantDraft[]>([]);
  const [notes, setNotes] = useState("");
  const [error, setError] = useState<string | undefined>(undefined);
  const [notice, setNotice] = useState<string | undefined>(undefined);
  const [saving, setSaving] = useState(false);

  const fixedHousehold =
    assignmentId === undefined ? undefined : households.find((option) => option.id === householdId);

  async function book(): Promise<void> {
    setError(undefined);
    setNotice(undefined);

    if (householdId === "") {
      setError("Choose which household this visit is with.");
      return;
    }

    if (date.trim() === "" || time.trim() === "") {
      setError("Give the day and the time.");
      return;
    }

    const scheduledFor = wardInputsToInstant(date, time, wardTimeZone);
    if (scheduledFor === null) {
      setError("That day and time could not be read. Check both fields.");
      return;
    }

    setSaving(true);

    try {
      const response = await fetch("/api/visit-appointments", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          householdId,
          scheduledFor,
          notes: notes.trim() === "" ? null : notes,
          companions: toParticipantPayload(companions),
          ...(assignmentId === undefined ? {} : { assignmentId }),
        }),
      });

      if (!response.ok) {
        setError(await readError(response, "Could not book that visit."));
        return;
      }

      const confirmation = bookedConfirmation(
        companions.filter((companion) => companion.kind === "user").length,
      );
      setHouseholdId(initialHouseholdId ?? "");
      setDate("");
      setTime("");
      setCompanions([]);
      setNotes("");
      setNotice(confirmation);
      router.refresh();
      onBooked?.(confirmation);
    } catch {
      setError("Could not reach the server. Check your connection and try again.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <form
      className="flex flex-col gap-4"
      onSubmit={(event) => {
        event.preventDefault();
        void book();
      }}
    >
      {fixedHousehold !== undefined ? (
        <p className="text-sm font-medium text-foreground">{fixedHousehold.label}</p>
      ) : (
        <div className="flex flex-col gap-1.5">
          <label htmlFor="schedule-visit-household" className="text-sm font-medium text-foreground">
            Household
          </label>
          <select
            id="schedule-visit-household"
            className={SELECT_CLASSES}
            value={householdId}
            onChange={(event) => setHouseholdId(event.target.value)}
          >
            <option value="">Choose a household…</option>
            {households.map((household) => (
              <option key={household.id} value={household.id}>
                {household.label}
              </option>
            ))}
          </select>
        </div>
      )}

      {/* No `min`. A visit written down after the fact is a real thing — a leader records on
          Wednesday the visit they arranged for Tuesday. min-w-0 lets the two share a 375px row. */}
      <div className="flex flex-wrap gap-3">
        <div className="flex min-w-0 flex-1 basis-36 flex-col">
          <Input
            id="schedule-visit-date"
            label="Day"
            type="date"
            value={date}
            onChange={(event) => setDate(event.target.value)}
          />
        </div>
        <div className="flex min-w-0 flex-1 basis-28 flex-col">
          <Input
            id="schedule-visit-time"
            label="Time"
            type="time"
            value={time}
            onChange={(event) => setTime(event.target.value)}
          />
        </div>
      </div>

      <VisitParticipantsField
        value={companions}
        onChange={setCompanions}
        user={user}
        leaders={leaders}
        memberNames={memberNames}
        outcome="completed"
        disabled={saving}
        copy={COMPANION_COPY}
        maxPeople={MAX_VISIT_COMPANIONS}
        idPrefix="schedule-visit-companion"
      />

      <div className="flex flex-col gap-1.5">
        <label htmlFor="schedule-visit-notes" className="text-sm font-medium text-foreground">
          Note (optional)
        </label>
        <p id="schedule-visit-notes-help" className="text-sm text-muted">
          Anyone who can see this appointment will read this.
        </p>
        <textarea
          id="schedule-visit-notes"
          aria-describedby="schedule-visit-notes-help"
          className={TEXTAREA_CLASSES}
          maxLength={MAX_SHARED_NOTES}
          value={notes}
          onChange={(event) => setNotes(event.target.value)}
        />
      </div>

      <FormError message={error} />
      {notice ? (
        <p role="status" className="text-sm text-success">
          {notice}
        </p>
      ) : null}

      <div>
        <Button type="submit" disabled={saving}>
          {saving ? "Saving…" : "Book visit"}
        </Button>
      </div>
    </form>
  );
}

export type ScheduleVisitWindowProps = Omit<ScheduleVisitFormProps, "onBooked"> & {
  isOpen: boolean;
  onClose: () => void;
  onBooked: () => void;
  title: string;
};

// THE WINDOW STAYS OPEN ON THE CONFIRMATION (defect 102-D1, the user's choice). It used to close the
// moment the save succeeded, which threw away the sentence saying whether the invites went out.
export function ScheduleVisitWindow({
  isOpen,
  onClose,
  onBooked,
  title,
  ...formProps
}: ScheduleVisitWindowProps) {
  const [confirmation, setConfirmation] = useState<string | undefined>(undefined);

  return (
    <Modal isOpen={isOpen} onClose={onClose} title={title}>
      {!isOpen ? null : confirmation !== undefined ? (
        <div className="flex flex-col gap-4">
          <p role="status" className="text-sm text-success">
            {confirmation}
          </p>
          <div>
            <Button type="button" onClick={onClose}>
              Done
            </Button>
          </div>
        </div>
      ) : (
        <ScheduleVisitForm
          {...formProps}
          onBooked={(message) => {
            setConfirmation(message);
            onBooked();
          }}
        />
      )}
    </Modal>
  );
}
