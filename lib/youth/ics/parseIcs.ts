import { createHash } from "node:crypto";
import ICAL from "ical.js";
import {
  MAX_ICS_EVENTS,
  MAX_OCCURRENCES_PER_SERIES,
  RECURRENCE_HORIZON_MONTHS,
} from "@/lib/youth/ics/limits";
import {
  occurrenceInstant,
  type IcsOccurrence,
  type IcsProblem,
} from "@/lib/youth/ics/occurrence";
import {
  resolveOccurrenceInstant,
  type IcsZone,
  type WallClock,
} from "@/lib/youth/ics/resolveInstant";

// The ICS file, turned into a bounded list of occurrences. NOTHING HERE PRODUCES A `Date` FOR AN
// OCCURRENCE — the wall clock and the zone name travel separately, and
// lib/youth/ics/resolveInstant.ts is the single place they become an instant. Its header explains
// why `ICAL.Time.toJSDate()` is never called anywhere in this slice.
//
// SERVER-ONLY: node:crypto, for the synthesised UID below.
//
// ---------------------------------------------------------------------------
// THE ical.js v2 API, VERIFIED AGAINST THE INSTALLED PACKAGE
// ---------------------------------------------------------------------------
// The project wiki's example (`new ICAL.Component(jCalData[1])`) is the 1.x API, where `parse`
// returned a tuple. v2 returns the jCal array itself, so it is
// `new ICAL.Component(ICAL.parse(text))`. That was read off node_modules/ical.js/dist/types/ and
// confirmed by running it, not taken from a blog post.
//
// `ICAL.parse` also returns an ARRAY OF jCal objects when a file holds more than one VCALENDAR,
// which some school exports do. The two shapes are told apart by whether the first element is the
// component name string.
//
// ---------------------------------------------------------------------------
// TimezoneService IS PROCESS-GLOBAL
// ---------------------------------------------------------------------------
// Registrations made while parsing one upload are visible to the next request in the same worker.
// Every VTIMEZONE in the file is registered under ITS OWN tzid and nothing else is mutated, so the
// worst case is that a later file referencing `TZID=America/Denver` without defining it resolves
// against an earlier file's definition of the same zone — which is the same zone.
//
// Our own arithmetic never consults this registry at all; resolveInstant.ts asks `Intl`. The
// registration exists so that ical.js compares an RRULE's `UNTIL` (always UTC) against zoned
// occurrences correctly while expanding.

// The types and `occurrenceInstant` live in lib/youth/ics/occurrence.ts, NOT here. This module
// imports node:crypto and ical.js, so anything a `"use client"` component can reach through
// buildImportPreview.ts has to sit outside it or ~505KB of ical.js ships to the browser — see
// that file's header for the measurement, and for why no check in this repo would catch it.
// Re-exported so server code still has one obvious place to import from.
export { occurrenceInstant, type IcsOccurrence, type IcsProblem };

export type ParseIcsOptions = {
  // The clock enters as a PARAMETER, never as `new Date()` inside. One import judges every
  // occurrence against one instant, and a test can pin it — the same rule listActivityEvents and
  // lib/visits/progress.ts follow.
  asOf: Date;
  wardTimeZone: string;
};

export type ParseIcsResult = {
  occurrences: IcsOccurrence[];
  problems: IcsProblem[];
  // How many occurrences MAX_ICS_EVENTS cut. Reported rather than dropped silently: a silent cap
  // reads as "your file only had 500 events" (limits.ts).
  occurrencesDropped: number;
};

// A whole-file refusal, with a sentence. Never a 500 — a malformed upload is the uploader's
// problem to fix, and the message has to name what to do about it.
export class IcsParseError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "IcsParseError";
  }
}

export function isIcsParseError(error: unknown): error is IcsParseError {
  return error instanceof IcsParseError;
}

// The precedent is parseDocument() refusing a PDF under ~200 characters (CLAUDE.md §9): a file
// that yields nothing useful fails at upload, naming the likely cause, rather than becoming an
// import of zero events that reads as a success.
const NO_EVENTS_MESSAGE =
  "That file has no events in it. Export the calendar again, or check you picked the schedule " +
  "rather than a subscription link.";

function twoDigits(value: number): string {
  return String(value).padStart(2, "0");
}

// `20270115T193000`, or `20270123` for a date-only entry. Deliberately the ICS spelling of the
// occurrence's own DTSTART rather than an ISO instant: it is stable regardless of what zone
// anything resolves in, which is the property a match key needs.
function renderRecurrenceId(wall: WallClock, allDay: boolean): string {
  const date = `${wall.year}${twoDigits(wall.month)}${twoDigits(wall.day)}`;
  if (allDay) return date;

  return `${date}T${twoDigits(wall.hour)}${twoDigits(wall.minute)}${twoDigits(wall.second)}`;
}

