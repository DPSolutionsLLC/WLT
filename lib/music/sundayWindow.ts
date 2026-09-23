import type { DateOnly } from "@/lib/calendar/dates";
import type { SundayType } from "@/types/domain";

// WHICH SUNDAYS /music SHOWS, AND IN WHAT ORDER. One place, so the page and its tests cannot
// drift apart.
//
// ---------------------------------------------------------------------------
// THE INSERT IS THE WHOLE POINT
// ---------------------------------------------------------------------------
// /music is a rolling list of the next few Sundays, and the Sacrament hub deep-links a Sunday's
// Music pill into it. A pill reporting real, correct work on a Sunday a year out therefore used
// to land on a page that had never heard of it — that is defect 072-D1, found by walking
// scenario 072.
//
// `06910f8` closed it by replacing the rolling list with a month board and month navigation. The
// user reversed that on 2026-09-23 in favour of the prototype's own answer, which is this
// function: keep the rolling list, and INSERT the jumped-to Sunday into it in date order
// (module-map.md §6.2 item 6). A distant Sunday is reachable because the link puts it in the
// list, not because the reader navigated to its month.
//
// ---------------------------------------------------------------------------
// PURE: NO CLOCK, NO DATABASE
// ---------------------------------------------------------------------------
// No `new Date()` and no query. The caller supplies the candidates, exactly as
// lib/sacrament/sundayStatus.ts supplies its counts — which is what lets this be tested
// exhaustively and what stops a future clock making an assertion pass by accident.

// 8 IS DEFINED HERE AND NOWHERE ELSE, including in the scenarios, which reference this name
// rather than restating the number (plans/retros/notification-trigger-drift.md is what one fact
// living in several places costs).
//
// It is the prototype's own constant and is arbitrary — module-map.md §6.2 says WLT is free to
// change it, since a jumped-to date is reachable either way.
export const MUSIC_WINDOW_SUNDAYS = 8;

export function musicSundayWindow<
  T extends { id: string; date: DateOnly; type: SundayType },
>(candidates: readonly T[], openSundayId: string | null): readonly T[] {
  // The window is the HEAD of the list, so `candidates` must already be date-sorted and already
  // filtered to Sundays that hold a sacrament meeting. Both are the page's job — filtering here
  // would put a second definition of "has a meeting" next to holdsSacramentMeeting().
  const window = candidates.slice(0, MUSIC_WINDOW_SUNDAYS);

  if (openSundayId === null) return window;
  if (window.some((candidate) => candidate.id === openSundayId)) return window;

  // A jump matching nothing is IGNORED rather than refused. The id may be stale, may belong to
  // another ward — RLS already returned nothing for it — or may name a Sunday holding no meeting,
  // which the page filtered out. None of those is worth a 404 on a page the reader can still use.
  const jumped = candidates.find((candidate) => candidate.id === openSundayId);
  if (jumped === undefined) return window;

  // INSERTED BY DATE, NOT APPENDED AND NOT BY POSITION. The page merges a distant Sunday into the
  // candidates in its own query, and comparing dates here means the result is in order whether it
  // merged in place or appended. `DateOnly` is YYYY-MM-DD, so string order IS date order.
  const insertAt = window.findIndex((candidate) => candidate.date > jumped.date);

  return insertAt === -1
    ? [...window, jumped]
    : [...window.slice(0, insertAt), jumped, ...window.slice(insertAt)];
}
