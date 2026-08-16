import {
  createTestUser,
  ensureTestWard,
  seedNotificationTriggers,
} from "../../../infrastructure/seedUtils.ts";

// The invite itself is NOT seeded — generating it through the admin page is half of what this
// scenario proves. What is seeded is the bishopric that can generate one, plus the notification
// triggers, without which `admin_setting_changed` fires into nothing: a ward created outside
// supabase/seed/ward.sql has no notification_settings rows at all
// (plans/retros/foundation-c-services.md).

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

  const triggerCount = await seedNotificationTriggers();

  console.log(`  ward, 2 bishopric users, ${triggerCount} notification triggers`);
}
