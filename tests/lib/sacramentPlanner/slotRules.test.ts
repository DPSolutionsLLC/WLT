// @vitest-environment node
import { describe, expect, it } from "vitest";
import { loadPlannerSlotRules, type PlannerSlot } from "@/tests/helpers/plannerSlotRules";

// GROUP-04 (plans/sacrament-planner-refinements.md): the Planner's pure slot rules, run straight
// out of body.html. Each refusal case uses a Sunday that passes every earlier check, so it is
// refused for the reason under test and not for an earlier one.

const rules = loadPlannerSlotRules();

const hymn = (id: string, role: string, number = ""): PlannerSlot => ({ id, role, number, title: "" });
const person = (id: string, role: string, name = "", status = name ? "tentative" : "open"): PlannerSlot => ({
  id,
  role,
  name,
  topic: "",
  status,
});

function regularSunday(): PlannerSlot[] {
  return [
    hymn("oh", "Opening Hymn"),
    person("op", "Opening Prayer"),
    { id: "mkbiz", role: "Ward Business" },
    hymn("sh", "Sacrament Hymn"),
    { id: "mksac", role: "Sacrament" },
    person("s1", "Speaker"),
    hymn("rh", "Rest Hymn"),
    person("s2", "Speaker"),
    hymn("ch", "Closing Hymn"),
    person("cp", "Closing Prayer"),
  ];
}

const roles = (slots: PlannerSlot[]) => slots.map((slot) => slot.role);

describe("isEmptyWork", () => {
  it("treats an untouched speaker slot as empty", () => {
    expect(rules.isEmptyWork(person("s", "Speaker"))).toBe(true);
  });

  it("counts a name, a topic or a reference as work (D5)", () => {
    expect(rules.isEmptyWork(person("s", "Speaker", "Lee, Ann"))).toBe(false);
    expect(rules.isEmptyWork({ ...person("s", "Speaker"), topic: "Gratitude" })).toBe(false);
    expect(rules.isEmptyWork({ ...person("s", "Speaker"), refs: [{ url: "https://example.org" }] })).toBe(false);
  });

  it("does not count a blank topic as work", () => {
    expect(rules.isEmptyWork({ ...person("s", "Speaker"), topic: "   " })).toBe(true);
  });

  it("treats an empty rest hymn as empty and one with a number as work", () => {
    expect(rules.isEmptyWork(hymn("r", "Rest Hymn"))).toBe(true);
    expect(rules.isEmptyWork(hymn("r", "Rest Hymn", "98"))).toBe(false);
  });

  it("never offers a prayer, another hymn or a musical number for removal", () => {
    expect(rules.isEmptyWork(person("p", "Opening Prayer"))).toBe(false);
    expect(rules.isEmptyWork(hymn("c", "Closing Hymn"))).toBe(false);
    expect(rules.isEmptyWork({ id: "m", role: "Musical Number", performer: "", title: "" })).toBe(false);
  });
});

