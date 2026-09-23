import { describe, expect, it } from "vitest";
import {
  HYMNS_PER_SUNDAY,
  PRAYERS_PER_SUNDAY,
  pillStatus,
  sundayHasPills,
  sundayPills,
  type SundayPill,
  type SundayPillKey,
  type SundayStatusAssignment,
  type SundayStatusInput,
} from "@/lib/sacrament/sundayStatus";
import { SUNDAY_TYPES } from "@/types/domain";

// The one definition of every count on the Sacrament hub. Table-driven, per CLAUDE.md §8's
// priority 4 — a pure function is cheap to test and this one decides six numbers a leader reads
// as the state of a Sunday.

function input(overrides: Partial<SundayStatusInput> = {}): SundayStatusInput {
  return {
    speakingSlots: 3,
    assignments: [],
    prayers: [],
    hymnSelectionCount: 0,
    ...overrides,
  };
}

function assignment(
  overrides: Partial<SundayStatusAssignment> = {},
): SundayStatusAssignment {
  return {
    topicId: null,
    memberId: null,
    externalSpeakerName: null,
    stage: "plan",
    ...overrides,
  };
}

function pillFor(pills: readonly SundayPill[], key: SundayPillKey): SundayPill {
  const found = pills.find((pill) => pill.key === key);
  if (found === undefined) throw new Error(`No "${key}" pill — sundayPills() stopped emitting it`);
  return found;
}

describe("pillStatus", () => {
  const cases: readonly [number, number, string][] = [
    [0, 3, "empty"],
    [1, 3, "partial"],
    [2, 3, "partial"],
    [3, 3, "complete"],
  ];

  for (const [filled, total, expected] of cases) {
    it(`reads ${filled} of ${total} as ${expected}`, () => {
      expect(pillStatus(filled, total)).toBe(expected);
    });
  }

  // THE CASE A READER GETS BACKWARDS, asserted on its own rather than folded into the table.
  // A Sunday configured for no talks has nothing outstanding; scoring it as empty would leave a
  // fast Sunday permanently on a list of things to chase.
  it("reads a total of 0 as COMPLETE, not empty", () => {
    expect(pillStatus(0, 0)).toBe("complete");
  });
});

