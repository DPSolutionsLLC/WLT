import { describe, expect, it } from "vitest";
import {
  DEFAULT_APPOINTMENTS_VIEW,
  isDayCollapsed,
  parseAppointmentsView,
  setAllDays,
  setShowPast,
  toggleDay,
} from "@/lib/appointments/appointmentsView";

// How My Appointments was left, so it reopens that way. A default plus exceptions, so "Collapse
// all" also covers days that appear next week.

const FRI = "2026-09-25";
const SAT = "2026-09-26";
const NEXT_WEEK = "2026-10-02";

describe("appointments view", () => {
  it("opens expanded with the past hidden by default", () => {
    expect(DEFAULT_APPOINTMENTS_VIEW).toEqual({ collapsed: false, toggledDays: [], showPast: false });
    expect(isDayCollapsed(DEFAULT_APPOINTMENTS_VIEW, FRI)).toBe(false);
  });

  it("collapses one day and opens it again", () => {
    const closed = toggleDay(DEFAULT_APPOINTMENTS_VIEW, FRI, [FRI, SAT]);
    expect(isDayCollapsed(closed, FRI)).toBe(true);
    expect(isDayCollapsed(closed, SAT)).toBe(false);

    const reopened = toggleDay(closed, FRI, [FRI, SAT]);
    expect(isDayCollapsed(reopened, FRI)).toBe(false);
    expect(reopened.toggledDays).toEqual([]);
  });

  it("keeps a day nobody has seen yet collapsed after Collapse all", () => {
    const all = setAllDays(toggleDay(DEFAULT_APPOINTMENTS_VIEW, FRI, [FRI]), true);
    expect(all.toggledDays).toEqual([]);
    expect(isDayCollapsed(all, NEXT_WEEK)).toBe(true);
  });

  it("opens one day inside a collapsed list", () => {
    const view = toggleDay(setAllDays(DEFAULT_APPOINTMENTS_VIEW, true), SAT, [FRI, SAT]);
    expect(isDayCollapsed(view, FRI)).toBe(true);
    expect(isDayCollapsed(view, SAT)).toBe(false);
  });

  it("forgets days that are no longer on screen, so the saved view cannot grow", () => {
    const old = { ...DEFAULT_APPOINTMENTS_VIEW, toggledDays: ["2026-01-01"] };
    expect(toggleDay(old, FRI, [FRI]).toggledDays).toEqual([FRI]);
  });

  it("remembers whether the past was showing", () => {
    expect(setShowPast(DEFAULT_APPOINTMENTS_VIEW, true).showPast).toBe(true);
  });

  it("falls back to the default for a saved value it cannot read", () => {
    expect(parseAppointmentsView(undefined)).toEqual(DEFAULT_APPOINTMENTS_VIEW);
    expect(parseAppointmentsView({ collapsed: "yes" })).toEqual(DEFAULT_APPOINTMENTS_VIEW);
    expect(parseAppointmentsView({ collapsed: true, toggledDays: [SAT], showPast: true })).toEqual({
      collapsed: true,
      toggledDays: [SAT],
      showPast: true,
    });
  });
});
