"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ChevronDown, ChevronRight, Home, ListTodo, Trophy } from "lucide-react";
import { Card } from "@/components/ui/Card";
import { FormError } from "@/components/ui/FormError";
import { Pill, type PillTone } from "@/components/ui/Pill";
import {
  isDayCollapsed,
  setAllDays,
  setShowPast,
  toggleDay,
  type AppointmentsView,
} from "@/lib/appointments/appointmentsView";
import {
  groupByWardDay,
  hasStarted,
  type AppointmentDay,
  type MyAppointmentKind,
  type MyAppointmentSource,
} from "@/lib/appointments/myAppointments";
import { APPOINTMENT_VIEW_STATE_LABELS, type AppointmentViewState } from "@/types/domain";
import { AskAnswerDialog } from "@/app/(app)/todos/AskAnswerDialog";
import { AskDetails } from "@/app/(app)/todos/AskDetails";
import { SmallButton } from "@/app/(app)/todos/SmallButton";
import { sendTodoRequest } from "@/app/(app)/todos/todoApi";

// The list itself. Upcoming first, soonest at the top; the past behind a "Show past (N)" toggle,
// hidden by default and most recent first. A past item is NEVER removed — it moves, and only once
// its ward day has ended. Until then it stays with today, GREYED once its time has passed.
//
// GROUPED BY DAY, WITH ALTERNATING BANDS (the user's request walking scenario 077): every other
// day sits on the Tasks section's gold tint, so the change of day is visible while scrolling. Each
// day collapses on its heading; Collapse all / Expand all sit at the top; everything is expanded
// by default.
//
// IT REOPENS AS IT WAS LEFT — the user's standing rule. The view (lib/appointments/
// appointmentsView.ts) arrives from the server, which read it from the account, so the first paint
// is already right; every change is saved back after a short pause, so a run of clicks is one save.
// A failed save is said out loud beside the controls (rule 7) and the page keeps working.
//
// Each row links to where it lives, and carries the one inline action its kind has: Cancel for a
// visit appointment, Unschedule for a to-do. A youth sign-up has none here; it is managed on the
// event's own page. Both actions call the owning module's existing route — this page owns no
// write of its own, which is what keeps it an aggregation rather than a second copy of three
// modules.
//
// A SCHEDULED TALK ASK ALSO CARRIES ITS TOPIC, ITS CONTACT DETAILS, AND ACCEPTED / DECLINED
// (Sacrament slice f1, the user's request walking scenario 078): the meeting is where the answer
// is given, so it can be recorded there. Both buttons post to the To Do answer route, and Declined
// opens the same window as on the card. Still no write of this page's own.
//
// TIMES ARE THE WARD'S, with the zone named in the formatter (rule 12). The zone arrives from the
// page, so the server's first render and the browser's read the same hour.

const KIND_LABELS: Record<MyAppointmentKind, string> = {
  visit: "Visit",
  todo: "To-do",
  youth: "Youth event",
};

const KIND_ICONS: Record<MyAppointmentKind, typeof Home> = {
  visit: Home,
  todo: ListTodo,
  youth: Trophy,
};

const VISIT_STATE_TONES: Record<AppointmentViewState, PillTone> = {
  scheduled: "neutral",
  kept: "ok",
  cancelled: "neutral",
  missed: "missing",
};

// The day heading names the day, so a row carries only its time. An all-day event says so rather
// than "12:00 AM", which would read as the off-by-hours bug (CLAUDE.md §9, migration 055).
function timeLabel(source: MyAppointmentSource, wardZone: string): string {
  if (source.allDay) return "All day";

  const parsed = new Date(source.startsAt);
  if (Number.isNaN(parsed.getTime())) return source.startsAt;

  return parsed.toLocaleTimeString("en-US", {
    timeZone: wardZone,
    hour: "numeric",
    minute: "2-digit",
  });
}

