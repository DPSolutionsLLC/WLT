import { describe, expect, it } from "vitest";
import {
  buildMyAppointments,
  groupByWardDay,
  hasStarted,
  type MyAppointmentSource,
} from "@/lib/appointments/myAppointments";

// One aggregation over the three sources (P5 slice c). Exact instants throughout, so the result
// cannot depend on the zone the test process runs in.

const DENVER = "America/Denver";

function visit(id: string, startsAt: string): MyAppointmentSource {
  return {
    kind: "visit",
    id,
    startsAt,
    allDay: false,
    title: `Visit ${id}`,
    detail: null,
    href: "/visits",
    viewState: "scheduled",
  };
}

function todo(id: string, startsAt: string): MyAppointmentSource {
  return {
    kind: "todo",
    id,
    startsAt,
    allDay: false,
    title: `To-do ${id}`,
    detail: null,
    href: `/todos#todo-${id}`,
    completed: false,
  };
}

function youth(id: string, startsAt: string, allDay = false): MyAppointmentSource {
  return {
    kind: "youth",
    id,
    startsAt,
    allDay,
    title: `Game ${id}`,
    detail: null,
    href: `/youth/events/${id}`,
  };
}

const ids = (list: readonly MyAppointmentSource[]) => list.map((source) => source.id);

describe("buildMyAppointments", () => {
  // Thursday 24 September 2026, noon in Denver.
  const asOf = new Date("2026-09-24T18:00:00.000Z");

  it("interleaves the three kinds in time order", () => {
    const { upcoming } = buildMyAppointments(
      [
        youth("game", "2026-09-26T01:30:00.000Z"),
        visit("visit", "2026-09-25T01:00:00.000Z"),
        todo("todo", "2026-09-25T20:00:00.000Z"),
      ],
      asOf,
      DENVER,
    );

    expect(ids(upcoming)).toEqual(["visit", "todo", "game"]);
  });

  it("puts the past most recent first, and drops nothing", () => {
    const sources = [
      visit("last-week", "2026-09-17T01:00:00.000Z"),
      todo("yesterday", "2026-09-23T20:00:00.000Z"),
      youth("two-weeks", "2026-09-10T01:30:00.000Z"),
      visit("tomorrow", "2026-09-25T20:00:00.000Z"),
    ];

    const { upcoming, past } = buildMyAppointments(sources, asOf, DENVER);

    expect(ids(past)).toEqual(["yesterday", "last-week", "two-weeks"]);
    expect(ids(upcoming)).toEqual(["tomorrow"]);
    expect(upcoming.length + past.length).toBe(sources.length);
  });

  // The user's rule walking scenario 077: nothing leaves today's list until the ward's day ends.
  it("keeps an item that started earlier today in upcoming, and marks it started", () => {
    const started = todo("started", "2026-09-24T17:59:00.000Z");
    const soon = todo("soon", "2026-09-24T18:01:00.000Z");
    const { upcoming, past } = buildMyAppointments([started, soon], asOf, DENVER);

    expect(ids(past)).toEqual([]);
    expect(ids(upcoming)).toEqual(["started", "soon"]);
    expect(hasStarted(started, asOf)).toBe(true);
    expect(hasStarted(soon, asOf)).toBe(false);
  });

  // 11pm Denver on the 24th is 05:00 UTC on the 25th. A UTC day would already call 7pm "yesterday".
  it("moves an evening item to past only once the ward's day has ended", () => {
    const evening = visit("evening", "2026-09-25T01:00:00.000Z");

    const lateSameNight = new Date("2026-09-25T05:00:00.000Z");
    expect(ids(buildMyAppointments([evening], lateSameNight, DENVER).upcoming)).toEqual(["evening"]);

    const nextMorning = new Date("2026-09-25T15:00:00.000Z");
    expect(ids(buildMyAppointments([evening], nextMorning, DENVER).past)).toEqual(["evening"]);
  });

  it("never marks an all-day item started on its own day", () => {
    expect(hasStarted(youth("t", "2026-09-24T06:00:00.000Z", true), asOf)).toBe(false);
  });

  // THE ZONE TRAP: an all-day tournament today in Denver is stored at Denver midnight. At 23:00
  // local — 05:00 UTC the next day — it is still today's event and must stay upcoming.
  it("keeps an all-day event upcoming until its ward day has ended", () => {
    const tournament = youth("tournament", "2026-09-24T06:00:00.000Z", true);
    const lateEvening = new Date("2026-09-25T05:00:00.000Z");

    expect(ids(buildMyAppointments([tournament], lateEvening, DENVER).upcoming)).toEqual([
      "tournament",
    ]);

    const nextMorning = new Date("2026-09-25T15:00:00.000Z");
    expect(ids(buildMyAppointments([tournament], nextMorning, DENVER).past)).toEqual([
      "tournament",
    ]);
  });

  it("orders two things at the same minute the same way every time", () => {
    const at = "2026-09-26T01:30:00.000Z";
    const first = buildMyAppointments([youth("b", at), todo("a", at), visit("c", at)], asOf, DENVER);
    const second = buildMyAppointments([visit("c", at), todo("a", at), youth("b", at)], asOf, DENVER);

    expect(ids(first.upcoming)).toEqual(ids(second.upcoming));
  });

  it("returns two empty lists for nothing", () => {
    expect(buildMyAppointments([], asOf, DENVER)).toEqual({ upcoming: [], past: [] });
  });
});

describe("groupByWardDay", () => {
  // 7:30pm Denver on the 25th is 01:30 UTC on the 26th; it must group with the 25th.
  it("groups by the ward's day, keeping the order it was given", () => {
    const days = groupByWardDay(
      [
        visit("a", "2026-09-25T15:00:00.000Z"),
        youth("b", "2026-09-26T01:30:00.000Z"),
        todo("c", "2026-09-26T16:00:00.000Z"),
      ],
      DENVER,
    );

    expect(days.map((group) => [group.day, ids(group.items)])).toEqual([
      ["2026-09-25", ["a", "b"]],
      ["2026-09-26", ["c"]],
    ]);
  });

  it("works on a most-recent-first list too", () => {
    const days = groupByWardDay(
      [todo("late", "2026-09-20T18:00:00.000Z"), todo("early", "2026-09-20T15:00:00.000Z"), todo("before", "2026-09-19T15:00:00.000Z")],
      DENVER,
    );

    expect(days.map((group) => group.day)).toEqual(["2026-09-20", "2026-09-19"]);
  });

  it("returns no days for nothing", () => {
    expect(groupByWardDay([], DENVER)).toEqual([]);
  });
});
