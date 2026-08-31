// @vitest-environment node
//
// The diff, over a fixture imported twice.
//
// ---------------------------------------------------------------------------
// THE THREE THINGS A RE-IMPORT MUST NOT DO
// ---------------------------------------------------------------------------
// Duplicate, revive, or destroy. This suite asserts the first and the third at the unit level,
// against buildImportPreview with a stubbed list of existing rows; tests/routes/
// youthCalendarImport.test.ts asserts them again against the database, where migration 055's
// unique index is the thing actually enforcing them.
//
// THE NAMED TRAP HAS ITS OWN TEST. `notInFile` computed over all time lists every past game the
// feed ever produced, because a season that ended is "absent from this file" in the same literal
// sense a cancelled game is. It is computed over the FILE'S OWN WINDOW instead, and the test
// below is what stops somebody simplifying that away.

import { describe, expect, it } from "vitest";
import { buildImportPreview, matchKey } from "@/lib/youth/ics/buildImportPreview";
import { occurrenceInstant, parseIcs, type IcsOccurrence } from "@/lib/youth/ics/parseIcs";
import type { ActivityEvent } from "@/lib/youth/queries";

const WARD_ZONE = "America/Denver";
const AS_OF = new Date("2026-12-01T00:00:00Z");
const CALENDAR_ID = "11111111-1111-4111-8111-111111111111";
const PROFILE_ID = "22222222-2222-4222-8222-222222222222";

// Stored as a person would type it — lib/ward/homeVenues.ts keeps the ward's own spelling and
// classifyEventLocation folds case on both sides. "Lincoln High" is the default location the
// `game()` helper writes, so every fixture game in this file classifies as `home`, which is what
// makes the guarantee below testable at all: a re-import that DID rewrite event_type would
// visibly turn a hand-corrected `away` back into `home`.
const HOME_VENUES = ["Lincoln High"];

function calendar(events: string[]): string {
  return [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//Lincoln High//Athletics//EN",
    ...events,
    "END:VCALENDAR",
  ].join("\n");
}

function game(uid: string | null, summary: string, dtstart: string, location = "Lincoln High") {
  return [
    "BEGIN:VEVENT",
    ...(uid === null ? [] : [`UID:${uid}`]),
    `SUMMARY:${summary}`,
    `DTSTART:${dtstart}`,
    `LOCATION:${location}`,
    "END:VEVENT",
  ].join("\n");
}

const JANUARY_FILE = calendar([
  game("g1@lincoln", "Game against Roosevelt", "20270115T023000Z"),
  game("g2@lincoln", "Game against Jefferson", "20270122T023000Z"),
  game("g3@lincoln", "Game against Madison", "20270129T023000Z"),
]);

function parse(text: string): IcsOccurrence[] {
  return parseIcs(text, { asOf: AS_OF, wardTimeZone: WARD_ZONE }).occurrences;
}

let nextId = 0;

// The rows the database would hold after importing `occurrences`. Built from the parse rather
// than written out by hand, so the fixture and the "already imported" state cannot drift apart —
// which is the only way this suite could pass while the real thing duplicates.
function asStoredEvents(occurrences: readonly IcsOccurrence[]): ActivityEvent[] {
  return occurrences.map((occurrence) => ({
    id: `stored-${(nextId += 1)}`,
    profileId: PROFILE_ID,
    calendarId: CALENDAR_ID,
    title: occurrence.summary,
    eventType: "tbd" as const,
    eventDate: occurrenceInstant(occurrence, WARD_ZONE).toISOString(),
    location: occurrence.location,
    status: "upcoming" as const,
    allDay: occurrence.allDay,
    sourceUid: occurrence.uid,
    sourceRecurrenceId: occurrence.recurrenceId,
    // Migration 059. Null means this game is only this young person's, which is what an import
    // writes: the ICS import deliberately creates no occasions (ITER-024, handed forward).
    occasionId: null,
    // Migration 061. Null on an imported row, and the import never writes it — a mark a person
    // made by hand survives every future import of the same file (Decision 6).
    youthAttended: null,
    createdAt: "2026-12-01T00:00:00.000Z",
  }));
}

