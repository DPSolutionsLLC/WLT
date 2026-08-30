// @vitest-environment node
//
// Migration 059's policies, asserted from the database rather than from the routes.
//
// ---------------------------------------------------------------------------
// THE FIVE THINGS THIS SUITE EXISTS FOR
// ---------------------------------------------------------------------------
// 1. WARDS DO NOT LEAK. Ward A cannot read, insert into, update or delete ward B's occasions —
//    the ordinary ward-isolation obligation every table carries.
//
// 2. AN EVENT CANNOT BE LINKED TO ANOTHER WARD'S OCCASION. The composite foreign key refuses it,
//    and this is one of the few cases that genuinely RAISES rather than returning zero rows.
//
// 3. THE CROSS-ORGANIZATION CASE IS ALLOWED, AND THIS IS THE ASSERTION THAT PROVES THE DECISION.
//    A Young Men president links a Young Women youth's event into the same occasion. If this test
//    ever fails, the policy has been narrowed and the feature is gone — an occasion holding two
//    organizations' rows is ITER-024's "pleasing consequence" and the reason 059c is ward-wide on
//    all four verbs rather than org-scoped like 054d.
//
// 4. DELETING AN OCCASION LEAVES ITS EVENTS STANDING, WITH `occasion_id` NULL. This is the
//    migration 046/047 regression, and it is the entire reason the column list on
//    `on delete set null (occasion_id)` exists: a bare `set null` on a composite key nulls
//    `ward_id` too, which is `not null`, so the cascade raises and the occasion becomes
//    undeletable.
//
// 5. A REFUSED UPDATE OR DELETE IS A ZERO-ROW SUCCESS, NOT AN ERROR. Only INSERT raises. Every
//    refusal below is asserted by RE-READING the row with the SERVICE client; asserting on
//    `error` alone would pass against a policy that permits everything.
//
// The suite runs over the network against the shared hosted project, so it cleans up after itself
// and never assumes an empty table (CLAUDE.md §9).

import type { SupabaseClient } from "@supabase/supabase-js";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { asRole } from "@/tests/helpers/asRole";
import { seedFixtures, type Fixtures } from "@/tests/helpers/seed";
import type { Database } from "@/types/database";

