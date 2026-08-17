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
    fixtures = await seedFixtures(["musicCoordinator"]);
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

  it("refuses a user rewriting their own role", async () => {
    const { error } = await musicCoordinator
      .from("users")
      .update({ role: "bishop" })
      .eq("id", selfId);

    expect(error).not.toBeNull();

    const { data: after } = await fixtures.service
      .from("users")
      .select("role")
      .eq("id", selfId)
      .single();

    expect(after?.role).toBe("music_coordinator");
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

  it("refuses a user rewriting their own name", async () => {
    const { error } = await musicCoordinator
      .from("users")
      .update({ first_name: "Renamed" })
      .eq("id", selfId);

    expect(error).not.toBeNull();
  });

  // Proves the narrowing did not reach the admin flows. adminUsers, youthAccounts, and
  // registration all write `users` through the service-role client, which has its own grant.
  it("leaves the service-role client able to write every column", async () => {
    const { error } = await fixtures.service
      .from("users")
      .update({ role: "ward_council_member", first_name: "Renamed" })
      .eq("id", selfId);

    expect(error).toBeNull();

    const { data: after } = await fixtures.service
      .from("users")
      .select("role, first_name")
      .eq("id", selfId)
      .single();

    expect(after?.role).toBe("ward_council_member");
    expect(after?.first_name).toBe("Renamed");
  });
});
