// @vitest-environment node
//
// Migration 022 Part 3 closed a gap handed forward by auth-a → auth-b → auth-c:
// `users_update_self` let a user update their own row and nothing restricted WHICH COLUMNS, so
// a user could rewrite their own `role` to bishop with a direct API call. RLS grants a row and
// never a column, so the fix is a column-level GRANT rather than a policy.
//
// Column privileges are checked BEFORE the policy, so a refusal here is a hard error rather
// than the zero-row success an RLS denial produces. Every case still re-reads the row: a test
// that only asserts "an error came back" can pass for the wrong reason.

import type { SupabaseClient } from "@supabase/supabase-js";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { asRole } from "@/tests/helpers/asRole";
import { seedFixtures, type Fixtures } from "@/tests/helpers/seed";
import type { Database } from "@/types/database";

describe("users column-level update grant", () => {
  let fixtures: Fixtures;
  let musicCoordinator: SupabaseClient<Database>;
  let selfId: string;

  beforeAll(async () => {
    fixtures = await seedFixtures(["musicCoordinator", "bishop"]);
    musicCoordinator = await asRole(fixtures, "musicCoordinator");
    selfId = fixtures.user("musicCoordinator").id;
  });

  afterAll(async () => {
    await fixtures?.cleanup();
  });

  // The grant that remains. ThemeToggle is the only authenticated write to `users` in the
  // repo, and narrowing the grant must not have broken it.
  it("lets a user update their own theme_preference", async () => {
    const { error } = await musicCoordinator
      .from("users")
      .update({ theme_preference: "dark" })
      .eq("id", selfId);

    expect(error).toBeNull();

    const { data: after } = await fixtures.service
      .from("users")
      .select("theme_preference")
      .eq("id", selfId)
      .single();

    expect(after?.theme_preference).toBe("dark");
  });

  // THE ROLE MOVED, AND SO DID THIS TEST. Migration 022's gap was that a user could rewrite
  // `users.role` to bishop with a direct API call; the role now lives on a CALLING (migration
  // 068), and migration 071 drops the column altogether — so the same escalation would be
  // attempted against `ward_role_assignments` instead.
  //
  // It is refused for a DIFFERENT reason than the column grant, and that is worth knowing: that
  // table has a SELECT policy and no write policies at all (068c), so RLS denies the update and
  // it comes back as a ZERO-ROW SUCCESS rather than an error. Asserting `error` here would pass
  // for the wrong reason on a table that had been opened up — only the re-read can catch it.
  it("refuses a user rewriting the role on their own calling", async () => {
    const { error } = await musicCoordinator
      .from("ward_role_assignments")
      .update({ role: "bishop" })
      .eq("user_id", selfId);

    expect(error).toBeNull();

    const { data: after } = await fixtures.service
      .from("ward_role_assignments")
      .select("role")
      .eq("user_id", selfId)
      .eq("is_active", true)
      .single();

    expect(after?.role).toBe("music_coordinator");
  });

  // The other half: they cannot GIVE themselves a calling in another ward either, which would be
  // the same escalation by a different door — and would authorize a ward switch on top.
  it("refuses a user giving themselves a calling in another ward", async () => {
    const { error } = await musicCoordinator.from("ward_role_assignments").insert({
      user_id: selfId,
      ward_id: fixtures.wardBId,
      role: "bishop",
    });

    // An INSERT refused by RLS RAISES, unlike the UPDATE above — the asymmetry is why both are
    // written out rather than sharing a helper.
    expect(error).not.toBeNull();

    const { data: after } = await fixtures.service
      .from("ward_role_assignments")
      .select("id")
      .eq("user_id", selfId)
      .eq("ward_id", fixtures.wardBId);

    expect(after).toEqual([]);
  });

  // Deactivation is enforced on the next request by reading is_active (lib/auth/session.ts).
  // A deactivated account that can set the column back is not deactivated at all.
  it("refuses a user reactivating themselves", async () => {
    const { error: deactivateError } = await fixtures.service
      .from("users")
      .update({ is_active: false })
      .eq("id", selfId);
    expect(deactivateError).toBeNull();

    const { error } = await musicCoordinator
      .from("users")
      .update({ is_active: true })
      .eq("id", selfId);

    expect(error).not.toBeNull();

    const { data: after } = await fixtures.service
      .from("users")
      .select("is_active")
      .eq("id", selfId)
      .single();

    expect(after?.is_active).toBe(false);

    const { error: reactivateError } = await fixtures.service
      .from("users")
      .update({ is_active: true })
      .eq("id", selfId);
    expect(reactivateError).toBeNull();
  });

  // The grant widened by EXACTLY ONE COLUMN in migration 066d. These two assertions are the pair
  // that says so: active_ward_id is now reachable, first_name still is not. A future profile-edit
  // page still has to widen the grant on purpose.
  //
  // This case proves the COLUMN GRANT, not the policy: a music coordinator holds no calling in
  // ward B, so `users_update_self`'s WITH CHECK refuses them too — and the two refusals are
  // indistinguishable from here, which is fine, because either one is a refusal. What would NOT
  // be fine is the write succeeding, and the re-read is what catches that.
  it("refuses an ordinary member setting their own active_ward_id", async () => {
    const { error } = await musicCoordinator
      .from("users")
      .update({ active_ward_id: fixtures.wardBId })
      .eq("id", selfId);

    expect(error).not.toBeNull();

    const { data: after } = await fixtures.service
      .from("users")
      .select("active_ward_id")
      .eq("id", selfId)
      .single();

    expect(after?.active_ward_id).toBeNull();
  });

  // Clearing can never need authorization (migration 066d), so even a member with no assignment
  // may write a null. It is a no-op here and must not be an error.
  it("lets any user clear their own active_ward_id", async () => {
    const { error } = await musicCoordinator
      .from("users")
      .update({ active_ward_id: null })
      .eq("id", selfId);

    expect(error).toBeNull();
  });

  // THE GRANT WIDENED BY A SECOND COLUMN IN MIGRATION 077. `settings` holds one person's own
  // display preferences — the pinned quick links today — and it follows the PERSON rather than
  // the device, which is the whole reason it is a column and not localStorage.
  //
  // Without the grant this write fails with "permission denied for table users" rather than the
  // zero-row success an RLS denial produces, because COLUMN PRIVILEGES ARE CHECKED BEFORE
  // POLICIES. That distinction cost real time on `active_ward_id`, which is why both halves are
  // pinned here rather than inferred from one another.
  it("lets a user write their own settings", async () => {
    const { error } = await musicCoordinator
      .from("users")
      .update({ settings: { quick_links: ["/music", "/calendar"] } })
      .eq("id", selfId);

    expect(error).toBeNull();

    const { data: after } = await fixtures.service
      .from("users")
      .select("settings")
      .eq("id", selfId)
      .single();

    expect((after?.settings as { quick_links?: string[] })?.quick_links).toEqual([
      "/music",
      "/calendar",
    ]);
  });

  // The row half of the rule, which the column grant says nothing about: `users_update_self` is
  // `id = auth.uid()` on both halves, so another person's preferences are out of reach. A denied
  // UPDATE is a ZERO-ROW SUCCESS, so the re-read is what catches a policy that had been opened up.
  it("refuses a user writing somebody else's settings", async () => {
    const otherId = fixtures.user("bishop").id;

    const { error } = await musicCoordinator
      .from("users")
      .update({ settings: { quick_links: ["/admin"] } })
      .eq("id", otherId);

    expect(error).toBeNull();

    const { data: after } = await fixtures.service
      .from("users")
      .select("settings")
      .eq("id", otherId)
      .single();

    expect((after?.settings as { quick_links?: string[] })?.quick_links).toBeUndefined();
  });

  // THE SIZE CHECK IS WHAT MAKES THE OPEN GRANT SAFE. An ungated jsonb column a user may write
  // directly is a storage hole; 4 KB is far more than a list of pins needs.
  it("refuses an oversized settings value", async () => {
    const { error } = await musicCoordinator
      .from("users")
      .update({ settings: { padding: "x".repeat(5000) } })
      .eq("id", selfId);

    // A CHECK violation RAISES, unlike the policy refusals above.
    expect(error).not.toBeNull();
    expect(error?.message).toMatch(/users_settings_size/);
  });

  it("refuses a user rewriting their own name", async () => {
    const { error } = await musicCoordinator
      .from("users")
      .update({ first_name: "Renamed" })
      .eq("id", selfId);

    expect(error).not.toBeNull();
  });

  // Proves the narrowing did not reach the admin flows. adminUsers, youthAccounts, and
  // registration all write `users` and `ward_role_assignments` through the service-role client,
  // which has its own grant and bypasses RLS entirely.
  it("leaves the service-role client able to write both tables", async () => {
    const { error } = await fixtures.service
      .from("users")
      .update({ first_name: "Renamed" })
      .eq("id", selfId);

    expect(error).toBeNull();

    const { error: callingError } = await fixtures.service
      .from("ward_role_assignments")
      .update({ role: "ward_council_member" })
      .eq("user_id", selfId)
      .eq("is_active", true);

    expect(callingError).toBeNull();

    const { data: after } = await fixtures.service
      .from("users")
      .select("first_name")
      .eq("id", selfId)
      .single();
    expect(after?.first_name).toBe("Renamed");

    const { data: calling } = await fixtures.service
      .from("ward_role_assignments")
      .select("role")
      .eq("user_id", selfId)
      .eq("is_active", true)
      .single();
    expect(calling?.role).toBe("ward_council_member");
  });
});
