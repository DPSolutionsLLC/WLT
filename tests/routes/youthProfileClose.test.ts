// @vitest-environment node
//
// PATCH /api/youth/profiles/[id]/close — closing a season out, and reopening one.
//
// ---------------------------------------------------------------------------
// THE ASSERTIONS THIS SUITE EXISTS FOR
// ---------------------------------------------------------------------------
// 1. CLOSING AND REOPENING ARE ONE ROUTE AND TWO AUDIT ACTIONS. `youth_activity_profile_closed`
//    and `youth_activity_profile_reopened`, never one action with a boolean in the payload — an
//    audit reader scanning for the events that changed what a ward sees should not have to parse a
//    detail object to tell which happened.
//
// 2. IT IS `.manage`, NOT `.log`. `org_secretary` holds `youth_activities.view` and `.log` and NOT
//    `.manage`, checked against lib/auth/permissions.ts rather than guessed. Ending somebody
//    else's season is a coordination decision, not a pastoral note.
//
// 3. THE ROW IS RE-READ WITH THE SERVICE CLIENT after every refusal. A 403 that left the column
//    changed would be a route that wrote before it checked.
//
// 4. THE SERVER DECIDES THE INSTANT. The body carries a boolean and no timestamp, so a mistyped
//    client clock cannot freeze a history page's final percentage at a moment nobody chose.
//
// See tests/helpers/routeClient.ts for why this needs no server and what exactly is mocked — only
// the client factory, so every query below still runs as a genuinely authenticated user against
// the hosted project and a pass means RLS allowed it.

import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { actAs, errorMessage, jsonRequest, readResponse } from "@/tests/helpers/routeClient";
import { seedFixtures, type Fixtures } from "@/tests/helpers/seed";

vi.mock("@/lib/supabase/server", async () => {
  const { serverClientMock } = await import("@/tests/helpers/routeClient");
  return serverClientMock();
});

const PROFILES_URL = "http://localhost/api/youth/profiles";

const MISSING_PROFILE_ID = "99999999-9999-4999-8999-999999999999";

async function callClose(id: string, body: unknown) {
  const { PATCH } = await import("@/app/api/youth/profiles/[id]/close/route");
  return readResponse(
    await PATCH(jsonRequest(`${PROFILES_URL}/${id}/close`, { method: "PATCH", body }), {
      // `params` is a PROMISE in Next 16, so the test has to hand the handler one.
      params: Promise.resolve({ id }),
    }),
  );
}

