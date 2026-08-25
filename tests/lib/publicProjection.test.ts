import { describe, expect, it } from "vitest";
import type { ProgramDraft } from "@/lib/program/draft";
import { toPublicProgram } from "@/lib/program/publicProjection";

// THE HIGHEST-VALUE TEST IN THIS CODEBASE, and it is written a particular way on purpose.
//
// ---------------------------------------------------------------------------------------------
// IT SCANS THE OUTPUT FOR THINGS THAT MUST NOT BE THERE
// ---------------------------------------------------------------------------------------------
// The obvious test lists the allowed fields and checks they are present. That test passes forever.
// It passes on the day somebody adds `missionaries` to the projection, because `missionaries` is
// not in its list of things to check — the assertion has no opinion about a field nobody thought
// about, which is precisely the field that leaks.
//
// So this suite serialises the whole result and searches it for the fixture's phone number, street
// address, email and member id. A field added to PublicProgram that carries any of them fails this
// suite WITHOUT ANYBODY UPDATING THE ASSERTION. That is the only property that survives the next
// six months.
//
// ---------------------------------------------------------------------------------------------
// THE SURNAME IS NO LONGER IN THE FORBIDDEN LIST. THAT IS THE CHANGE, NOT A GAP.
// ---------------------------------------------------------------------------------------------
// Names are published in full as of 2026-08-24 (lib/program/publicProjection.ts explains why), so
// "Whitfield" is now asserted PRESENT rather than absent. Read that as a deliberate narrowing of
// what this suite protects — and note what it still protects: a phone number, a street address, an
// email, a member id, the leadership contacts array and the missionary block. Those rows were
// always the larger exposure, and every one of them is still scanned for.
//
// ---------------------------------------------------------------------------------------------
// THE FIXTURE IS BUILT SO A LEAK IS UNMISTAKABLE (plans/retros/ai-b-knowledge-and-retrieval.md)
// ---------------------------------------------------------------------------------------------
// Every forbidden value is long, distinctive, and appears in no other string in the draft, so an
// assertion that it is absent cannot pass by luck and cannot fail by coincidence.
//
// The draft holds a MEMBER speaker and an EXTERNAL speaker at once. They are named by the same
// rule now, but the pair is kept: a fixture with only one kind lets the other path break silently,
// and a regression that reintroduced shortening would show up in this pair first.

const PHONE = "555-0142";
const ADDRESS = "2201 Canyon Road";
const EMAIL = "sarah.whitfield@example.test";
const MEMBER_ID = "7c9f1e64-2b3a-4d51-9f77-0f2c81a5be93";
const MEMBER_FULL_NAME = "Sarah Whitfield";
const CHORISTER_FULL_NAME = "Anna Whitfield";

// Every field of a ProgramDraft populated, including the three the projection must never carry.
// A fixture with `leadershipContacts: []` would let a projector that copies the array straight
// through pass every assertion here.
function fullDraft(): ProgramDraft {
  return {
    version: 1,
    heading: "Ward Conference",
    date: "2026-09-20",
    sundayType: "ward_conference",
    presiding: { printedName: "Mark Andersen", publicName: "Mark Andersen" },
    conducting: { printedName: "Peter Lindqvist", publicName: "Peter Lindqvist" },
    organist: { printedName: "Ruth Delgado", publicName: "Ruth Delgado" },
    chorister: { printedName: CHORISTER_FULL_NAME, publicName: CHORISTER_FULL_NAME },
    openingHymn: { number: 19, title: "We Thank Thee, O God, for a Prophet" },
    invocation: { printedName: "David Brooks", publicName: "David Brooks" },
    wardBusiness: "Sustaining of a new Primary president.",
    sacramentHymn: { number: 193, title: "I Stand All Amazed" },
    specialNotes: "The choir will remain after the meeting.",
    musicalNumber: {
      performer: { printedName: "The Primary children", publicName: "The Primary children" },
      pieceTitle: "I Am a Child of God",
      // A note on the musical number is internal staging detail, not something to publish.
      notes: `Sound check at 8:30. Reach the chorister on ${PHONE}.`,
    },
    speakers: [
      {
        slotNumber: 1,
        kind: "member",
        printedName: MEMBER_FULL_NAME,
        publicName: MEMBER_FULL_NAME,
        topic: "Charity Never Faileth",
      },
      {
        slotNumber: 2,
        kind: "external",
        printedName: "President Mark Andersen",
        publicName: "President Mark Andersen",
        topic: null,
      },
      { slotNumber: 3, kind: "empty", printedName: null, publicName: null, topic: null },
    ],
    closingHymn: { number: 152, title: "God Be with You Till We Meet Again" },
    benediction: { printedName: "Ellen Moretti", publicName: "Ellen Moretti" },
    announcements: "Ward temple night is on the 14th.",
    // The three that must never reach the page. All populated, and all carrying something
    // distinctive enough that its presence in the output is unarguable.
    leadershipContacts: [
      { role: "Bishop", name: "Mark Andersen", phone: PHONE },
      { role: "Ward Secretary", name: `Ruth Delgado (${EMAIL})`, phone: "555-0102" },
    ],
    missionaries: `Elder Kim and Elder Osei — ${ADDRESS}, member id ${MEMBER_ID}`,
    missing: ["organist", "chorister"],
  };
}