describe("placeIntoSlots", () => {
  it("fills the first open speaker slot and pencils them in", () => {
    const result = rules.placeIntoSlots(regularSunday(), "Lee, Ann", "talk", "", "warn");
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.slots.find((slot) => slot.id === "s1")).toMatchObject({ name: "Lee, Ann", status: "tentative" });
    expect(result.slots.find((slot) => slot.id === "s2")?.name).toBe("");
  });

  it("writes the topic only when one was given", () => {
    const start = regularSunday().map((slot) => (slot.id === "s1" ? { ...slot, topic: "Kept" } : slot));
    const without = rules.placeIntoSlots(start, "Lee, Ann", "talk", "", "warn");
    const withTopic = rules.placeIntoSlots(start, "Lee, Ann", "talk", "Faith", "warn");
    expect(without.ok && without.slots.find((slot) => slot.id === "s1")?.topic).toBe("Kept");
    expect(withTopic.ok && withTopic.slots.find((slot) => slot.id === "s1")?.topic).toBe("Faith");
  });

  it("refuses somebody already on the Sunday, even with a slot open", () => {
    const start = regularSunday().map((slot) => (slot.id === "s1" ? { ...slot, name: "Lee, Ann", status: "calling" } : slot));
    expect(rules.placeIntoSlots(start, "Lee, Ann", "talk", "", "add")).toEqual({ ok: false, reason: "already" });
  });

  it("ignores an open slot that still carries their name", () => {
    const start = regularSunday().map((slot) => (slot.id === "s1" ? { ...slot, name: "Lee, Ann", status: "open" } : slot));
    expect(rules.placeIntoSlots(start, "Lee, Ann", "prayer", "", "warn").ok).toBe(true);
  });

  it("warns instead of adding when every speaker slot is named", () => {
    const full = regularSunday().map((slot) => (slot.role === "Speaker" ? { ...slot, name: `Person ${slot.id}`, status: "tentative" } : slot));
    expect(rules.placeIntoSlots(full, "Lee, Ann", "talk", "", "warn")).toEqual({ ok: false, reason: "talksFull" });
  });

  it("adds a speaker before the closing hymn when told to", () => {
    const full = regularSunday().map((slot) => (slot.role === "Speaker" ? { ...slot, name: `Person ${slot.id}`, status: "tentative" } : slot));
    const result = rules.placeIntoSlots(full, "Lee, Ann", "talk", "Hope", "add");
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const added = result.slots.findIndex((slot) => slot.name === "Lee, Ann");
    expect(result.slots[added]).toMatchObject({ role: "Speaker", topic: "Hope", status: "tentative" });
    expect(result.slots[added + 1].role).toBe("Closing Hymn");
  });

  it("fills the opening prayer, then the closing prayer", () => {
    const first = rules.placeIntoSlots(regularSunday(), "Lee, Ann", "prayer", "", "warn");
    expect(first.ok && first.slots.find((slot) => slot.id === "op")?.name).toBe("Lee, Ann");
    if (!first.ok) return;
    const second = rules.placeIntoSlots(first.slots, "Ray, Bo", "prayer", "", "warn");
    expect(second.ok && second.slots.find((slot) => slot.id === "cp")?.name).toBe("Ray, Bo");
    if (!second.ok) return;
    expect(rules.placeIntoSlots(second.slots, "Kim, Jo", "prayer", "", "add")).toEqual({ ok: false, reason: "prayersFull" });
  });

  it("never changes the slots it was given", () => {
    const start = regularSunday();
    const before = JSON.stringify(start);
    rules.placeIntoSlots(start, "Lee, Ann", "talk", "Faith", "add");
    rules.placeIntoSlots(start, "Lee, Ann", "prayer", "", "add");
    expect(JSON.stringify(start)).toBe(before);
  });
});

describe("meeting-type slot rules", () => {
  it("removes empty speakers and then the lone empty rest hymn", () => {
    expect(roles(rules.withoutEmptySpeakers(regularSunday()))).toEqual([
      "Opening Hymn",
      "Opening Prayer",
      "Ward Business",
      "Sacrament Hymn",
      "Sacrament",
      "Closing Hymn",
      "Closing Prayer",
    ]);
  });

  it("keeps a named speaker and the rest hymn that sits with them", () => {
    const start = regularSunday().map((slot) => (slot.id === "s2" ? { ...slot, name: "Lee, Ann" } : slot));
    const after = rules.withoutEmptySpeakers(start);
    expect(after.map((slot) => slot.id)).toContain("s2");
    expect(after.map((slot) => slot.id)).not.toContain("s1");
    expect(after.map((slot) => slot.id)).toContain("rh");
  });

  it("keeps a topic-only speaker slot (D5)", () => {
    const start = regularSunday().map((slot) => (slot.id === "s1" ? { ...slot, topic: "Sabbath" } : slot));
    expect(rules.withoutEmptySpeakers(start).map((slot) => slot.id)).toContain("s1");
  });

  it("keeps a rest hymn somebody chose even with no speakers left", () => {
    const start = regularSunday().map((slot) => (slot.id === "rh" ? { ...slot, number: "98" } : slot));
    expect(rules.withoutEmptySpeakers(start).map((slot) => slot.id)).toContain("rh");
  });

  it("adds nothing when a speaker slot already exists", () => {
    const start = regularSunday();
    expect(rules.withDefaultSpeakers(start)).toEqual(start);
  });

  it("returns to the same layout after Regular → Fast → Regular", () => {
    const back = rules.withDefaultSpeakers(rules.withoutEmptySpeakers(regularSunday()));
    expect(roles(back)).toEqual(roles(regularSunday()));
  });

  it("does not add a rest hymn beside a musical number", () => {
    const fast = rules.withoutEmptySpeakers(regularSunday());
    const withMusic = [...fast.slice(0, 5), { id: "mn", role: "Musical Number", performer: "", title: "" }, ...fast.slice(5)];
    expect(roles(rules.withDefaultSpeakers(withMusic)).filter((role) => role === "Rest Hymn")).toEqual([]);
  });

  it("puts a rest hymn at the middle once there are two speakers and none yet", () => {
    const fast = rules.withoutEmptySpeakers(regularSunday());
    const two = rules.withSpeakerAdded(rules.withSpeakerAdded(fast));
    const after = roles(rules.withRestHymnIfTwoSpeakers(two));
    expect(after.slice(-5)).toEqual(["Speaker", "Rest Hymn", "Speaker", "Closing Hymn", "Closing Prayer"]);
  });

  it("leaves one speaker, or an existing rest hymn, alone", () => {
    const fast = rules.withoutEmptySpeakers(regularSunday());
    const one = rules.withSpeakerAdded(fast);
    expect(rules.withRestHymnIfTwoSpeakers(one)).toEqual(one);
    expect(rules.withRestHymnIfTwoSpeakers(regularSunday())).toEqual(regularSunday());
  });
});

