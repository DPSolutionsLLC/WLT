import { describe, expect, it } from "vitest";
import {
  ageOn,
  plannerNameOf,
  toPlannerWardList,
  type PlannerWardMember,
} from "@/lib/sacramentPlanner/wardList";

function member(overrides: Partial<PlannerWardMember>): PlannerWardMember {
  return {
    householdId: null,
    firstName: "Jane",
    lastName: "Doe",
    preferredName: null,
    fullName: null,
    birthDate: null,
    gender: null,
    phone: null,
    email: null,
    category: null,
    ...overrides,
  };
}

describe("plannerNameOf", () => {
  it("prefers the preferred name", () => {
    expect(
      plannerNameOf(member({ preferredName: "Doe, Janie", fullName: "Doe, Jane Marie" })),
    ).toBe("Doe, Janie");
  });

  it("falls back to the full name, then to Last, First", () => {
    expect(plannerNameOf(member({ fullName: "Doe, Jane Marie" }))).toBe("Doe, Jane Marie");
    expect(plannerNameOf(member({ preferredName: "  " }))).toBe("Doe, Jane");
  });
});

describe("ageOn", () => {
  it("is one year younger on the day before the birthday", () => {
    expect(ageOn("2000-10-24", "2026-10-23")).toBe(25);
  });

  it("turns over on the birthday itself", () => {
    expect(ageOn("2000-10-23", "2026-10-23")).toBe(26);
  });

  it("is null with no birth date", () => {
    expect(ageOn(null, "2026-10-23")).toBeNull();
  });
});

describe("toPlannerWardList", () => {
  const TODAY = "2026-10-23";

  it("builds the Planner's tuple in its order: name, age, gender, phone, phoneVia, email", () => {
    const rows = toPlannerWardList(
      [
        member({
          preferredName: "Doe, Jane",
          birthDate: "1980-01-01",
          gender: "female",
          phone: "307-555-0101",
          email: "jane@example.com",
        }),
      ],
      TODAY,
    );
    expect(rows).toEqual([["Doe, Jane", 46, "F", "307-555-0101", "", "jane@example.com"]]);
  });

  it("maps male to M and an unknown gender to an empty string", () => {
    const rows = toPlannerWardList(
      [member({ firstName: "Al", gender: "male" }), member({ firstName: "Bo", gender: null })],
      TODAY,
    );
    expect(rows.map((row) => row[2])).toEqual(["M", ""]);
  });

  it("reaches somebody with no phone through a man in their household before an older woman", () => {
    const rows = toPlannerWardList(
      [
        member({ householdId: "h1", firstName: "Kid", birthDate: "2015-05-05" }),
        member({
          householdId: "h1",
          firstName: "Dad",
          birthDate: "1985-01-01",
          gender: "male",
          phone: "111",
        }),
        member({
          householdId: "h1",
          firstName: "Grandma",
          birthDate: "1950-01-01",
          gender: "female",
          phone: "222",
        }),
        member({ householdId: "h1", firstName: "Teen", birthDate: "2010-01-01", phone: "333" }),
      ],
      TODAY,
    );
    const kid = rows.find((row) => row[0] === "Doe, Kid");
    expect(kid?.[3]).toBe("111");
    expect(kid?.[4]).toBe("Doe, Dad");
  });

  it("picks the oldest of several men, and the oldest woman when no man has a phone", () => {
    const withMen = toPlannerWardList(
      [
        member({ householdId: "h1", firstName: "Kid", birthDate: "2015-05-05" }),
        member({ householdId: "h1", firstName: "Son", birthDate: "2000-01-01", gender: "male", phone: "1" }),
        member({ householdId: "h1", firstName: "Dad", birthDate: "1970-01-01", gender: "male", phone: "2" }),
      ],
      TODAY,
    );
    expect(withMen.find((row) => row[0] === "Doe, Kid")?.[4]).toBe("Doe, Dad");

    const withoutMen = toPlannerWardList(
      [
        member({ householdId: "h1", firstName: "Kid", birthDate: "2015-05-05" }),
        member({ householdId: "h1", firstName: "Dad", birthDate: "1970-01-01", gender: "male" }),
        member({ householdId: "h1", firstName: "Aunt", birthDate: "1990-01-01", gender: "female", phone: "3" }),
        member({ householdId: "h1", firstName: "Mom", birthDate: "1972-01-01", gender: "female", phone: "4" }),
      ],
      TODAY,
    );
    expect(withoutMen.find((row) => row[0] === "Doe, Kid")?.[4]).toBe("Doe, Mom");
  });

  it("never reaches somebody through a minor's phone", () => {
    const rows = toPlannerWardList(
      [
        member({ householdId: "h1", firstName: "Kid", birthDate: "2015-05-05" }),
        member({ householdId: "h1", firstName: "Teen", birthDate: "2010-01-01", phone: "333" }),
      ],
      TODAY,
    );
    expect(rows.find((row) => row[0] === "Doe, Kid")?.slice(3, 5)).toEqual(["", ""]);
  });

  it("leaves a person with their own phone alone", () => {
    const rows = toPlannerWardList(
      [
        member({ householdId: "h1", firstName: "Mom", birthDate: "1980-01-01", phone: "444" }),
        member({ householdId: "h1", firstName: "Grandpa", birthDate: "1940-01-01", phone: "555" }),
      ],
      TODAY,
    );
    expect(rows.find((row) => row[0] === "Doe, Mom")?.slice(3, 5)).toEqual(["444", ""]);
  });

  it("sorts by name the way the Planner's list was sorted", () => {
    const rows = toPlannerWardList(
      [member({ lastName: "Young" }), member({ lastName: "Adams" }), member({ lastName: "Mills" })],
      TODAY,
    );
    expect(rows.map((row) => row[0])).toEqual(["Adams, Jane", "Mills, Jane", "Young, Jane"]);
  });

  it("serves exactly the members it is given, so the caller's statuses decide who is listed", () => {
    expect(toPlannerWardList([], TODAY)).toEqual([]);
  });
});
