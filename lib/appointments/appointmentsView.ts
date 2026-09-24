import { z } from "zod";

// How a leader LEFT My Appointments, so it reopens that way (the user's standing rule, 2026-09-24:
// every page remembers how it was left). Stored on the account in `users.settings.page_views`
// through lib/users/userSettings.ts, never in the browser, so it follows the person between devices
// and the server renders it correctly on first paint.
//
// ---------------------------------------------------------------------------
// A DEFAULT PLUS EXCEPTIONS, NOT A LIST OF COLLAPSED DAYS
// ---------------------------------------------------------------------------
// The days on the list change every week. "Collapse all" has to mean that next week's new days
// open collapsed too, which a list of collapsed dates cannot say. So the view stores the default
// (`collapsed`) and the days somebody toggled against it (`toggledDays`). Collapse all / Expand all
// set the default and clear the exceptions. `toggledDays` is pruned to the days on screen at each
// change, so it never grows past the list it describes — the settings column has a 4 KB ceiling
// (migration 077).
//
// Pure: no clock, no storage. The parse falls back rather than throwing, userSettings.ts' rule — a
// preference nobody can parse must not take the page down.

const MAX_TOGGLED_DAYS = 120;
const DAY_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

export const appointmentsViewSchema = z.object({
  collapsed: z.boolean(),
  toggledDays: z.array(z.string().regex(DAY_PATTERN)).max(MAX_TOGGLED_DAYS),
  showPast: z.boolean(),
});

export type AppointmentsView = z.infer<typeof appointmentsViewSchema>;

// Expanded by default, the past hidden — the user's stated default.
export const DEFAULT_APPOINTMENTS_VIEW: AppointmentsView = {
  collapsed: false,
  toggledDays: [],
  showPast: false,
};

export function parseAppointmentsView(value: unknown): AppointmentsView {
  if (value === undefined || value === null) return DEFAULT_APPOINTMENTS_VIEW;

  const parsed = appointmentsViewSchema.safeParse(value);
  if (!parsed.success) {
    console.warn(
      `The saved My Appointments view ${JSON.stringify(value)} is not readable; opening the default.`,
    );
    return DEFAULT_APPOINTMENTS_VIEW;
  }
  return parsed.data;
}

export function isDayCollapsed(view: AppointmentsView, day: string): boolean {
  return view.collapsed !== view.toggledDays.includes(day);
}

export function toggleDay(
  view: AppointmentsView,
  day: string,
  daysOnScreen: readonly string[],
): AppointmentsView {
  const toggled = view.toggledDays.includes(day)
    ? view.toggledDays.filter((entry) => entry !== day)
    : [...view.toggledDays, day];

  return {
    ...view,
    toggledDays: toggled.filter((entry) => daysOnScreen.includes(entry)).slice(-MAX_TOGGLED_DAYS),
  };
}

export function setAllDays(view: AppointmentsView, collapsed: boolean): AppointmentsView {
  return { ...view, collapsed, toggledDays: [] };
}

export function setShowPast(view: AppointmentsView, showPast: boolean): AppointmentsView {
  return { ...view, showPast };
}
