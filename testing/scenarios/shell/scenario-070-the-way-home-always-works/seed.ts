import {
  addMemberToOrganization,
  createHousehold,
  createMember,
  createSunday,
  createTestUser,
  ensureTestWard,
  seedNotificationTriggers,
} from "../../../infrastructure/seedUtils.ts";

// THE WAY HOME ALWAYS WORKS.
//
// ⚠️ THIS SEED EXISTS TO MAKE THE HOPS REAL. The back link is the thing under test, and the only
// way to break it is to navigate SEVERAL PAGES DEEP ACROSS DIFFERENT MODULES — the prototype's
// version tracked one step of history, overwritten on every navigation, so it took a couple of
// hops before it began ping-ponging between the last two pages and permanently lost the path
// home. A dashboard with nothing behind its tiles cannot reproduce that.
//
// So there is a household to open from /roster, a young person with an activity to open from
// /youth, and a Sunday to open from /calendar and /program. Five real stops, in four modules.
//
// The bishop is the only account: a multi-hop walk is one person's session, and a second role
// would only repeat scenario 069's work.

export async function seed(): Promise<void> {
  await ensureTestWard({ name: "Harness Test Ward" });
  await seedNotificationTriggers();

  const bishop = await createTestUser({
    handle: "bishop",
    role: "bishop",
    firstName: "Mark",
    lastName: "Andersen",
  });

  // A household with somebody in it, so /roster has a row to open and the walk has a page that
  // is genuinely three levels down rather than two.
  const household = await createHousehold({
    familyName: "Brooks",
    address: "2201 Canyon Road",
  });

  await createMember({
    firstName: "Rachel",
    lastName: "Brooks",
    householdId: household,
    category: "adult",
    gender: "female",
  });

  const youth = await createMember({
    firstName: "Ethan",
    lastName: "Brooks",
    householdId: household,
    category: "youth",
    gender: "male",
  });

  await addMemberToOrganization({ memberId: youth, org: "youngMen" });

  // Two Sundays, so /calendar and /program each have something to open and the walk does not
  // have to reuse the same stop twice.
  await createSunday({ date: "2026-10-04", conductingUserId: bishop.id });
  await createSunday({ date: "2026-10-11", conductingUserId: bishop.id });

  console.log("  ward, 1 user, 1 household, 2 members, 2 Sundays");
}