describe("activity occasion scoping", () => {
  let fixtures: Fixtures;

  let eqPresident: SupabaseClient<Database>;
  let rsPresident: SupabaseClient<Database>;
  let wardBBishop: SupabaseClient<Database>;

  let wardAOccasionId: string;
  let wardBOccasionId: string;

  let eqProfileId: string;
  let rsProfileId: string;
  let wardBProfileId: string;

  let eqEventId: string;
  let rsEventId: string;
  let wardBEventId: string;

  // Rebuilt per test that consumes one, because linking and deleting are the point.
  const disposableOccasions: string[] = [];
  const disposableEvents: string[] = [];

  const seedOccasion = async (wardId: string): Promise<string> => {
    const { data, error } = await fixtures.service
      .from("activity_occasions")
      .insert({ ward_id: wardId })
      .select("id")
      .single();

    if (error) throw new Error(error.message);
    return data.id;
  };

  const seedEvent = async (
    wardId: string,
    profileId: string,
    title: string,
    occasionId: string | null = null,
  ): Promise<string> => {
    const { data, error } = await fixtures.service
      .from("activity_events")
      .insert({
        ward_id: wardId,
        profile_id: profileId,
        title: `${title} ${fixtures.runId}`,
        event_type: "home",
        event_date: "2027-11-14T19:30:00-07:00",
        status: "upcoming",
        occasion_id: occasionId,
      })
      .select("id")
      .single();

    if (error) throw new Error(error.message);
    return data.id;
  };

  // The service client bypasses RLS, so this is the ground truth a refused write is measured
  // against. A zero-row UPDATE looks identical to a successful one from the caller's side.
  const storedOccasionIds = async (): Promise<string[]> => {
    const { data, error } = await fixtures.service
      .from("activity_occasions")
      .select("id")
      .in("id", [wardAOccasionId, wardBOccasionId]);

    if (error) throw new Error(error.message);
    return (data ?? []).map((row) => row.id);
  };

  const storedEventOccasion = async (eventId: string): Promise<string | null> => {
    const { data, error } = await fixtures.service
      .from("activity_events")
      .select("occasion_id")
      .eq("id", eventId)
      .maybeSingle();

    if (error) throw new Error(error.message);
    return data?.occasion_id ?? null;
  };

  beforeAll(async () => {
    fixtures = await seedFixtures(["bishop", "eqPresident", "rsPresident", "wardBBishop"]);

    [eqPresident, rsPresident, wardBBishop] = await Promise.all([
      asRole(fixtures, "eqPresident"),
      asRole(fixtures, "rsPresident"),
      asRole(fixtures, "wardBBishop"),
    ]);

    const { data: members, error: memberError } = await fixtures.service
      .from("members")
      .insert([
        {
          ward_id: fixtures.wardAId,
          first_name: "Ada",
          last_name: `YouthA${fixtures.runId}`,
          category: "youth",
          status: "active",
        },
        {
          ward_id: fixtures.wardBId,
          first_name: "Bo",
          last_name: `YouthB${fixtures.runId}`,
          category: "youth",
          status: "active",
        },
      ])
      .select("id, ward_id");
    if (memberError) throw new Error(memberError.message);

    const wardAYouthId = members!.find((row) => row.ward_id === fixtures.wardAId)!.id;
    const wardBYouthId = members!.find((row) => row.ward_id === fixtures.wardBId)!.id;

    const { data: profiles, error: profileError } = await fixtures.service
      .from("youth_activity_profiles")
      .insert([
        {
          ward_id: fixtures.wardAId,
          org_id: fixtures.eldersQuorumId,
          member_id: wardAYouthId,
          activity_name: `EQ basketball ${fixtures.runId}`,
          activity_type: "sport",
        },
        {
          ward_id: fixtures.wardAId,
          org_id: fixtures.reliefSocietyId,
          member_id: wardAYouthId,
          activity_name: `RS basketball ${fixtures.runId}`,
          activity_type: "sport",
        },
        {
          ward_id: fixtures.wardBId,
          org_id: fixtures.wardBOrgId,
          member_id: wardBYouthId,
          activity_name: `Ward B track ${fixtures.runId}`,
          activity_type: "sport",
        },
      ])
      .select("id, ward_id, activity_name");
    if (profileError) throw new Error(profileError.message);

    eqProfileId = profiles!.find((row) => row.activity_name.startsWith("EQ"))!.id;
    rsProfileId = profiles!.find((row) => row.activity_name.startsWith("RS"))!.id;
    wardBProfileId = profiles!.find((row) => row.activity_name.startsWith("Ward B"))!.id;

    wardAOccasionId = await seedOccasion(fixtures.wardAId);
    wardBOccasionId = await seedOccasion(fixtures.wardBId);

    eqEventId = await seedEvent(fixtures.wardAId, eqProfileId, "EQ game", wardAOccasionId);
    rsEventId = await seedEvent(fixtures.wardAId, rsProfileId, "RS game");
    wardBEventId = await seedEvent(fixtures.wardBId, wardBProfileId, "Ward B meet");
  }, 180_000);

  afterAll(async () => {
    if (disposableEvents.length > 0) {
      await fixtures.service.from("activity_events").delete().in("id", disposableEvents);
    }
    if (disposableOccasions.length > 0) {
      await fixtures.service.from("activity_occasions").delete().in("id", disposableOccasions);
    }
    await fixtures?.cleanup();
  });

  describe("wards do not leak into each other", () => {
    it("hides ward B's occasion from ward A", async () => {
      const { data, error } = await eqPresident
        .from("activity_occasions")
        .select("id")
        .eq("id", wardBOccasionId);

      expect(error).toBeNull();
      expect(data ?? []).toEqual([]);
    });

    it("hides ward A's occasion from ward B's bishop", async () => {
      const { data, error } = await wardBBishop
        .from("activity_occasions")
        .select("id")
        .eq("id", wardAOccasionId);

      expect(error).toBeNull();
      expect(data ?? []).toEqual([]);
    });

    // An INSERT genuinely raises, unlike the two refusals below it.
    it("refuses an insert carrying another ward's ward_id", async () => {
      const { error } = await eqPresident
        .from("activity_occasions")
        .insert({ ward_id: fixtures.wardBId });

      expect(error).not.toBeNull();
    });

    // ASSERTED BY RE-READING WITH THE SERVICE CLIENT. An RLS-denied UPDATE is a zero-row success,
    // so `error === null` here proves nothing on its own.
    it("cannot update another ward's occasion", async () => {
      const { error } = await eqPresident
        .from("activity_occasions")
        .update({ created_by: fixtures.user("eqPresident").id })
        .eq("id", wardBOccasionId);

      expect(error).toBeNull();

      const { data } = await fixtures.service
        .from("activity_occasions")
        .select("created_by")
        .eq("id", wardBOccasionId)
        .maybeSingle();

      expect(data?.created_by).toBeNull();
    });

    it("cannot delete another ward's occasion", async () => {
      const { error } = await eqPresident
        .from("activity_occasions")
        .delete()
        .eq("id", wardBOccasionId);

      expect(error).toBeNull();
      expect(await storedOccasionIds()).toContain(wardBOccasionId);
    });

    // THE COMPOSITE FOREIGN KEY, DOING THE JOB THE ROUTE'S 404 IS ONLY THE POLITE VERSION OF.
    // This one raises: a foreign-key violation is not a policy refusal.
    it("refuses an event pointing at another ward's occasion", async () => {
      const { error } = await fixtures.service
        .from("activity_events")
        .update({ occasion_id: wardBOccasionId })
        .eq("id", eqEventId);

      expect(error).not.toBeNull();
      expect(await storedEventOccasion(eqEventId)).toBe(wardAOccasionId);
    });
  });

  // ---------------------------------------------------------------------------
  // AN OCCASION IS WARD-WIDE WITHIN ITS WARD — MIGRATION 059c, ON PURPOSE
  // ---------------------------------------------------------------------------
  // THE POSITIVE ASSERTIONS ARE THE POINT. Asserting only that ward B is hidden would leave a
  // later narrowing free to happen silently. Asserting that a Relief Society president CAN read
  // and CAN link an Elders Quorum occasion means a narrowing has to break a test rather than
  // quietly change behaviour, and whoever breaks it has to write down why.
  describe("a cross-organization occasion is the point, not an edge case", () => {
    it("lets another organization's president read it", async () => {
      const { data, error } = await rsPresident
        .from("activity_occasions")
        .select("id")
        .eq("id", wardAOccasionId);

      expect(error).toBeNull();
      expect(data?.map((row) => row.id)).toEqual([wardAOccasionId]);
    });

    it("lets another organization's president create one", async () => {
      const { data, error } = await rsPresident
        .from("activity_occasions")
        .insert({ ward_id: fixtures.wardAId, created_by: fixtures.user("rsPresident").id })
        .select("id")
        .single();

      expect(error).toBeNull();
      expect(data?.id).toBeDefined();
      if (data) disposableOccasions.push(data.id);
    });

    // THE FEATURE, IN ONE ASSERTION. The Elders Quorum's occasion takes in a Relief Society
    // youth's event, written by the Elders Quorum president. A write policy comparing
    // current_org_id() would make exactly this unwritable.
    it("lets one organization's president link another organization's event into it", async () => {
      const { error } = await eqPresident
        .from("activity_events")
        .update({ occasion_id: wardAOccasionId })
        .eq("id", rsEventId);

      expect(error).toBeNull();
      expect(await storedEventOccasion(rsEventId)).toBe(wardAOccasionId);

      // Left as it was found, because the next describe deletes this occasion.
      await fixtures.service
        .from("activity_events")
        .update({ occasion_id: null })
        .eq("id", rsEventId);
    });

    it("hides an occasion from a ward B account however it was created", async () => {
      const { data, error } = await wardBBishop.from("activity_occasions").select("id");

      expect(error).toBeNull();
      expect((data ?? []).map((row) => row.id)).not.toContain(wardAOccasionId);
    });
  });

  // ---------------------------------------------------------------------------
  // THE MIGRATION 046/047 REGRESSION
  // ---------------------------------------------------------------------------
  // A bare `on delete set null` on a COMPOSITE foreign key nulls every referencing column,
  // `ward_id` included — and `ward_id` is `not null`, so the cascade raises and the parent row
  // becomes UNDELETABLE. Migration 059b carries the column list `(occasion_id)`, and this is what
  // proves it.
  describe("deleting an occasion leaves its events standing", () => {
    it("nulls occasion_id and deletes nothing else", async () => {
      const occasionId = await seedOccasion(fixtures.wardAId);
      const firstId = await seedEvent(fixtures.wardAId, eqProfileId, "Joined one", occasionId);
      const secondId = await seedEvent(fixtures.wardAId, rsProfileId, "Joined two", occasionId);
      disposableEvents.push(firstId, secondId);

      const { error } = await eqPresident
        .from("activity_occasions")
        .delete()
        .eq("id", occasionId);

      // IT DELETES AT ALL, which is the half migration 046 failed on: there the cascade raised.
      expect(error).toBeNull();

      const { data } = await fixtures.service
        .from("activity_occasions")
        .select("id")
        .eq("id", occasionId);
      expect(data ?? []).toEqual([]);

      // AND THE GAMES SURVIVE, unlinked. `set null` rather than `cascade`, deliberately: deleting
      // an occasion must not delete the fixtures.
      expect(await storedEventOccasion(firstId)).toBeNull();
      expect(await storedEventOccasion(secondId)).toBeNull();

      const { data: survivors } = await fixtures.service
        .from("activity_events")
        .select("id, ward_id")
        .in("id", [firstId, secondId]);

      expect((survivors ?? []).length).toBe(2);
      // ward_id in particular, because that is the column a bare `set null` would have tried to
      // null and could not.
      expect((survivors ?? []).every((row) => row.ward_id === fixtures.wardAId)).toBe(true);
    });
  });

  // Not asserted here: the route's refusals (same event twice, two occasions, the 403). Those are
  // application rules rather than policy ones and live in tests/routes/youthOccasions.test.ts.
  it("keeps the ward B event out of every ward A read", async () => {
    const { data } = await eqPresident.from("activity_events").select("id").eq("id", wardBEventId);

    expect(data ?? []).toEqual([]);
  });
});
