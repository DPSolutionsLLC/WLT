import { describe, expect, it } from "vitest";
import {
  MAX_DOCUMENT_CHARACTERS,
  plannerWriteSchema,
  validatePlannerDocument,
} from "@/lib/sacramentPlanner/documentSchemas";

// Every refusal below uses data that passes every check that runs BEFORE the one under test, so
// it is refused for the reason being tested rather than for an earlier one.

describe("validatePlannerDocument — ids", () => {
  it("accepts a Sunday saved under its own date", () => {
    expect(
      validatePlannerDocument("real", "sundays", "2026-10-18", { date: "2026-10-18", slots: [] }),
    ).toEqual({ ok: true });
  });

  it("refuses a Sunday id that is not a date", () => {
    const check = validatePlannerDocument("real", "sundays", "next-week", { date: "next-week" });
    expect(check.ok).toBe(false);
  });

  it("refuses a Sunday whose date does not match its id", () => {
    const check = validatePlannerDocument("real", "sundays", "2026-10-18", {
      date: "2026-10-25",
    });
    expect(check).toEqual({
      ok: false,
      problem: "A Sunday's date must match the date it is saved under.",
    });
  });

  it.each(["bishopric", "rotation", "contacts", "autoRelease", "topics"])(
    "accepts the settings document %s",
    (id) => {
      expect(validatePlannerDocument("real", "settings", id, {})).toEqual({ ok: true });
    },
  );

  it("refuses a settings id the Planner does not use", () => {
    expect(validatePlannerDocument("real", "settings", "theme", {}).ok).toBe(false);
  });

  it.each(["k1a2b3c4-12", "xlq8m2abcde", "2019-03-03-C-1", "k9f00d1-9|kabc-4", "a.b:c_d"])(
    "accepts the id shape %s",
    (id) => {
      expect(validatePlannerDocument("real", "rowFixes", id, {})).toEqual({ ok: true });
    },
  );

  it.each(["has space", "slash/inside", "x".repeat(201), "émoji"])("refuses the id %j", (id) => {
    expect(validatePlannerDocument("real", "rowFixes", id, {}).ok).toBe(false);
  });
});

describe("validatePlannerDocument — shapes", () => {
  it("keeps every field, including ones nobody declared", () => {
    const data = { name: "Doe, Jane", count: 2, approvals: ["A"], unexpected: { nested: true } };
    expect(validatePlannerDocument("real", "deferrals", "k1-8", data)).toEqual({ ok: true });
  });

  it("refuses a deferral with no name", () => {
    const check = validatePlannerDocument("real", "deferrals", "k1-8", { count: 1 });
    expect(check.ok).toBe(false);
    if (!check.ok) expect(check.problem).toMatch(/name/);
  });

  it("refuses a mark with a name but no author", () => {
    expect(validatePlannerDocument("real", "marks", "k1-8", { name: "Doe, Jane" }).ok).toBe(false);
  });

  it("refuses a consider with a name but no kind", () => {
    expect(validatePlannerDocument("real", "considers", "x1", { name: "Doe, Jane" }).ok).toBe(
      false,
    );
  });

  it("refuses a name fix with a key but no person", () => {
    expect(validatePlannerDocument("real", "nameFixes", "k1-8", { key: "Jane" }).ok).toBe(false);
  });

  it("accepts the practice layer's delete marker", () => {
    expect(validatePlannerDocument("practice", "deferrals", "k1-8", { __del: true })).toEqual({
      ok: true,
    });
  });

  it("refuses the delete marker in the real layer", () => {
    expect(validatePlannerDocument("real", "deferrals", "k1-8", { __del: true }).ok).toBe(false);
  });

  it("refuses a record over the size cap", () => {
    const data = { name: "Doe, Jane", log: "x".repeat(MAX_DOCUMENT_CHARACTERS) };
    const check = validatePlannerDocument("real", "deferrals", "k1-8", data);
    expect(check).toEqual({
      ok: false,
      problem: "That record is too large to save. Try removing some of it.",
    });
  });
});

describe("plannerWriteSchema", () => {
  const valid = { layer: "real", collection: "marks", documentId: "k1-8", data: {} };

  it("accepts a well-formed write", () => {
    expect(plannerWriteSchema.safeParse(valid).success).toBe(true);
  });

  it("refuses an unknown layer", () => {
    expect(plannerWriteSchema.safeParse({ ...valid, layer: "test" }).success).toBe(false);
  });

  it("refuses data that is not an object", () => {
    expect(plannerWriteSchema.safeParse({ ...valid, data: ["a"] }).success).toBe(false);
  });
});
