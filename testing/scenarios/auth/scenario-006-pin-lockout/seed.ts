import {
  createTestUser,
  createYouthAccount,
  ensureTestWard,
  seedNotificationTriggers,
  setYouthLoginAttempts,
} from "../../../infrastructure/seedUtils.ts";

// Seeded at FOUR failures, one short of the threshold. Lockout is a timed state, and the
// interesting moments are the fifth failure, the sixth attempt with the CORRECT PIN, and the
// bishopric notification. Walking to the boundary by hand takes four sign-in attempts every
// time you want to see it again.
//
// locked_until stays null: the account is not locked yet, and the tester's first action is
// what locks it.
//
// seedNotificationTriggers() is not optional here. `youth_account_locked` is a new key
// (migration 021); without a notification_settings row emitNotification() warns to the console
// and sends nothing, and the "both bishopric members were notified" check would fail for a
// reason unrelated to the code under test (plans/retros/foundation-c-services.md).

const YOUTH_PIN = "572913";
const FAILURES_ALREADY_RECORDED = 4;

export async function seed(): Promise<void> {
  await ensureTestWard({ name: "Harness Test Ward" });

  await createTestUser({
    handle: "bishop",
    role: "bishop",
    org: "bishopric",
    firstName: "Mark",
    lastName: "Andersen",
  });

  await createTestUser({
    handle: "counselor1",
    role: "counselor",
    org: "bishopric",
    counselorPosition: 1,
    firstName: "Sarah",
    lastName: "Brooks",
  });

  const youth = await createYouthAccount({
    username: "jsmith",
    pin: YOUTH_PIN,
    firstName: "Jared",
    lastName: "Smith",
  });

  await setYouthLoginAttempts({
    username: youth.username,
    failedCount: FAILURES_ALREADY_RECORDED,
    lockedUntil: null,
  });

  const triggerCount = await seedNotificationTriggers();

  console.log(
    `  ward, bishop + counselor, youth account ${youth.username} (PIN ${YOUTH_PIN}) ` +
      `at ${FAILURES_ALREADY_RECORDED} failed attempts, ${triggerCount} notification triggers`,
  );
}
