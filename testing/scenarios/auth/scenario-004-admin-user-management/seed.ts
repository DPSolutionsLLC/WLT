import {
  createTestUser,
  ensureTestWard,
  seedNotificationTriggers,
} from "../../../infrastructure/seedUtils.ts";

// Exactly one bishop, plus a spare account to promote into a second one. The whole point of
// this scenario is the refusal that fires when the ward is down to its last active bishop, and
// that state is fiddly to reach by hand and exact when seeded.
//
// seedNotificationTriggers() is not optional here: without it `admin_setting_changed` fires
// into nothing and the "counselor1 was notified" check fails for a reason that has nothing to
// do with the code under test (plans/retros/foundation-c-services.md).

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

  await createTestUser({
    handle: "secretary",
    role: "ward_secretary",
    org: "bishopric",
    firstName: "David",
    lastName: "Nguyen",
  });

  await createTestUser({
    handle: "eqpres",
    role: "org_president",
    org: "eldersQuorum",
    firstName: "Tomas",
    lastName: "Ruiz",
  });

  await createTestUser({
    handle: "spare",
    role: "ward_council_member",
    firstName: "Miguel",
    lastName: "Cortez",
  });

  const triggerCount = await seedNotificationTriggers();

  console.log(`  ward, 5 users (1 bishop), ${triggerCount} notification triggers`);
}
