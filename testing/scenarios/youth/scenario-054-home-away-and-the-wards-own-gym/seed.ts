import {
  addMemberToOrganization,
  createHousehold,
  createMember,
  createTestUser,
  createYouthActivityProfile,
  ensureTestWard,
  seedNotificationTriggers,
} from "../../../infrastructure/seedUtils.ts";

// NO HOME VENUES, AND NO EVENTS. BOTH ABSENCES ARE THE POINT.
//
// ---------------------------------------------------------------------------------------------
// WHY THE VENUE LIST IS DELIBERATELY EMPTY
// ---------------------------------------------------------------------------------------------
// The tester configures it themselves, half way through, and that is the whole scenario: import
// the file with NO venues and watch every event arrive "Home or away?"; then add the school and
// import again and watch the new games arrive Home. Seeding a configured ward would let the
// checklist pass while the venue editor was broken — which is the one control that makes
// classification work at all, and the reason it had to ship in this slice rather than waiting for
// a Phase 11 admin screen (`lib/ward/homeVenues.ts` header).
//
// It also proves the closed direction. An unconfigured ward classifies NOTHING, rather than
// guessing — because a wrong `home` guess means nobody is asked to attend a game somebody should
// have attended, with no badge anywhere saying so.
//
// ---------------------------------------------------------------------------------------------
// WHY THERE ARE NO EVENTS
// ---------------------------------------------------------------------------------------------
// Every event in this scenario has to come from the FILE, twice, with a hand-made correction in
// between. A pre-seeded row is a row the tester did not import, and the guarantee being checked —
// that a re-import never rewrites a hand-made home/away correction — is only meaningful about
// rows the import itself created.
//
// ---------------------------------------------------------------------------------------------
// THE GUARANTEE THIS EXISTS TO CHECK WAS WRITTEN ABOUT THIS SLICE, IN ADVANCE
// ---------------------------------------------------------------------------------------------
// youth-b's Decision 6: "status and event_type are never touched on a matched row, so a
// hand-cancelled game and slice C's future home/away correction both survive." Slice C is the
// change that starts writing `event_type` on an import at all, so it is the first thing that
// could break it. `tests/lib/icsIdempotent.test.ts` pins the diff; what it cannot answer is
// whether the PREVIEW SCREEN says so, in words, before the leader confirms.
//
// `lincoln-basketball.ics` is scenario 051's file, byte for byte. Reusing it rather than writing a
// second one means the two scenarios cannot drift about what the file contains, and the
// DESCRIPTION line on every entry states what the app should do with it.
//
// The locations it carries, which is what matters here:
//   Lincoln High School gym         4 entries (one of them a weekly practice → 7 rows)
//   Lincoln High School cafeteria   1 entry — no DTSTART, so it never becomes a row
//   Jefferson High School           1 entry — an away game the school published as UTC
//   Regional Sports Center          1 entry — the all-day district tournament

export async function seed(): Promise<void> {
  // NO `homeVenues`. See the header — absent is the state the tester is asked to fix.
  await ensureTestWard({ name: "Harness Test Ward" });
  await seedNotificationTriggers();

  const bishop = await createTestUser({
    handle: "bishop",
    role: "bishop",
    firstName: "Marcus",
    lastName: "Reyes",
  });

  const youngMenPresident = await createTestUser({
    handle: "ym-president",
    role: "org_president",
    org: "youngMen",
    firstName: "Miguel",
    lastName: "Cortez",
  });

  const brooks = await createHousehold({
    familyName: "Brooks",
    address: "2201 Canyon Road",
  });

  const ethan = await createMember({
    firstName: "Ethan",
    lastName: "Brooks",
    householdId: brooks,
    category: "youth",
    gender: "male",
  });

  await addMemberToOrganization({ memberId: ethan, org: "youngMen" });

  await createYouthActivityProfile({
    memberId: ethan,
    activityName: "Varsity basketball",
    activityType: "sport",
    schoolOrg: "Lincoln High School",
    seasonSchedule: "November to February",
    org: "youngMen",
    enteredBy: youngMenPresident.id,
  });

  console.log(
    "  ward with NO home venues, 2 users, 1 household, 1 youth, 1 activity profile, NO events",
  );
  console.log(`  bishop=${bishop.email} ym-president=${youngMenPresident.email}`);
}
