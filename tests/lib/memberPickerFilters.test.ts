// MemberPicker's filter composition, which is the part of a frozen interface most likely to be
// got wrong quietly. resolvePickerFilter builds the SERVER filter — and therefore the query key
// — while narrowPickerMembers applies everything the server cannot filter on.
//
// The single most important assertion in this file is that `moved_out` never appears in the
// resolved statuses under any combination of props. Every downstream number in the app — the
// speaker rotation, the visit-goal denominator, the ward count — is wrong the moment a picker
// offers someone who has moved out (02-roster.md §Pitfalls).

import { describe, expect, it } from "vitest";
import {
  groupMembersByHousehold,
  narrowPickerMembers,
  resolvePickerFilter,
  type MemberPickerProps,
} from "@/components/roster/MemberPicker";
import type { Member } from "@/lib/roster/queries";
import {
  MEMBER_STATUSES,
  type MemberStatus,
  type Role,
  type SessionUser,
} from "@/types/domain";

const ELDERS_QUORUM_ID = "00000000-0000-4000-8000-0000000000e1";
const RELIEF_SOCIETY_ID = "00000000-0000-4000-8000-0000000000e2";
const ANDERSEN_HOUSEHOLD_ID = "00000000-0000-4000-8000-0000000000h1";
const SMITH_HOUSEHOLD_ID = "00000000-0000-4000-8000-0000000000h2";

function sessionUser(role: Role, orgId: string | null = null): SessionUser {
  return {
    id: "00000000-0000-4000-8000-000000000001",
    wardId: "00000000-0000-4000-8000-000000000002",
    role,
    orgId,
    counselorPosition: null,
    firstName: "Test",
    lastName: "User",
    username: null,
    themePreference: "system",
    isActive: true,
  };
}

function pickerProps(overrides: Partial<MemberPickerProps> = {}): MemberPickerProps {
  return {
    value: [],
    onChange: () => {},
    user: sessionUser("bishop"),
    ...overrides,
  };
}

function member(overrides: Partial<Member> & { id: string }): Member {
  return {
    householdId: null,
    firstName: "Test",
    lastName: "Member",
    category: "adult",
    gender: "male",
    status: "active",
    phone: null,
    createdAt: "2026-01-01T00:00:00.000Z",
    ...overrides,
  };
}

describe("resolvePickerFilter", () => {
  const bishop = sessionUser("bishop");
  const eqPresident = sessionUser("org_president", ELDERS_QUORUM_ID);

  it("defaults to active members with no organization for a bishop", () => {
    const filter = resolvePickerFilter(pickerProps(), bishop);

    expect(filter.statuses).toEqual(["active"]);
    expect(filter.organizationId).toBeUndefined();
  });

  it("defaults to the org president's own organization", () => {
    const filter = resolvePickerFilter(
      pickerProps({ user: eqPresident }),
      eqPresident,
    );

    expect(filter.organizationId).toBe(ELDERS_QUORUM_ID);
  });

  it("lets an explicit organization override the session default", () => {
    const filter = resolvePickerFilter(
      pickerProps({
        user: eqPresident,
        filter: { organizationId: RELIEF_SOCIETY_ID },
      }),
      eqPresident,
    );

    expect(filter.organizationId).toBe(RELIEF_SOCIETY_ID);
  });

  describe("the do_not_contact override", () => {
    it("omits do_not_contact by default", () => {
      const filter = resolvePickerFilter(pickerProps(), bishop);

      expect(filter.statuses).not.toContain("do_not_contact");
    });

    // Decision 2: when the override has not been confirmed they are not FETCHED, so they cannot
    // reach the browser through a component that forgot to hide them.
    it("omits do_not_contact even when a caller asks for it directly", () => {
      const filter = resolvePickerFilter(
        pickerProps({ filter: { statuses: ["active", "do_not_contact"] } }),
        bishop,
      );

      expect(filter.statuses).toEqual(["active"]);
    });

    it("includes do_not_contact once allowed", () => {
      const filter = resolvePickerFilter(
        pickerProps({ allowDoNotContact: true }),
        bishop,
      );

      expect(filter.statuses).toContain("do_not_contact");
    });
  });

  // The assertion that protects the rest of the app. Exhaustive over every status, both values
  // of allowDoNotContact, and the no-filter case — a future prop that widens statuses has to
  // break this test to get in.
  describe("moved_out is never offered", () => {
    const combinations: Array<{ name: string; props: MemberPickerProps }> = [
      { name: "no filter at all", props: pickerProps() },
      {
        name: "moved_out requested outright",
        props: pickerProps({ filter: { statuses: ["moved_out"] } }),
      },
      {
        name: "moved_out alongside active",
        props: pickerProps({ filter: { statuses: ["active", "moved_out"] } }),
      },
      {
        name: "every status requested",
        props: pickerProps({ filter: { statuses: MEMBER_STATUSES } }),
      },
      {
        name: "every status requested with the override on",
        props: pickerProps({
          filter: { statuses: MEMBER_STATUSES },
          allowDoNotContact: true,
        }),
      },
    ];

    it.each(combinations)("omits moved_out with $name", ({ props }) => {
      expect(resolvePickerFilter(props, bishop).statuses).not.toContain("moved_out");
    });

    // A caller asking for moved_out and nothing else would otherwise resolve to an empty list,
    // and an empty `.in("status", [])` falls back to the data layer's default — which would
    // quietly widen rather than narrow. Active is the floor.
    it("falls back to active rather than an empty status list", () => {
      const filter = resolvePickerFilter(
        pickerProps({ filter: { statuses: ["moved_out"] } }),
        bishop,
      );

      expect(filter.statuses).toEqual(["active"]);
    });
  });

  // excludeIds changes every time a picker opens. Keying the cache on it would produce one
  // cache entry per opening and defeat the point of caching the roster at all.
  it("keeps excludeIds out of the query filter", () => {
    const filter = resolvePickerFilter(
      pickerProps({ excludeIds: ["00000000-0000-4000-8000-00000000000f"] }),
      bishop,
    );

    expect(Object.keys(filter)).toEqual(["statuses"]);
  });

  // Same reasoning: categories, genders and householdId narrow in memory, so two pickers with
  // different category filters share one fetch.
  it("keeps the client-side filters out of the query filter", () => {
    const filter = resolvePickerFilter(
      pickerProps({
        filter: {
          categories: ["youth"],
          genders: ["male"],
          householdId: ANDERSEN_HOUSEHOLD_ID,
        },
      }),
      bishop,
    );

    expect(filter).toEqual({ statuses: ["active"] });
  });
});