function preview(
  text: string,
  existingEvents: readonly ActivityEvent[],
  homeVenues: readonly string[] = HOME_VENUES,
) {
  return buildImportPreview({
    occurrences: parse(text),
    problems: [],
    occurrencesDropped: 0,
    existingEvents,
    wardTimeZone: WARD_ZONE,
    homeVenues,
    fileHash: "0".repeat(64),
    calendarExists: existingEvents.length > 0,
    lastSyncedAt: null,
  });
}

describe("the same file, twice", () => {
  it("creates nothing, updates nothing, and counts everything as unchanged", () => {
    const stored = asStoredEvents(parse(JANUARY_FILE));
    const second = preview(JANUARY_FILE, stored);

    expect(second.toCreate).toEqual([]);
    expect(second.toUpdate).toEqual([]);
    expect(second.unchanged).toBe(3);
    expect(second.notInFile).toEqual([]);
  });

  it("creates everything on the first import", () => {
    const first = preview(JANUARY_FILE, []);

    expect(first.toCreate).toHaveLength(3);
    expect(first.unchanged).toBe(0);
    expect(first.notInFile).toEqual([]);
  });
});

describe("a game the school moved", () => {
  it("is exactly one update and zero creates", () => {
    const stored = asStoredEvents(parse(JANUARY_FILE));

    const moved = calendar([
      game("g1@lincoln", "Game against Roosevelt", "20270115T023000Z"),
      // Same UID, a week later.
      game("g2@lincoln", "Game against Jefferson", "20270129T023000Z"),
      game("g3@lincoln", "Game against Madison", "20270129T023000Z"),
    ]);

    const result = preview(moved, stored);

    expect(result.toCreate).toEqual([]);
    expect(result.toUpdate).toHaveLength(1);
    expect(result.toUpdate[0].changedFields).toEqual(["date and time"]);
    expect(result.unchanged).toBe(2);
    // The row it matched, not a replacement. The same id is what makes it an update.
    expect(result.toUpdate[0].existingId).toBe(
      stored.find((event) => event.sourceUid === "g2@lincoln")!.id,
    );
  });

  it("names which fields moved rather than only that something did", () => {
    const stored = asStoredEvents(parse(JANUARY_FILE));

    const renamed = calendar([
      game("g1@lincoln", "Game against Roosevelt High", "20270115T023000Z", "Roosevelt High"),
      game("g2@lincoln", "Game against Jefferson", "20270122T023000Z"),
      game("g3@lincoln", "Game against Madison", "20270129T023000Z"),
    ]);

    expect(preview(renamed, stored).toUpdate[0].changedFields).toEqual(["name", "where"]);
  });
});

describe("an event removed from the file", () => {
  it("is reported as notInFile and changes nothing else", () => {
    const stored = asStoredEvents(parse(JANUARY_FILE));

    const shortened = calendar([
      game("g1@lincoln", "Game against Roosevelt", "20270115T023000Z"),
      game("g3@lincoln", "Game against Madison", "20270129T023000Z"),
    ]);

    const result = preview(shortened, stored);

    expect(result.notInFile).toHaveLength(1);
    expect(result.notInFile[0].uid).toBe("g2@lincoln");
    // The half that matters: nothing else moved because of it.
    expect(result.toCreate).toEqual([]);
    expect(result.toUpdate).toEqual([]);
    expect(result.unchanged).toBe(2);
  });
});