describe("+ / − speaking slots", () => {
  it("adds an empty speaker before the closing hymn", () => {
    const after = rules.withSpeakerAdded(regularSunday());
    expect(roles(after).slice(-4)).toEqual(["Speaker", "Speaker", "Closing Hymn", "Closing Prayer"]);
  });

  it("removes the last empty speaker", () => {
    const after = rules.withoutLastEmptySpeaker(regularSunday());
    expect(after?.map((slot) => slot.id)).not.toContain("s2");
    expect(after?.map((slot) => slot.id)).toContain("s1");
  });

  it("removes nothing when every speaker slot has someone or a topic", () => {
    const start = regularSunday().map((slot) =>
      slot.id === "s1" ? { ...slot, name: "Lee, Ann" } : slot.id === "s2" ? { ...slot, topic: "Faith" } : slot,
    );
    expect(rules.withoutLastEmptySpeaker(start)).toBeNull();
  });
});

describe("slotFill", () => {
  it("reads 0 of 0 on a Fast & Testimony layout", () => {
    expect(rules.slotFill(rules.withoutEmptySpeakers(regularSunday()), "talk")).toMatchObject({ filled: 0, total: 0 });
  });

  it("counts tentative and accepted, never open", () => {
    const start = regularSunday().map((slot) =>
      slot.id === "s1" ? { ...slot, name: "Lee, Ann", status: "tentative" } : slot.id === "s2" ? { ...slot, name: "Ray, Bo", status: "accepted" } : slot,
    );
    expect(rules.slotFill(start, "talk")).toMatchObject({ filled: 2, total: 2 });
    const reopened = start.map((slot) => (slot.id === "s2" ? { ...slot, status: "open" } : slot));
    expect(rules.slotFill(reopened, "talk")).toMatchObject({ filled: 1, total: 2 });
  });

  it("counts prayers on their own", () => {
    const start = regularSunday().map((slot) => (slot.id === "op" ? { ...slot, name: "Lee, Ann", status: "calling" } : slot));
    expect(rules.slotFill(start, "prayer")).toMatchObject({ filled: 1, total: 2 });
  });
});

describe("callEditable (D12)", () => {
  const today = "2026-10-30";
  it("is editable today and on any later Sunday", () => {
    expect(rules.callEditable(today, today, false)).toBe(true);
    expect(rules.callEditable("2026-11-08", today, false)).toBe(true);
  });

  it("stays editable for 9 days after the Sunday and locks on the 10th", () => {
    expect(rules.callEditable("2026-10-25", today, false)).toBe(true);
    expect(rules.callEditable("2026-10-21", today, false)).toBe(true);
    expect(rules.callEditable("2026-10-20", today, false)).toBe(false);
  });

  it("is never editable once the Sunday is in the agenda history (D3)", () => {
    expect(rules.callEditable("2026-10-25", today, true)).toBe(false);
    expect(rules.callEditable("2026-11-08", today, true)).toBe(false);
  });
});

describe("callMatches (D11)", () => {
  const slot: PlannerSlot = {
    ...person("s", "Speaker", "Okafor, Grace", "accepted"),
    history: [{ name: "Lindqvist, Nora", at: "2026-10-01", reason: "Prefers not to" }],
    past: [{ name: "Brooks, Laura", at: "2026-10-02", status: "calling" }],
  };

  it("matches everything when the search is empty", () => {
    expect(rules.callMatches(slot, "")).toBe(true);
    expect(rules.callMatches(slot, "  ")).toBe(true);
  });

  it("matches the slot's person, a decliner and someone swapped out", () => {
    expect(rules.callMatches(slot, "okafor")).toBe(true);
    expect(rules.callMatches(slot, "NORA")).toBe(true);
    expect(rules.callMatches(slot, "laura")).toBe(true);
  });

  it("matches a name typed first-name first", () => {
    expect(rules.callMatches(slot, "Grace Okafor")).toBe(true);
  });

  it("does not match a topic or a reason", () => {
    expect(rules.callMatches({ ...slot, topic: "Gratitude" }, "gratitude")).toBe(false);
    expect(rules.callMatches(slot, "prefers")).toBe(false);
  });
});
