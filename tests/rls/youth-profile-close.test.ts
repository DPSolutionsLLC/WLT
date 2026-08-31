// @vitest-environment node
//
// Closing a season, asserted from the DATABASE rather than from the route.
//
// ---------------------------------------------------------------------------
// WHY THIS SUITE EXISTS WHEN MIGRATION 060 ADDS NO POLICY
// ---------------------------------------------------------------------------
// That is precisely why. Closing a season is an ORDINARY UPDATE on `youth_activity_profiles`, and
// migration 060 deliberately adds no policy of its own — 054d's `youth_activity_profiles_update`
// already describes the right boundary, and a second permissive policy could only ever WIDEN it
// (PostgreSQL ORs them together; plans/retros/talks-d-reliability-goals.md).
//
// A decision to REUSE a policy is a claim about that policy, and a claim is worth a test. If
// somebody later adds `youth_activity_profiles_close` "for clarity", the third case below is what
// notices.
//
// ---------------------------------------------------------------------------
// THE FOUR THINGS THIS SUITE IS FOR
// ---------------------------------------------------------------------------
// 1. AN ORG PRESIDENT CLOSES THEIR OWN ORGANIZATION'S SEASON. The ordinary path.
//
// 2. THEY CANNOT CLOSE ANOTHER ORGANIZATION'S. Asserted by RE-READING the row with the service
//    client: AN RLS-DENIED UPDATE IS A ZERO-ROW SUCCESS, NOT AN ERROR. Only INSERT raises, so
//    asserting on `error` alone would pass against a policy that permits everything.
//
// 3. A WARD-WIDE PROFILE (`org_id is null`) CLOSED BY A `ward_council_member` WITH NO ORGANIZATION.
//    This is the talks-d hole: `org_id = current_org_id()` is NULL rather than true when both
//    sides are null. 054d's USING clause carries `entered_by = auth.uid()` and its WITH CHECK
//    carries an explicit `org_id is null` arm, and BOTH are load-bearing here — the row is seeded
//    as one this member entered, because that is the only way USING admits them. Getting that
//    wrong produces a leader who cannot close the ward-wide activity they created.
//
// 4. WARDS DO NOT LEAK. Ward B's bishop cannot close ward A's season.
//
// Runs over the network against the shared hosted project, so it cleans up after itself and never
// assumes an empty table (CLAUDE.md §9).

import type { SupabaseClient } from "@supabase/supabase-js";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { asRole } from "@/tests/helpers/asRole";
import { seedFixtures, type Fixtures } from "@/tests/helpers/seed";
import type { Database } from "@/types/database";

const CLOSED_AT = "2027-03-01T12:00:00Z";

