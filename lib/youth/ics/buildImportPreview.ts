import { classifyEventLocation } from "@/lib/youth/classifyLocation";
import {
  occurrenceInstant,
  type IcsOccurrence,
  type IcsProblem,
} from "@/lib/youth/ics/occurrence";
import type { ActivityEvent } from "@/lib/youth/queries";
import type { EventType } from "@/types/domain";

// What the import WILL do, computed against what is already there.
//
// ---------------------------------------------------------------------------
// THE IMPORT ABOVE IS FROM occurrence.ts AND NOT FROM parseIcs.ts, DELIBERATELY
// ---------------------------------------------------------------------------
// IcsPreviewStep.tsx is a `"use client"` component and imports `countsFromPreview` from here, so a
// value import reaching parseIcs.ts puts the whole of ical.js in the browser bundle — measured at
// ~505KB of `.next/static`. It does NOT fail the build and it breaks no test, which is exactly why
// it is easy to undo by accident. occurrence.ts's header carries the numbers.
//
// ---------------------------------------------------------------------------
// THIS MODULE PERFORMS NO WRITE OF ANY KIND
// ---------------------------------------------------------------------------
// No insert, no update, no upsert, no rpc, no writeAuditLog. It does not even take a Supabase
// client — the caller hands it the rows it already read. A preview with a write path is a
// preview whose "nothing happened" guarantee has to be re-proved every time it changes; with no
// client in scope there is nothing to re-prove, and it can be read off the imports.
// lib/roster/csv/buildImportPreview.ts states the same guarantee for the roster.
//
// ---------------------------------------------------------------------------
// THE FOUR COUNTS ARE THE SAME FOUR THE RESULT SCREEN SHOWS
// ---------------------------------------------------------------------------
// roster-c's defect was a preview saying "6 to update" and a result saying "3 updated" — both
// numbers correct, the pairing wrong, and the user left believing something had been skipped. The
// defence is not a cleverer calculation; it is that `IcsImportPreview` and `IcsImportResult` use
// the SAME KEY NAMES for the same quantities, so the two screens render from one component and
// cannot drift.

export type PreviewEvent = {
  uid: string;
  recurrenceId: string | null;
  title: string;
  location: string | null;
  // The resolved instant, ISO. What gets written.
  eventDate: string;
  allDay: boolean;
  // THE HOUR, ALREADY FORMATTED. The single most important thing this screen does is let a leader
  // read "Fri 15 Jan 2027, 7:30pm" BEFORE confirming, rather than discovering the hour afterwards.
  // A raw ISO string on this screen would answer a different question from the one being asked.
  localTime: string;
  // The file gave no zone, or gave one this system could not resolve, so the ward's zone was used.
  // Shown per event, because a leader who can see which games were assumed can tell at a glance
  // whether the assumption was right (Decisions 1 and 2).
  usedWardZone: boolean;
  // HOME OR AWAY, ALREADY DECIDED, SO THE LEADER READS IT BEFORE CONFIRMING.
  //
  // On a row about to be CREATED this is classifyEventLocation()'s answer — `home` when the
  // location matches one of the ward's venues, `tbd` otherwise, and NEVER `away` (that function's
  // header argues why at length). On a row that already exists it is the row's stored value,
  // which is what will still be there afterwards.
  //
  // Showing it here is the reason the venue editor had to ship in the same slice: a preview that
  // said nothing about classification would leave a leader discovering it afterwards, which is
  // the same failure the localTime field exists to prevent for the hour.
  eventType: EventType;
};

export type PreviewEventChange = {
  event: PreviewEvent;
  // The row it matched, so the screen can show what is moving rather than only what it will be.
  existingId: string;
  existingTitle: string;
  existingLocalTime: string;
  changedFields: string[];
  // WHAT THE HOME/AWAY SETTING STAYS AS — never what the file would have made it.
  //
  // applyImport writes `event_type` on an INSERT ONLY; a matched row keeps whatever it has, which
  // is youth-b's Decision 6 and was written about this slice in advance. Without this field the
  // guarantee is invisible: a leader who corrected a classification last month has no way to see
  // that the correction survived, so the screen says so per row rather than in a footnote.
  existingEventType: EventType;
};

