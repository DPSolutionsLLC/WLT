// @vitest-environment node
//
// The bifold PDF, rendered for real and then read back.
//
// ---------------------------------------------------------------------------------------------
// THE TEXT IS EXTRACTED FROM THE ACTUAL PDF, NOT ASSERTED ON A COMPONENT TREE
// ---------------------------------------------------------------------------------------------
// A shallow-render test would prove that four components were passed the right props. It would
// not notice a layout that overflows its panel, a page that never got its second half, or a
// `null` that reached the renderer as the string "null". Rendering to a Buffer and pulling the
// text back out with unpdf — already a dependency, used by lib/knowledge/parseDocument.ts — checks
// the artefact rather than the intention.
//
// ---------------------------------------------------------------------------------------------
// WHAT THIS SUITE CANNOT DO
// ---------------------------------------------------------------------------------------------
// It can prove that the OUTSIDE panels share page 1 and the INSIDE panels share page 2, which is
// the half of imposition that is expressible in software. It cannot prove that a sheet folded once
// puts the cover on the outside right — that depends on the printer's duplex flip edge and on
// physical paper. Scenario 034 is the only check for it, and it is a Definition-of-Done item for
// Milestone M4 for exactly this reason.

import { describe, expect, it } from "vitest";
import { extractText } from "unpdf";
import { renderProgramPdf } from "@/lib/pdf/renderProgram";
import type { ProgramDraft } from "@/lib/program/draft";
import type { ProgramTemplate } from "@/lib/program/gather";

const WARD_NAME = "Buffalo Ward";
const EXTERNAL_SPEAKER = "President Mark Andersen";
const LEADERSHIP_PHONE = "555-0142";

function template(overrides: Partial<ProgramTemplate> = {}): ProgramTemplate {
  return {
    wardName: WARD_NAME,
    churchName: "The Church of Jesus Christ of Latter-day Saints",
    coverImageUrl: null,
    fontFamily: "serif",
    primaryColor: "#1a1a1a",
    ...overrides,
  };
}

// Every field populated. A fixture with holes in it would let a panel that drops a whole section
// pass unnoticed.
function fullDraft(): ProgramDraft {
  return {
    version: 1,
    heading: "Ward Conference",
    date: "2026-09-20",
    sundayType: "ward_conference",
    presiding: { printedName: "Mark Andersen", publicName: "Mark Andersen" },
    conducting: { printedName: "Peter Lindqvist", publicName: "Peter Lindqvist" },
    organist: { printedName: "Ruth Delgado", publicName: "Ruth Delgado" },
    chorister: { printedName: "Anna Whitfield", publicName: "Anna Whitfield" },
    openingHymn: { number: 19, title: "We Thank Thee, O God, for a Prophet" },
    invocation: { printedName: "David Brooks", publicName: "David Brooks" },
    wardBusiness: "Sustaining of a new Primary president.",
    sacramentHymn: { number: 193, title: "I Stand All Amazed" },
    specialNotes: "The choir will remain after the meeting.",
    musicalNumber: {
      performer: { printedName: "The Primary children", publicName: "The Primary children" },
      pieceTitle: "I Am a Child of God",
      notes: null,
    },
    speakers: [
      {
        slotNumber: 1,
        kind: "member",
        printedName: "Sarah Whitfield",
        publicName: "Sarah Whitfield",
        topic: "Charity Never Faileth",
      },
      // ITER-004. The name and title somebody typed in order to have them printed.
      {
        slotNumber: 2,
        kind: "external",
        printedName: EXTERNAL_SPEAKER,
        publicName: EXTERNAL_SPEAKER,
        topic: null,
      },
    ],
    closingHymn: { number: 152, title: "God Be with You Till We Meet Again" },
    benediction: { printedName: "Ellen Moretti", publicName: "Ellen Moretti" },
    announcements: "Ward temple night is on the 14th.",
    leadershipContacts: [
      { role: "Bishop", name: "Mark Andersen", phone: LEADERSHIP_PHONE },
      { role: "Ward Secretary", name: "Ruth Delgado", phone: "555-0102" },
    ],
    missionaries: "Elder Kim and Elder Osei",
    missing: [],
  };
}

// A Thursday-night programme: no speakers confirmed, two hymns unchosen, no contacts, no
// announcements. Every optional field null. This is the shape a real ward has for most of the week
// and the one most likely to throw.
function sparseDraft(): ProgramDraft {
  return {
    version: 1,
    heading: null,
    date: "2026-09-27",
    sundayType: "standard",
    presiding: { printedName: "Mark Andersen", publicName: "Mark Andersen" },
    conducting: { printedName: null, publicName: null },
    organist: null,
    chorister: null,
    openingHymn: null,
    invocation: null,
    wardBusiness: null,
    sacramentHymn: { number: 193, title: "I Stand All Amazed" },
    specialNotes: null,
    musicalNumber: null,
    speakers: [
      { slotNumber: 1, kind: "empty", printedName: null, publicName: null, topic: null },
      { slotNumber: 2, kind: "empty", printedName: null, publicName: null, topic: null },
    ],
    closingHymn: null,
    benediction: null,
    announcements: null,
    leadershipContacts: [],
    missionaries: null,
    missing: ["opening_hymn", "closing_hymn", "speaker_slot"],
  };
}