describe("closing a youth activity profile", () => {
  let fixtures: Fixtures;

  let eqPresident: SupabaseClient<Database>;
  let wardCouncilMember: SupabaseClient<Database>;
  let wardBBishop: SupabaseClient<Database>;

  let eqProfileId: string;
  let rsProfileId: string;
  let wardWideProfileId: string;
  let wardBProfileId: string;

  const storedClosedAt = async (profileId: string): Promise<string | null | undefined> => {
    const { data, error } = await fixtures.service
      .from("youth_activity_profiles")
      .select("closed_at")
      .eq("id", profileId)
      .maybeSingle();

    if (error) throw new Error(error.message);
    return data === null ? undefined : data.closed_at;
  };

  // Between cases, because several of them close the same row and a test that inherited a closed
  // season from the one before it would pass without proving anything.
  const reopenWithService = async (profileId: string): Promise<void> => {
    const { error } = await fixtures.service
      .from("youth_activity_profiles")
      .update({ closed_at: null })
      .eq("id", profileId);

    if (error) throw new Error(error.message);
  };

  beforeAll(async () => {
    fixtures = await seedFixtures([
      "eqPresident",
      "rsPresident",
      "wardCouncilMember",
      "wardBBishop",
    ]);

    [eqPresident, wardCouncilMember, wardBBishop] = await Promise.all([
      asRole(fixtures, "eqPresident"),
      asRole(fixtures, "wardCouncilMember"),
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
          activity_name: `RS choir ${fixtures.runId}`,
          activity_type: "performance",
        },
        {
          // NULL org_id — a ward-wide activity, and ENTERED BY the ward council member. Both
          // halves are required: 054d's USING clause admits them through `entered_by`, and its
          // WITH CHECK admits the result through the explicit `org_id is null` arm. A row seeded
          // with a different author would be refused for a reason that has nothing to do with the
          // null branch this case is about.
          ward_id: fixtures.wardAId,
          org_id: null,
          member_id: wardAYouthId,
          activity_name: `Ward-wide debate ${fixtures.runId}`,
          activity_type: "academic",
          entered_by: fixtures.user("wardCouncilMember").id,
        },
        {
          ward_id: fixtures.wardBId,
          org_id: fixtures.wardBOrgId,
          member_id: wardBYouthId,
          activity_name: `Ward B track ${fixtures.runId}`,
          activity_type: "sport",
        },
      ])
      .select("id, activity_name");
    if (profileError) throw new Error(profileError.message);

    const byName = (prefix: string) =>
      profiles!.find((row) => row.activity_name.startsWith(prefix))!.id;

    eqProfileId = byName("EQ");
    rsProfileId = byName("RS");
    wardWideProfileId = byName("Ward-wide");
    wardBProfileId = byName("Ward B");
  }, 180_000);

  afterAll(async () => {
    await fixtures?.cleanup();
  });

  it("lets an org president close their own organization's season", async () => {
    await reopenWithService(eqProfileId);

    const { error } = await eqPresident
      .from("youth_activity_profiles")
      .update({ closed_at: CLOSED_AT })
      .eq("id", eqProfileId);

    expect(error).toBeNull();
    expect(await storedClosedAt(eqProfileId)).not.toBeNull();
  });

  it("lets them reopen it by setting closed_at back to null", async () => {
    // A MISTAKE MUST BE RECOVERABLE. This is why the column is a nullable timestamp rather than a
    // one-way flag, and the policy has to permit the write in both directions.
    const { error } = await eqPresident
      .from("youth_activity_profiles")
      .update({ closed_at: null })
      .eq("id", eqProfileId);

    expect(error).toBeNull();
    expect(await storedClosedAt(eqProfileId)).toBeNull();
  });

  // ASSERTED BY RE-READING, NOT BY EXPECTING A THROW. An RLS-denied UPDATE returns zero rows and
  // no error, so `error === null` here proves nothing on its own.
  it("cannot close another organization's season", async () => {
    await reopenWithService(rsProfileId);

    const { error } = await eqPresident
      .from("youth_activity_profiles")
      .update({ closed_at: CLOSED_AT })
      .eq("id", rsProfileId);

    expect(error).toBeNull();
    expect(await storedClosedAt(rsProfileId)).toBeNull();
  });

  // THE talks-d HOLE, ASSERTED DIRECTLY. `ward_council_member` is the role most likely to have no
  // organization at all and one of the two this module was built for.
  it("lets a ward council member with no organization close their ward-wide season", async () => {
    await reopenWithService(wardWideProfileId);

    const { error } = await wardCouncilMember
      .from("youth_activity_profiles")
      .update({ closed_at: CLOSED_AT })
      .eq("id", wardWideProfileId);

    expect(error).toBeNull();
    expect(await storedClosedAt(wardWideProfileId)).not.toBeNull();
  });

  it("hides another ward's season from the update entirely", async () => {
    await reopenWithService(wardBProfileId);

    const { error } = await eqPresident
      .from("youth_activity_profiles")
      .update({ closed_at: CLOSED_AT })
      .eq("id", wardBProfileId);

    expect(error).toBeNull();
    expect(await storedClosedAt(wardBProfileId)).toBeNull();
  });

  it("stops ward B's bishop closing a ward A season", async () => {
    await reopenWithService(eqProfileId);

    const { error } = await wardBBishop
      .from("youth_activity_profiles")
      .update({ closed_at: CLOSED_AT })
      .eq("id", eqProfileId);

    expect(error).toBeNull();
    expect(await storedClosedAt(eqProfileId)).toBeNull();
  });
});
