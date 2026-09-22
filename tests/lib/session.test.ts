// @vitest-environment node

import type { SupabaseClient } from "@supabase/supabase-js";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { getSessionUser } from "@/lib/auth/session";
import { anonClient, asRole } from "@/tests/helpers/asRole";
import { seedFixtures, type Fixtures } from "@/tests/helpers/seed";
import type { Database } from "@/types/database";

// getSessionUser takes an optional client for exactly this reason: a real authenticated
// Supabase client exercises the query and the RLS policy behind it, with no mock in sight.
//
// The React cache() wrapper is inert here. cache() memoizes against a per-request dispatcher
// that only exists while a Server Component renders; with none, React calls straight through.
// That is what lets the deactivation test below read the same client twice and get two
// different answers.

describe("getSessionUser", () => {
  let fixtures: Fixtures;
  let eqPresidentClient: SupabaseClient<Database>;

  beforeAll(async () => {
    fixtures = await seedFixtures(["eqPresident", "counselor1", "musicCoordinator"]);
    eqPresidentClient = await asRole(fixtures, "eqPresident");
  });

  afterAll(async () => {
    await fixtures?.cleanup();
  });

  it("resolves the signed-in user's row", async () => {
    const seeded = fixtures.user("eqPresident");
    const user = await getSessionUser(eqPresidentClient);

    expect(user).not.toBeNull();
    expect(user?.id).toBe(seeded.id);
    expect(user?.wardId).toBe(fixtures.wardAId);
    expect(user?.role).toBe("org_president");
    expect(user?.orgId).toBe(fixtures.eldersQuorumId);
    // THE ORGANIZATION'S TYPE, from the same round trip (migration 072). It decides permissions
    // from P2 on — an org_president in Young Women may manage youth activities, one in Sunday
    // School may not — so it is asserted against a real organization rather than a stub.
    expect(user?.orgType).toBe("elders_quorum");
    expect(user?.isActive).toBe(true);
  });

  it("carries the counselor position through", async () => {
    const counselorClient = await asRole(fixtures, "counselor1");
    const user = await getSessionUser(counselorClient);

    expect(user?.role).toBe("counselor");
    expect(user?.counselorPosition).toBe(1);
  });

  it("maps every column to camelCase", async () => {
    const user = await getSessionUser(eqPresidentClient);
    const snakeCaseKeys = Object.keys(user ?? {}).filter((key) => key.includes("_"));

    expect(snakeCaseKeys).toEqual([]);
    expect(Object.keys(user ?? {}).sort()).toEqual([
      // `wardId` is the EFFECTIVE ward — the one this session is acting in, which is what
      // current_ward_id() returns and therefore what every RLS policy compares against.
      // `homeWardId` is the old meaning of `wardId`, under its new name.
      //
      // `callingId` REPLACES `isVisitingWard` (migration 070). There is no visitor to flag: a
      // person holds a real calling in each ward they reach, so the useful fact is WHICH CALLING
      // this session is acting under rather than whether they are away from home. `role`, `orgId`
      // and `counselorPosition` are that calling's, and all of them come from session_context()
      // rather than being recomputed here.
      "activeWardId",
      "callingId",
      "counselorPosition",
      "firstName",
      "homeWardId",
      "id",
      "isActive",
      "lastName",
      "orgId",
      // Added by migration 072. The TYPE of the calling's organization, resolved in the same
      // query as the organization itself so the app and RLS cannot disagree about it.
      "orgType",
      "role",
      "themePreference",
      "username",
      "wardId",
    ]);
  });

  // At home, all three agree — which is the state every user in every existing ward is in, and
  // what makes migrations 068–070 invisible to them.
  it("reports a leader with one calling as being in their own ward", async () => {
    const user = await getSessionUser(eqPresidentClient);

    expect(user?.homeWardId).toBe(fixtures.wardAId);
    expect(user?.wardId).toBe(user?.homeWardId);
    expect(user?.activeWardId).toBeNull();
  });

  // THE ROLE COMES FROM THE CALLING, NOT FROM THE `users` ROW (migration 070b), and after
  // migration 071 there is no column on `users` it could have come from. A non-null callingId is
  // what proves session_context() resolved one rather than the app defaulting to something.
  it("carries the id of the calling it is acting under", async () => {
    const user = await getSessionUser(eqPresidentClient);

    expect(user?.callingId).toBeTruthy();
    expect(user?.role).toBe("org_president");
    expect(user?.orgId).toBe(fixtures.eldersQuorumId);
  });

  it("defaults the theme preference to system", async () => {
    const user = await getSessionUser(eqPresidentClient);

    expect(user?.themePreference).toBe("system");
  });

  it("returns null with no session at all", async () => {
    expect(await getSessionUser(anonClient())).toBeNull();
  });

  // The deactivation enforcement point. The user still holds a perfectly valid session cookie
  // — nothing was revoked — and must still be refused.
  it("returns null for a deactivated account", async () => {
    const musicClient = await asRole(fixtures, "musicCoordinator");
    const seeded = fixtures.user("musicCoordinator");

    expect(await getSessionUser(musicClient)).not.toBeNull();

    const { error: deactivateError } = await fixtures.service
      .from("users")
      .update({ is_active: false })
      .eq("id", seeded.id);
    expect(deactivateError).toBeNull();

    try {
      expect(await getSessionUser(musicClient)).toBeNull();
    } finally {
      // Fixtures are shared across this file, so put it back however the assertion went.
      const { error: reactivateError } = await fixtures.service
        .from("users")
        .update({ is_active: true })
        .eq("id", seeded.id);
      expect(reactivateError).toBeNull();
    }
  });
});
