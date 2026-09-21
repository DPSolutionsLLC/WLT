// @vitest-environment node
//
// GET and PATCH /api/session/active-ward.
//
// A route test needs no server — see tests/helpers/routeClient.ts, and read its header for the
// vi.mock hoisting trap before editing the mock below. Only the client factory is mocked, so
// every query still runs against the hosted project as a genuinely authenticated user: a passing
// case here proves the POLICY allowed it, not that a stub returned a row.
//
// THE CASE THIS FILE EXISTS FOR IS THE 403. A refused switch RAISES (SQLSTATE 42501) rather than
// returning zero rows, and without lib/units/wardSwitch.ts's mapping it would surface as a 500
// reading "Please try again" — which is untrue, because trying again cannot work (defect
// 060-D2, in a second place).
//
// ---------------------------------------------------------------------------
// WHAT CHANGED WITH THE CALLING MODEL
// ---------------------------------------------------------------------------
// The list is no longer "wards under a stake I am assigned over". It is THE WARDS I HOLD AN
// ACTIVE CALLING IN (migration 070a), so the fixtures moved from `stakePresident` to
// `twoCallings`. A stake assignment now reaches NOTHING — STAKE_OFFICER_PERMISSIONS is empty and
// a stake officer's eventual surface is a narrow, purpose-built agenda view rather than a switch
// — and `superAdmin`'s reach is proto-d's to decide with its own screen. Both are asserted below
// as refusals, because "it used to work" is exactly the regression somebody would restore.

import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import {
  actAs,
  errorMessage,
  jsonRequest,
  readResponse,
} from "@/tests/helpers/routeClient";
import { seedFixtures, type Fixtures } from "@/tests/helpers/seed";

vi.mock("@/lib/supabase/server", async () => {
  const { serverClientMock } = await import("@/tests/helpers/routeClient");
  return serverClientMock();
});

const ROUTE_URL = "http://localhost/api/session/active-ward";

type WardListItem = { wardId: string; name: string };

type SwitchableHandle = "twoCallings" | "eqPresident" | "stakePresident" | "superAdmin";