describe("what notInFile must never contain", () => {
  it("excludes a hand-entered event inside the window", () => {
    const stored = asStoredEvents(parse(JANUARY_FILE));

    const handEntered: ActivityEvent = {
      id: "hand-entered",
      profileId: PROFILE_ID,
      // Null on both, exactly as createActivityEvent writes them. Either one alone would be
      // enough; both is what the route actually produces.
      calendarId: null,
      title: "Team dinner",
      eventType: "tbd",
      eventDate: "2027-01-20T02:00:00.000Z",
      location: null,
      status: "upcoming",
      allDay: false,
      sourceUid: null,
      sourceRecurrenceId: null,
      occasionId: null,
      youthAttended: null,
      createdAt: "2026-12-01T00:00:00.000Z",
    };

    const result = preview(JANUARY_FILE, [...stored, handEntered]);

    expect(result.notInFile).toEqual([]);
    expect(result.unchanged).toBe(3);
  });

  // THE NAMED TRAP. Computed over all time, every past game the feed ever produced would appear
  // here — and a leader reading "47 events are in the app and not in this file" would reasonably
  // assume something had gone wrong.
  it("excludes a past event outside the file's own window", () => {
    const stored = asStoredEvents(parse(JANUARY_FILE));

    const lastSeason: ActivityEvent = {
      ...stored[0],
      id: "last-season",
      title: "Last season's final",
      eventDate: "2026-03-01T02:30:00.000Z",
      sourceUid: "old@lincoln",
      sourceRecurrenceId: null,
    };

    const result = preview(JANUARY_FILE, [...stored, lastSeason]);

    expect(result.notInFile).toEqual([]);
    expect(result.windowStart).toBe("2027-01-15T02:30:00.000Z");
    expect(result.windowEnd).toBe("2027-01-29T02:30:00.000Z");
  });

  it("keeps the window open across a re-import, so a removed game is still found", () => {
    // The window is built from EVERY occurrence the file produced, matched ones included.
    // Building it from toCreate alone would collapse to nothing here and hide the removal.
    const stored = asStoredEvents(parse(JANUARY_FILE));

    const shortened = calendar([
      game("g1@lincoln", "Game against Roosevelt", "20270115T023000Z"),
      game("g3@lincoln", "Game against Madison", "20270129T023000Z"),
    ]);

    const result = preview(shortened, stored);

    expect(result.windowStart).toBe("2027-01-15T02:30:00.000Z");
    expect(result.notInFile.map((event) => event.uid)).toEqual(["g2@lincoln"]);
  });
});

describe("a VEVENT with no UID", () => {
  it("gets a synthesised one, and the same one on a second parse of the same file", () => {
    const text = calendar([game(null, "Booster meeting", "20270115T023000Z")]);

    const first = parse(text)[0];
    const second = parse(text)[0];

    expect(first.uidWasSynthesised).toBe(true);
    expect(first.uid.startsWith("wlt-synth-")).toBe(true);
    expect(second.uid).toBe(first.uid);
  });

  it("therefore matches itself on a re-import rather than duplicating", () => {
    const text = calendar([game(null, "Booster meeting", "20270115T023000Z")]);
    const stored = asStoredEvents(parse(text));

    const result = preview(text, stored);

    expect(result.toCreate).toEqual([]);
    expect(result.unchanged).toBe(1);
  });

  it("distinguishes two UID-less entries that differ only in time", () => {
    const first = parse(calendar([game(null, "Booster meeting", "20270115T023000Z")]))[0];
    const second = parse(calendar([game(null, "Booster meeting", "20270116T023000Z")]))[0];

    expect(second.uid).not.toBe(first.uid);
    expect(matchKey(second.uid, null)).not.toBe(matchKey(first.uid, null));
  });
});

