import { describe, expect, it } from "vitest";
import { bishopricRoleLabel, plannerNameFor } from "@/lib/sacramentPlanner/identity";

const BISHOPRIC = {
  members: [
    { name: "Avery Stone", role: "Bishop" },
    { name: "Blake Rivers", role: "1st Counselor" },
    { name: "Casey Field", role: "2nd Counselor" },
  ],
};

describe("bishopricRoleLabel", () => {
  it("names the bishop", () => {
    expect(bishopricRoleLabel("bishop", null)).toBe("Bishop");
  });

  it("names each counselor by position", () => {
    expect(bishopricRoleLabel("counselor", 1)).toBe("1st Counselor");
    expect(bishopricRoleLabel("counselor", 2)).toBe("2nd Counselor");
  });

  it("gives a counselor with no position no label", () => {
    expect(bishopricRoleLabel("counselor", null)).toBeNull();
  });

  it("gives anybody outside the bishopric no label", () => {
    expect(bishopricRoleLabel("music_coordinator", null)).toBeNull();
    expect(bishopricRoleLabel("super_admin", null)).toBeNull();
  });
});

describe("plannerNameFor", () => {
  it("finds the name the Planner lists beside the role", () => {
    expect(plannerNameFor("Bishop", BISHOPRIC)).toBe("Avery Stone");
    expect(plannerNameFor("2nd Counselor", BISHOPRIC)).toBe("Casey Field");
  });

  it("returns null when the document is missing", () => {
    expect(plannerNameFor("Bishop", null)).toBeNull();
  });

  it("returns null when nobody holds that role", () => {
    expect(plannerNameFor("1st Counselor", { members: [{ name: "A", role: "Bishop" }] })).toBeNull();
  });

  it("returns null with no label, a malformed list or a blank name", () => {
    expect(plannerNameFor(null, BISHOPRIC)).toBeNull();
    expect(plannerNameFor("Bishop", { members: "nope" })).toBeNull();
    expect(plannerNameFor("Bishop", { members: [{ name: "  ", role: "Bishop" }] })).toBeNull();
  });
});
