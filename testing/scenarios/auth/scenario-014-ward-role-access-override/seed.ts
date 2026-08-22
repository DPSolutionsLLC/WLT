import {
  addMemberToOrganization,
  createHousehold,
  createMember,
  createSunday,
  createTestUser,
  ensureTestWard,
} from "../../../infrastructure/seedUtils.ts";

// The point of this scenario is the ward's role_access override, so the roster and calendar are
// only as large as they need to be to have something to allow and something to refuse.
//
// Nothing in the app writes role_access — the Phase 11 screen that will own it does not exist —
// so this state is unreachable by hand without editing jsonb in the Supabase dashboard. That is
// exactly what seeding is for, and walking it once proves the delta shape is writable and
// readable end to end BEFORE a screen depends on it.
//
// The override is a DELTA, not a replacement list:
//   ward_secretary GAINS roster.manage (bishopric-only by default)
//   bishop LOSES calendar.manage — and so does the counselor, who is never named, because
//          bishopric authority is shared and mergeRoleAccess applies the delta to both.
//
// Deliberately absent: any admin.* or sacrament.* entry. Those are locked in both directions, so
// an override naming one is ignored — the checklist verifies that by having the bishop still
// reach /admin/users.

export async function seed(): Promise<void> {
  await ensureTestWard({
    name: "Harness Test Ward",
    roleAccess: {
      ward_secretary: { add: ["roster.manage"] },
      bishop: { remove: ["calendar.manage"] },
    },
  });

  await createTestUser({
    handle: "bishop",
    role: "bishop",
    org: "bishopric",
    firstName: "Mark",
    lastName: "Andersen",
  });

  // Named in no delta. He must lose calendar.manage anyway — that is the half of this scenario
  // a tester would never guess from reading the seeded JSON.
  await createTestUser({
    handle: "counselor1",
    role: "counselor",
    org: "bishopric",
    counselorPosition: 1,
    firstName: "Paul",
    lastName: "Whitfield",
  });

  await createTestUser({
    handle: "secretary",
    role: "ward_secretary",
    org: "bishopric",
    firstName: "Ruth",
    lastName: "Nguyen",
  });

  const andersen = await createHousehold({
    familyName: "Andersen",
    address: "12 Oak Street",
  });
  const nguyen = await createHousehold({
    familyName: "Nguyen",
    address: "7 Cedar Court",
  });

  const mark = await createMember({
    firstName: "Mark",
    lastName: "Andersen",
    householdId: andersen,
    category: "adult",
    gender: "male",
    phone: "555-0101",
  });
  await createMember({
    firstName: "Julia",
    lastName: "Andersen",
    householdId: andersen,
    category: "adult",
    gender: "female",
    phone: "555-0102",
  });
  // In no organization to start with, so the ward secretary's save is an ADD and the new row is
  // unambiguous when checked in Supabase.
  await createMember({
    firstName: "David",
    lastName: "Nguyen",
    householdId: nguyen,
    category: "adult",
    gender: "male",
    phone: "555-0106",
  });
  await createMember({
    firstName: "Kevin",
    lastName: "Nguyen",
    householdId: nguyen,
    category: "youth",
    gender: "male",
  });

  await addMemberToOrganization({ memberId: mark, org: "eldersQuorum" });

  // One month, so the calendar page has a Sunday to refuse an edit on.
  for (const date of ["2027-06-06", "2027-06-13", "2027-06-20", "2027-06-27"]) {
    await createSunday({ date, speakingSlots: 3 });
  }

  console.log(
    "  ward with a role_access override (ward_secretary +roster.manage, " +
      "bishop -calendar.manage), 3 users, 2 households, 4 members, 4 Sundays",
  );
}
