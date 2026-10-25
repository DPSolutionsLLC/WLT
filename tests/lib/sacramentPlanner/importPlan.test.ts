import { describe, expect, it } from "vitest";
import {
  canonicalJson,
  countByCollection,
  planPlannerImport,
  type SettingsDefaults,
} from "@/lib/sacramentPlanner/importPlan";

const DEFAULTS: SettingsDefaults = {
  bishopric: [
    { name: "Bishop, Test", role: "Bishop" },
    { name: "First, Test", role: "1st Counselor" },
    { name: "Second, Test", role: "2nd Counselor" },
  ],
  rotation: { start: "2026-01", order: ["Bishop, Test", "First, Test", "Second, Test"] },
};

const SUNDAY = { date: "2026-10-25", slots: [], type: "regular" };
const DEFERRAL = { name: "Doe, Jane", count: 1, status: "active" };

describe("planPlannerImport", () => {
  it("keeps every document under its original id with every field", () => {
    const plan = planPlannerImport(
      {
        sundays: { "2026-10-25": { ...SUNDAY, unknownField: { kept: true } } },
        deferrals: { abc123: DEFERRAL },
        settings: { bishopric: { members: [] }, rotation: { start: "2026-01", order: [] } },
      },
      DEFAULTS,
    );

    expect(plan.failures).toEqual([]);
    expect(plan.documents).toContainEqual({
      collection: "sundays",
      documentId: "2026-10-25",
      data: { ...SUNDAY, unknownField: { kept: true } },
    });
    expect(plan.documents).toContainEqual({ collection: "deferrals", documentId: "abc123", data: DEFERRAL });
  });

  it("skips practice collections and reports them", () => {
    const plan = planPlannerImport(
      { t_sundays: { "2026-10-25": SUNDAY }, deferrals: { abc123: DEFERRAL } },
      DEFAULTS,
    );

    expect(plan.skippedPracticeCollections).toEqual(["t_sundays"]);
    expect(plan.documents.some((document) => document.collection === "sundays")).toBe(false);
  });

  it("refuses a collection the Planner does not have", () => {
    const plan = planPlannerImport({ invoices: { one: { name: "x" } } }, DEFAULTS);
    expect(plan.unknownCollections).toEqual(["invoices"]);
  });

  it("adds the bishopric and rotation settings only when the export lacks them", () => {
    const lacking = planPlannerImport({ settings: { contacts: { execSecretary: "" } } }, DEFAULTS);
    expect(lacking.addedSettings).toEqual(["bishopric", "rotation"]);
    expect(lacking.documents).toContainEqual({
      collection: "settings",
      documentId: "bishopric",
      data: { members: DEFAULTS.bishopric },
    });

    const having = planPlannerImport(
      { settings: { bishopric: { members: [] }, rotation: { start: "2025-01", order: [] } } },
      DEFAULTS,
    );
    expect(having.addedSettings).toEqual([]);
    expect(having.documents).toContainEqual({
      collection: "settings",
      documentId: "rotation",
      data: { start: "2025-01", order: [] },
    });
  });

  it("reports a document the save route would refuse, with a valid collection and id", () => {
    const plan = planPlannerImport(
      { sundays: { "2026-10-25": { ...SUNDAY, date: "2026-11-01" } } },
      DEFAULTS,
    );
    expect(plan.failures).toHaveLength(1);
    expect(plan.failures[0]).toContain("sundays/2026-10-25");
  });

  it("reports a deferral missing its name, with a valid collection and id", () => {
    const plan = planPlannerImport({ deferrals: { abc123: { count: 1 } } }, DEFAULTS);
    expect(plan.failures).toHaveLength(1);
    expect(plan.failures[0]).toContain("deferrals/abc123");
  });
});

describe("countByCollection", () => {
  it("counts documents per collection", () => {
    expect(
      countByCollection([{ collection: "sundays" }, { collection: "sundays" }, { collection: "marks" }]),
    ).toEqual({ sundays: 2, marks: 1 });
  });
});

describe("canonicalJson", () => {
  it("treats the same document with keys in another order as equal", () => {
    expect(canonicalJson({ b: 1, a: { d: [1, { y: 2, x: 1 }], c: null } })).toBe(
      canonicalJson({ a: { c: null, d: [1, { x: 1, y: 2 }] }, b: 1 }),
    );
  });

  it("tells different documents apart", () => {
    expect(canonicalJson({ a: 1 })).not.toBe(canonicalJson({ a: 2 }));
    expect(canonicalJson([1, 2])).not.toBe(canonicalJson([2, 1]));
  });
});