describe("narrowPickerMembers", () => {
  const mark = member({
    id: "m-mark",
    firstName: "Mark",
    lastName: "Andersen",
    householdId: ANDERSEN_HOUSEHOLD_ID,
    category: "adult",
    gender: "male",
  });
  const ethan = member({
    id: "m-ethan",
    firstName: "Ethan",
    lastName: "Andersen",
    householdId: ANDERSEN_HOUSEHOLD_ID,
    category: "youth",
    gender: "male",
  });
  const grace = member({
    id: "m-grace",
    firstName: "Grace",
    lastName: "Smith",
    householdId: SMITH_HOUSEHOLD_ID,
    category: "youth",
    gender: "female",
  });

  const all = [mark, ethan, grace];
  const householdNames = {
    [ANDERSEN_HOUSEHOLD_ID]: "Andersen",
    [SMITH_HOUSEHOLD_ID]: "Smith",
  };

  it("returns everyone when nothing narrows", () => {
    expect(narrowPickerMembers(all, {})).toEqual(all);
  });

  it("narrows by category", () => {
    expect(
      narrowPickerMembers(all, { categories: ["youth"] }).map((entry) => entry.id),
    ).toEqual(["m-ethan", "m-grace"]);
  });

  it("narrows by gender", () => {
    expect(
      narrowPickerMembers(all, { genders: ["female"] }).map((entry) => entry.id),
    ).toEqual(["m-grace"]);
  });

  it("narrows by household", () => {
    expect(
      narrowPickerMembers(all, { householdId: SMITH_HOUSEHOLD_ID }).map(
        (entry) => entry.id,
      ),
    ).toEqual(["m-grace"]);
  });

  // Phase 10: the water blesser must differ from the bread blesser.
  it("removes excluded ids", () => {
    expect(
      narrowPickerMembers(all, { excludeIds: ["m-mark"] }).map((entry) => entry.id),
    ).toEqual(["m-ethan", "m-grace"]);
  });

  it("matches a search against a first or last name", () => {
    expect(
      narrowPickerMembers(all, { search: "eth", householdNames }).map(
        (entry) => entry.id,
      ),
    ).toEqual(["m-ethan"]);
  });

  // The household half of the search, which is what makes the flattened list useful: a family
  // name matches everyone living under it even though it is not on the member's own row.
  it("matches a search against the household family name", () => {
    expect(
      narrowPickerMembers(all, { search: "andersen", householdNames }).map(
        (entry) => entry.id,
      ),
    ).toEqual(["m-mark", "m-ethan"]);
  });

  it("combines a category filter with an exclusion", () => {
    expect(
      narrowPickerMembers(all, {
        categories: ["youth"],
        excludeIds: ["m-ethan"],
      }).map((entry) => entry.id),
    ).toEqual(["m-grace"]);
  });
});

describe("groupMembersByHousehold", () => {
  const householdNames = {
    [ANDERSEN_HOUSEHOLD_ID]: "Andersen",
    [SMITH_HOUSEHOLD_ID]: "Smith",
  };

  it("groups members under their household name, alphabetically", () => {
    const groups = groupMembersByHousehold(
      [
        member({ id: "m-grace", householdId: SMITH_HOUSEHOLD_ID }),
        member({ id: "m-mark", householdId: ANDERSEN_HOUSEHOLD_ID }),
      ],
      householdNames,
    );

    expect(groups.map((group) => group.householdName)).toEqual(["Andersen", "Smith"]);
  });

  // The member with no household is the reason the flat roster list exists at all. A picker
  // that grouped strictly by household would lose them, silently.
  it("puts members with no household in a group of their own, last", () => {
    const groups = groupMembersByHousehold(
      [
        member({ id: "m-jonah", householdId: null }),
        member({ id: "m-mark", householdId: ANDERSEN_HOUSEHOLD_ID }),
      ],
      householdNames,
    );

    expect(groups.map((group) => group.householdName)).toEqual([
      "Andersen",
      "No household",
    ]);
    expect(groups[1]?.members.map((entry) => entry.id)).toEqual(["m-jonah"]);
  });
});

// A guard rather than a behaviour: MEMBER_STATUSES is what the exhaustive moved_out table above
// iterates, so a fourth status added to the domain without a decision here would otherwise slip
// through as an untested combination.
describe("the status domain", () => {
  it("still holds exactly the three statuses this picker reasons about", () => {
    const known: readonly MemberStatus[] = ["active", "moved_out", "do_not_contact"];

    expect([...MEMBER_STATUSES].sort()).toEqual([...known].sort());
  });
});