export type IcsImportPreview = {
  calendarExists: boolean;
  lastSyncedAt: string | null;
  // The same instant, formatted by the SAME function every other date on this screen goes
  // through. The client must render this and never re-derive it from `lastSyncedAt` — that is
  // what produced defect youth-b-D2.
  lastSyncedLocal: string | null;
  wardTimeZone: string;
  fileHash: string;
  toCreate: PreviewEvent[];
  toUpdate: PreviewEventChange[];
  unchanged: number;
  notInFile: PreviewEvent[];
  windowStart: string | null;
  windowEnd: string | null;
  problems: IcsProblem[];
  occurrencesDropped: number;
};

// The four numbers, and nothing else. `IcsImportResult` (applyImport.ts) carries the identical
// four so the preview screen and the result screen can render from one component.
export type IcsImportCounts = {
  toCreate: number;
  toUpdate: number;
  unchanged: number;
  notInFile: number;
};

export function countsFromPreview(preview: IcsImportPreview): IcsImportCounts {
  return {
    toCreate: preview.toCreate.length,
    toUpdate: preview.toUpdate.length,
    unchanged: preview.unchanged,
    notInFile: preview.notInFile.length,
  };
}

// THE MATCH KEY, IN ONE PLACE. Every occurrence carries a uid — synthesised deterministically
// when the file gave none, so there is exactly one rule here rather than the two
// 08-youth-activities.md proposed. The database's unique index
// (ward_id, calendar_id, source_uid, source_recurrence_id) is the same key, which is what makes
// this diff a description of what the database will do rather than a second opinion about it.
const KEY_SEPARATOR = String.fromCharCode(0);

export function matchKey(uid: string, recurrenceId: string | null): string {
  return `${uid}${KEY_SEPARATOR}${recurrenceId ?? ""}`;
}

// THE READER'S OWN ZONE IS NOT AVAILABLE ON THE SERVER, so the preview formats in the WARD'S
// zone and says which zone that is. That is the right answer here and not a compromise: the
// question a leader is asking on this screen is "will this game show at the hour the school
// published", and the school and the ward are in the same place.
//
// EventList.tsx formats the same instants in the READER'S zone once they are rows, which is also
// right — by then the question is "when do I have to turn up".
// EVERY DATE THIS SCREEN SHOWS COMES THROUGH ONE OF THESE TWO FUNCTIONS, and that is the fix for
// defect youth-b-D2. The "last imported" line used to be a bare `toLocaleDateString()` in the
// client, which rendered `1/2/2027` beside a dozen dates reading `Sat, 2 Jan 2027` — ambiguous to
// anybody outside the US, on the one screen whose entire job is that dates are not ambiguous.
const DATE_PARTS: Intl.DateTimeFormatOptions = {
  weekday: "short",
  day: "numeric",
  month: "short",
  year: "numeric",
};

function formatDate(instant: Date, timeZone: string): string {
  return new Intl.DateTimeFormat("en-GB", { timeZone, ...DATE_PARTS }).format(instant);
}

function formatLocal(instant: Date, timeZone: string, allDay: boolean): string {
  if (allDay) return `${formatDate(instant, timeZone)}, all day`;

  return new Intl.DateTimeFormat("en-GB", {
    timeZone,
    ...DATE_PARTS,
    hour: "numeric",
    minute: "2-digit",
  }).format(instant);
}