// ---------------------------------------------------------------------------
// THE TWO DEFECTS THE SCENARIO 051/052 WALK FOUND, 2026-08-28
// ---------------------------------------------------------------------------
// Both were copy rather than correctness, and both are the kind of thing that only shows up when
// somebody reads the actual screen — which is exactly what the harness walk is for. These tests
// exist so neither can come back silently.
describe("what the preview tells the reader about zones and dates", () => {
  it("does not claim an all-day entry carried no time zone", () => {
    // youth-b-D1. The screen read "Fri, 5 Feb 2027, all day" and then, directly underneath,
    // "This entry carried no time zone, so it is shown in the ward's." An entry with no time has
    // no time to have assumed, so the note is noise exactly where the screen is reassuring.
    const text = calendar([
      [
        "BEGIN:VEVENT",
        "UID:tourney@lincoln",
        "SUMMARY:District Tournament",
        "DTSTART;VALUE=DATE:20270205",
        "END:VEVENT",
      ].join("\n"),
    ]);

    const result = preview(text, []);

    expect(result.toCreate).toHaveLength(1);
    expect(result.toCreate[0].allDay).toBe(true);
    expect(result.toCreate[0].usedWardZone).toBe(false);
  });

  it("still says so for a TIMED entry that carried no zone", () => {
    // The other half of the assertion, and the one that stops the fix from being "delete the
    // feature". A floating 6pm game genuinely was resolved in a zone somebody should be told about.
    const result = preview(
      calendar([game("floating@lincoln", "Scrimmage", "20270117T190000")]),
      [],
    );

    expect(result.toCreate[0].allDay).toBe(false);
    expect(result.toCreate[0].usedWardZone).toBe(true);
  });

  it("formats the last-imported date the same way as every other date on the screen", () => {
    // youth-b-D2. The client used a bare toLocaleDateString(), which renders `1/2/2027` under an
    // en-US locale — read as 1 February by everybody else, on the one screen whose entire job is
    // that dates are unambiguous. The server now formats it, so it cannot drift from the rest.
    const result = buildImportPreview({
      occurrences: parse(JANUARY_FILE),
      problems: [],
      occurrencesDropped: 0,
      existingEvents: [],
      wardTimeZone: WARD_ZONE,
      homeVenues: HOME_VENUES,
      fileHash: "0".repeat(64),
      calendarExists: true,
      lastSyncedAt: "2027-01-03T01:00:00+00:00",
    });

    expect(result.lastSyncedLocal).toBe("Sat, 2 Jan 2027");
    // Unambiguous: no all-numeric date anywhere in it.
    expect(result.lastSyncedLocal).not.toMatch(/^\d+\/\d+\/\d+$/);
    // And it reads like the event rows beside it.
    expect(result.toCreate[0].localTime).toContain("Jan 2027");
  });

  it("leaves lastSyncedLocal null when there is no feed yet", () => {
    expect(preview(JANUARY_FILE, []).lastSyncedLocal).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// SLICE C: A HAND-MADE HOME/AWAY CORRECTION SURVIVES EVERY FUTURE RE-IMPORT
// ---------------------------------------------------------------------------
// This is youth-b's Decision 6, and that decision was written ABOUT THIS SLICE, IN ADVANCE:
// "status and event_type are never touched on a matched row, so a hand-cancelled game and slice
// C's future home/away correction both survive."
//
// Slice C is the first thing that could break it — it is the change that starts writing
// `event_type` on an import at all. Without these cases nothing would notice: the preview would
// still show the right counts, the suite would still be green, and a leader's correction would be
// silently undone on the next import of an unchanged file.
describe("a hand-made classification survives a re-import", () => {
  it("does not list a corrected event as needing an update at all", () => {
    const stored = asStoredEvents(parse(JANUARY_FILE));
    // A leader looked at "Lincoln High" and knew it was the OTHER Lincoln — an away game. The
    // classifier would say `home`, because the location matches a configured venue.
    stored[0] = { ...stored[0], eventType: "away" };

    const second = preview(JANUARY_FILE, stored);

    // event_type is NOT one of the four writable columns, so a differing classification is not a
    // change at all — the row is unchanged, not updated-with-the-old-value.
    expect(second.toUpdate).toEqual([]);
    expect(second.unchanged).toBe(3);
  });

  it("reports the stored classification, not the file's, on a row that IS being updated", () => {
    const stored = asStoredEvents(parse(JANUARY_FILE));
    stored[0] = { ...stored[0], eventType: "away" };

    // The school moved the game, so this row genuinely does need updating — and the preview must
    // still say the home/away setting stays `away`. Showing the classifier's `home` here would be
    // the screen promising something the write path is forbidden from doing.
    const moved = calendar([
      game("g1@lincoln", "Game against Roosevelt", "20270116T023000Z"),
      game("g2@lincoln", "Game against Jefferson", "20270122T023000Z"),
      game("g3@lincoln", "Game against Madison", "20270129T023000Z"),
    ]);

    const second = preview(moved, stored);

    expect(second.toUpdate).toHaveLength(1);
    expect(second.toUpdate[0].existingEventType).toBe("away");
    expect(second.toUpdate[0].changedFields).toEqual(["date and time"]);
  });

  it("classifies a genuinely NEW occurrence from the ward's venues", () => {
    const first = preview(JANUARY_FILE, []);

    expect(first.toCreate.map((event) => event.eventType)).toEqual(["home", "home", "home"]);
  });

  it("leaves a new occurrence at an unknown venue for a person, never marking it away", () => {
    const elsewhere = calendar([
      game("g9@lincoln", "Game at Roosevelt", "20270205T023000Z", "Roosevelt High School"),
    ]);

    expect(preview(elsewhere, []).toCreate[0].eventType).toBe("tbd");
  });

  it("classifies everything as tbd when the ward has configured no venues", () => {
    const first = preview(JANUARY_FILE, [], []);

    expect(first.toCreate.map((event) => event.eventType)).toEqual(["tbd", "tbd", "tbd"]);
  });
});
