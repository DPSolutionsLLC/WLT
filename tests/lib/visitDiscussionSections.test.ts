import { describe, expect, it } from "vitest";
import {
  addVisitDiscussions,
  agendaTemplate,
  FLAGGED_SECTION_TITLE,
  newAgendaItem,
  removeVisitDiscussion,
  VISIT_DISCUSSION_SECTION_TITLE,
  visitDiscussionIds,
  visitDiscussionLine,
} from "@/lib/agendas/sections";
import { agendaSectionsSchema } from "@/lib/validation/agenda";

// "Discuss in bishopric meeting" on an agenda (ITER-055 bv7) — the pure half.

const VISIT_A = "11111111-0000-4000-8000-000000000001";
const VISIT_B = "11111111-0000-4000-8000-000000000002";

describe("visitDiscussionLine", () => {
  it("names the family and nothing else", () => {
    expect(visitDiscussionLine("Ellis")).toBe("Visit — Ellis family — to discuss");
  });

  it("says 'A household' when the household is gone", () => {
    expect(visitDiscussionLine(null)).toBe("Visit — A household family — to discuss");
  });
});

describe("addVisitDiscussions", () => {
  it("makes a 'Visits to discuss' section right after the flagged section", () => {
    const sections = addVisitDiscussions(agendaTemplate(), [
      { sourceId: VISIT_A, text: visitDiscussionLine("Ellis") },
    ]);
    const titles = sections.map((section) => section.title);
    const flaggedAt = titles.indexOf(FLAGGED_SECTION_TITLE);

    expect(titles[flaggedAt + 1]).toBe(VISIT_DISCUSSION_SECTION_TITLE);
    expect(sections[flaggedAt + 1].items).toEqual([
      expect.objectContaining({ source: "visit_discussion", sourceId: VISIT_A }),
    ]);
    expect(sections[flaggedAt + 1].carryForward).toBe(false);
  });

  it("puts the section at the end when the ward removed the flagged heading", () => {
    const withoutFlagged = agendaTemplate().filter(
      (section) => section.title !== FLAGGED_SECTION_TITLE,
    );
    const sections = addVisitDiscussions(withoutFlagged, [{ sourceId: VISIT_A, text: "x" }]);
    expect(sections.at(-1)?.title).toBe(VISIT_DISCUSSION_SECTION_TITLE);
  });

  it("appends to an existing section and never adds a visit twice", () => {
    const once = addVisitDiscussions(agendaTemplate(), [{ sourceId: VISIT_A, text: "a" }]);
    const twice = addVisitDiscussions(once, [
      { sourceId: VISIT_A, text: "a" },
      { sourceId: VISIT_B, text: "b" },
    ]);

    expect(twice.filter((section) => section.title === VISIT_DISCUSSION_SECTION_TITLE)).toHaveLength(1);
    expect(visitDiscussionIds(twice)).toEqual([VISIT_A, VISIT_B]);
  });

  it("returns the same sections when there is nothing to add", () => {
    const template = agendaTemplate();
    expect(addVisitDiscussions(template, [])).toBe(template);
  });

  it("produces sections the agenda schema accepts", () => {
    const sections = addVisitDiscussions(agendaTemplate(), [{ sourceId: VISIT_A, text: "a" }]);
    expect(agendaSectionsSchema.safeParse(sections).success).toBe(true);
  });
});

describe("visitDiscussionIds", () => {
  it("reads only visit_discussion lines — never a ward-council flag on the same visit", () => {
    const sections = agendaTemplate();
    sections[0].items.push(newAgendaItem("flagged", "flag", VISIT_B));
    const withDiscussion = addVisitDiscussions(sections, [{ sourceId: VISIT_A, text: "a" }]);

    expect(visitDiscussionIds(withDiscussion)).toEqual([VISIT_A]);
  });
});

describe("removeVisitDiscussion", () => {
  it("takes off only that visit's discussion line and keeps the section", () => {
    const sections = addVisitDiscussions(agendaTemplate(), [
      { sourceId: VISIT_A, text: "a" },
      { sourceId: VISIT_B, text: "b" },
    ]);
    sections[0].items.push(newAgendaItem("flagged", "flag", VISIT_A));

    const removed = removeVisitDiscussion(sections, VISIT_A);

    expect(visitDiscussionIds(removed)).toEqual([VISIT_B]);
    expect(removed[0].items).toEqual([expect.objectContaining({ source: "flag", sourceId: VISIT_A })]);
    expect(removed.some((section) => section.title === VISIT_DISCUSSION_SECTION_TITLE)).toBe(true);
  });
});
