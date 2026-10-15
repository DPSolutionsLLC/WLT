import { describe, expect, it } from "vitest";
import { ageGroupOn } from "@/lib/roster/ageGroup";

// The Church's rule: a youth from January 1 of the year they turn 12, an adult on their 18th
// birthday.

describe("ageGroupOn", () => {
  it("moves a child to youth on January 1 of the year they turn 12", () => {
    expect(ageGroupOn("2014-10-05", "2025-12-31")).toBe("child");
    expect(ageGroupOn("2014-10-05", "2026-01-01")).toBe("youth");
  });

  it("keeps a youth until the day before their 18th birthday", () => {
    expect(ageGroupOn("2008-06-13", "2026-06-12")).toBe("youth");
  });

  it("makes them an adult on their 18th birthday exactly", () => {
    expect(ageGroupOn("2008-06-13", "2026-06-13")).toBe("adult");
  });

  it("treats a February 29 birthday as March 1 in a year with no February 29", () => {
    expect(ageGroupOn("2008-02-29", "2026-02-28")).toBe("youth");
    expect(ageGroupOn("2008-02-29", "2026-03-01")).toBe("adult");
  });

  it("calls a newborn a child and an old member an adult", () => {
    expect(ageGroupOn("2026-10-01", "2026-10-14")).toBe("child");
    expect(ageGroupOn("1940-01-01", "2026-10-14")).toBe("adult");
  });
});
