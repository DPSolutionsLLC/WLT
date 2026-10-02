import { describe, expect, it } from "vitest";
import {
  buildPrayerAskNotes,
  buildPrayerAskTitle,
  countPrayersNeedingAsk,
  prayerNeedsAsk,
  prayersAskState,
  prayersSettled,
  type PrayerAskInput,
  type PrayersAskStateInput,
} from "@/lib/prayers/prayerAsks";
import { NO_CONTACT_LINE } from "@/lib/sacrament/talkAsks";
import { MAX_TODO_TITLE } from "@/lib/validation/todo";
import { PRAYER_STAGES } from "@/types/domain";

// ITER-036 fb: the pure rules for asking a Sunday's prayers.

function prayer(overrides: Partial<PrayerAskInput> = {}): PrayerAskInput {
  return { hasMember: true, stage: "assign", openAskCount: 0, ...overrides };
}

function stateInput(overrides: Partial<PrayersAskStateInput> = {}): PrayersAskStateInput {
  return { prayersFinalized: false, hasConductor: true, prayers: [prayer()], ...overrides };
}

describe("prayerNeedsAsk", () => {
  // Every combination, so a later edit to one clause cannot quietly change another row.
  it.each(
    [true, false].flatMap((hasMember) =>
      PRAYER_STAGES.flatMap((stage) =>
        [0, 1].map((openAskCount) => ({ hasMember, stage, openAskCount })),
      ),
    ),
  )("member $hasMember, stage $stage, $openAskCount open", (input) => {
    expect(prayerNeedsAsk(input)).toBe(
      input.hasMember && input.stage === "assign" && input.openAskCount === 0,
    );
  });

  // Each negative differs from the positive in exactly one field, so it is refused for the reason
  // it names and not for an earlier one.
  it("asks somebody down to pray, at assign, with no open ask", () => {
    expect(prayerNeedsAsk(prayer())).toBe(true);
  });

  it("does not ask an empty slot", () => {
    expect(prayerNeedsAsk(prayer({ hasMember: false }))).toBe(false);
  });

  it("does not ask somebody already moved to Asked on the board", () => {
    expect(prayerNeedsAsk(prayer({ stage: "ask" }))).toBe(false);
  });

  it("does not ask somebody who already holds an open ask — a second finalize asks nothing", () => {
    expect(prayerNeedsAsk(prayer({ openAskCount: 1 }))).toBe(false);
  });

  it("counts only the prayers that need an ask", () => {
    expect(
      countPrayersNeedingAsk([prayer(), prayer({ openAskCount: 1 }), prayer({ hasMember: false })]),
    ).toBe(1);
  });
});

describe("prayersAskState", () => {
  it("is locked when nobody is down to pray", () => {
    expect(prayersAskState(stateInput({ prayers: [prayer({ hasMember: false })] }))).toEqual({
      kind: "locked",
      reason: "no_prayer",
    });
    expect(prayersAskState(stateInput({ prayers: [] }))).toEqual({
      kind: "locked",
      reason: "no_prayer",
    });
  });

  it("is locked with no conductor while it still needs finalizing", () => {
    expect(prayersAskState(stateInput({ hasConductor: false }))).toEqual({
      kind: "locked",
      reason: "no_conductor",
    });
  });

  it("counts who finalizing would ask", () => {
    expect(
      prayersAskState(stateInput({ prayers: [prayer(), prayer({ hasMember: false }), prayer()] })),
    ).toEqual({ kind: "not_finalized", count: 2 });
  });

  it("reads not finalized, never pending, when finalized with somebody still to ask (a half-run)", () => {
    const input = stateInput({ prayersFinalized: true });
    expect(prayersSettled(input)).toBe(false);
    expect(prayersAskState(input)).toEqual({ kind: "not_finalized", count: 1 });
  });

  it("is pending once finalized and everyone holds an ask", () => {
    const input = stateInput({ prayersFinalized: true, prayers: [prayer({ openAskCount: 1 })] });
    expect(prayersSettled(input)).toBe(true);
    expect(prayersAskState(input)).toEqual({ kind: "pending" });
  });

  it("is accepted once every assigned prayer is confirmed or given", () => {
    const input = stateInput({
      prayersFinalized: true,
      prayers: [prayer({ stage: "confirm" }), prayer({ stage: "done" }), prayer({ hasMember: false })],
    });
    expect(prayersAskState(input)).toEqual({ kind: "accepted" });
  });

  it("keeps a finalized Sunday settled after its conductor is cleared", () => {
    const input = stateInput({
      prayersFinalized: true,
      hasConductor: false,
      prayers: [prayer({ stage: "confirm" })],
    });
    expect(prayersSettled(input)).toBe(true);
    expect(prayersAskState(input)).toEqual({ kind: "accepted" });
  });
});

describe("the ask's text", () => {
  it("names which prayer, in words a member would use", () => {
    expect(buildPrayerAskTitle("Maria Lopez", "invocation")).toBe(
      "Ask Maria Lopez to give the opening prayer",
    );
    expect(buildPrayerAskTitle("Maria Lopez", "benediction")).toBe(
      "Ask Maria Lopez to give the closing prayer",
    );
  });

  it("keeps the title within the to-do limit", () => {
    expect(buildPrayerAskTitle("A".repeat(400), "invocation").length).toBeLessThanOrEqual(
      MAX_TODO_TITLE,
    );
  });

  it("carries the prayer, the person, the contact line and the Sunday in UTC", () => {
    const notes = buildPrayerAskNotes({
      personName: "Maria Lopez",
      phone: "555-0100",
      prayerType: "benediction",
      sundayDate: "2027-03-07",
    });
    expect(notes).toBe(
      ["Prayer: The closing prayer", "Who: Maria Lopez", "Phone: 555-0100", "Sunday: Sunday, March 7, 2027"].join("\n"),
    );
  });

  it("says when there is no phone on file", () => {
    const notes = buildPrayerAskNotes({
      personName: "Maria Lopez",
      phone: null,
      prayerType: "invocation",
      sundayDate: "2027-03-07",
    });
    expect(notes).toContain(NO_CONTACT_LINE);
  });
});