// 08-youth-activities.md says "match on UID where present, else title + date". TWO RULES IS TWO
// CODE PATHS THAT CAN DISAGREE, so instead the fallback rule is applied HERE, once, and the match
// key downstream is always (calendar_id, source_uid, source_recurrence_id).
//
// Deterministic on purpose: the same file parsed next month must synthesise the same value, or
// re-importing it would create every UID-less event a second time.
function synthesiseUid(summary: string, dtstartRaw: string): string {
  const digest = createHash("sha256").update(`${summary} ${dtstartRaw}`, "utf8").digest("hex");
  return `wlt-synth-${digest.slice(0, 32)}`;
}

function wallClockOf(time: ICAL.Time): WallClock {
  return {
    year: time.year,
    month: time.month,
    day: time.day,
    hour: time.hour,
    minute: time.minute,
    second: time.second,
  };
}

// The zone comes from the DTSTART PROPERTY's `TZID` parameter first, because that parameter
// survives even when ical.js could not resolve the zone: an unregistered `TZID=Mars/Olympus`
// leaves `time.zone` reading "floating" while the parameter still says what the file asked for.
// Reading the parameter is what makes Decision 2's "report the zone it asked for" possible at all.
function zoneOf(property: ICAL.Property, time: ICAL.Time): IcsZone {
  const parameter = property.getParameter("tzid");
  const tzid = Array.isArray(parameter) ? parameter[0] : parameter;

  if (typeof tzid === "string" && tzid.trim() !== "") {
    return { kind: "named", tzid: tzid.trim() };
  }

  if (time.zone?.tzid === "UTC") return { kind: "utc" };

  return { kind: "floating" };
}

function textOf(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed === "" ? null : trimmed;
}

function horizonEnd(asOf: Date): Date {
  const end = new Date(asOf.getTime());
  end.setUTCMonth(end.getUTCMonth() + RECURRENCE_HORIZON_MONTHS);
  return end;
}

type BuildOccurrenceArgs = {
  uid: string;
  uidWasSynthesised: boolean;
  summary: string;
  location: string | null;
  time: ICAL.Time;
  zone: IcsZone;
  recurring: boolean;
  wardTimeZone: string;
};

function buildOccurrence(args: BuildOccurrenceArgs): IcsOccurrence {
  const wallClock = wallClockOf(args.time);
  const allDay = args.time.isDate === true;

  // An all-day entry is ward midnight by definition, so the file's own zone never applies to it
  // and `usedWardZone` is true by construction rather than by resolution.
  const resolved = allDay
    ? { usedWardZone: true }
    : resolveOccurrenceInstant(wallClock, args.zone, args.wardTimeZone);

  return {
    uid: args.uid,
    uidWasSynthesised: args.uidWasSynthesised,
    recurrenceId: args.recurring ? renderRecurrenceId(wallClock, allDay) : null,
    summary: args.summary,
    location: args.location,
    allDay,
    wallClock,
    zone: allDay ? { kind: "floating" } : args.zone,
    usedWardZone: resolved.usedWardZone,
    unresolvedTzid:
      !allDay && args.zone.kind === "named" && resolved.usedWardZone ? args.zone.tzid : null,
  };
}

function registerFileTimezones(calendar: ICAL.Component): void {
  for (const vtimezone of calendar.getAllSubcomponents("vtimezone")) {
    const tzid = vtimezone.getFirstPropertyValue("tzid");
    if (typeof tzid !== "string" || tzid.trim() === "") continue;

    try {
      ICAL.TimezoneService.register(vtimezone);
    } catch (error) {
      // A VTIMEZONE this library refuses is not a reason to refuse the file: resolveInstant.ts
      // asks Intl, and Intl knows every IANA zone a school feed is going to name. Logged with the
      // reason in the MESSAGE so a genuinely odd feed leaves a trace Next's dev logger renders.
      const description = error instanceof Error ? error.message : String(error);
      console.warn(`Ignoring a VTIMEZONE this file defines for ${tzid} — ${description}`);
    }
  }
}

