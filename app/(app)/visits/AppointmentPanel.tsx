"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { FormError } from "@/components/ui/FormError";
import { Input } from "@/components/ui/Input";
import { appointmentViewState } from "@/lib/visits/appointmentStatus";
import { logVisitHref } from "@/lib/visits/appointmentLink";
import { MAX_SHARED_NOTES } from "@/lib/validation/visit";
import {
  APPOINTMENT_VIEW_STATE_LABELS,
  type AppointmentStatus,
  type AppointmentViewState,
} from "@/types/domain";
import type { HouseholdOption } from "@/app/(app)/visits/VisitLogForm";

// Appointments — the visits a ward has ARRANGED but not yet made.
//
// ---------------------------------------------------------------------------
// "MISSED" IS COMPUTED HERE, NOT READ FROM A COLUMN
// ---------------------------------------------------------------------------
// The server sends the STORED status and the time; this panel asks
// lib/visits/appointmentStatus.ts what that means right now. A missed appointment is one that was
// scheduled and whose time has passed — it becomes missed because the clock moved, and nothing in
// this app runs on a schedule to write that down (there is no pg_cron and no cron function).
//
// The panel recomputes on render rather than trusting the value the server computed, so an
// appointment that passes its time while somebody has the page open reads correctly on the next
// render instead of when they reload.
//
// A missed one is visually distinct AND says the word. Colour alone is not a label.

export type AppointmentRow = {
  id: string;
  householdId: string | null;
  householdName: string | null;
  scheduledFor: string;
  status: AppointmentStatus;
  visitLogId: string | null;
  madeByName: string | null;
  notes: string | null;
};

export type AppointmentPanelProps = {
  appointments: AppointmentRow[];
  households: HouseholdOption[];
  canBook: boolean;
};

// "Log this visit" puts the appointment in the URL rather than in shared client state, and
// page.tsx reads it back out and hands it to VisitLogForm. That keeps the page a Server
// Component — no client wrapper owning two panels — and it means the prefilled form survives a
// refresh and can be linked to.
//
// The query parameter itself lives in lib/visits/appointmentLink.ts, NOT here. A constant
// exported from this file reached the Server Component as a client-reference proxy rather than
// as a string, and the prefill silently never ran — that module's header records it.

// ---------------------------------------------------------------------------
// THE STATE READS AS A BADGE, AND CARRIES A MARK AS WELL AS A COLOUR
// ---------------------------------------------------------------------------
// The first build set the state as a bare coloured line of text, and walking scenario 044 found
// it did not stand out — four states down a list all looked like body copy, and "Cancelled" in
// grey read as text that had been disabled rather than as a state somebody chose.
//
// So it is a bordered pill, following components/assignments/StageBadge.tsx: the colour is the
// TEXT and BORDER on the surrounding surface rather than white text on a filled pill, because
// every token in app/globals.css was measured against --surface and --surface-raised in both
// themes and a fill would need its own second measurement per state.
//
// The MARK is the point of the change. Colour alone separates these four only for somebody who
// can see all four colours, and grey-on-grey barely separates them for anybody. A circle, a
// tick, a cross and an exclamation are four different SHAPES, legible at a glance and legible in
// greyscale. The word is always present too, so the badge never depends on the mark either.
//
// Text glyphs rather than emoji, deliberately: an emoji renders in its own colour on most
// platforms, which would fight the state colour and defeat the pill, and its size varies by
// platform in a row this small.
const STATE_CLASSES: Record<AppointmentViewState, string> = {
  scheduled: "border-border text-foreground",
  kept: "border-success text-success",
  cancelled: "border-border text-muted",
  missed: "border-warning text-warning",
};

// aria-hidden: the word beside it already says the state, so a screen reader announcing
// "check mark Kept" would just be reading the same fact twice.
const STATE_MARKS: Record<AppointmentViewState, string> = {
  scheduled: "○",
  kept: "✓",
  cancelled: "✕",
  missed: "!",
};

const TEXTAREA_CLASSES =
  "min-h-20 rounded-md border border-border bg-surface-raised px-3 py-2 text-base text-foreground placeholder:text-muted focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary";

