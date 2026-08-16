// @vitest-environment node

import type { SupabaseClient } from "@supabase/supabase-js";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { claimInvite, redeemInvite } from "@/lib/auth/invites";
import { seedFixtures, type Fixtures } from "@/tests/helpers/seed";
import type { Database } from "@/types/database";

const PASSWORD = "harness-invite-password-1";
const HOUR_MS = 60 * 60 * 1000;

// A client that behaves exactly like the service client except that inserting into `users`
// fails. The plan proposed forcing this failure with an org_id from another ward, but `invites`
// carries the same composite foreign key as `users`, so such an invite cannot be created in the
// first place — the database refuses it one step earlier. Standing in for the failure is the
// only way left to exercise both compensations.
function withFailingUsersInsert(
  service: SupabaseClient<Database>,
): SupabaseClient<Database> {
  return {
    auth: service.auth,
    from(table: string) {
      if (table === "users") {
        return {
          insert: async () => ({
            data: null,
            error: { message: "simulated users insert failure" },
          }),
        };
      }
      return service.from(table as "invites");
    },
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- deliberately partial client, standing in for a failing users insert
  } as any as SupabaseClient<Database>;
}

describe("invite lifecycle", () => {
  let fixtures: Fixtures;
  const createdAuthUserIds: string[] = [];
  let inviteCounter = 0;

  async function seedInvite(options: {
    wardId: string;
    invitedBy: string;
    email: string;
    role?: string;
    expiresAt?: string | null;
  }): Promise<{ id: string; token: string }> {
    inviteCounter += 1;
    const token = `wlt-test-token-${fixtures.runId}-lifecycle-${inviteCounter}`;

    const { data, error } = await fixtures.service
      .from("invites")
      .insert({
        ward_id: options.wardId,
        email: options.email,
        role: options.role ?? "ward_council_member",
        invited_by: options.invitedBy,
        token,
        expires_at:
          options.expiresAt === undefined
            ? new Date(Date.now() + HOUR_MS).toISOString()
            : options.expiresAt,
      })
      .select("id")
      .single();

    if (error) throw new Error(`Could not seed the invite: ${error.message}`);

    return { id: data.id, token };
  }

  async function readUsedAt(inviteId: string): Promise<string | null> {
    const { data, error } = await fixtures.service
      .from("invites")
      .select("used_at")
      .eq("id", inviteId)
      .single();

    if (error) throw new Error(error.message);
    return data.used_at;
  }

  async function findAuthUserIdByEmail(email: string): Promise<string | undefined> {
    const { data, error } = await fixtures.service.auth.admin.listUsers({
      perPage: 1000,
    });
    if (error) throw new Error(error.message);

    return data.users.find((user) => user.email === email)?.id;
  }

  beforeAll(async () => {
    fixtures = await seedFixtures(["bishop", "wardBBishop"]);
  });

  afterAll(async () => {
    await fixtures?.cleanup();

    for (const authUserId of createdAuthUserIds) {
      const { error } = await fixtures.service.auth.admin.deleteUser(authUserId);
      if (error) {
        console.warn(`Could not delete registrant auth user ${authUserId}`, error.message);
      }
    }
  });

  it("refuses a token that does not exist", async () => {
    expect(await claimInvite(`wlt-test-token-${fixtures.runId}-nonexistent`)).toBeNull();

    const result = await redeemInvite(`wlt-test-token-${fixtures.runId}-nonexistent`, {
      firstName: "Nobody",
      lastName: "Here",
      password: PASSWORD,
    });

    expect(result.ok).toBe(false);
  });

  it("refuses an expired invite and leaves used_at null", async () => {
    const invite = await seedInvite({
      wardId: fixtures.wardAId,
      invitedBy: fixtures.user("bishop").id,
      email: `wlt-test-${fixtures.runId}-expired@wardleadershiptools.test`,
      expiresAt: new Date(Date.now() - HOUR_MS).toISOString(),
    });

    expect(await claimInvite(invite.token)).toBeNull();
    expect(await readUsedAt(invite.id)).toBeNull();
  });

  // The single-use rule, tested directly rather than through the route.
  it("refuses the second claim on the same token", async () => {
    const invite = await seedInvite({
      wardId: fixtures.wardAId,
      invitedBy: fixtures.user("bishop").id,
      email: `wlt-test-${fixtures.runId}-single-use@wardleadershiptools.test`,
    });

    expect(await claimInvite(invite.token)).not.toBeNull();
    expect(await claimInvite(invite.token)).toBeNull();
  });

  // Two people opening the same link at the same moment. A read-then-check would let both
  // through; the conditional UPDATE lets exactly one.
  it("lets exactly one of two concurrent claims succeed", async () => {
    const invite = await seedInvite({
      wardId: fixtures.wardAId,
      invitedBy: fixtures.user("bishop").id,
      email: `wlt-test-${fixtures.runId}-race@wardleadershiptools.test`,
    });

    const results = await Promise.all([
      claimInvite(invite.token),
      claimInvite(invite.token),
    ]);

    expect(results.filter((result) => result !== null)).toHaveLength(1);
  });

  it("puts the new user in the invite's ward, not the caller's", async () => {
    const email = `wlt-test-${fixtures.runId}-ward-b@wardleadershiptools.test`;
    const invite = await seedInvite({
      wardId: fixtures.wardBId,
      invitedBy: fixtures.user("wardBBishop").id,
      email,
      role: "org_secretary",
    });

    const result = await redeemInvite(invite.token, {
      firstName: "Ward",
      lastName: "Bee",
      password: PASSWORD,
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    createdAuthUserIds.push(result.userId);

    const { data } = await fixtures.service
      .from("users")
      .select("ward_id, role")
      .eq("id", result.userId)
      .maybeSingle();

    expect(data?.ward_id).toBe(fixtures.wardBId);
    expect(data?.ward_id).not.toBe(fixtures.wardAId);
    expect(data?.role).toBe("org_secretary");
  });

  // Compensation one: the auth user was never created, so only the invite needs releasing.
  it("releases the invite when the auth user cannot be created", async () => {
    const invite = await seedInvite({
      wardId: fixtures.wardAId,
      invitedBy: fixtures.user("bishop").id,
      // Already registered as a fixture, so createUser refuses it.
      email: fixtures.user("bishop").email,
    });

    const result = await redeemInvite(invite.token, {
      firstName: "Duplicate",
      lastName: "Account",
      password: PASSWORD,
    });

    expect(result.ok).toBe(false);
    expect(await readUsedAt(invite.id)).toBeNull();
  });

  // Compensation two, in order: delete the auth user, then release the invite. A half-created
  // account could never sign in (getSessionUser returns null without a public.users row), so
  // leaving one behind would silently burn the email address.
  it("deletes the auth user and releases the invite when the users insert fails", async () => {
    const email = `wlt-test-${fixtures.runId}-compensated@wardleadershiptools.test`;
    const invite = await seedInvite({
      wardId: fixtures.wardAId,
      invitedBy: fixtures.user("bishop").id,
      email,
    });

    const result = await redeemInvite(
      invite.token,
      { firstName: "Rolled", lastName: "Back", password: PASSWORD },
      withFailingUsersInsert(fixtures.service),
    );

    expect(result.ok).toBe(false);
    expect(await readUsedAt(invite.id)).toBeNull();

    const orphan = await findAuthUserIdByEmail(email);
    if (orphan) createdAuthUserIds.push(orphan);
    expect(orphan).toBeUndefined();
  });
});
