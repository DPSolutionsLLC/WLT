// @vitest-environment node
//
// PURE, plus one test that reads a migration file off disk — which is why this runs in node
// rather than jsdom.
//
// No database, no model, no network. Everything here is a function of its arguments.

import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  RECENCY_OPTIONS,
  SPEAKER_ROLES,
  SPEAKER_ROLE_LABELS,
  formatConferenceDate,
  isSpeakerRole,
  parseConferenceDate,
  recencyLabel,
  resolveSinceDate,
} from "@/lib/knowledge/conferenceMetadata";

describe("the speaker role vocabulary", () => {
  // THE HIGHEST-VALUE TEST IN THIS FILE, and it is worth explaining why a "trivial" list
  // comparison earns a place.
  //
  // SPEAKER_ROLES is what the upload form offers, what the resolver's prompt teaches the model,
  // and what every filter is built from. Migration 033's CHECK constraint is what the database
  // will actually accept. If those two lists drift, the failure is a 400 arriving from Postgres
  // with a constraint name in it — at upload time, or worse at accept time after somebody has
  // read and approved a filter. Nothing in the UI could diagnose it.
  //
  // Read from the migration TEXT rather than duplicated here, because a copy of the list in this
  // file could drift from the constraint in exactly the same way.
  it("matches migration 033's CHECK constraint exactly", () => {
    const migration = readFileSync(
      path.resolve(process.cwd(), "supabase/migrations/033_knowledge_metadata.sql"),
      "utf8",
    );

    const constraint = /speaker_role in \(([^)]+)\)/.exec(migration);
    expect(constraint).not.toBeNull();

    const allowed = [...constraint![1].matchAll(/'([a-z_]+)'/g)].map((match) => match[1]);

    expect([...allowed].sort()).toEqual([...SPEAKER_ROLES].sort());
  });

  it("gives every role a label, so none renders as raw snake_case", () => {
    for (const role of SPEAKER_ROLES) {
      expect(SPEAKER_ROLE_LABELS[role]).toBeTruthy();
      expect(SPEAKER_ROLE_LABELS[role]).not.toContain("_");
    }
  });

  it("recognises its own roles and rejects anything else", () => {
    expect(isSpeakerRole("apostle")).toBe(true);
    expect(isSpeakerRole("bishop")).toBe(false);
    expect(isSpeakerRole("")).toBe(false);
  });
});

describe("parseConferenceDate", () => {
  it("reads a month and year the way a person would type it", () => {
    expect(parseConferenceDate("April 2026")).toBe("2026-04-01");
    expect(parseConferenceDate("October 2019")).toBe("2019-10-01");
  });

  it("is case and whitespace insensitive", () => {
    expect(parseConferenceDate("  april 2026 ")).toBe("2026-04-01");
    expect(parseConferenceDate("APRIL 2026")).toBe("2026-04-01");
  });

  it("reads an ISO year-month", () => {
    expect(parseConferenceDate("2026-04")).toBe("2026-04-01");
  });

  it("NORMALISES a full date to the first of its month", () => {
    // Two talks from one conference entered as the 4th and the 5th must answer a
    // `>= 2026-04-01` filter identically. That is not a distinction anybody typing a conference
    // date meant to draw, and leaving it in would make a recency filter behave differently for
    // two rows from the same weekend.
    expect(parseConferenceDate("2026-04-04")).toBe("2026-04-01");
    expect(parseConferenceDate("2026-04-30")).toBe("2026-04-01");
  });

  it("NEVER THROWS, and returns null for anything it cannot read", () => {
    // It is fed by a text input and by a manifest file, and both callers are ready to say
    // something useful about null. A parser that throws on "Aprol 2026" turns a typo into a
    // stack trace.
    for (const input of ["Aprol 2026", "", "   ", "next spring", "2026", "2026-13", "13/04/26"]) {
      expect(() => parseConferenceDate(input)).not.toThrow();
      expect(parseConferenceDate(input)).toBeNull();
    }
  });

  it("rejects a month that does not exist", () => {
    expect(parseConferenceDate("2026-00")).toBeNull();
    expect(parseConferenceDate("2026-99")).toBeNull();
  });
});

describe("formatConferenceDate", () => {
  it("renders the stored date as a conference a person would name", () => {
    expect(formatConferenceDate("2026-04-01")).toBe("April 2026");
    expect(formatConferenceDate("2019-10-01")).toBe("October 2019");
  });

  it("reads the date in UTC, not local time", () => {
    // The whole reason lib/calendar/dates.ts exists. A date-only string read back in local time
    // lands a day early anywhere west of UTC — and one day early on the 1st of the month is one
    // MONTH early on screen, which is the version of this bug somebody would actually notice.
    expect(formatConferenceDate("2026-01-01")).toBe("January 2026");
    expect(formatConferenceDate("2026-12-01")).toBe("December 2026");
  });

  it("falls back to the raw value rather than throwing on something unexpected", () => {
    expect(formatConferenceDate("not-a-date")).toBe("not-a-date");
  });
});

describe("resolveSinceDate", () => {
  it("returns null for no limit, which filters nothing", () => {
    // null is NOT zero. A zero-year limit would forbid every talk; null must reach the database
    // as "this axis is unfiltered".
    expect(resolveSinceDate(null, "2026-08-24")).toBeNull();
  });

  it("counts back whole years and lands on a month start", () => {
    expect(resolveSinceDate(2, "2026-08-24")).toBe("2024-08-01");
    expect(resolveSinceDate(5, "2026-08-24")).toBe("2021-08-01");
    expect(resolveSinceDate(10, "2026-08-24")).toBe("2016-08-01");
  });

  it("is stable across a leap day", () => {
    expect(resolveSinceDate(1, "2024-02-29")).toBe("2023-02-01");
  });

  it("takes today as an argument, so it is testable without freezing a clock", () => {
    // Relative recency is resolved at RETRIEVAL time and never at save time — that is why the
    // setting stores a number of years. Pinning the date when the ward pressed Save would make
    // "the last two years" drift a month further from the truth every month.
    expect(resolveSinceDate(2, "2027-01-15")).toBe("2025-01-01");
    expect(resolveSinceDate(2, "2026-01-15")).toBe("2024-01-01");
  });
});

describe("RECENCY_OPTIONS", () => {
  it("offers no limit as the first and default choice", () => {
    // A ward that has never opened the scope panel must retrieve exactly what it retrieved
    // before ai-d shipped.
    expect(RECENCY_OPTIONS[0].years).toBeNull();
  });

  it("names each option distinctly", () => {
    const labels = RECENCY_OPTIONS.map((option) => option.label);
    expect(new Set(labels).size).toBe(labels.length);
  });

  it("labels a known option and falls back for an unknown one", () => {
    expect(recencyLabel(null)).toBe("No limit");
    expect(recencyLabel(2)).toBe("Last 2 years");
    expect(recencyLabel(7)).toBe("Last 7 years");
  });
});
