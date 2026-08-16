// @vitest-environment node

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { redeemInvite } from "@/lib/auth/invites";
import { registerSchema, type RegisterInput } from "@/lib/validation/invite";
import { seedFixtures, type Fixtures } from "@/tests/helpers/seed";

// 01-auth-rbac.md calls privilege escalation through the registration body "the single most
// likely security bug in this phase". This suite is the proof that it cannot happen, at two
// layers: the schema drops the field, and the function never reads it even if the schema is
// bypassed entirely.

const PASSWORD = "harness-invite-password-1";

describe("invite privilege escalation", () => {
  let fixtures: Fixtures;
  const createdAuthUserIds: string[] = [];

  async function seedInvite(role: string, email: string): Promise<string> {
    const token = `wlt-test-token-${fixtures.runId}-${createdAuthUserIds.length}-${role}`;

    const { error } = await fixtures.service.from("invites").insert({
      ward_id: fixtures.wardAId,
      email,
      role,
      invited_by: fixtures.user("bishop").id,
      token,
      expires_at: new Date(Date.now() + 60 * 60 * 1000).toISOString(),
    });

    if (error) throw new Error(`Could not seed the invite: ${error.message}`);

    return token;
  }

  async function readCreatedUser(userId: string) {
    const { data, error } = await fixtures.service
      .from("users")
      .select("id, ward_id, role, org_id")
      .eq("id", userId)
      .maybeSingle();

    if (error) throw new Error(error.message);
    return data;
  }

  beforeAll(async () => {
    fixtures = await seedFixtures(["bishop"]);
  });

  afterAll(async () => {
    // Wards first — they cascade to public.users, which is what frees the auth rows below
    // (plans/retros/foundation-c-services.md).
    await fixtures?.cleanup();

    for (const authUserId of createdAuthUserIds) {
      const { error } = await fixtures.service.auth.admin.deleteUser(authUserId);
      if (error) {
        console.warn(`Could not delete registrant auth user ${authUserId}`, error.message);
      }
    }
  });

  it("strips role and orgId from a registration body that carries them", () => {
    const result = registerSchema.parse({
      firstName: "Ada",
      lastName: "Lovelace",
      password: PASSWORD,
      role: "bishop",
      orgId: "11111111-1111-4111-8111-111111111111",
    });

    expect(result).not.toHaveProperty("role");
    expect(result).not.toHaveProperty("orgId");
    expect(result.firstName).toBe("Ada");
  });

  it("creates the account with the invite's role", async () => {
    const email = `wlt-test-${fixtures.runId}-invitee-a@wardleadershiptools.test`;
    const token = await seedInvite("music_coordinator", email);

    const result = await redeemInvite(token, {
      firstName: "Ada",
      lastName: "Lovelace",
      password: PASSWORD,
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    createdAuthUserIds.push(result.userId);

    const created = await readCreatedUser(result.userId);

    expect(created?.role).toBe("music_coordinator");
    expect(created?.ward_id).toBe(fixtures.wardAId);
  });

  // The schema is one control. This is the other: even handed an object that DOES carry
  // role: "bishop", redeemInvite reads the invite row and nothing else.
  it("ignores a role smuggled past the schema straight into redeemInvite", async () => {
    const email = `wlt-test-${fixtures.runId}-invitee-b@wardleadershiptools.test`;
    const token = await seedInvite("music_coordinator", email);

    const smuggled = {
      firstName: "Grace",
      lastName: "Hopper",
      password: PASSWORD,
      role: "bishop",
      orgId: fixtures.eldersQuorumId,
      wardId: fixtures.wardBId,
    } as unknown as RegisterInput;

    const result = await redeemInvite(token, smuggled);

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    createdAuthUserIds.push(result.userId);

    const created = await readCreatedUser(result.userId);

    expect(created?.role).toBe("music_coordinator");
    expect(created?.role).not.toBe("bishop");
    expect(created?.org_id).toBeNull();
    expect(created?.ward_id).toBe(fixtures.wardAId);
  });
});
