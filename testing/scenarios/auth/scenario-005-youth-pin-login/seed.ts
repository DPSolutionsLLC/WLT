import {
  createMember,
  createSacramentAssignment,
  createSacramentRotationPool,
  createSunday,
  createTestUser,
  createYouthAccount,
  ensureTestWard,
  seedNotificationTriggers,
  setSacramentManager,
} from "../../../infrastructure/seedUtils.ts";

// A youth account with a PIN the tester knows. Reaching this state through the app is a
// multi-step admin flow before the interesting part can even start, and the interesting part —
// which keyboard the phone raises, iOS auto-capitalisation — is a physical-device question no
// automated test can answer.
//
// The sacrament data exists so the page the youth lands on has something on it and so
// setSacramentManager() can point at the account, which is what makes
// is_active_sacrament_manager() return true.

const YOUTH_PIN = "572913";

export async function seed(): Promise<void> {
  await ensureTestWard({ name: "Harness Test Ward" });

  const bishop = await createTestUser({
    handle: "bishop",
    role: "bishop",
    org: "bishopric",
    firstName: "Mark",
    lastName: "Andersen",
  });

  const youth = await createYouthAccount({
    username: "jsmith",
    pin: YOUTH_PIN,
    firstName: "Jared",
    lastName: "Smith",
  });

  const deacons = await Promise.all([
    createMember({ firstName: "Ethan", lastName: "Park", category: "youth" }),
    createMember({ firstName: "Noah", lastName: "Reyes", category: "youth" }),
    createMember({ firstName: "Liam", lastName: "Turner", category: "youth" }),
  ]);

  await createSacramentRotationPool({
    assignmentType: "bread_blessing",
    memberIds: deacons,
    createdBy: bishop.id,
  });

  const sundays = ["2026-08-02", "2026-08-09", "2026-08-16", "2026-08-23", "2026-08-30"];

  for (const date of sundays) {
    const sundayId = await createSunday({ date });
    await createSacramentAssignment({
      sundayId,
      assignmentType: "bread_blessing",
      memberIds: deacons.slice(0, 2),
    });
  }

  await setSacramentManager({ userId: youth.id, assignedBy: bishop.id });

  const triggerCount = await seedNotificationTriggers();

  console.log(
    `  ward, 1 bishop, youth account ${youth.username} (PIN ${YOUTH_PIN}), ` +
      `${sundays.length} sundays with assignments, ${triggerCount} notification triggers`,
  );
}
