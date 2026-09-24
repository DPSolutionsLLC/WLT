import { describe, expect, it } from "vitest";
import {
  agendaTemplate,
  carryForwardSection,
  countAgendaItems,
  findSectionByTitle,
  FLAGGED_SECTION_TITLE,
  newAgendaItem,
  newAgendaSection,
} from "@/lib/agendas/sections";
import {
  compareActionItems,
  describeCarriedFrom,
  itemsToCarryForward,
  openActionItems,
  type ActionItem,
} from "@/lib/agendas/carryForward";
import { agendaSectionsSchema, createAgendaSchema } from "@/lib/validation/agenda";

// The pure half of the agenda module. No database, no clock, no browser.

function actionItem(overrides: Partial<ActionItem> = {}): ActionItem {
  return {
    id: crypto.randomUUID(),
    agendaId: "agenda-1",
    description: "Visit the Diaz family",
    assignedTo: null,
    assignedUserId: null,
    completionReviewRequestedAt: null,
    dueDate: null,
    status: "open",
    carriedFromAgendaId: null,
    completedAt: null,
    createdAt: "2026-09-01T00:00:00Z",
    ...overrides,
  };
}

describe("the agenda template", () => {
  it("starts every agenda with the seven standing sections", () => {
    const sections = agendaTemplate();

    expect(sections.map((section) => section.title)).toEqual([
      "Opening and prayer",
      "Approval of previous minutes",
      "Flagged ward council items",
      "Organization reports",
      "Action items",
      "New business",
      "Closing and prayer",
    ]);
  });

  // EXACTLY ONE, and the Zod schema enforces the same thing on every write. Two would make
  // carryForwardSection() return whichever came first, so carried items would land somewhere that
  // depends on array order.
  it("marks exactly one section as the one carried items land in", () => {
    const sections = agendaTemplate();
    const carrying = sections.filter((section) => section.carryForward);

    expect(carrying).toHaveLength(1);
    expect(carrying[0].title).toBe("Action items");
    expect(carryForwardSection(sections)?.title).toBe("Action items");
  });

  it("gives every section and item a fresh id, so two agendas never share one", () => {
    const first = agendaTemplate();
    const second = agendaTemplate();

    const ids = new Set([...first, ...second].map((section) => section.id));
    expect(ids.size).toBe(first.length + second.length);
  });

  // The flagged section is found by TITLE, so a ward that renames it gets its flags in a section
  // of their own making — the behaviour a rename is asking for.
  it("finds the flagged section by title, ignoring case and padding", () => {
    const sections = agendaTemplate();

    expect(findSectionByTitle(sections, FLAGGED_SECTION_TITLE)).not.toBeNull();
    expect(findSectionByTitle(sections, "  flagged WARD council ITEMS ")).not.toBeNull();
    expect(findSectionByTitle(sections, "Tithing")).toBeNull();
  });

  it("returns null rather than inventing a section when the ward deleted the carrying one", () => {
    const sections = agendaTemplate().filter((section) => !section.carryForward);
    expect(carryForwardSection(sections)).toBeNull();
  });

  it("counts every line across every section", () => {
    const sections = agendaTemplate();
    sections[0].items.push(newAgendaItem("Opening hymn"), newAgendaItem("Prayer by Br Diaz"));
    sections[3].items.push(newAgendaItem("Relief Society report"));

    expect(countAgendaItems(sections)).toBe(3);
  });

  it("makes a new section that does not steal the carried items", () => {
    const section = newAgendaSection("Tithing declaration");
    expect(section.carryForward).toBe(false);
    expect(section.items).toEqual([]);
  });
});

