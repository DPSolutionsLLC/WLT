import { describe, expect, it } from "vitest";
import { diffDrafts, speakerSlotLabel } from "@/lib/program/diff";
import type { ProgramDraft } from "@/lib/program/draft";

// The refresh diff. This is what makes the snapshot rule safe to keep: a draft that stopped
// tracking its sources is only trustworthy if there is an honest way to see what has moved.
//
// The property that matters most is not which fields it finds, it is WHAT A PERSON READS. A diff
// naming `speakers.1.publicName` would be technically correct and useless to a secretary — the
// same failure calendar-b records for a raw uuid on screen.

function draft(overrides: Partial<ProgramDraft> = {}): ProgramDraft {
  return {
    version: 1,
    heading: null,
    date: "2026-09-06",
    sundayType: "standard",
    presiding: { printedName: "Mark Chen", publicName: "Mark C." },
    conducting: { printedName: "Peter Lindqvist", publicName: "Peter L." },
    organist: null,
    chorister: null,
    openingHymn: { number: 19, title: "We Thank Thee, O God, for a Prophet" },
    invocation: { printedName: "David Brooks", publicName: "David B." },
    wardBusiness: null,
    sacramentHymn: null,
    specialNotes: null,
    musicalNumber: null,
    speakers: [
      {
        slotNumber: 1,
        kind: "member",
        printedName: "Sarah Whitfield",
        publicName: "Sarah W.",
        topic: "Charity Never Faileth",
      },
      { slotNumber: 2, kind: "empty", printedName: null, publicName: null, topic: null },
    ],
    closingHymn: { number: 152, title: "God Be with You Till We Meet Again" },
    benediction: null,
    announcements: null,
    leadershipContacts: [],
    missionaries: null,
    missing: ["sacrament_hymn", "speaker_slot", "benediction"],
    ...overrides,
  };
}

describe("diffDrafts — nothing moved", () => {
  it("returns an empty array when the drafts are identical", () => {
    // program-b shows this as a sentence, not as an empty panel.
    expect(diffDrafts(draft(), draft())).toEqual([]);
  });

  it("ignores a publicName change with no printedName change", () => {
    // publicName is derived from printedName by one rule, so this cannot happen through the
    // assembler — and if a hand-edited draft carries it, showing the row would tell a secretary
    // nothing they could act on.
    const next = draft({
      conducting: { printedName: "Peter Lindqvist", publicName: "SOMETHING ELSE" },
    });

    expect(diffDrafts(draft(), next)).toEqual([]);
  });
});

describe("diffDrafts — a changed field", () => {
  it("reports a hymn change with both sides rendered for display", () => {
    const next = draft({ openingHymn: { number: 2, title: "The Spirit of God" } });
    const [change] = diffDrafts(draft(), next);

    expect(change).toEqual({
      field: "openingHymn",
      label: "Opening hymn",
      before: "19 — We Thank Thee, O God, for a Prophet",
      after: "2 — The Spirit of God",
    });
  });

  it("renders a hymn with no resolvable title as its number alone", () => {
    const next = draft({ openingHymn: { number: 169, title: "" } });
    const [change] = diffDrafts(draft(), next);

    expect(change.after).toBe("169");
  });

  it("reports a name change by its printed name", () => {
    const next = draft({
      conducting: { printedName: "Elena Ruiz", publicName: "Elena R." },
    });
    const [change] = diffDrafts(draft(), next);

    expect(change).toMatchObject({
      field: "conducting",
      label: "Conducting",
      before: "Peter Lindqvist",
      after: "Elena Ruiz",
    });
  });

  it("reports a Sunday becoming a ward conference in words, not in column values", () => {
    const next = draft({ sundayType: "ward_conference", heading: "Ward Conference" });
    const changes = diffDrafts(draft(), next);

    const type = changes.find((change) => change.field === "sundayType");
    expect(type).toMatchObject({ label: "Kind of Sunday", after: "Ward Conference" });
    expect(type?.after).not.toBe("ward_conference");
  });

  it("names leadership contacts without carrying a phone number into the panel", () => {
    const next = draft({
      leadershipContacts: [{ role: "Bishop", name: "Mark Chen", phone: "555-0100" }],
    });
    const [change] = diffDrafts(draft(), next);

    expect(change.after).toBe("Mark Chen");
    expect(JSON.stringify(change)).not.toContain("555-0100");
  });
});

