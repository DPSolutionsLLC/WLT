import {
  TEST_WARD_ID,
  createAgenda,
  createMember,
  createTestUser,
  createUnitAssignment,
  ensureTestUnits,
  ensureTestWard,
  seedNotificationTriggers,
  setReleasedModules,
} from "../../../infrastructure/seedUtils.ts";

// A WARD THAT HAS RELEASED ONLY SOME MODULES (ITER-041 slice b).
//
// The same data, seen three ways: a bishop who sees only Tithing, a super admin who sees
// everything with the unreleased tiles marked, and a ward secretary for a second ordinary view.
// The list is Tithing alone. (It was Speakers & Prayers + Tithing until ITER-044 removed that
// never-built placeholder; scenario 092 seeds Buffalo's real list.)
//
// THE AGENDA IS THE EVIDENCE. A refused read is an empty result, and an empty result is also what
// a ward with no agendas shows — so one agenda exists, and its absence for the bishop and its
// presence for the super admin is the proof the policy is what hid it.

export async function seed(): Promise<void> {
  await ensureTestWard({ name: "Harness Test Ward" });
  // A stake above the ward, so Stakes & Wards shows the ward's card and its release editor.
  await ensureTestUnits();
  await seedNotificationTriggers();
  await setReleasedModules(TEST_WARD_ID, ["tithing"]);

  await createTestUser({
    handle: "bishop",
    role: "bishop",
    firstName: "Mark",
    lastName: "Andersen",
  });

  // The user's own shape in the real app: an ordinary bishopric calling PLUS app-wide super
  // admin authority, which only a unit_assignments row gives.
  const admin = await createTestUser({
    handle: "admin",
    role: "counselor",
    counselorPosition: 1,
    firstName: "Dana",
    lastName: "Whitmore",
  });
  await createUnitAssignment({ userId: admin.id, role: "super_admin", unitId: null });

  await createTestUser({
    handle: "secretary",
    role: "ward_secretary",
    firstName: "Sarah",
    lastName: "Brooks",
  });

  // Members stay readable whatever the list (migration 091 leaves them unrestricted), because
  // other modules read the people.
  await createMember({ firstName: "Ethan", lastName: "Cortez" });
  await createMember({ firstName: "Elena", lastName: "Cortez" });

  await createAgenda({ meetingType: "bishopric", meetingDate: "2026-10-18" });
}