async function renderPages(
  draft: ProgramDraft,
  overrides: Partial<ProgramTemplate> = {},
): Promise<{ pages: string[]; warnings: string[] }> {
  const result = await renderProgramPdf({
    draft,
    template: template(overrides),
    fallbackWardName: WARD_NAME,
    qrDataUri: null,
    publicUrl: null,
  });

  // mergePages: false gives one entry per page, which is what makes the imposition assertions
  // below possible at all.
  const { text } = await extractText(new Uint8Array(result.buffer), { mergePages: false });

  return { pages: text, warnings: result.warnings };
}

describe("renderProgramPdf", () => {
  describe("a full draft", () => {
    it("renders two pages", async () => {
      const { pages } = await renderPages(fullDraft());

      // One landscape sheet, printed double-sided: the front and the reverse.
      expect(pages).toHaveLength(2);
    });

    it("puts the two OUTSIDE panels on the front of the sheet", async () => {
      const { pages } = await renderPages(fullDraft());
      const front = pages[0];

      // The cover — outside right.
      expect(front).toContain(WARD_NAME);
      expect(front).toContain("Sacrament Meeting");
      // The back panel — outside left.
      expect(front).toContain("Elder Kim");
      expect(front).toContain("Ward temple night");
    });

    it("puts the two INSIDE panels on the reverse of the sheet", async () => {
      const { pages } = await renderPages(fullDraft());
      const reverse = pages[1];

      // Contacts — inside left. The phone number belongs HERE and nowhere public.
      expect(reverse).toContain("Ward Leadership");
      expect(reverse).toContain(LEADERSHIP_PHONE);
      // Meeting order — inside right.
      expect(reverse).toContain("Order of Meeting");
      expect(reverse).toContain("I Stand All Amazed");
    });

    it("does not put a meeting-order line on the same side as the cover", async () => {
      const { pages } = await renderPages(fullDraft());

      // The failure this guards against is the whole imposition collapsing into reading order —
      // cover, then meeting order, on one side. If somebody reorders ProgramDocument's pages to
      // "make it read properly", this is what says no.
      expect(pages[0]).not.toContain("Order of Meeting");
      expect(pages[1]).not.toContain("Sacrament Meeting");
    });

    // ITER-004, on the printed half. The public half is tests/lib/publicProjection.test.ts.
    it("prints an external speaker's full name and title", async () => {
      const { pages } = await renderPages(fullDraft());

      expect(pages[1]).toContain(EXTERNAL_SPEAKER);
    });
  });

  describe("a sparse draft", () => {
    it("renders without throwing", async () => {
      const { pages } = await renderPages(sparseDraft());

      expect(pages).toHaveLength(2);
    });

    // The property this whole file exists to protect. A congregation does not need to read what
    // the bishopric has not finished, and a placeholder baked into a printed handout is worse than
    // a blank line — it reads as though somebody typed it.
    const placeholders = ["TBD", "Nobody yet", "Not chosen yet", "null", "undefined", "None"];

    for (const placeholder of placeholders) {
      it(`never prints "${placeholder}"`, async () => {
        const { pages } = await renderPages(sparseDraft());

        expect(pages.join("\n")).not.toContain(placeholder);
      });
    }

    it("omits the label of an empty line, not just its value", async () => {
      const { pages } = await renderPages(sparseDraft());
      const whole = pages.join("\n");

      // A label with nothing after it is the failure mode a value-only check would miss.
      expect(whole).not.toContain("ORGANIST");
      expect(whole).not.toContain("BENEDICTION");
      // The one hymn that IS chosen still prints, so this is not just an empty document.
      expect(whole).toContain("I Stand All Amazed");
    });

    it("renders nothing for a null heading", async () => {
      const { pages } = await renderPages(sparseDraft());

      // program-a Decision 1: `heading` is the ward-conference case and renders NOTHING when null.
      expect(pages[0]).not.toContain("Ward Conference");
    });
  });

  describe("the ward's configured colour", () => {
    it("is accepted when it can be read on white paper", async () => {
      const { warnings } = await renderPages(fullDraft(), { primaryColor: "#7b1d1d" });

      expect(warnings).toEqual([]);
    });

    // A ward-visible failure with no error attached is exactly what the contrast guard is for:
    // 200 programmes printed in pale yellow because a settings box was mistyped.
    it("is refused with a reported reason when it is too pale", async () => {
      const { warnings } = await renderPages(fullDraft(), { primaryColor: "#ffee88" });

      expect(warnings).toHaveLength(1);
      expect(warnings[0]).toContain("too pale to read");
    });

    it("is refused with its own reason when it is not a hex colour", async () => {
      const { warnings } = await renderPages(fullDraft(), { primaryColor: "rebeccapurple" });

      expect(warnings).toHaveLength(1);
      expect(warnings[0]).toContain("not a hex colour");
    });
  });

  describe("a ward with no settings at all", () => {
    // Every ward, until Phase 11's admin screen is filled in. It must still print.
    it("renders using the ward row's own name", async () => {
      const { pages } = await renderPages(sparseDraft(), {
        wardName: null,
        churchName: null,
        fontFamily: null,
        primaryColor: null,
      });

      expect(pages[0]).toContain(WARD_NAME);
      // The cover uppercases the church name — see CoverPanel.
      expect(pages[0]).toContain("LATTER-DAY SAINTS");
    });
  });
});
