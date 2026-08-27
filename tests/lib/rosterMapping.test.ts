import { describe, expect, it } from "vitest";
import {
  mapHouseholdRow,
  mapMemberRow,
  toSearchPattern,
  type HouseholdRow,
  type MemberRow,
} from "@/lib/roster/queries";

// snake_case in SQL, camelCase in TypeScript, mapped exactly once (CLAUDE.md §6). A mapper
// that drops a field fails silently — the value is simply undefined everywhere downstream.

function memberRow(overrides: Partial<MemberRow> = {}): MemberRow {
  return {
    id: "11111111-1111-4111-8111-111111111111",
    household_id: "22222222-2222-4222-8222-222222222222",
    first_name: "Tomas",
    last_name: "Ruiz",
    category: "adult",
    gender: "male",
    status: "active",
    phone: "555-0100",
    created_at: "2026-08-01T00:00:00.000Z",
    ...overrides,
  };
}

function householdRow(overrides: Partial<HouseholdRow> = {}): HouseholdRow {
  return {
    id: "22222222-2222-4222-8222-222222222222",
    family_name: "Ruiz",
    address: "12 Oak Street",
    latitude: null,
    longitude: null,
    do_not_contact: false,
    created_at: "2026-08-01T00:00:00.000Z",
    ...overrides,
  };
}

describe("mapMemberRow", () => {
  const CASES: Array<[keyof MemberRow, string, unknown]> = [
    ["first_name", "firstName", "Tomas"],
    ["last_name", "lastName", "Ruiz"],
    ["household_id", "householdId", "22222222-2222-4222-8222-222222222222"],
    ["created_at", "createdAt", "2026-08-01T00:00:00.000Z"],
  ];

  for (const [column, property, expected] of CASES) {
    it(`maps ${column} to ${property}`, () => {
      const member = mapMemberRow(memberRow()) as unknown as Record<string, unknown>;

      expect(member[property]).toBe(expected);
      expect(member[column]).toBeUndefined();
    });
  }

  it("keeps nullable columns as null rather than undefined", () => {
    const member = mapMemberRow(
      memberRow({ household_id: null, category: null, gender: null, phone: null }),
    );

    expect(member.householdId).toBeNull();
    expect(member.category).toBeNull();
    expect(member.gender).toBeNull();
    expect(member.phone).toBeNull();
  });

  // Pins Decision 1 of plans/roster-a-data-and-pages.md. There is no members.notes column —
  // notes live in member_notes behind their own policy, because RLS grants a row and never a
  // column. This assertion is what catches a future column being added and blindly spread.
  it("produces no notes key", () => {
    const member = mapMemberRow(memberRow());

    expect(Object.keys(member)).not.toContain("notes");
    expect("notes" in member).toBe(false);
  });

  it("throws when the status column holds a value the union does not know", () => {
    expect(() => mapMemberRow(memberRow({ status: "deceased" }))).toThrow(/drifted/);
  });

  it("throws when the category column has drifted", () => {
    expect(() => mapMemberRow(memberRow({ category: "senior" }))).toThrow(/drifted/);
  });
});

describe("mapHouseholdRow", () => {
  it("maps family_name and created_at", () => {
    const household = mapHouseholdRow(householdRow());

    expect(household.familyName).toBe("Ruiz");
    expect(household.createdAt).toBe("2026-08-01T00:00:00.000Z");
    expect((household as unknown as Record<string, unknown>).family_name).toBeUndefined();
  });

  // A new column that the mapper does not know about is SILENTLY DROPPED — no error, just
  // `undefined` everywhere downstream (CLAUDE.md rule 9). This is the assertion for the one
  // ITER-018 added.
  it("maps do_not_contact to doNotContact", () => {
    expect(mapHouseholdRow(householdRow()).doNotContact).toBe(false);
    expect(mapHouseholdRow(householdRow({ do_not_contact: true })).doNotContact).toBe(true);
    expect(
      (mapHouseholdRow(householdRow()) as unknown as Record<string, unknown>).do_not_contact,
    ).toBeUndefined();
  });

  it("keeps a missing address as null", () => {
    expect(mapHouseholdRow(householdRow({ address: null })).address).toBeNull();
  });
});

describe("toSearchPattern", () => {
  it("wraps an ordinary term in wildcards", () => {
    expect(toSearchPattern("ruiz")).toBe("%ruiz%");
  });

  // PostgREST's `or` filter is comma-delimited and gives `.`, `(`, `)` and `"` their own
  // meaning; ILIKE gives `%` and `_` theirs. An unescaped one changes what the query asks for.
  it("neutralises the characters that would change the filter's meaning", () => {
    const pattern = toSearchPattern('smith,ward_id.eq.(1)"');

    expect(pattern).not.toContain(",");
    expect(pattern).not.toContain(".");
    expect(pattern).not.toContain("(");
    expect(pattern).not.toContain(")");
    expect(pattern).not.toContain('"');
    expect(pattern).not.toContain("_");
  });

  it("returns null when nothing searchable is left", () => {
    expect(toSearchPattern("   ")).toBeNull();
    expect(toSearchPattern("%_,")).toBeNull();
  });
});
