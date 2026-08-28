import {
  allDayInstant,
  resolveOccurrenceInstant,
  type IcsZone,
  type WallClock,
} from "@/lib/youth/ics/resolveInstant";

// The shapes the ICS import passes around, and the one function that turns an occurrence into an
// instant.
//
// ---------------------------------------------------------------------------
// WHY THIS IS NOT IN parseIcs.ts, WHERE IT WOULD OTHERWISE BELONG
// ---------------------------------------------------------------------------
// parseIcs.ts imports `node:crypto` and `ical.js`, which makes it SERVER-ONLY. buildImportPreview.ts
// needs `occurrenceInstant`, and IcsPreviewStep.tsx — a `"use client"` component — needs
// `countsFromPreview` out of buildImportPreview. A value import across that chain puts the whole
// of ical.js in the BROWSER BUNDLE.
//
// MEASURED, not assumed, on 2026-08-27: `.next/static` is 2,083,281 bytes with this split and
// 2,600,417 without it. Half a megabyte of recurrence expander shipped to a phone, for a page
// whose only use for it is four integers.
//
// THE BUILD DOES NOT FAIL. Next 16 shims `node:crypto` for the client rather than refusing, so
// `npm run build` succeeds either way and so does `tsc --noEmit`, and every unit test is green in
// both arrangements. There is no check in this repo that would catch the regression — only the
// bundle size, which nobody reads. That is why the reason is written down here.
//
// So the pure half lives here: types, plus arithmetic that only needs `Intl`. Nothing in this file
// may import ical.js, node:*, or anything that reads `next/headers`. parseIcs.ts re-exports the
// types so server code still has one obvious place to import from.

export type IcsProblem = {
  // THERE ARE NO ROW NUMBERS IN AN ICS FILE, so there is no `rowNumber` here, and inventing one
  // would be worse than having none — a number a user cannot find in their file is noise. The
  // summary is the thing they can search for.
  summary: string | null;
  message: string;
};

export type IcsOccurrence = {
  uid: string;
  // True when the VEVENT carried no UID and one was synthesised. Kept so the preview can say so,
  // and so a test can prove the same file synthesises the same value twice.
  uidWasSynthesised: boolean;
  // The occurrence's own DTSTART, rendered as a stable string, for an expanded series. Null for a
  // one-off. Together with (calendar_id, source_uid) this is the match key, and it is what stops
  // twelve weeks of practice collapsing onto one row.
  recurrenceId: string | null;
  summary: string;
  location: string | null;
  allDay: boolean;
  wallClock: WallClock;
  zone: IcsZone;
  // The ward's zone had to stand in — the file gave no zone, or gave one this system cannot
  // resolve. The preview says so per event rather than resolving silently (Decisions 1 and 2).
  usedWardZone: boolean;
  // The tzid the file asked for, when it asked for one this system could not resolve; null
  // otherwise. Carried so the problem can NAME the zone rather than say "a zone".
  unresolvedTzid: string | null;
};

// One occurrence's instant, used for the recurrence horizon in the parser and for the diff in the
// preview. It exists so the two cannot disagree about what a given occurrence means.
export function occurrenceInstant(occurrence: IcsOccurrence, wardTimeZone: string): Date {
  if (occurrence.allDay) return allDayInstant(occurrence.wallClock, wardTimeZone);

  return resolveOccurrenceInstant(occurrence.wallClock, occurrence.zone, wardTimeZone).instant;
}