describe("/api/session/active-ward", () => {
  let fixtures: Fixtures;

  beforeAll(async () => {
    fixtures = await seedFixtures([
      "eqPresident",
      "twoCallings",
      "stakePresident",
      "superAdmin",
    ]);
  });

  afterAll(async () => {
    await fixtures?.cleanup();
  });

  async function activeWardOf(handle: SwitchableHandle): Promise<string | null> {
    const { data } = await fixtures.service
      .from("users")
      .select("active_ward_id")
      .eq("id", fixtures.user(handle).id)
      .single();
    return data?.active_ward_id ?? null;
  }

  // ---------------------------------------------------------------------------
  // GET
  // ---------------------------------------------------------------------------

  // THE REQUIREMENT THE WHOLE PHASE IS INVISIBLE BY. Anyone who belongs to exactly one ward never
  // sees the unit layer at all, and the control renders off this list — so an empty array here is
  // what keeps a pointless switcher off every ordinary leader's chrome bar.
  //
  // `switchable_wards()` honestly returns ONE row for this person: they hold a calling in their
  // own ward, like everybody. lib/units/queries.ts is what turns a list of one into a list of
  // none, and this is the assertion that pins it.
  it("returns no wards to a leader with one calling", async () => {
    await actAs(fixtures, "eqPresident");
    const { GET } = await import("@/app/api/session/active-ward/route");

    const { status, body } = await readResponse(await GET());

    expect(status).toBe(200);
    expect(body.wards).toEqual([]);
    expect(body.activeWardId).toBeNull();
    expect(body.homeWardId).toBe(fixtures.wardAId);
  });

  it("offers both wards to somebody holding a calling in each", async () => {
    await actAs(fixtures, "twoCallings");
    const { GET } = await import("@/app/api/session/active-ward/route");

    const { status, body } = await readResponse(await GET());

    expect(status).toBe(200);

    const wardIds = (body.wards as WardListItem[]).map((ward) => ward.wardId).sort();
    expect(wardIds).toEqual([fixtures.wardAId, fixtures.wardBId].sort());
  });

  // A STAKE ASSIGNMENT REACHES NOTHING, and this fixture still holds one over the stake that is
  // parent to both ward units — so the row exists and buys nothing. Under migration 066 this
  // returned both wards; the arm was removed deliberately (CLAUDE.md §7), and the empty list is
  // the assertion that says so out loud.
  it("offers a stake president nothing at all", async () => {
    await actAs(fixtures, "stakePresident");
    const { GET } = await import("@/app/api/session/active-ward/route");

    const { status, body } = await readResponse(await GET());

    expect(status).toBe(200);
    expect(body.wards).toEqual([]);
  });

  // ---------------------------------------------------------------------------
  // PATCH
  // ---------------------------------------------------------------------------

  it("switches somebody into the ward of their second calling", async () => {
    await actAs(fixtures, "twoCallings");
    const { PATCH } = await import("@/app/api/session/active-ward/route");

    const { status, body } = await readResponse(
      await PATCH(
        jsonRequest(ROUTE_URL, {
          method: "PATCH",
          body: { activeWardId: fixtures.wardBId },
        }),
      ),
    );

    expect(status).toBe(200);
    expect(body.activeWardId).toBe(fixtures.wardBId);
    expect(body.wardId).toBe(fixtures.wardBId);
    expect(body.homeWardId).toBe(fixtures.wardAId);

    // The column really moved. A 200 with an unchanged row is the failure this re-read catches.
    expect(await activeWardOf("twoCallings")).toBe(fixtures.wardBId);
  });

  // MIGRATION 067'S DEFECT, ASSERTED. `audit_log`'s composite key demanded the author's home ward
  // equal the row's ward, so this row could not be written at all until it was narrowed — and
  // writeAuditLog never throws, so the switch would simply have gone unrecorded. Migration 069
  // did the same for the other forty-seven.
  it("writes one audit row for the switch, filed under the ward being entered", async () => {
    const { data } = await fixtures.service
      .from("audit_log")
      .select("ward_id, action, module")
      .eq("user_id", fixtures.user("twoCallings").id)
      .eq("action", "active_ward_switched");

    expect(data?.length).toBe(1);
    expect(data?.[0]?.ward_id).toBe(fixtures.wardBId);
    expect(data?.[0]?.module).toBe("units");
  });

  it("returns them to their home ward on a null body", async () => {
    await actAs(fixtures, "twoCallings");
    const { PATCH } = await import("@/app/api/session/active-ward/route");

    const { status, body } = await readResponse(
      await PATCH(
        jsonRequest(ROUTE_URL, { method: "PATCH", body: { activeWardId: null } }),
      ),
    );

    expect(status).toBe(200);
    expect(body.activeWardId).toBeNull();
    expect(body.wardId).toBe(fixtures.wardAId);
    expect(await activeWardOf("twoCallings")).toBeNull();
  });

  it("audits the clear as its own action", async () => {
    const { data } = await fixtures.service
      .from("audit_log")
      .select("ward_id, action")
      .eq("user_id", fixtures.user("twoCallings").id)
      .eq("action", "active_ward_cleared");

    expect(data?.length).toBe(1);
    expect(data?.[0]?.ward_id).toBe(fixtures.wardAId);
  });

  // ---------------------------------------------------------------------------
  // 403, NOT 500
  // ---------------------------------------------------------------------------

  it("refuses a leader with one calling with a sentence, not a server fault", async () => {
    await actAs(fixtures, "eqPresident");
    const { PATCH } = await import("@/app/api/session/active-ward/route");

    const { status, body } = await readResponse(
      await PATCH(
        jsonRequest(ROUTE_URL, {
          method: "PATCH",
          body: { activeWardId: fixtures.wardBId },
        }),
      ),
    );

    expect(status).toBe(403);
    expect(errorMessage(body)).toContain("do not hold a calling in that ward");
    expect(await activeWardOf("eqPresident")).toBeNull();
  });

  it("refuses a stake president, whose assignment grants no ward at all", async () => {
    await actAs(fixtures, "stakePresident");
    const { PATCH } = await import("@/app/api/session/active-ward/route");

    const { status } = await readResponse(
      await PATCH(
        jsonRequest(ROUTE_URL, {
          method: "PATCH",
          body: { activeWardId: fixtures.wardBId },
        }),
      ),
    );

    expect(status).toBe(403);
    expect(await activeWardOf("stakePresident")).toBeNull();
  });

  // A SUPER ADMIN IS REFUSED TOO, and that is deliberate rather than an oversight. Migration 066's
  // can_act_in_ward() had an arm granting them every ward; 070a removed it, because what a super
  // admin reaches is proto-d's decision to take with the screen that grants it — not something
  // inherited quietly from a migration about something else.
  it("refuses a super admin, whose cross-ward reach proto-d has yet to decide", async () => {
    await actAs(fixtures, "superAdmin");
    const { PATCH } = await import("@/app/api/session/active-ward/route");

    const { status } = await readResponse(
      await PATCH(
        jsonRequest(ROUTE_URL, {
          method: "PATCH",
          body: { activeWardId: fixtures.wardBId },
        }),
      ),
    );

    expect(status).toBe(403);
    expect(await activeWardOf("superAdmin")).toBeNull();
  });

  // Clearing is ALWAYS permitted (migration 066d), including for somebody who could never have
  // switched in the first place. Somebody just released from a second calling must be able to get
  // home, and the policy admits a null unconditionally for that reason.
  it("lets even a single-calling leader clear the switch", async () => {
    await actAs(fixtures, "eqPresident");
    const { PATCH } = await import("@/app/api/session/active-ward/route");

    const { status } = await readResponse(
      await PATCH(
        jsonRequest(ROUTE_URL, { method: "PATCH", body: { activeWardId: null } }),
      ),
    );

    expect(status).toBe(200);
  });

  it("rejects a body that is not a uuid", async () => {
    await actAs(fixtures, "twoCallings");
    const { PATCH } = await import("@/app/api/session/active-ward/route");

    const { status, body } = await readResponse(
      await PATCH(
        jsonRequest(ROUTE_URL, { method: "PATCH", body: { activeWardId: "ward-b" } }),
      ),
    );

    expect(status).toBe(400);
    expect(errorMessage(body)).toContain("Choose a ward from the list.");
  });
});
