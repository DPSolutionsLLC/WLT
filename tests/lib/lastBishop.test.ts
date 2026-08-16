// @vitest-environment node

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  LAST_BISHOP_MESSAGE,
  countActiveBishops,
  updateWardUser,
} from "@/lib/auth/adminUsers";
import { seedFixtures, type Fixtures } from "@/tests/helpers/seed";

// The ward must never be able to lock itself out of its own admin surface. Every assertion that
// a change was REFUSED re-reads the row: an RLS-denied update returns zero rows and no error
// (plans/retros/foundation-c-services.md), so "no error" proves nothing on its own.

describe("last active bishop guard", () => {
  let fixtures: Fixtures;

  async function readUser(userId: string) {
    const { data, error } = await fixtures.service
      .from("users")
      .select("role, is_active")
      .eq("id", userId)
      .maybeSingle();

    if (error) throw new Error(error.message);
    return data;
  }

  beforeAll(async () => {
    fixtures = await seedFixtures([
      "bishop",
      "counselor1",
      "wardCouncilMember",
      "wardBBishop",
    ]);
  });

  afterAll(async () => {
    await fixtures?.cleanup();
  });

  it("counts exactly one active bishop to start with", async () => {
    expect(await countActiveBishops(fixtures.wardAId, fixtures.service)).toBe(1);
  });

  it("refuses to deactivate the only active bishop", async () => {
    const bishop = fixtures.user("bishop");

    const result = await updateWardUser(
      {
        wardId: fixtures.wardAId,
        targetUserId: bishop.id,
        changes: { isActive: false },
      },
      fixtures.service,
    );

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.message).toBe(LAST_BISHOP_MESSAGE);

    expect((await readUser(bishop.id))?.is_active).toBe(true);
  });

  it("refuses to move the only active bishop off the bishop role", async () => {
    const bishop = fixtures.user("bishop");

    const result = await updateWardUser(
      {
        wardId: fixtures.wardAId,
        targetUserId: bishop.id,
        changes: { role: "counselor" },
      },
      fixtures.service,
    );

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.message).toBe(LAST_BISHOP_MESSAGE);

    expect((await readUser(bishop.id))?.role).toBe("bishop");
  });

  it("allows a second bishop to be appointed", async () => {
    const result = await updateWardUser(
      {
        wardId: fixtures.wardAId,
        targetUserId: fixtures.user("wardCouncilMember").id,
        changes: { role: "bishop" },
      },
      fixtures.service,
    );

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.user.role).toBe("bishop");
    expect(result.changeSummaries.join(" ")).toContain("role changed");
    expect(await countActiveBishops(fixtures.wardAId, fixtures.service)).toBe(2);
  });

  it("allows deactivating one of two bishops", async () => {
    const second = fixtures.user("wardCouncilMember");

    const result = await updateWardUser(
      {
        wardId: fixtures.wardAId,
        targetUserId: second.id,
        changes: { isActive: false },
      },
      fixtures.service,
    );

    expect(result.ok).toBe(true);
    expect((await readUser(second.id))?.is_active).toBe(false);
  });

  it("does not count an inactive bishop toward the total", async () => {
    expect(await countActiveBishops(fixtures.wardAId, fixtures.service)).toBe(1);
  });

  it("protects the remaining bishop once the second is inactive", async () => {
    const bishop = fixtures.user("bishop");

    const result = await updateWardUser(
      {
        wardId: fixtures.wardAId,
        targetUserId: bishop.id,
        changes: { isActive: false },
      },
      fixtures.service,
    );

    expect(result.ok).toBe(false);
    expect((await readUser(bishop.id))?.is_active).toBe(true);
  });

  it("leaves a non-bishop account changeable", async () => {
    const result = await updateWardUser(
      {
        wardId: fixtures.wardAId,
        targetUserId: fixtures.user("counselor1").id,
        changes: { isActive: false },
      },
      fixtures.service,
    );

    expect(result.ok).toBe(true);
    expect((await readUser(fixtures.user("counselor1").id))?.is_active).toBe(false);
  });

  // RLS would refuse this write anyway, but a denied UPDATE comes back as success with zero
  // rows. The explicit ward check turns that into a message the admin can act on.
  it("refuses a target in another ward", async () => {
    const wardBBishop = fixtures.user("wardBBishop");

    const result = await updateWardUser(
      {
        wardId: fixtures.wardAId,
        targetUserId: wardBBishop.id,
        changes: { isActive: false },
      },
      fixtures.service,
    );

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.message).toContain("not in your ward");

    expect((await readUser(wardBBishop.id))?.is_active).toBe(true);
  });

  it("refuses an organization from another ward", async () => {
    const result = await updateWardUser(
      {
        wardId: fixtures.wardAId,
        targetUserId: fixtures.user("counselor1").id,
        changes: { orgId: fixtures.wardBOrgId },
      },
      fixtures.service,
    );

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.message).toContain("not in your ward");
  });
});