function toPreviewEvent(
  occurrence: IcsOccurrence,
  instant: Date,
  wardTimeZone: string,
  homeVenues: readonly string[],
): PreviewEvent {
  return {
    uid: occurrence.uid,
    recurrenceId: occurrence.recurrenceId,
    title: occurrence.summary,
    location: occurrence.location,
    eventDate: instant.toISOString(),
    allDay: occurrence.allDay,
    localTime: formatLocal(instant, wardTimeZone, occurrence.allDay),
    // FALSE FOR AN ALL-DAY ENTRY, ALWAYS — defect youth-b-D1, found by walking scenario 051.
    //
    // The occurrence's own flag is true and correctly so: ward midnight IS the ward's zone. But
    // this field exists for one purpose, which is deciding whether to TELL the reader a zone was
    // assumed, and an entry with no time has no time to have assumed. The screen was rendering
    // "Fri, 5 Feb 2027, all day" and then "This entry carried no time zone, so it is shown in the
    // ward's" directly underneath it.
    //
    // Corrected here rather than at the render site, so a second reader of this field cannot
    // reintroduce the same sentence somewhere else.
    usedWardZone: occurrence.allDay ? false : occurrence.usedWardZone,
    // Classified from the LOCATION TEXT and nothing else. This function reads no time, which is
    // what keeps ICAL.Time.toJSDate() out of the classification path — occurrenceInstant() above
    // is the one place an instant is resolved (lib/youth/ics/resolveInstant.ts).
    eventType: classifyEventLocation(occurrence.location, homeVenues),
  };
}

function existingAsPreviewEvent(event: ActivityEvent, wardTimeZone: string): PreviewEvent {
  const instant = new Date(event.eventDate);

  return {
    uid: event.sourceUid ?? "",
    recurrenceId: event.sourceRecurrenceId,
    title: event.title,
    location: event.location,
    eventDate: event.eventDate,
    allDay: event.allDay,
    localTime: formatLocal(instant, wardTimeZone, event.allDay),
    usedWardZone: false,
    // The STORED value, not a re-classification. This shape describes a row that already exists,
    // and re-running the classifier over it would show a leader a home/away the import is
    // forbidden from writing.
    eventType: event.eventType,
  };
}

// Which of the four writable columns actually differ. Named rather than counted, because "the
// school moved the game" and "the school renamed the game" are different things to a leader and
// the screen should say which happened.
function changedFields(existing: ActivityEvent, next: PreviewEvent): string[] {
  const changed: string[] = [];

  if (existing.title !== next.title) changed.push("name");
  if (new Date(existing.eventDate).getTime() !== new Date(next.eventDate).getTime()) {
    changed.push("date and time");
  }
  if ((existing.location ?? null) !== next.location) changed.push("where");
  if (existing.allDay !== next.allDay) changed.push("all day");

  return changed;
}

export type BuildImportPreviewInput = {
  occurrences: readonly IcsOccurrence[];
  problems: readonly IcsProblem[];
  occurrencesDropped: number;
  // Every event this profile's ICS calendar has already produced, read by the CALLER with the
  // caller's own client so RLS decided. Hand-entered events are absent by construction: they
  // carry a null calendar_id and the caller filters on the calendar.
  existingEvents: readonly ActivityEvent[];
  // The ward's own venues, already trimmed and lower-cased by lib/ward/homeVenues.ts. An empty
  // list is the ordinary state of a ward that has not configured one, and it means every new
  // occurrence previews as "Home or away?" — which is the loud, correct answer rather than a
  // guess.
  homeVenues: readonly string[];
  wardTimeZone: string;
  fileHash: string;
  calendarExists: boolean;
  lastSyncedAt: string | null;
};

