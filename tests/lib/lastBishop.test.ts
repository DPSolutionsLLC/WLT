// @vitest-environment node

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  LAST_BISHOP_MESSAGE,
  SELF_DEACTIVATE_MESSAGE,
  countActiveBishops,
  updateWardUser,
} from "@/lib/auth/adminUsers";
import { updateCalling } from "@/lib/callings/writeCalling";
import { seedFixtures, type Fixtures } from "@/tests/helpers/seed";

// The ward must never be able to lock itself out of its own admin surface. Every assertion that
// a change was REFUSED re-reads the row: an RLS-denied update returns zero rows and no error
// (plans/retros/foundation-c-services.md), so "no error" proves nothing on its own.

describe("last active bishop guard", () => {
  let fixtures: Fixtures;

  // TWO ROWS, TWO FACTS (migration 068). `is_active` is the ACCOUNT's — app-wide, and what a
  // deactivation writes. `role` is the CALLING's, in the ward being administered. The guard reads
  // both, so a re-read that only looked at one could pass while the other had moved.
  async function readUser(userId: string) {
    const { data: account, error: accountError } = await fixtures.service
      .from("users")
      .select("is_active")
      .eq("id", userId)
      .maybeSingle();

    if (accountError) throw new Error(accountError.message);
    if (!account) return null;

    const { data: calling, error: callingError } = await fixtures.service
      .from("ward_role_assignments")
      .select("role")
      .eq("user_id", userId)
      .eq("ward_id", fixtures.wardAId)
      .eq("is_active", true)
      .maybeSingle();

    if (callingError) throw new Error(callingError.message);

    return { is_active: account.is_active, role: calling?.role ?? null };
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

  // ITER-058 cr2: nobody deactivates their own account. Counselor 1 is active, in the ward and not
  // a bishop, so the only thing refusing this is that it is their own.
  it("refuses an account deactivating itself", async () => {
    const counselor = fixtures.user("counselor1");

    const result = await updateWardUser(
      {
        wardId: fixtures.wardAId,
        actorUserId: counselor.id,
        targetUserId: counselor.id,
        changes: { isActive: false },
      },
      fixtures.service,
    );

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.message).toBe(SELF_DEACTIVATE_MESSAGE);
    expect((await readUser(counselor.id))?.is_active).toBe(true);
  });

  // The actor is NOT the bishop, so the self-deactivation refusal cannot be what stops it.
  it("refuses to deactivate the only active bishop", async () => {
    const bishop = fixtures.user("bishop");

    const result = await updateWardUser(
      {
        wardId: fixtures.wardAId,
        actorUserId: fixtures.user("counselor1").id,
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

  // Admin → Users no longer changes a calling (ITER-058 cr2), so a second bishop is made through the
  // one writer, and the review's own last-bishop guard is tests/routes/calling-review.test.ts's.
  it("counts a second bishop once one is appointed", async () => {
    const updated = await updateCalling(
      {
        userId: fixtures.user("wardCouncilMember").id,
        wardId: fixtures.wardAId,
        changes: { role: "bishop" },
        actorUserId: fixtures.user("bishop").id,
        source: "manual",
      },
      fixtures.service,
    );

    expect(updated?.role).toBe("bishop");
    expect(await countActiveBishops(fixtures.wardAId, fixtures.service)).toBe(2);
  });

  it("allows deactivating one of two bishops", async () => {
    const second = fixtures.user("wardCouncilMember");

    const result = await updateWardUser(
      {
        wardId: fixtures.wardAId,
        actorUserId: fixtures.user("bishop").id,
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
        actorUserId: fixtures.user("counselor1").id,
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
        actorUserId: fixtures.user("bishop").id,
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
        actorUserId: fixtures.user("bishop").id,
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
});
