import { describe, expect, it } from "vitest";
import {
  HYMNS_PER_SUNDAY,
  PRAYERS_PER_SUNDAY,
  pillStatus,
  sundayHasPills,
  sundayPillHrefs,
  sundayPills,
  type SundayPill,
  type SundayPillKey,
  type SundayPillLinkKey,
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
    topicsFinalized: false,
    references: { count: 0, decision: null },
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
  // The prototype's order: References sits directly after Topics (p4-sacrament-c).
  it("emits the five pills in a fixed order", () => {
    expect(sundayPills(input()).map((pill) => pill.key)).toEqual([
      "topics",
      "references",
      "talks",
      "prayer",
      "music",
    ]);
  });

  // program-c's reversal, asserted here rather than only in the component: an omitted empty slot
  // reads as "failed to load", which looks correct enough that nobody reports it.
  it("emits an untouched Sunday's pills as zeroes rather than omitting them", () => {
    const pills = sundayPills(input());

    expect(pills).toHaveLength(5);
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

// WHERE EACH PILL GOES. Every case below is a rule that has already been got wrong once — twice
// in the prototype, once here — so each assertion names the mistake it pins rather than the
// string it expects.
//
// WHAT THIS DOES NOT BUY: it catches an href that stops carrying the Sunday. It cannot catch the
// DESTINATION being unable to honour one, which is what 072-D1 actually was — /music read no
// date parameter at all. tests/lib/musicSundayWindow.test.ts covers the arithmetic on the other
// side; the walk of scenario 072 is the only thing that proves the two halves meet.
describe("sundayPillHrefs", () => {
  const SUNDAY_ID = "2f6d4a1e-0000-4000-8000-000000000001";

  it("sends Topics and Talks to the per-date editor, never to the topic library", () => {
    const hrefs = sundayPillHrefs(SUNDAY_ID, "2027-08-15");

    expect(hrefs.topics).toBe(`/assignments/${SUNDAY_ID}`);
    expect(hrefs.talks).toBe(`/assignments/${SUNDAY_ID}`);

    // The negative, asserted explicitly. /talks/topics is the ward-level topic LIBRARY a slot's
    // topic is chosen FROM; the two names are one word apart and module-map.md §2.1 calls this
    // the single most likely thing to get backwards.
    expect(hrefs.topics).not.toContain("/talks/topics");
    expect(hrefs.talks).not.toContain("/talks/topics");
  });

  it("sends Music to that SUNDAY, names the origin, and scrolls to its card", () => {
    // Three parts, none redundant. `?sunday=` OPENS the card — /music is a collapsed list, so
    // without it the reader lands on a closed row. `&from=sacrament` is what makes the back link
    // read "Back to Sacrament Calendar". The fragment scrolls, with no JavaScript.
    expect(sundayPillHrefs(SUNDAY_ID, "2027-08-15")).toMatchObject({
      music: `/music?sunday=${SUNDAY_ID}&from=sacrament#sunday-${SUNDAY_ID}`,
    });
  });

  // THE NEGATIVE, because this is what was REVERSED. `06910f8` made /music a month board and put
  // `?month=` in this href; the user reversed that on 2026-09-23 in favour of the prototype's
  // rolling list with the jumped-to Sunday inserted. /music no longer reads `?month=` at all, so
  // an href carrying one would be a parameter the destination silently ignores (roster-b).
  it("no longer sends Music to a month", () => {
    expect(sundayPillHrefs(SUNDAY_ID, "2027-08-15").music).not.toContain("month=");
  });

  it("leaves the Prayer href as it was", () => {
    // /prayers is a month board in the prototype AND here, so it did not move with Music. The two
    // pills reading differently is the decision rather than an oversight.
    expect(sundayPillHrefs(SUNDAY_ID, "2027-08-15")).toMatchObject({
      prayer: `/prayers?month=2027-08#sunday-${SUNDAY_ID}`,
    });
  });

  it("takes the Prayer month from the Sunday's own date and from nothing ambient", () => {
    // A date that is neither today nor in the month a clock would pick, and the last day of its
    // month besides — so a future clock cannot make this pass by accident, and an off-by-one
    // that rolled into February would fail rather than pass silently.
    expect(sundayPillHrefs(SUNDAY_ID, "2027-01-31").prayer).toContain("month=2027-01");
  });

  it("carries the Sunday's id in every href", () => {
    // The prototype's `openProgram(key)` bug as an assertion: it ignored its key and always
    // opened whichever Sunday was closest to today
    // (build-notes-raw.md §sacrament-to-program-navigation).
    const hrefs = sundayPillHrefs(SUNDAY_ID, "2027-08-15");

    for (const href of Object.values(hrefs)) {
      expect(href).toContain(SUNDAY_ID);
    }
  });

  // EVERY KEY BUT `references`, which opens a modal and must not be given a fake destination.
  it("answers for every linked pill key, so a key added later cannot arrive without a destination", () => {
    const keys: SundayPillLinkKey[] = ["topics", "talks", "prayer", "music"];

    expect(Object.keys(sundayPillHrefs(SUNDAY_ID, "2027-08-15")).sort()).toEqual(
      [...keys].sort(),
    );
  });
});

describe("the References pill — p4-sacrament-c", () => {
  const SUNDAY_ID = "2f6d4a1e-0000-4000-8000-000000000001";

  it("is not emitted on a Sunday with no speaking slots", () => {
    const keys = sundayPills(input({ speakingSlots: 0 })).map((pill) => pill.key);

    expect(keys).not.toContain("references");
  });

  it("reads empty with nothing chosen and nothing decided", () => {
    expect(pillFor(sundayPills(input()), "references")).toMatchObject({
      label: "Refs",
      status: "empty",
      countText: "0",
      spokenCount: "0 chosen",
      finalized: false,
    });
  });

  // A COUNT, NOT A FRACTION — nobody owes a Sunday a number of references.
  it("reads partial with references nobody has called ready", () => {
    expect(
      pillFor(sundayPills(input({ references: { count: 2, decision: null } })), "references"),
    ).toMatchObject({ status: "partial", countText: "2", finalized: false });
  });

  it("reads complete and finalized once somebody finalizes", () => {
    expect(
      pillFor(
        sundayPills(input({ references: { count: 2, decision: "finalized" } })),
        "references",
      ),
    ).toMatchObject({ status: "complete", countText: "2", finalized: true });
  });

  // SKIPPED IS A RECORDED DECISION, NOT AN EMPTY LIST (module-map §2.1 item 2). Zero references
  // with a skip is complete; zero without one is empty — and a count alone cannot tell them apart.
  it("reads complete with zero references when skipped", () => {
    expect(
      pillFor(
        sundayPills(input({ references: { count: 0, decision: "skipped" } })),
        "references",
      ),
    ).toMatchObject({
      status: "complete",
      countText: "skipped",
      spokenCount: "skipped",
      finalized: true,
    });
  });

  it("has no href", () => {
    expect(Object.keys(sundayPillHrefs(SUNDAY_ID, "2027-08-15"))).not.toContain("references");
  });

  it("leaves every counted pill reading filled/total", () => {
    const pills = sundayPills(
      input({
        assignments: [assignment({ topicId: "t1", memberId: "m1" })],
        hymnSelectionCount: 2,
      }),
    ).filter((pill) => pill.key !== "references");

    for (const pill of pills) {
      expect(pill.countText).toBe(`${pill.filled}/${pill.total}`);
      expect(pill.spokenCount).toBe(`${pill.filled} of ${pill.total}`);
    }
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
