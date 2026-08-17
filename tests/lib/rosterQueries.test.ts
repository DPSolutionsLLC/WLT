// @vitest-environment node
//
// Integration coverage for lib/roster/queries.ts against the real database. The pure parts of
// this module (status resolution, row mapping, search-term cleaning) are tested without a
// network round trip in memberStatusFilter.test.ts and rosterMapping.test.ts. What is asserted
// here is the part those cannot reach: that the queries this module BUILDS are accepted by
// PostgREST and return what the module claims.
//
// The two paths that justify the network cost:
//   - the hand-built `.or()` filter, whose grammar is the module's own string concatenation
//   - the two-step organizationId read through member_organizations
// Both are consumed unchanged by roster-b's MemberPicker, so a malformed filter here would
// surface as a bug in two plans at once.
//
// Reads go through an AUTHENTICATED client, not the service client, so RLS applies exactly as
// it will in the app. Fixtures clean up after themselves — these run against the shared hosted
// project (CLAUDE.md §9).

import type { SupabaseClient } from "@supabase/supabase-js";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  createHousehold,
  createMember,
  getHousehold,
  getMember,
  listHouseholds,
  listMembers,
  updateHousehold,
  updateMember,
} from "@/lib/roster/queries";
import { asRole } from "@/tests/helpers/asRole";
import { seedFixtures, type Fixtures } from "@/tests/helpers/seed";
import type { Database } from "@/types/database";