// A day is a `date` — no zone — so UTC, never the reader's (lib/calendar/dates.ts).
const DAY_HEADING = new Intl.DateTimeFormat("en-US", {
  timeZone: "UTC",
  weekday: "long",
  month: "short",
  day: "numeric",
  year: "numeric",
});

function dayHeading(day: string, today: string): string {
  const label = DAY_HEADING.format(new Date(`${day}T00:00:00Z`));
  return day === today ? `Today · ${label}` : label;
}

// Long enough that a run of clicks is one save (and one audit row), short enough that leaving the
// page straight after a click rarely loses it.
const SAVE_DELAY_MS = 500;

async function saveView(view: AppointmentsView): Promise<void> {
  const response = await fetch("/api/session/page-view", {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ page: "appointments", view }),
  });

  if (response.ok) return;

  let message = "Could not remember how you left this page. Please try again.";
  try {
    const parsed = (await response.json()) as { error?: unknown };
    if (typeof parsed.error === "string") message = parsed.error;
  } catch {
    message = "The server sent a response this page could not read.";
  }
  throw new Error(message);
}

async function cancelVisitAppointment(id: string): Promise<void> {
  const response = await fetch(`/api/visit-appointments/${id}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ action: "cancel" }),
  });

  if (response.ok) return;

  let message = "Could not cancel that appointment. Please try again.";
  try {
    const parsed = (await response.json()) as { error?: unknown };
    if (typeof parsed.error === "string") message = parsed.error;
  } catch {
    message = "The server sent a response this page could not read.";
  }
  throw new Error(message);
}

export type AppointmentListProps = {
  upcoming: MyAppointmentSource[];
  past: MyAppointmentSource[];
  wardZone: string;
  // The ward's date and the instant the page was built, both from the server, so the server's
  // render and the browser's agree about which day is today and which rows are greyed.
  today: string;
  asOf: string;
  initialView: AppointmentsView;
  canCancelVisits: boolean;
  // `talks.request`, which POST /api/todos/[id]/answer asserts. Without it, an ask shows its
  // details and no answer buttons.
  canAnswerAsks: boolean;
};

export function AppointmentList({
  upcoming,
  past,
  wardZone,
  today,
  asOf,
  initialView,
  canCancelVisits,
  canAnswerAsks,
}: AppointmentListProps) {
  const router = useRouter();
  const [view, setView] = useState<AppointmentsView>(initialView);
  const [saveError, setSaveError] = useState<string | undefined>(undefined);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [declining, setDeclining] = useState<{ id: string; title: string } | null>(null);
  const [error, setError] = useState<{ id: string; message: string } | null>(null);
  // Bumped by every change the person makes; 0 means "nothing to save yet", so opening the page
  // never writes the view it was just given.
  const [changeCount, setChangeCount] = useState(0);

  const asOfDate = new Date(asOf);
  const upcomingDays = groupByWardDay(upcoming, wardZone);
  const pastDays = groupByWardDay(past, wardZone);
  const daysOnScreen = [...upcomingDays, ...(view.showPast ? pastDays : [])].map(
    (group) => group.day,
  );

  // Each change restarts the wait (the cleanup clears the previous timer), so only the last view
  // of a burst is saved.
  useEffect(() => {
    if (changeCount === 0) return;
    const timer = setTimeout(() => {
      saveView(view).catch((saveFailure: unknown) =>
        setSaveError(
          saveFailure instanceof Error
            ? saveFailure.message
            : "Could not reach the server, so this view was not remembered.",
        ),
      );
    }, SAVE_DELAY_MS);
    return () => clearTimeout(timer);
  }, [changeCount, view]);

  function changeView(next: AppointmentsView) {
    setView(next);
    setSaveError(undefined);
    setChangeCount((count) => count + 1);
  }

  async function run(id: string, action: () => Promise<unknown>): Promise<void> {
    setBusyId(id);
    setError(null);
    try {
      await action();
      router.refresh();
    } catch (actionError) {
      setError({
        id,
        message:
          actionError instanceof Error
            ? actionError.message
            : "Could not reach the server. Check your connection and try again.",
      });
    } finally {
      setBusyId(null);
    }
  }

  function cancelVisit(source: MyAppointmentSource) {
    // Says what cancelling does and does not do — the row stays on the visit record as cancelled.
    const confirmed = window.confirm(
      `Cancel "${source.title}"? It stays on the visit record as cancelled rather than disappearing.`,
    );
    if (!confirmed) return;
    void run(source.id, () => cancelVisitAppointment(source.id));
  }

  function unschedule(source: MyAppointmentSource) {
    void run(source.id, () =>
      sendTodoRequest(`/api/todos/${source.id}`, "PATCH", { scheduledFor: null }),
    );
  }

  function acceptAsk(source: MyAppointmentSource) {
    void run(source.id, () =>
      sendTodoRequest(`/api/todos/${source.id}/answer`, "POST", { outcome: "accepted" }),
    );
  }

  // `inUpcoming`: only today's list greys a row whose time has gone by — greyed, still here, still
  // actionable, until the day is over. Everything under Past is past, so greying there would say
  // nothing and, since an all-day item is never "started", would grey some rows and not others.
  function renderRow(source: MyAppointmentSource, inUpcoming: boolean) {
    const Icon = KIND_ICONS[source.kind];
    const busy = busyId === source.id;
    const started = inUpcoming && hasStarted(source, asOfDate);

    return (
      <li key={`${source.kind}-${source.id}`}>
        <Card className={`flex flex-col gap-1 p-3 ${started ? "opacity-60" : ""}`}>
          <div className="flex items-start gap-2">
            <div className="flex min-w-0 flex-1 flex-col gap-1">
              <span className="text-sm font-semibold text-foreground tabular-nums">
                {timeLabel(source, wardZone)}
              </span>
              <Link
                href={source.href}
                className="inline-flex min-h-11 items-center gap-2 self-start break-words text-base font-medium text-primary hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
              >
                <Icon aria-hidden="true" className="h-4 w-4 shrink-0 text-muted" />
                <span className="min-w-0 break-words">{source.title}</span>
              </Link>
              <span className="flex flex-wrap items-center gap-1.5">
                <Pill tone="neutral">{KIND_LABELS[source.kind]}</Pill>
                {source.kind === "visit" && source.viewState !== "scheduled" ? (
                  <Pill tone={VISIT_STATE_TONES[source.viewState]}>
                    {APPOINTMENT_VIEW_STATE_LABELS[source.viewState]}
                  </Pill>
                ) : null}
                {source.kind === "todo" && source.completed ? <Pill tone="ok">Done</Pill> : null}
                {source.detail === null ? null : (
                  <span className="text-xs text-muted">{source.detail}</span>
                )}
              </span>
              {source.kind === "todo" && source.ask !== null && source.ask.isOpen ? (
                <AskDetails ask={source.ask} />
              ) : null}
              {source.kind === "todo" && source.ask?.isOpen === true && canAnswerAsks ? (
                <span className="flex flex-wrap items-center gap-1">
                  <SmallButton
                    label="Accepted"
                    accessibleName={`They accepted — ${source.title}`}
                    onClick={() => acceptAsk(source)}
                    disabled={busyId !== null}
                  />
                  <SmallButton
                    label="Declined"
                    accessibleName={`They declined — ${source.title}`}
                    onClick={() => setDeclining({ id: source.id, title: source.title })}
                    disabled={busyId !== null}
                  />
                </span>
              ) : null}
            </div>

            <div className="flex shrink-0 items-center">
              {source.kind === "visit" && canCancelVisits && source.viewState === "scheduled" ? (
                <SmallButton
                  label={busy ? "Cancelling…" : "Cancel"}
                  accessibleName={`Cancel ${source.title}`}
                  onClick={() => cancelVisit(source)}
                  disabled={busyId !== null}
                />
              ) : null}
              {source.kind === "todo" && !source.completed ? (
                <SmallButton
                  label={busy ? "Removing…" : "Unschedule"}
                  accessibleName={`Unschedule ${source.title}`}
                  onClick={() => unschedule(source)}
                  disabled={busyId !== null}
                />
              ) : null}
            </div>
          </div>
          <FormError message={error?.id === source.id ? error.message : undefined} />
        </Card>
      </li>
    );
  }

  // Every other day on the gold tint, counted down each list separately, so the first day of the
  // past always starts plain. The band is a background behind the cards, never their colour.
  function renderDays(days: AppointmentDay[], label: string) {
    return (
      <ul className="flex flex-col gap-2" aria-label={label}>
        {days.map((group, index) => {
          const collapsed = isDayCollapsed(view, group.day);
          const bodyId = `appointments-day-${label.toLowerCase()}-${group.day}`;
          const Chevron = collapsed ? ChevronRight : ChevronDown;

          return (
            <li
              key={group.day}
              className={`flex flex-col gap-2 rounded-lg p-2 ${index % 2 === 1 ? "bg-gold-soft" : ""}`}
            >
              <button
                type="button"
                aria-expanded={!collapsed}
                aria-controls={bodyId}
                onClick={() => changeView(toggleDay(view, group.day, daysOnScreen))}
                className="inline-flex min-h-11 items-center gap-2 self-start rounded-md px-1 text-left text-sm font-semibold text-foreground hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
              >
                <Chevron aria-hidden="true" className="h-4 w-4 shrink-0 text-muted" />
                <span>{dayHeading(group.day, today)}</span>
                {collapsed ? (
                  <span className="text-xs font-normal text-muted tabular-nums">
                    ({group.items.length})
                  </span>
                ) : null}
              </button>
              {collapsed ? null : (
                <ul id={bodyId} className="flex flex-col gap-2">
                  {group.items.map((source) => renderRow(source, label === "Upcoming"))}
                </ul>
              )}
            </li>
          );
        })}
      </ul>
    );
  }

  const hasAnyDay = upcomingDays.length > 0 || (view.showPast && pastDays.length > 0);

  return (
    <div className="flex flex-col gap-3">
      {hasAnyDay ? (
        <div className="flex flex-wrap items-center gap-1" role="group" aria-label="Days">
          <SmallButton
            label="Expand all"
            accessibleName="Expand every day"
            onClick={() => changeView(setAllDays(view, false))}
          >
            <ChevronDown aria-hidden="true" className="h-3.5 w-3.5" />
          </SmallButton>
          <SmallButton
            label="Collapse all"
            accessibleName="Collapse every day"
            onClick={() => changeView(setAllDays(view, true))}
          >
            <ChevronRight aria-hidden="true" className="h-3.5 w-3.5" />
          </SmallButton>
        </div>
      ) : null}
      <FormError message={saveError} />

      {upcomingDays.length === 0 ? (
        <Card>
          <p className="text-sm text-muted">
            Nothing scheduled. Visit appointments, scheduled to-dos and youth events you&apos;ve
            signed up for appear here.
          </p>
        </Card>
      ) : (
        renderDays(upcomingDays, "Upcoming")
      )}

      {past.length === 0 ? null : (
        <div className="flex flex-col gap-2">
          <button
            type="button"
            aria-expanded={view.showPast}
            onClick={() => changeView(setShowPast(view, !view.showPast))}
            className="inline-flex min-h-11 items-center self-start text-sm font-medium text-primary hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
          >
            {view.showPast ? `Hide past (${past.length})` : `Show past (${past.length})`}
          </button>
          {view.showPast ? renderDays(pastDays, "Past") : null}
        </div>
      )}

      {/* Mounted only while open, so each decline starts from a clean window. */}
      {declining === null ? null : (
        <AskAnswerDialog
          isOpen
          onClose={() => setDeclining(null)}
          onSaved={() => router.refresh()}
          todoId={declining.id}
          title={declining.title}
        />
      )}
    </div>
  );
}