export function buildImportPreview(input: BuildImportPreviewInput): IcsImportPreview {
  const { occurrences, existingEvents, wardTimeZone, homeVenues } = input;

  const existingByKey = new Map<string, ActivityEvent>();
  for (const event of existingEvents) {
    // A row with no source_uid was typed in by a person. It cannot match anything in a file and
    // must never be updated by one, so it never enters the index at all.
    if (event.sourceUid === null) continue;
    existingByKey.set(matchKey(event.sourceUid, event.sourceRecurrenceId), event);
  }

  const toCreate: PreviewEvent[] = [];
  const toUpdate: PreviewEventChange[] = [];
  const seenKeys = new Set<string>();

  let unchanged = 0;
  let earliest: number | null = null;
  let latest: number | null = null;

  for (const occurrence of occurrences) {
    const instant = occurrenceInstant(occurrence, wardTimeZone);
    const previewEvent = toPreviewEvent(occurrence, instant, wardTimeZone, homeVenues);
    const key = matchKey(occurrence.uid, occurrence.recurrenceId);

    // THE WINDOW IS THE FILE'S OWN SPAN, and it is built from every occurrence the file produced
    // — including ones that matched. Building it from `toCreate` alone would collapse to nothing
    // on a re-import of an unchanged file, and `notInFile` would then be empty for the wrong
    // reason.
    const time = instant.getTime();
    earliest = earliest === null ? time : Math.min(earliest, time);
    latest = latest === null ? time : Math.max(latest, time);

    // A file that names the same occurrence twice is a real thing (a feed exported mid-edit).
    // The second copy is neither a create nor an update — the database's unique index would
    // refuse it — so it is simply not counted twice.
    if (seenKeys.has(key)) continue;
    seenKeys.add(key);

    const existing = existingByKey.get(key);

    if (existing === undefined) {
      toCreate.push(previewEvent);
      continue;
    }

    const changed = changedFields(existing, previewEvent);

    if (changed.length === 0) {
      unchanged += 1;
      continue;
    }

    toUpdate.push({
      event: previewEvent,
      existingId: existing.id,
      existingTitle: existing.title,
      existingLocalTime: formatLocal(new Date(existing.eventDate), wardTimeZone, existing.allDay),
      changedFields: changed,
      existingEventType: existing.eventType,
    });
  }

  // ---------------------------------------------------------------------------
  // WHAT IS IN THE APP AND NOT IN THE FILE — AND THE TRAP IN COMPUTING IT
  // ---------------------------------------------------------------------------
  // Computed ONLY over [windowStart, windowEnd], the span the file itself covers. Over all time it
  // would list every past game the feed has ever produced, because recurrence is expanded roughly
  // twelve months ahead and a season that ended is "absent from the file" in the same literal
  // sense a cancelled game is. That is pre-planning Decision 3's named trap.
  //
  // Rows with a null source_uid are excluded entirely, above: they were never expected to be in
  // the file.
  //
  // NOTHING IS DONE WITH THIS LIST. The confirm performs no deletes and no status changes — a feed
  // that briefly publishes a short file must not be able to cancel a season. The list exists so
  // the preview can SAY SO by name, which is what makes the guarantee legible rather than
  // theoretical.
  const notInFile: PreviewEvent[] = [];

  if (earliest !== null && latest !== null) {
    for (const event of existingEvents) {
      if (event.sourceUid === null) continue;

      const key = matchKey(event.sourceUid, event.sourceRecurrenceId);
      if (seenKeys.has(key)) continue;

      const time = new Date(event.eventDate).getTime();
      if (!Number.isFinite(time) || time < earliest || time > latest) continue;

      notInFile.push(existingAsPreviewEvent(event, wardTimeZone));
    }
  }

  return {
    calendarExists: input.calendarExists,
    lastSyncedAt: input.lastSyncedAt,
    lastSyncedLocal:
      input.lastSyncedAt === null
        ? null
        : formatDate(new Date(input.lastSyncedAt), wardTimeZone),
    wardTimeZone,
    fileHash: input.fileHash,
    toCreate,
    toUpdate,
    unchanged,
    notInFile,
    windowStart: earliest === null ? null : new Date(earliest).toISOString(),
    windowEnd: latest === null ? null : new Date(latest).toISOString(),
    problems: [...input.problems],
    occurrencesDropped: input.occurrencesDropped,
  };
}