describe("carrying action items forward", () => {
  // ---------------------------------------------------------------------------
  // THE ASSERTION THIS SUITE EXISTS FOR
  // ---------------------------------------------------------------------------
  // §Step A3: "Carry-forward is a copy, not a move, so each agenda remains an accurate record of
  // what was discussed that day." A move would silently remove a line last month's agenda
  // genuinely contained, so the minutes would then disagree with the meeting.
  it("copies the open items and leaves the originals untouched", () => {
    const open = actionItem({ description: "Assign a new ministering companionship" });
    const done = actionItem({ description: "Order the manuals", status: "complete" });
    const previous = [open, done];

    const carried = itemsToCarryForward(previous, "agenda-previous");

    expect(carried).toHaveLength(1);
    expect(carried[0].description).toBe("Assign a new ministering companionship");
    // The originals are the same objects, unmodified — a move would have mutated or removed them.
    expect(previous).toHaveLength(2);
    expect(previous[0].status).toBe("open");
  });

  it("leaves a completed item behind", () => {
    const carried = itemsToCarryForward(
      [actionItem({ status: "complete", completedAt: "2026-09-01T00:00:00Z" })],
      "agenda-previous",
    );
    expect(carried).toEqual([]);
  });

  it("carries the assignee and the due date with the description", () => {
    const carried = itemsToCarryForward(
      [actionItem({ assignedTo: "Sister Alvarez", dueDate: "2026-10-01" })],
      "agenda-previous",
    );

    expect(carried[0].assignedTo).toBe("Sister Alvarez");
    expect(carried[0].dueDate).toBe("2026-10-01");
  });

  // Slice p5-b: the assignment stands on the copy, an unanswered review request goes with it, and
  // the copy names the row it came from so the create route can move the assignee's to-do link.
  it("carries the assigned account, its review request, and the id of the item it copies", () => {
    const original = actionItem({
      assignedUserId: "user-eq-president",
      completionReviewRequestedAt: "2026-09-18T20:00:00Z",
    });

    const [carried] = itemsToCarryForward([original], "agenda-previous");

    expect(carried.assignedUserId).toBe("user-eq-president");
    expect(carried.completionReviewRequestedAt).toBe("2026-09-18T20:00:00Z");
    expect(carried.carriedFromItemId).toBe(original.id);
  });

  // ALWAYS THE AGENDA IT IS BEING COPIED FROM, never the original's own origin. An item open
  // across four meetings should read "carried from" the LAST one, because that is where it was
  // last discussed; pointing every copy at the first would make the chain a star rather than a
  // line and lose the meetings in between.
  it("points a twice-carried item at the meeting it came from, not the one it started in", () => {
    const alreadyCarried = actionItem({ carriedFromAgendaId: "agenda-first" });

    const carried = itemsToCarryForward([alreadyCarried], "agenda-second");

    expect(carried[0].carriedFromAgendaId).toBe("agenda-second");
  });

  it("says where a carried item came from, and says nothing for one raised here", () => {
    expect(describeCarriedFrom("Tuesday, November 12, 2026")).toBe(
      "carried from Tuesday, November 12, 2026",
    );
    expect(describeCarriedFrom(null)).toBeNull();
  });

  // COMPLETED ITEMS STAY ON THE AGENDA rather than vanishing when ticked: what was closed at this
  // meeting is half of what a meeting produced. They sort below the open ones because the open
  // ones are what the meeting is for.
  it("sorts open items above completed ones, each oldest first", () => {
    const items = [
      actionItem({ description: "done later", status: "complete", createdAt: "2026-09-02T00:00:00Z" }),
      actionItem({ description: "open later", createdAt: "2026-09-04T00:00:00Z" }),
      actionItem({ description: "done earlier", status: "complete", createdAt: "2026-09-01T00:00:00Z" }),
      actionItem({ description: "open earlier", createdAt: "2026-09-03T00:00:00Z" }),
    ];

    expect([...items].sort(compareActionItems).map((item) => item.description)).toEqual([
      "open earlier",
      "open later",
      "done earlier",
      "done later",
    ]);
  });

  it("counts only the open ones", () => {
    const items = [actionItem(), actionItem({ status: "complete" }), actionItem()];
    expect(openActionItems(items)).toHaveLength(2);
  });
});

describe("validating the sections blob", () => {
  // §Step A1 asks for this by name: "A malformed blob breaks the PDF renderer and is hard to
  // diagnose after the fact." migration 012 gave `sections` no shape at all, so this schema is the
  // only thing between a bad write and a render failure weeks later.
  it("accepts the template it ships with", () => {
    expect(agendaSectionsSchema.safeParse(agendaTemplate()).success).toBe(true);
  });

  it("refuses two sections claiming the carried items", () => {
    const sections = agendaTemplate();
    sections[0].carryForward = true;

    const result = agendaSectionsSchema.safeParse(sections);
    expect(result.success).toBe(false);
  });

  it("accepts an agenda with no carrying section at all", () => {
    const sections = agendaTemplate().filter((section) => !section.carryForward);
    expect(agendaSectionsSchema.safeParse(sections).success).toBe(true);
  });

  it("refuses a blank heading and a blank line", () => {
    const blankTitle = agendaTemplate();
    blankTitle[0].title = "   ";
    expect(agendaSectionsSchema.safeParse(blankTitle).success).toBe(false);

    const blankItem = agendaTemplate();
    blankItem[0].items.push({ ...newAgendaItem("x"), text: "  " });
    expect(agendaSectionsSchema.safeParse(blankItem).success).toBe(false);
  });

  it("refuses the shapes migration 012 would happily store", () => {
    for (const blob of [42, "sections", { title: "Opening" }, [{ title: "Opening" }]]) {
      expect(agendaSectionsSchema.safeParse(blob).success).toBe(false);
    }
  });

  it("insists a meeting date is a day, never an instant", () => {
    const base = { meetingType: "ward_council" as const };

    expect(createAgendaSchema.safeParse({ ...base, meetingDate: "2026-11-12" }).success).toBe(true);
    expect(
      createAgendaSchema.safeParse({ ...base, meetingDate: "2026-11-12T19:00:00Z" }).success,
    ).toBe(false);
    expect(createAgendaSchema.safeParse({ ...base, meetingDate: "12/11/2026" }).success).toBe(false);
  });

  it("refuses a meeting type the database would reject", () => {
    expect(
      createAgendaSchema.safeParse({ meetingType: "elders_quorum", meetingDate: "2026-11-12" })
        .success,
    ).toBe(false);
  });
});