function calendarComponents(text: string): ICAL.Component[] {
  let parsed: unknown;

  try {
    parsed = ICAL.parse(text);
  } catch (error) {
    // ical.js raises here for a malformed line AND for an RRULE it cannot read — a bad FREQ fails
    // the whole parse rather than one VEVENT. That is why "a recurrence rule this app cannot
    // read" is a file-level sentence in this slice rather than a per-event problem.
    const description = error instanceof Error ? error.message : String(error);
    console.error(`Could not parse an uploaded ICS file — ${description}`);

    throw new IcsParseError(
      "That calendar file could not be read. Export it again from the school or league " +
        "calendar — the copy you have is incomplete, edited, or not a calendar file.",
    );
  }

  if (!Array.isArray(parsed)) throw new IcsParseError(NO_EVENTS_MESSAGE);

  // A single jCal object is `["vcalendar", [...], [...]]`; a file holding two VCALENDARs parses to
  // a list of those. The first element being a string is what tells them apart.
  const documents = typeof parsed[0] === "string" ? [parsed] : (parsed as unknown[]);

  return documents.map((document) => new ICAL.Component(document as never));
}

export function parseIcs(text: string, options: ParseIcsOptions): ParseIcsResult {
  const { asOf, wardTimeZone } = options;

  const problems: IcsProblem[] = [];
  const occurrences: IcsOccurrence[] = [];
  const horizon = horizonEnd(asOf);

  let occurrencesDropped = 0;
  let sawAnyEvent = false;

  const push = (occurrence: IcsOccurrence): void => {
    if (occurrences.length >= MAX_ICS_EVENTS) {
      occurrencesDropped += 1;
      return;
    }

    occurrences.push(occurrence);
  };

  for (const calendar of calendarComponents(text)) {
    registerFileTimezones(calendar);

    for (const vevent of calendar.getAllSubcomponents("vevent")) {
      const summary = textOf(vevent.getFirstPropertyValue("summary")) ?? "Untitled event";
      const location = textOf(vevent.getFirstPropertyValue("location"));

      sawAnyEvent = true;

      // The PROPERTY, not `ICAL.Event.startDate`: the property is what carries the TZID
      // parameter, and `startDate` would already have resolved the zone for us — through the
      // process's own local zone, which is the bug this whole slice is arranged around.
      const dtstartProperty = vevent.getFirstProperty("dtstart");

      if (dtstartProperty === null) {
        problems.push({
          summary,
          message: "This entry has no start date, so there is nothing to put on a schedule.",
        });
        continue;
      }

      const dtstart = dtstartProperty.getFirstValue();

      if (!(dtstart instanceof ICAL.Time)) {
        problems.push({
          summary,
          message: "This entry's start date could not be read, so it was not imported.",
        });
        continue;
      }

      const zone = zoneOf(dtstartProperty, dtstart);
      const rawUid = textOf(vevent.getFirstPropertyValue("uid"));
      const uid = rawUid ?? synthesiseUid(summary, dtstartProperty.toICALString());

      const shared = {
        uid,
        uidWasSynthesised: rawUid === null,
        summary,
        location,
        zone,
        recurring: vevent.getFirstProperty("rrule") !== null,
        wardTimeZone,
      };

      if (!shared.recurring) {
        push(buildOccurrence({ ...shared, time: dtstart }));
        continue;
      }

      // RecurExpansion handles EXDATE and RDATE. The loop's OWN bound is what handles an RRULE
      // with neither UNTIL nor COUNT, which is infinite by definition: it stops at the first of
      // the horizon, MAX_OCCURRENCES_PER_SERIES, or the iterator running out.
      try {
        const expansion = new ICAL.RecurExpansion({ component: vevent, dtstart });

        let produced = 0;
        let next = expansion.next();

        while (next) {
          if (produced >= MAX_OCCURRENCES_PER_SERIES) {
            problems.push({
              summary,
              message:
                `This repeats more than ${MAX_OCCURRENCES_PER_SERIES} times. The first ` +
                `${MAX_OCCURRENCES_PER_SERIES} were read; the rest were not.`,
            });
            break;
          }

          const occurrence = buildOccurrence({ ...shared, time: next });

          if (occurrenceInstant(occurrence, wardTimeZone) > horizon) break;

          push(occurrence);
          produced += 1;
          next = expansion.next();
        }
      } catch (error) {
        const description = error instanceof Error ? error.message : String(error);
        console.warn(`Could not expand a recurring ICS event — ${description}`);

        problems.push({
          summary,
          message:
            "This event repeats on a rule this app could not read, so nothing was taken from " +
            "it. Add it by hand, or export the calendar again.",
        });
      }
    }
  }

  if (!sawAnyEvent) throw new IcsParseError(NO_EVENTS_MESSAGE);

  return { occurrences, problems, occurrencesDropped };
}