describe("roster queries", () => {
  let fixtures: Fixtures;
  let bishop: SupabaseClient<Database>;
  let wardBBishop: SupabaseClient<Database>;

  let andersenId: string;
  let smithNorthId: string;
  let smithSouthId: string;

  let markId: string;
  let ethanId: string;
  let movedOutId: string;
  let doNotContactId: string;
  let unhousedId: string;

  function names(members: Array<{ firstName: string; lastName: string }>): string[] {
    return members.map((member) => `${member.firstName} ${member.lastName}`).sort();
  }

  beforeAll(async () => {
    fixtures = await seedFixtures(["bishop", "eqPresident", "wardBBishop"]);

    bishop = await asRole(fixtures, "bishop");
    wardBBishop = await asRole(fixtures, "wardBBishop");

    const insertHousehold = async (familyName: string, address: string | null) => {
      const { data, error } = await fixtures.service
        .from("households")
        .insert({ ward_id: fixtures.wardAId, family_name: familyName, address })
        .select("id")
        .single();
      if (error) throw new Error(error.message);
      return data.id;
    };

    const insertMember = async (row: {
      firstName: string;
      lastName: string;
      householdId?: string | null;
      category?: string | null;
      status?: string;
    }) => {
      const { data, error } = await fixtures.service
        .from("members")
        .insert({
          ward_id: fixtures.wardAId,
          household_id: row.householdId ?? null,
          first_name: row.firstName,
          last_name: row.lastName,
          category: row.category ?? "adult",
          status: row.status ?? "active",
        })
        .select("id")
        .single();
      if (error) throw new Error(error.message);
      return data.id;
    };

    andersenId = await insertHousehold("Andersen", "12 Oak Street");
    smithNorthId = await insertHousehold("Smith", "3 North Road");
    smithSouthId = await insertHousehold("Smith", "91 South Road");

    markId = await insertMember({
      firstName: "Mark",
      lastName: "Andersen",
      householdId: andersenId,
    });
    ethanId = await insertMember({
      firstName: "Ethan",
      lastName: "Andersen",
      householdId: andersenId,
      category: "youth",
    });
    await insertMember({
      firstName: "Daniel",
      lastName: "Smith",
      householdId: smithNorthId,
    });
    await insertMember({
      firstName: "Peter",
      lastName: "Smith",
      householdId: smithSouthId,
    });
    movedOutId = await insertMember({
      firstName: "Carlos",
      lastName: "Departed",
      householdId: andersenId,
      status: "moved_out",
    });
    doNotContactId = await insertMember({
      firstName: "Helen",
      lastName: "Guarded",
      householdId: smithNorthId,
      status: "do_not_contact",
    });
    unhousedId = await insertMember({
      firstName: "Jonah",
      lastName: "Whitfield",
      householdId: null,
    });

    const { error: orgError } = await fixtures.service
      .from("member_organizations")
      .insert([
        {
          ward_id: fixtures.wardAId,
          member_id: markId,
          org_id: fixtures.eldersQuorumId,
        },
        {
          ward_id: fixtures.wardAId,
          member_id: doNotContactId,
          org_id: fixtures.eldersQuorumId,
        },
      ]);
    if (orgError) throw new Error(orgError.message);
  });

  afterAll(async () => {
    await fixtures?.cleanup();
  });

  describe("listMembers status default", () => {
    // The unit test proves resolveMemberStatuses returns ["active"]. This proves the resulting
    // `.in("status", …)` actually keeps a moved-out member out of the result set.
    it("returns no moved_out member when called with no options", async () => {
      const members = await listMembers(fixtures.wardAId, undefined, bishop);
      const ids = members.map((member) => member.id);

      expect(ids).toContain(markId);
      expect(ids).not.toContain(movedOutId);
      expect(ids).not.toContain(doNotContactId);
    });

    it("returns a moved_out member only when asked", async () => {
      const members = await listMembers(
        fixtures.wardAId,
        { statuses: ["active", "moved_out"] },
        bishop,
      );

      expect(members.map((member) => member.id)).toContain(movedOutId);
    });

    it("includes the member with no household", async () => {
      const members = await listMembers(fixtures.wardAId, undefined, bishop);

      expect(members.map((member) => member.id)).toContain(unhousedId);
    });
  });

  // The `.or()` filter is built by string concatenation in this module, so its grammar is the
  // module's own responsibility rather than the client library's. Every assertion below would
  // fail loudly on a malformed one — PostgREST rejects a bad filter with a 400.
  describe("listMembers search", () => {
    it("matches a partial first name", async () => {
      const members = await listMembers(fixtures.wardAId, { search: "eth" }, bishop);

      expect(members.map((member) => member.id)).toEqual([ethanId]);
    });

    it("matches a partial last name, case-insensitively", async () => {
      const members = await listMembers(fixtures.wardAId, { search: "ANDERS" }, bishop);

      expect(names(members)).toEqual(["Ethan Andersen", "Mark Andersen"]);
    });

    // The cross-table half: the term matches no member's own name, only the family name of the
    // household they belong to. This is the path that needs the household lookup and the
    // `household_id.in.(…)` term inside the or filter.
    it("matches everyone in a household whose family name matches", async () => {
      const members = await listMembers(fixtures.wardAId, { search: "smith" }, bishop);

      expect(names(members)).toEqual(["Daniel Smith", "Peter Smith"]);
    });

    it("returns an empty list rather than erroring when nothing matches", async () => {
      const members = await listMembers(
        fixtures.wardAId,
        { search: "nobodyhasthisname" },
        bishop,
      );

      expect(members).toEqual([]);
    });

    // The reason toSearchPattern exists. An unescaped comma would close the or filter's first
    // condition and start a new one, so a term shaped like a filter could widen the result set
    // past what the caller asked for. It must come back as a literal that matches nothing.
    it("treats a term shaped like a PostgREST filter as literal text", async () => {
      const members = await listMembers(
        fixtures.wardAId,
        { search: `x,ward_id.neq.${fixtures.wardAId}` },
        bishop,
      );

      expect(members).toEqual([]);
    });

    // A term made entirely of neutralised characters leaves nothing to search for. The
    // tempting shortcut is to drop the filter, which silently returns the whole ward — more
    // than the caller asked for, which is the wrong direction for a search to fail in.
    it("returns nothing, not everything, for a term that is only wildcards", async () => {
      expect(await listMembers(fixtures.wardAId, { search: "%" }, bishop)).toEqual([]);
      expect(await listMembers(fixtures.wardAId, { search: "%_," }, bishop)).toEqual([]);
    });

    it("returns nothing for a wildcard-only household search too", async () => {
      expect(await listHouseholds(fixtures.wardAId, { search: "%" }, bishop)).toEqual([]);
    });

    it("combines a search with a category filter", async () => {
      const members = await listMembers(
        fixtures.wardAId,
        { search: "andersen", category: "youth" },
        bishop,
      );

      expect(members.map((member) => member.id)).toEqual([ethanId]);
    });
  });

  describe("listMembers organization filter", () => {
    // The two-step read: member_organizations first, then `.in("id", …)`. roster-b's caller
    // default is built on exactly this.
    it("returns only members of the named organization", async () => {
      const members = await listMembers(
        fixtures.wardAId,
        { organizationId: fixtures.eldersQuorumId },
        bishop,
      );

      expect(members.map((member) => member.id)).toEqual([markId]);
    });

    // The status default still applies on top of the organization filter — the do-not-contact
    // member above is in the elders quorum and must not appear without being asked for.
    it("still applies the status default within an organization", async () => {
      const withDoNotContact = await listMembers(
        fixtures.wardAId,
        {
          organizationId: fixtures.eldersQuorumId,
          statuses: ["active", "do_not_contact"],
        },
        bishop,
      );

      expect(withDoNotContact.map((member) => member.id).sort()).toEqual(
        [markId, doNotContactId].sort(),
      );
    });

    it("returns an empty list for an organization with no members", async () => {
      const members = await listMembers(
        fixtures.wardAId,
        { organizationId: fixtures.reliefSocietyId },
        bishop,
      );

      expect(members).toEqual([]);
    });
  });

  describe("listHouseholds", () => {
    it("groups members under their household", async () => {
      const households = await listHouseholds(fixtures.wardAId, undefined, bishop);
      const andersen = households.find((household) => household.id === andersenId);

      expect(andersen?.familyName).toBe("Andersen");
      expect(names(andersen?.members ?? [])).toEqual(["Ethan Andersen", "Mark Andersen"]);
    });

    it("leaves a moved_out member out of the group by default", async () => {
      const households = await listHouseholds(fixtures.wardAId, undefined, bishop);
      const andersen = households.find((household) => household.id === andersenId);

      expect(andersen?.members.map((member) => member.id)).not.toContain(movedOutId);
    });

    it("keeps two households that share a family name separate", async () => {
      const households = await listHouseholds(
        fixtures.wardAId,
        { search: "smith" },
        bishop,
      );

      const smiths = households.filter((household) => household.familyName === "Smith");
      expect(smiths).toHaveLength(2);
      expect(smiths.map((household) => household.address).sort()).toEqual([
        "3 North Road",
        "91 South Road",
      ]);
    });

    // A household whose family name does not match, found only because someone living in it
    // does. Without this the household view would lose people the flat list can find.
    it("finds a household by the name of someone living in it", async () => {
      const households = await listHouseholds(
        fixtures.wardAId,
        { search: "ethan" },
        bishop,
      );

      expect(households.map((household) => household.id)).toEqual([andersenId]);
    });

    it("narrows the members shown by category without dropping the household", async () => {
      const households = await listHouseholds(
        fixtures.wardAId,
        { category: "youth" },
        bishop,
      );

      const andersen = households.find((household) => household.id === andersenId);
      const smithNorth = households.find((household) => household.id === smithNorthId);

      expect(andersen?.members.map((member) => member.id)).toEqual([ethanId]);
      expect(smithNorth).toBeDefined();
      expect(smithNorth?.members).toEqual([]);
    });
  });

  describe("getMember and getHousehold", () => {
    it("returns a member with their household attached", async () => {
      const member = await getMember(fixtures.wardAId, markId, bishop);

      expect(member?.firstName).toBe("Mark");
      expect(member?.household?.familyName).toBe("Andersen");
    });

    it("returns a member with no household as household: null", async () => {
      const member = await getMember(fixtures.wardAId, unhousedId, bishop);

      expect(member?.household).toBeNull();
    });

    it("returns null for an id that does not exist", async () => {
      const member = await getMember(
        fixtures.wardAId,
        "00000000-0000-4000-8000-0000000000ff",
        bishop,
      );

      expect(member).toBeNull();
    });

    // Deliberately unlike listHouseholds: a detail page that hid the member who moved out
    // would make them unreachable from the only page listing their family.
    it("includes a moved_out member on the household detail read", async () => {
      const household = await getHousehold(fixtures.wardAId, andersenId, bishop);

      expect(household?.members.map((member) => member.id)).toContain(movedOutId);
    });
  });

  describe("writes", () => {
    it("creates and updates a household", async () => {
      const created = await createHousehold(
        fixtures.wardAId,
        { familyName: "Petersen", address: "14 Birch Way" },
        bishop,
      );

      expect(created.familyName).toBe("Petersen");

      const updated = await updateHousehold(
        fixtures.wardAId,
        created.id,
        { address: "15 Birch Way" },
        bishop,
      );

      expect(updated?.address).toBe("15 Birch Way");
    });

    it("creates a member and moves them out without deleting them", async () => {
      const created = await createMember(
        fixtures.wardAId,
        {
          householdId: andersenId,
          firstName: "Temporary",
          lastName: "Resident",
          category: "adult",
          gender: null,
          status: "active",
          phone: null,
        },
        bishop,
      );

      const movedOut = await updateMember(
        fixtures.wardAId,
        created.id,
        { status: "moved_out" },
        bishop,
      );

      expect(movedOut?.status).toBe("moved_out");

      const stillThere = await getMember(fixtures.wardAId, created.id, bishop);
      expect(stillThere?.id).toBe(created.id);
    });

    // An UPDATE denied by policy comes back as success with zero rows, not an error
    // (plans/retros/foundation-c-services.md). The route turns this null into a 404 rather
    // than reporting a save that never happened.
    it("returns null when the row is not in the caller's ward", async () => {
      const updated = await updateMember(
        fixtures.wardAId,
        "00000000-0000-4000-8000-0000000000ff",
        { phone: "555-0000" },
        bishop,
      );

      expect(updated).toBeNull();
    });
  });

  // RLS is the boundary, not the wardId argument. Passing ward A's id from a ward B session
  // must still return nothing — if this ever passes rows, the ward scope has become a
  // convention rather than a guarantee.
  describe("ward isolation", () => {
    it("returns no ward A members to a ward B session", async () => {
      const members = await listMembers(fixtures.wardAId, undefined, wardBBishop);

      expect(members).toEqual([]);
    });

    it("returns no ward A households to a ward B session", async () => {
      const households = await listHouseholds(fixtures.wardAId, undefined, wardBBishop);

      expect(households).toEqual([]);
    });

    it("returns null for a ward A member read from a ward B session", async () => {
      expect(await getMember(fixtures.wardAId, markId, wardBBishop)).toBeNull();
    });
  });
});