describe("sundayPills", () => {
  it("emits the four pills in a fixed order", () => {
    expect(sundayPills(input()).map((pill) => pill.key)).toEqual([
      "topics",
      "talks",
      "prayer",
      "music",
    ]);
  });

  // program-c's reversal, asserted here rather than only in the component: an omitted empty slot
  // reads as "failed to load", which looks correct enough that nobody reports it.
  it("emits an untouched Sunday's pills as zeroes rather than omitting them", () => {
    const pills = sundayPills(input());

    expect(pills).toHaveLength(4);
    expect(pillFor(pills, "topics")).toMatchObject({ filled: 0, total: 3, status: "empty" });
    expect(pillFor(pills, "talks")).toMatchObject({ filled: 0, total: 3, status: "empty" });
  });

  // ---------------------------------------------------------------------------
  // TOPICS AND TALKS ARE DIFFERENT METRICS
  // ---------------------------------------------------------------------------
  it("counts a topic with no speaker toward topics and NOT toward talks", () => {
    const pills = sundayPills(
      input({
        assignments: [
          assignment({ topicId: "topic-1" }),
          assignment({ topicId: "topic-2" }),
          assignment(),
        ],
      }),
    );

    expect(pillFor(pills, "topics")).toMatchObject({ filled: 2, total: 3, status: "partial" });
    expect(pillFor(pills, "talks")).toMatchObject({ filled: 0, total: 3, status: "empty" });
  });

  it("counts a speaker with no topic toward NEITHER", () => {
    const pills = sundayPills(
      input({ assignments: [assignment({ memberId: "member-1" })] }),
    );

    expect(pillFor(pills, "topics").filled).toBe(0);
    expect(pillFor(pills, "talks").filled).toBe(0);
  });

  it("counts a slot with both toward both", () => {
    const pills = sundayPills(
      input({ assignments: [assignment({ topicId: "topic-1", memberId: "member-1" })] }),
    );

    expect(pillFor(pills, "topics").filled).toBe(1);
    expect(pillFor(pills, "talks").filled).toBe(1);
  });

  // ITER-004: a visiting high councillor named in external_speaker_name fills the slot exactly as
  // a roster member does.
  it("counts an external speaker with a topic toward talks", () => {
    const pills = sundayPills(
      input({
        assignments: [
          assignment({ topicId: "topic-1", externalSpeakerName: "Brother Hale" }),
        ],
      }),
    );

    expect(pillFor(pills, "talks")).toMatchObject({ filled: 1, total: 3, status: "partial" });
  });

  it("does not count a whitespace-only external speaker name", () => {
    const pills = sundayPills(
      input({ assignments: [assignment({ topicId: "topic-1", externalSpeakerName: "   " })] }),
    );

    expect(pillFor(pills, "talks").filled).toBe(0);
  });

  it("reads three filled slots of three as complete", () => {
    const pills = sundayPills(
      input({
        assignments: [
          assignment({ topicId: "a", memberId: "m1" }),
          assignment({ topicId: "b", memberId: "m2" }),
          assignment({ topicId: "c", externalSpeakerName: "Sister Vance" }),
        ],
      }),
    );

    expect(pillFor(pills, "topics")).toMatchObject({ filled: 3, total: 3, status: "complete" });
    expect(pillFor(pills, "talks")).toMatchObject({ filled: 3, total: 3, status: "complete" });
  });

  // ---------------------------------------------------------------------------
  // THE TOTAL IS `speaking_slots`, NEVER `assignments.length`
  // ---------------------------------------------------------------------------
  it("scores one assignment on a three-slot Sunday as 1/3, not 1/1", () => {
    const pills = sundayPills(
      input({
        speakingSlots: 3,
        assignments: [assignment({ topicId: "a", memberId: "m1" })],
      }),
    );

    expect(pillFor(pills, "talks")).toMatchObject({ filled: 1, total: 3, status: "partial" });
  });

  it("never renders more than the slot count, even with extra assignment rows", () => {
    const pills = sundayPills(
      input({
        speakingSlots: 3,
        assignments: [
          assignment({ topicId: "a", memberId: "m1" }),
          assignment({ topicId: "b", memberId: "m2" }),
          assignment({ topicId: "c", memberId: "m3" }),
          assignment({ topicId: "d", memberId: "m4" }),
        ],
      }),
    );

    expect(pillFor(pills, "topics")).toMatchObject({ filled: 3, total: 3 });
    expect(pillFor(pills, "talks")).toMatchObject({ filled: 3, total: 3 });
  });

  // ---------------------------------------------------------------------------
  // A SUNDAY WITH NO SPEAKING SLOTS CARRIES NO TALK PILLS AT ALL
  // ---------------------------------------------------------------------------
  // This REPLACED a rule that rendered them as `0/0` in the complete tone. Walking scenario 072
  // the user read `Topics 0/0` as a card that had failed to load — a pill for work that does not
  // exist reads as broken, exactly as program-c found an omitted pill for work that DOES exist
  // reads as broken. The reconciling rule: a pill is shown when there is work to count.
  it("omits both talk pills on a Sunday with no speaking slots", () => {
    const keys = sundayPills(input({ speakingSlots: 0 })).map((pill) => pill.key);

    expect(keys).toEqual(["prayer", "music"]);
  });

  // The whole reason this is keyed on the slot count and not on `holdsSacramentMeeting`.
  it("keeps prayer and music on a Sunday with no speaking slots", () => {
    const pills = sundayPills(
      input({
        speakingSlots: 0,
        prayers: [
          { memberId: "m1", prayerType: "invocation" },
          { memberId: "m2", prayerType: "benediction" },
        ],
        hymnSelectionCount: 3,
      }),
    );

    expect(pillFor(pills, "prayer")).toMatchObject({ filled: 2, total: 2, status: "complete" });
    expect(pillFor(pills, "music")).toMatchObject({ filled: 3, total: 3, status: "complete" });
  });

  // Keyed on the COUNT, never on the TYPE. A ward that zeroes the slots on an ordinary Sunday
  // means the same thing by it, and reading the type here would put a second definition of
  // "has speakers" in the codebase for the calendar to disagree with.
  it("omits the talk pills on a standard Sunday configured for no speakers", () => {
    const keys = sundayPills(input({ speakingSlots: 0 })).map((pill) => pill.key);

    expect(keys).not.toContain("topics");
    expect(keys).not.toContain("talks");
  });

  // ---------------------------------------------------------------------------
  // PRAYERS SURVIVE `speaking_slots = 0`
  // ---------------------------------------------------------------------------
  it("keeps both prayer slots on a Sunday with no speakers", () => {
    const pills = sundayPills(
      input({ speakingSlots: 0, prayers: [{ memberId: "m1", prayerType: "invocation" }] }),
    );

    expect(pillFor(pills, "prayer")).toMatchObject({
      filled: 1,
      total: PRAYERS_PER_SUNDAY,
      status: "partial",
    });
  });

  it("does not count a prayer slot that exists with nobody in it", () => {
    const pills = sundayPills(
      input({ prayers: [{ memberId: null, prayerType: "invocation" }] }),
    );

    expect(pillFor(pills, "prayer")).toMatchObject({ filled: 0, status: "empty" });
  });

  it("reads both prayers as complete", () => {
    const pills = sundayPills(
      input({
        prayers: [
          { memberId: "m1", prayerType: "invocation" },
          { memberId: "m2", prayerType: "benediction" },
        ],
      }),
    );

    expect(pillFor(pills, "prayer")).toMatchObject({ filled: 2, total: 2, status: "complete" });
  });

  // ---------------------------------------------------------------------------
  // MUSIC
  // ---------------------------------------------------------------------------
  it("scores hymns out of three", () => {
    expect(pillFor(sundayPills(input({ hymnSelectionCount: 2 })), "music")).toMatchObject({
      filled: 2,
      total: HYMNS_PER_SUNDAY,
      status: "partial",
    });

    expect(pillFor(sundayPills(input({ hymnSelectionCount: 3 })), "music")).toMatchObject({
      filled: 3,
      status: "complete",
    });
  });

  it("never renders more than three hymns", () => {
    expect(pillFor(sundayPills(input({ hymnSelectionCount: 5 })), "music")).toMatchObject({
      filled: 3,
      total: 3,
    });
  });

  // ---------------------------------------------------------------------------
  // THE PROGRAMME AND THE CONDUCTOR ARE NOT PILLS, AND THAT IS ASSERTED
  // ---------------------------------------------------------------------------
  // The programme became the CARD's own destination (SundayCard.tsx) and the conductor is a
  // standing rotation rather than a piece of outstanding work. Both are asserted as absences so
  // a later change has to delete this test rather than quietly re-add a pill.
  it("emits no programme pill and no conducting pill", () => {
    const keys = sundayPills(
      input({
        assignments: [assignment({ topicId: "a", memberId: "m1" })],
        hymnSelectionCount: 3,
      }),
    ).map((pill) => pill.key);

    expect(keys).not.toContain("program");
    expect(keys).not.toContain("conducting");
  });

  // `assignments` — who passes, blesses and prepares — belongs in this row and is deliberately
  // held until P11 builds the adult ordinance screen, because a pill pointing at a route with no
  // page is the standing broken-link bug P3 closed. This fails the day somebody adds the key
  // without the page, which is the intent.
  it("does not yet emit an assignments pill", () => {
    const keys = sundayPills(input()).map((pill) => String(pill.key));

    expect(keys).not.toContain("assignments");
  });

  // No clock anywhere in the module, so the same input is the same answer whenever it is read.
  it("is deterministic — two calls with one input agree", () => {
    const given = input({
      assignments: [assignment({ topicId: "a", memberId: "m1" })],
      hymnSelectionCount: 1,
    });

    expect(sundayPills(given)).toEqual(sundayPills(given));
  });
});

describe("sundayHasPills", () => {
  it("withholds the pill row from a Sunday with no sacrament meeting", () => {
    expect(sundayHasPills("stake_conference")).toBe(false);
    expect(sundayHasPills("general_conference")).toBe(false);
  });

  // `holiday` and `ward_conference` are DELIBERATELY absent from NO_MEETING_SUNDAY_TYPES — both
  // hold an ordinary meeting and are only barred from being Fast Sunday (types/domain.ts). This
  // asserts the whole set, so a type added to either list has to be decided rather than inherited.
  it("keeps the pill row on every other Sunday type", () => {
    const withPills = SUNDAY_TYPES.filter((type) => sundayHasPills(type));

    expect(withPills).toEqual([
      "standard",
      "fast_sunday",
      "holiday",
      "ward_conference",
      "special",
    ]);
  });
});