describe("PATCH /api/youth/profiles/[id]/close", () => {
  let fixtures: Fixtures;
  let wardId: string;

  let eqProfileId: string;
  let rsProfileId: string;
  let reassignedProfileId: string;

  const storedClosedAt = async (profileId: string): Promise<string | null | undefined> => {
    const { data, error } = await fixtures.service
      .from("youth_activity_profiles")
      .select("closed_at")
      .eq("id", profileId)
      .maybeSingle();

    if (error) throw new Error(error.message);
    return data === null ? undefined : data.closed_at;
  };

  const countAuditRows = async (action: string): Promise<number> => {
    const { count, error } = await fixtures.service
      .from("audit_log")
      .select("id", { count: "exact", head: true })
      .eq("ward_id", wardId)
      .eq("action", action);

    if (error) throw new Error(error.message);
    return count ?? 0;
  };

  beforeAll(async () => {
    fixtures = await seedFixtures(["bishop", "eqPresident", "eqSecretary", "rsPresident"]);
    wardId = fixtures.wardAId;

    const { data: member, error: memberError } = await fixtures.service
      .from("members")
      .insert({
        ward_id: wardId,
        first_name: "Ada",
        last_name: `Youth${fixtures.runId}`,
        category: "youth",
        status: "active",
      })
      .select("id")
      .single();
    if (memberError) throw new Error(memberError.message);

    const { data: profiles, error: profileError } = await fixtures.service
      .from("youth_activity_profiles")
      .insert([
        {
          ward_id: wardId,
          org_id: fixtures.eldersQuorumId,
          member_id: member.id,
          activity_name: `EQ basketball ${fixtures.runId}`,
          activity_type: "sport",
        },
        {
          ward_id: wardId,
          org_id: fixtures.reliefSocietyId,
          member_id: member.id,
          activity_name: `RS choir ${fixtures.runId}`,
          activity_type: "performance",
        },
        {
          // THE ONE SHAPE WHERE 054d's USING AND WITH CHECK DISAGREE: owned by the Relief
          // Society, ENTERED BY the Elders Quorum president. USING admits them through
          // `entered_by`; WITH CHECK refuses the result and RAISES rather than matching no
          // rows — the shape a release and a recall leave behind (060-D2).
          ward_id: wardId,
          org_id: fixtures.reliefSocietyId,
          member_id: member.id,
          activity_name: `Reassigned ${fixtures.runId}`,
          activity_type: "sport",
          entered_by: fixtures.user("eqPresident").id,
        },
      ])
      .select("id, activity_name");
    if (profileError) throw new Error(profileError.message);

    eqProfileId = profiles!.find((row) => row.activity_name.startsWith("EQ"))!.id;
    rsProfileId = profiles!.find((row) => row.activity_name.startsWith("RS"))!.id;
    reassignedProfileId = profiles!.find((row) => row.activity_name.startsWith("Reassigned"))!.id;
  }, 180_000);

  afterAll(async () => {
    await fixtures?.cleanup();
  });

  it("closes a season, stamps an instant and audits it as CLOSED", async () => {
    const before = await countAuditRows("youth_activity_profile_closed");
    await actAs(fixtures, "eqPresident");

    const { status, body } = await callClose(eqProfileId, { closed: true });

    expect(status).toBe(200);
    expect((body.profile as { closedAt: string | null }).closedAt).not.toBeNull();
    expect(await storedClosedAt(eqProfileId)).not.toBeNull();
    expect(await countAuditRows("youth_activity_profile_closed")).toBe(before + 1);
  });

  it("reopens it through the same route and audits it as REOPENED", async () => {
    const before = await countAuditRows("youth_activity_profile_reopened");
    await actAs(fixtures, "eqPresident");

    const { status, body } = await callClose(eqProfileId, { closed: false });

    expect(status).toBe(200);
    expect((body.profile as { closedAt: string | null }).closedAt).toBeNull();
    expect(await storedClosedAt(eqProfileId)).toBeNull();
    expect(await countAuditRows("youth_activity_profile_reopened")).toBe(before + 1);
  });

  it("lets the bishopric close any organization's season", async () => {
    await actAs(fixtures, "bishop");

    const { status } = await callClose(rsProfileId, { closed: true });

    expect(status).toBe(200);
    expect(await storedClosedAt(rsProfileId)).not.toBeNull();

    await fixtures.service
      .from("youth_activity_profiles")
      .update({ closed_at: null })
      .eq("id", rsProfileId);
  });

  // The POLICY decides which, not a branch in the route (CLAUDE.md rule 2). The 404 is the route
  // turning a zero-row update into an answer, and the sentence must not confirm the row exists.
  it("returns 404 rather than closing another organization's season", async () => {
    await actAs(fixtures, "eqPresident");

    const { status, body } = await callClose(rsProfileId, { closed: true });

    expect(status).toBe(404);
    expect(errorMessage(body)).toContain("another organization");
    expect(await storedClosedAt(rsProfileId)).toBeNull();
  });

  // `.manage`, NOT `.log`. An org secretary may write follow-ups and may not end a season.
  it("refuses a role holding .log but not .manage, and leaves the row alone", async () => {
    await actAs(fixtures, "eqSecretary");

    const { status } = await callClose(eqProfileId, { closed: true });

    expect(status).toBe(403);
    expect(await storedClosedAt(eqProfileId)).toBeNull();
  });

  // ---------------------------------------------------------------------------
  // A WITH-CHECK REFUSAL IS A 404 WITH A SENTENCE, NEVER A 500 — defect 060-D2
  // ---------------------------------------------------------------------------
  // Every other refusal in this module is a zero-row success. This one RAISES: the row passes
  // USING (`entered_by = auth.uid()`) and then fails WITH CHECK, which omits `entered_by` so that
  // nobody can move a profile into another organization. Until 2026-08-31 the raise escaped as a
  // 500 reading "Please try again", which was untrue — trying again cannot work.
  //
  // The row is what a release and a recall leave behind, and walking scenario 060 hit it on the
  // first press. It now joins the quiet refusal on the same path: 404, and the sentence the
  // caller already gets for a profile that is not theirs.
  it("answers 404 rather than 500 when WITH CHECK refuses the result", async () => {
    await actAs(fixtures, "eqPresident");

    const { status, body } = await callClose(reassignedProfileId, { closed: true });

    expect(status).toBe(404);
    expect(errorMessage(body)).toContain("another organization");

    // AND NOTHING WAS WRITTEN. A raised error that had been half-applied would be worse than the
    // 500 it replaced.
    expect(await storedClosedAt(reassignedProfileId)).toBeNull();
  });

  // THE SAME HOLE IN THE ORDINARY EDIT, which had it first and since youth-a. Fixed in the same
  // change, because leaving one of two identical paths returning 500 is how it comes back.
  it("answers 404 rather than 500 on the ordinary PATCH too", async () => {
    await actAs(fixtures, "eqPresident");

    const { PATCH } = await import("@/app/api/youth/profiles/[id]/route");
    const { status, body } = await readResponse(
      await PATCH(
        jsonRequest(`${PROFILES_URL}/${reassignedProfileId}`, {
          method: "PATCH",
          body: { notes: "should not be written" },
        }),
        { params: Promise.resolve({ id: reassignedProfileId }) },
      ),
    );

    expect(status).toBe(404);
    expect(errorMessage(body)).toContain("another organization");

    const { data } = await fixtures.service
      .from("youth_activity_profiles")
      .select("notes")
      .eq("id", reassignedProfileId)
      .maybeSingle();
    expect(data?.notes).toBeNull();
  });

  it("returns 404 for a profile that is not in this ward", async () => {
    await actAs(fixtures, "eqPresident");

    const { status, body } = await callClose(MISSING_PROFILE_ID, { closed: true });

    expect(status).toBe(404);
    expect(errorMessage(body)).toContain("not in your ward");
  });

  it("refuses a body whose `closed` is not a boolean", async () => {
    await actAs(fixtures, "eqPresident");

    const { status } = await callClose(eqProfileId, { closed: "yes" });

    expect(status).toBe(400);
    expect(await storedClosedAt(eqProfileId)).toBeNull();
  });

  it("refuses an id that is not a uuid", async () => {
    await actAs(fixtures, "eqPresident");

    const { status } = await callClose("not-a-uuid", { closed: true });

    expect(status).toBe(400);
  });
});