describe("toPublicProgram", () => {
  describe("what must never appear in the output", () => {
    // Each case is its own `it` so a failure names WHICH kind of data leaked, rather than one
    // assertion that says "something did".
    const forbidden: Array<{ what: string; needle: string }> = [
      { what: "a phone number", needle: PHONE },
      { what: "a street address", needle: ADDRESS },
      { what: "an email address", needle: EMAIL },
      { what: "a member id", needle: MEMBER_ID },
      { what: "an internal note", needle: "Sound check" },
      { what: "a leadership contact", needle: "Ward Secretary" },
      { what: "missionary information", needle: "Elder Kim" },
    ];

    for (const { what, needle } of forbidden) {
      it(`does not publish ${what}`, () => {
        const serialised = JSON.stringify(toPublicProgram(fullDraft()));

        expect(serialised).not.toContain(needle);
      });
    }

    // The three fields are absent from the TYPE, so this is belt and braces on the runtime object:
    // a later edit that reintroduced one as `undefined` would still fail here.
    it("has no key for the fields the type does not declare", () => {
      const keys = Object.keys(toPublicProgram(fullDraft()));

      expect(keys).not.toContain("leadershipContacts");
      expect(keys).not.toContain("missionaries");
      expect(keys).not.toContain("missing");
      expect(keys).not.toContain("sundayType");
    });

    // A spread-then-delete projector passes every assertion above until somebody adds a field.
    // This is the assertion that catches the projector being rewritten that way: the output holds
    // exactly the seventeen declared keys and nothing else.
    it("publishes exactly the declared field list and no more", () => {
      expect(Object.keys(toPublicProgram(fullDraft())).sort()).toEqual(
        [
          "announcements",
          "benediction",
          "chorister",
          "closingHymn",
          "conducting",
          "date",
          "heading",
          "invocation",
          "musicalNumber",
          "openingHymn",
          "organist",
          "presiding",
          "sacramentHymn",
          "specialNotes",
          "speakers",
          "version",
          "wardBusiness",
        ].sort(),
      );
    });

    it("carries no speaker discriminator, so no name is labelled as a member's", () => {
      const speakers = toPublicProgram(fullDraft()).speakers;

      for (const speaker of speakers) {
        expect(Object.keys(speaker).sort()).toEqual(["name", "slotNumber", "topic"]);
      }
    });
  });

  // Everybody is named the same way, which is the whole of the 2026-08-24 decision. The two
  // speakers sit in adjacent slots in the fixture precisely so "the same way" is asserted about
  // one program rather than two.
  describe("names", () => {
    it("publishes a ward member in full, surname included", () => {
      const speaker = toPublicProgram(fullDraft()).speakers[0];

      expect(speaker?.name).toBe(MEMBER_FULL_NAME);
    });

    it("publishes an external speaker's typed name in full, title included", () => {
      const speaker = toPublicProgram(fullDraft()).speakers[1];

      expect(speaker?.name).toBe("President Mark Andersen");
    });

    // The regression guard for the reversal: if shortening is reintroduced upstream, these are the
    // six fields that would quietly start reading "Mark A." again.
    it("publishes every other name in full too, not only speakers", () => {
      const result = toPublicProgram(fullDraft());

      expect(result.presiding).toBe("Mark Andersen");
      expect(result.conducting).toBe("Peter Lindqvist");
      expect(result.organist).toBe("Ruth Delgado");
      expect(result.chorister).toBe(CHORISTER_FULL_NAME);
      expect(result.invocation).toBe("David Brooks");
      expect(result.benediction).toBe("Ellen Moretti");
    });

    // It still SELECTS rather than transforms. A projector that re-derived would mangle
    // "The Primary children" the moment any naming rule came back.
    it("leaves a typed performer name alone", () => {
      expect(toPublicProgram(fullDraft()).musicalNumber?.performer).toBe(
        "The Primary children",
      );
    });

    // THE BOUNDARY THAT DID NOT MOVE. printedName is still unreachable from the projection, which
    // is what makes a per-program publicName override actually take effect. The two fields default
    // to the same text now, so nothing but this test would notice if the projector started reading
    // the wrong one.
    it("reads publicName and never printedName", () => {
      const draft = fullDraft();
      draft.speakers[0] = {
        ...draft.speakers[0]!,
        printedName: "SHOULD-NOT-BE-PUBLISHED",
        publicName: "Sarah W.",
      };

      const result = toPublicProgram(draft);

      expect(result.speakers[0]?.name).toBe("Sarah W.");
      expect(JSON.stringify(result)).not.toContain("SHOULD-NOT-BE-PUBLISHED");
    });
  });

  describe("what it does publish", () => {
    it("carries the meeting order a congregation needs", () => {
      const result = toPublicProgram(fullDraft());

      expect(result.version).toBe(1);
      expect(result.date).toBe("2026-09-20");
      expect(result.heading).toBe("Ward Conference");
      expect(result.openingHymn).toEqual({
        number: 19,
        title: "We Thank Thee, O God, for a Prophet",
      });
      expect(result.sacramentHymn?.number).toBe(193);
      expect(result.closingHymn?.number).toBe(152);
      expect(result.wardBusiness).toBe("Sustaining of a new Primary president.");
      expect(result.announcements).toBe("Ward temple night is on the 14th.");
      expect(result.specialNotes).toBe("The choir will remain after the meeting.");
    });

    it("keeps a speaker's topic and slot number", () => {
      const speaker = toPublicProgram(fullDraft()).speakers[0];

      expect(speaker?.slotNumber).toBe(1);
      expect(speaker?.topic).toBe("Charity Never Faileth");
    });

    // The empty slot survives as a slot with no name rather than being dropped here. The PANEL
    // decides not to render it; dropping it in the projector would mean the stored projection and
    // the stored draft disagreed about how many slots the meeting has.
    it("keeps an empty slot as a null name rather than dropping it", () => {
      const speakers = toPublicProgram(fullDraft()).speakers;

      expect(speakers).toHaveLength(3);
      expect(speakers[2]).toEqual({ slotNumber: 3, name: null, topic: null });
    });

    it("drops the musical number's internal notes but keeps the piece", () => {
      expect(toPublicProgram(fullDraft()).musicalNumber).toEqual({
        performer: "The Primary children",
        pieceTitle: "I Am a Child of God",
      });
    });
  });

  describe("absences", () => {
    // A blank string is an absence, normalised here so the page never has to tell "" from null.
    // A page that rendered "" would show a label with nothing after it, which reads as a failure.
    it("turns a blank name into null rather than an empty string", () => {
      const draft = fullDraft();
      draft.presiding = { printedName: "Mark Andersen", publicName: "   " };
      draft.announcements = "";

      const result = toPublicProgram(draft);

      expect(result.presiding).toBeNull();
      expect(result.announcements).toBeNull();
    });

    it("nulls a nullable person entirely when there is nobody in the slot", () => {
      const draft = fullDraft();
      draft.organist = null;
      draft.chorister = null;
      draft.invocation = null;
      draft.benediction = null;

      const result = toPublicProgram(draft);

      expect(result.organist).toBeNull();
      expect(result.chorister).toBeNull();
      expect(result.invocation).toBeNull();
      expect(result.benediction).toBeNull();
    });

    it("omits a musical number with neither a performer nor a piece", () => {
      const draft = fullDraft();
      draft.musicalNumber = {
        performer: { printedName: null, publicName: null },
        pieceTitle: "  ",
        notes: "internal",
      };

      expect(toPublicProgram(draft).musicalNumber).toBeNull();
    });

    it("keeps a musical number that has a piece but nobody named yet", () => {
      const draft = fullDraft();
      draft.musicalNumber = {
        performer: { printedName: null, publicName: null },
        pieceTitle: "I Am a Child of God",
        notes: null,
      };

      expect(toPublicProgram(draft).musicalNumber).toEqual({
        performer: null,
        pieceTitle: "I Am a Child of God",
      });
    });

    it("publishes no heading on an ordinary Sunday", () => {
      const draft = fullDraft();
      draft.heading = null;
      draft.sundayType = "standard";

      expect(toPublicProgram(draft).heading).toBeNull();
    });

    // No field is ever a placeholder. A draft never holds one either (assembleDraft), and this is
    // the second gate: a placeholder written into public_data would be printed by program-d and
    // read by a congregation exactly as though somebody had typed it.
    it("invents no placeholder text for anything that is missing", () => {
      const draft = fullDraft();
      draft.organist = null;
      draft.sacramentHymn = null;
      draft.announcements = null;

      const serialised = JSON.stringify(toPublicProgram(draft));

      for (const placeholder of ["TBD", "Not yet assigned", "None", "N/A", "Nobody yet"]) {
        expect(serialised).not.toContain(placeholder);
      }
    });
  });
});