describe("diffDrafts — speakers", () => {
  it("names a slot in words a bishopric uses", () => {
    const next = draft({
      speakers: [
        {
          slotNumber: 1,
          kind: "member",
          printedName: "Ruth Okonkwo",
          publicName: "Ruth O.",
          topic: "Charity Never Faileth",
        },
        { slotNumber: 2, kind: "empty", printedName: null, publicName: null, topic: null },
      ],
    });

    const [change] = diffDrafts(draft(), next);

    expect(change).toEqual({
      field: "speakers.1.printedName",
      label: "First speaker",
      before: "Sarah Whitfield",
      after: "Ruth Okonkwo",
    });
  });

  it("shows a slot that filled in since the draft was written", () => {
    const next = draft({
      speakers: [
        draft().speakers[0],
        {
          slotNumber: 2,
          kind: "external",
          printedName: "President Mark Andersen",
          publicName: "President Mark Andersen",
          topic: null,
        },
      ],
      missing: ["sacrament_hymn", "benediction"],
    });

    const changes = diffDrafts(draft(), next);

    expect(changes).toContainEqual({
      field: "speakers.2.printedName",
      label: "Second speaker",
      before: null,
      after: "President Mark Andersen",
    });

    // The single most useful line a refresh can show, and it reads in the DONE direction.
    expect(changes).toContainEqual({
      field: "missing.speaker_slot",
      label: "Every speaking slot filled",
      before: "Still needed",
      after: "Done",
    });
  });

  it("reports a topic change separately from a name change", () => {
    const next = draft({
      speakers: [
        { ...draft().speakers[0], topic: "The Doctrine of Christ" },
        draft().speakers[1],
      ],
    });

    const [change] = diffDrafts(draft(), next);

    expect(change).toEqual({
      field: "speakers.1.topic",
      label: "First speaker's topic",
      before: "Charity Never Faileth",
      after: "The Doctrine of Christ",
    });
  });

  it("reports a slot that disappeared because the Sunday lost a slot", () => {
    const next = draft({ speakers: [draft().speakers[0]] });
    const changes = diffDrafts(draft(), next);

    // Slot 2 was empty in both, so only `missing` moves — there is no name to report as removed.
    expect(changes.some((change) => change.field.startsWith("speakers.2"))).toBe(false);
  });

  it("labels slots beyond the ninth numerically rather than inventing a word", () => {
    expect(speakerSlotLabel(1)).toBe("First speaker");
    expect(speakerSlotLabel(9)).toBe("Ninth speaker");
    expect(speakerSlotLabel(12)).toBe("Speaker 12");
  });
});

describe("diffDrafts — labels are human words", () => {
  it("never renders a dotted path or a snake_case key as a label", () => {
    const next = draft({
      sundayType: "ward_conference",
      heading: "Ward Conference",
      openingHymn: null,
      sacramentHymn: { number: 169, title: "As Now We Take the Sacrament" },
      announcements: "Ward temple night is Thursday.",
      speakers: [
        { ...draft().speakers[0], printedName: "Ruth Okonkwo", topic: null },
        {
          slotNumber: 2,
          kind: "external",
          printedName: "President Mark Andersen",
          publicName: "President Mark Andersen",
          topic: null,
        },
      ],
      missing: [],
    });

    const changes = diffDrafts(draft(), next);
    expect(changes.length).toBeGreaterThan(5);

    for (const change of changes) {
      expect(change.label).not.toContain(".");
      expect(change.label).not.toContain("_");
      expect(change.label).not.toMatch(/^[a-z]+[A-Z]/);
    }
  });
});