const SELECT_CLASSES =
  "min-h-11 rounded-md border border-border bg-surface-raised px-3 text-base text-foreground focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary";

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

// The ward's own locale and timezone, from the browser. An appointment is the one thing in this
// app stored as an instant rather than a date, so it is the one thing that must be rendered in
// somebody's local time rather than UTC.
function formatScheduledFor(value: string): string {
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return value;

  return parsed.toLocaleString(undefined, {
    weekday: "short",
    day: "numeric",
    month: "short",
    hour: "numeric",
    minute: "2-digit",
  });
}

// <input type="datetime-local"> speaks local wall-clock with no offset, and the API takes an ISO
// instant. Converting through Date rather than string-building is what keeps a ward on the far
// side of a timezone from booking Tuesday and reading back Monday.
function toIsoInstant(localValue: string): string | null {
  const parsed = new Date(localValue);
  return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString();
}

export function AppointmentPanel({
  appointments,
  households,
  canBook,
}: AppointmentPanelProps) {
  const router = useRouter();

  const [householdId, setHouseholdId] = useState("");
  const [scheduledFor, setScheduledFor] = useState("");
  const [notes, setNotes] = useState("");
  const [error, setError] = useState<string | undefined>(undefined);
  const [notice, setNotice] = useState<string | undefined>(undefined);
  const [saving, setSaving] = useState(false);

  const now = new Date();

  async function book(): Promise<void> {
    setError(undefined);
    setNotice(undefined);

    if (householdId === "") {
      setError("Choose which household this appointment is with.");
      return;
    }

    const instant = toIsoInstant(scheduledFor);

    if (instant === null) {
      setError("Give the day and time of the appointment.");
      return;
    }

    setSaving(true);

    try {
      const response = await fetch("/api/visit-appointments", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          householdId,
          scheduledFor: instant,
          notes: notes.trim() === "" ? null : notes,
        }),
      });

      if (!response.ok) {
        setError(errorFrom(await readJson(response), "Could not book that appointment."));
        return;
      }

      setHouseholdId("");
      setScheduledFor("");
      setNotes("");
      setNotice("Appointment booked.");
      router.refresh();
    } catch {
      setError("Could not reach the server. Check your connection and try again.");
    } finally {
      setSaving(false);
    }
  }

  async function patch(appointmentId: string, body: unknown, fallback: string): Promise<void> {
    setError(undefined);
    setNotice(undefined);
    setSaving(true);

    try {
      const response = await fetch(`/api/visit-appointments/${appointmentId}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      });

      if (!response.ok) {
        setError(errorFrom(await readJson(response), fallback));
        return;
      }

      router.refresh();
    } catch {
      setError("Could not reach the server. Check your connection and try again.");
    } finally {
      setSaving(false);
    }
  }

  async function cancel(appointment: AppointmentRow): Promise<void> {
    // The confirm says what cancelling DOES and what it does not: the row stays, because that an
    // appointment was made and called off is part of the record of how a ward has tried to reach
    // a household.
    const confirmed = window.confirm(
      `Cancel the appointment with ${appointment.householdName ?? "this household"}? ` +
        "It stays on the record as cancelled rather than disappearing.",
    );

    if (!confirmed) return;

    await patch(appointment.id, { action: "cancel" }, "Could not cancel that appointment.");
  }

  async function reschedule(appointment: AppointmentRow): Promise<void> {
    const answer = window.prompt(
      "New day and time, as YYYY-MM-DD HH:MM",
      // Prefilled from the existing time so rescheduling by an hour is an edit rather than a
      // retype.
      formatPromptDefault(appointment.scheduledFor),
    );

    if (answer === null) return;

    const instant = toIsoInstant(answer.trim().replace(" ", "T"));

    if (instant === null) {
      setError("That did not read as a day and time. Use YYYY-MM-DD HH:MM.");
      return;
    }

    await patch(
      appointment.id,
      { action: "reschedule", scheduledFor: instant },
      "Could not reschedule that appointment.",
    );
  }

  return (
    <Card>
      <h2 className="text-base font-semibold text-foreground">Appointments</h2>
      <p className="mt-1 text-sm text-muted">
        Visits arranged ahead of time. An appointment whose time has passed without being kept
        reads as missed — nothing writes that down, it is worked out each time this loads.
      </p>

      {appointments.length === 0 ? (
        <p className="mt-3 text-sm text-muted">No appointments have been booked.</p>
      ) : (
        <ul className="mt-3 flex flex-col gap-3">
          {appointments.map((appointment) => {
            const state = appointmentViewState(appointment, now);

            return (
              <li
                key={appointment.id}
                className="rounded-md border border-border bg-surface p-3"
              >
                <p className="text-sm font-medium text-foreground">
                  {appointment.householdName ?? "Unknown household"}
                </p>
                <p className="mt-1 text-sm text-muted">
                  {formatScheduledFor(appointment.scheduledFor)}
                  {appointment.madeByName === null ? "" : ` · booked by ${appointment.madeByName}`}
                </p>

                {/* The word AND a shape, never the colour alone. */}
                <p className="mt-2">
                  <span
                    className={`inline-flex items-center gap-1.5 rounded-full border px-2 py-0.5 text-xs font-medium ${STATE_CLASSES[state]}`}
                  >
                    <span aria-hidden="true">{STATE_MARKS[state]}</span>
                    {APPOINTMENT_VIEW_STATE_LABELS[state]}
                  </span>
                </p>

                {appointment.notes === null ? null : (
                  <p className="mt-2 whitespace-pre-wrap text-sm text-foreground">
                    {appointment.notes}
                  </p>
                )}

                {canBook && appointment.status === "scheduled" ? (
                  <div className="mt-3 flex flex-wrap gap-2">
                    <Button
                      variant="secondary"
                      disabled={saving}
                      onClick={() => router.push(logVisitHref(appointment.id))}
                    >
                      Log this visit
                    </Button>
                    <Button
                      variant="secondary"
                      disabled={saving}
                      onClick={() => void reschedule(appointment)}
                    >
                      Reschedule
                    </Button>
                    <Button
                      variant="secondary"
                      disabled={saving}
                      onClick={() => void cancel(appointment)}
                    >
                      Cancel
                    </Button>
                  </div>
                ) : null}
              </li>
            );
          })}
        </ul>
      )}

      {canBook ? (
        <div className="mt-6 flex flex-col gap-4 border-t border-border pt-4">
          <h3 className="text-sm font-semibold text-foreground">Book an appointment</h3>

          <div className="flex flex-col gap-1.5">
            <label htmlFor="appointment-household" className="text-sm font-medium text-foreground">
              Household
            </label>
            <select
              id="appointment-household"
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

          {/* No `min`. An appointment recorded after the fact is a real thing — a leader writes
              down on Wednesday the visit they arranged for Tuesday — and refusing it would push
              that record into a notes field where nothing can count it. */}
          <Input
            id="appointment-scheduled-for"
            label="Day and time"
            type="datetime-local"
            value={scheduledFor}
            onChange={(event) => setScheduledFor(event.target.value)}
          />

          <div className="flex flex-col gap-1.5">
            <label htmlFor="appointment-notes" className="text-sm font-medium text-foreground">
              Note
            </label>
            <p id="appointment-notes-help" className="text-sm text-muted">
              Anyone who can see this appointment will read this.
            </p>
            <textarea
              id="appointment-notes"
              aria-describedby="appointment-notes-help"
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
            <Button onClick={() => void book()} disabled={saving}>
              {saving ? "Saving…" : "Book appointment"}
            </Button>
          </div>
        </div>
      ) : (
        <FormError message={error} />
      )}
    </Card>
  );
}

// The value window.prompt shows. Local wall-clock, because that is what the person typing means.
function formatPromptDefault(value: string): string {
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return "";

  const pad = (part: number) => String(part).padStart(2, "0");

  return (
    `${parsed.getFullYear()}-${pad(parsed.getMonth() + 1)}-${pad(parsed.getDate())} ` +
    `${pad(parsed.getHours())}:${pad(parsed.getMinutes())}`
  );
}
