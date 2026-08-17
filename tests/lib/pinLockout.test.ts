// @vitest-environment node

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { isPinLockedError } from "@/lib/auth/errors";
import {
  MAX_FAILED_ATTEMPTS,
  assertNotLocked,
  clearAttempts,
  recordFailedAttempt,
} from "@/lib/auth/pinLockout";
import { seedFixtures, type Fixtures } from "@/tests/helpers/seed";

// Runs against the hosted project with the service client, which is the only thing that can
// touch `youth_login_attempts` — migration 021 enables RLS on it and defines no policies.
//
// Every row is keyed to this run's ward, and the ward is deleted in afterAll, so the suite
// cleans up after itself and never assumes an empty table (CLAUDE.md §9).

const HOUR_MS = 60 * 60 * 1000;

describe("PIN lockout", () => {
  let fixtures: Fixtures;
  let wardId: string;
  let usernameCounter = 0;

  // A fresh username per test, so one test's counter can never be another's starting point.
  function nextUsername(label: string): string {
    usernameCounter += 1;
    return `wlt-${fixtures.runId}-${label}-${usernameCounter}`.toLowerCase();
  }

  async function failTimes(username: string, times: number): Promise<boolean> {
    let isNowLocked = false;
    for (let attempt = 0; attempt < times; attempt += 1) {
      ({ isNowLocked } = await recordFailedAttempt(wardId, username, fixtures.service));
    }
    return isNowLocked;
  }

  async function readRow(username: string) {
    const { data, error } = await fixtures.service
      .from("youth_login_attempts")
      .select("failed_count, locked_until")
      .eq("ward_id", wardId)
      .eq("username", username)
      .maybeSingle();

    if (error) throw new Error(error.message);
    return data;
  }

  beforeAll(async () => {
    fixtures = await seedFixtures(["bishop"]);
    wardId = fixtures.wardAId;
  });

  afterAll(async () => {
    await fixtures?.cleanup();
  });

  it("does not lock before the threshold", async () => {
    const username = nextUsername("under");

    expect(await failTimes(username, MAX_FAILED_ATTEMPTS - 1)).toBe(false);
    await expect(assertNotLocked(wardId, username, fixtures.service)).resolves.toBeUndefined();

    expect((await readRow(username))?.failed_count).toBe(MAX_FAILED_ATTEMPTS - 1);
  });

  it("locks on the fifth failure", async () => {
    const username = nextUsername("threshold");

    expect(await failTimes(username, MAX_FAILED_ATTEMPTS)).toBe(true);
    expect((await readRow(username))?.locked_until).not.toBeNull();
  });

  // The sixth attempt is refused even with the correct PIN — assertNotLocked runs before the
  // password exchange, so the PIN is never even offered to Supabase.
  it("throws PinLockedError with a positive remaining-minutes value while locked", async () => {
    const username = nextUsername("locked");
    await failTimes(username, MAX_FAILED_ATTEMPTS);

    const caught = await assertNotLocked(wardId, username, fixtures.service).then(
      () => null,
      (error: unknown) => error,
    );

    expect(isPinLockedError(caught)).toBe(true);
    if (!isPinLockedError(caught)) return;
    expect(caught.remainingMinutes).toBeGreaterThan(0);
  });

  // "Five CONSECUTIVE failures". A success in the middle resets the counter; it does not
  // accumulate for the life of the account.
  it("resets the count on a success", async () => {
    const username = nextUsername("consecutive");

    await failTimes(username, 3);
    await clearAttempts(wardId, username, fixtures.service);
    expect(await failTimes(username, 3)).toBe(false);

    expect((await readRow(username))?.failed_count).toBe(3);
    await expect(assertNotLocked(wardId, username, fixtures.service)).resolves.toBeUndefined();
  });

  it("removes the row entirely when the attempts are cleared", async () => {
    const username = nextUsername("cleared");

    await failTimes(username, 2);
    await clearAttempts(wardId, username, fixtures.service);

    expect(await readRow(username)).toBeNull();
  });

  it("does not throw for a lock whose window has passed", async () => {
    const username = nextUsername("stale");
    await failTimes(username, MAX_FAILED_ATTEMPTS);

    const { error } = await fixtures.service
      .from("youth_login_attempts")
      .update({ locked_until: new Date(Date.now() - HOUR_MS).toISOString() })
      .eq("ward_id", wardId)
      .eq("username", username);
    if (error) throw new Error(error.message);

    await expect(assertNotLocked(wardId, username, fixtures.service)).resolves.toBeUndefined();
  });

  // A stale lock has to restart the count, not resume it. Resuming would re-lock on the very
  // next failure and the fifteen-minute window would never actually expire.
  it("restarts the count at 1 after a stale lock", async () => {
    const username = nextUsername("rolling");
    await failTimes(username, MAX_FAILED_ATTEMPTS);

    const { error } = await fixtures.service
      .from("youth_login_attempts")
      .update({ locked_until: new Date(Date.now() - HOUR_MS).toISOString() })
      .eq("ward_id", wardId)
      .eq("username", username);
    if (error) throw new Error(error.message);

    expect(await failTimes(username, 1)).toBe(false);

    const row = await readRow(username);
    expect(row?.failed_count).toBe(1);
    expect(row?.locked_until).toBeNull();
  });

  // The anti-enumeration property. A username that matches nobody still gets a row, so the
  // work of probing for real usernames is the same as the work of guessing a PIN.
  it("records an attempt for a username that matches no account", async () => {
    const username = nextUsername("nobody");

    await failTimes(username, 1);

    expect((await readRow(username))?.failed_count).toBe(1);
  });

  it("counts a username case-insensitively", async () => {
    const username = nextUsername("mixedcase");

    await failTimes(username, 1);
    await recordFailedAttempt(wardId, username.toUpperCase(), fixtures.service);

    expect((await readRow(username))?.failed_count).toBe(2);
  });

  // Two wards may each hold a "jsmith". Locking one must not lock the other.
  it("keeps the count separate per ward", async () => {
    const username = nextUsername("wardscoped");

    await failTimes(username, MAX_FAILED_ATTEMPTS);
    await expect(
      assertNotLocked(fixtures.wardBId, username, fixtures.service),
    ).resolves.toBeUndefined();
  });
});
