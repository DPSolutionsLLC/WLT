import {
  createHousehold,
  createMember,
  createTestUser,
  createVisitGoal,
  createVisitLog,
  createVisitPrivateNote,
  ensureTestWard,
  seedNotificationTriggers,
} from "../../../infrastructure/seedUtils.ts";

// THE STATE THIS SEEDS IS A PRIVATE NOTE SOMEBODY ELSE WROTE.
//
// That is the whole reason this scenario exists as a seeded fixture rather than a unit test. The
// tester can write their own note in thirty seconds; what they cannot do alone is be TWO people
// at once, and "the bishop opens a visit and sees no trace of the EQ president's note" is only a
// real check if the note was written by somebody other than whoever is looking.
//
// ---------------------------------------------------------------------------------------------
// WHY TWO ORGANIZATIONS
// ---------------------------------------------------------------------------------------------
// One Relief Society log beside three Elders Quorum ones makes the org boundary visible on the
// same screen as the notes boundary. The harness ward has cross_org_visibility off by default, so
// the EQ president should see three visits and not four — a count that is wrong in an obvious way
// if migration 019's policy ever loosens.
//
// ---------------------------------------------------------------------------------------------
// WHY A HOUSEHOLD WITH NO ACTIVE MEMBERS
// ---------------------------------------------------------------------------------------------
// DEFAULT_MEMBER_STATUSES is ["active"] and its header in lib/roster/queries.ts names a visit-goal
// denominator as the reason it exists. The Ferreira household has one moved-out member and nobody
// else, so it must NOT appear in the household picker. A fixture without it would let that rule
// rot unnoticed until visits-b computes a progress number over the wrong denominator.
//
// ---------------------------------------------------------------------------------------------
// WHY AN ORG SECRETARY
// ---------------------------------------------------------------------------------------------
// `visits.view` and `visits.create` reach a secretary; `visits.manage_goals` does not
// (lib/auth/permissions.ts). That is the read-only case, and it is the one somebody is most
// likely to break by reaching for a role comparison instead of the permission matrix
// (plans/retros/role-access-overrides.md).

const EQ_PRIVATE_NOTE =
  "Private: the family asked us not to repeat what was said about their son. " +
  "PRIVATE-NOTE-CANARY-038";

const EQ_SHARED_NOTE =
  "Shared: brought a meal round after the surgery. Happy for home teachers to call again.";

export async function seed(): Promise<void> {
  await ensureTestWard({ name: "Harness Test Ward" });

  // A ward created outside supabase/seed/ward.sql has no notification_settings rows, and
  // scenario 039 continues from this state expecting a notification to arrive.
  await seedNotificationTriggers();

  await createTestUser({
    handle: "bishop",
    role: "bishop",
    firstName: "Mark",
    lastName: "Andersen",
  });

  const eqPresident = await createTestUser({
    handle: "eq-president",
    role: "org_president",
    org: "eldersQuorum",
    firstName: "Miguel",
    lastName: "Cortez",
  });

  await createTestUser({
    handle: "eq-secretary",
    role: "org_secretary",
    org: "eldersQuorum",
    firstName: "Peter",
    lastName: "Nakamura",
  });

  const rsPresident = await createTestUser({
    handle: "rs-president",
    role: "org_president",
    org: "reliefSociety",
    firstName: "Ana",
    lastName: "Delgado",
  });

  const households = await Promise.all(
    [
      { familyName: "Brooks", address: "2201 Canyon Road" },
      { familyName: "Whitfield", address: "88 Elm Street" },
      { familyName: "Okonkwo", address: "14 Larkspur Lane" },
      { familyName: "Halvorsen", address: "902 Ridgeview Drive" },
      { familyName: "Tuiasosopo", address: "35 Maple Court" },
    ].map((household) => createHousehold(household)),
  );

  await Promise.all(
    [
      { firstName: "David", lastName: "Brooks", householdId: households[0] },
      { firstName: "Ruth", lastName: "Brooks", householdId: households[0] },
      { firstName: "Sarah", lastName: "Whitfield", householdId: households[1] },
      { firstName: "Emeka", lastName: "Okonkwo", householdId: households[2] },
      { firstName: "Inge", lastName: "Halvorsen", householdId: households[3] },
      { firstName: "Lani", lastName: "Tuiasosopo", householdId: households[4] },
    ].map((member) =>
      createMember({ ...member, category: "adult", status: "active" }),
    ),
  );

  // The sixth household: everybody moved out, so it is not somewhere to visit.
  const ferreira = await createHousehold({
    familyName: "Ferreira",
    address: "410 Sycamore Way",
  });

  await createMember({
    firstName: "Joana",
    lastName: "Ferreira",
    householdId: ferreira,
    category: "adult",
    status: "moved_out",
  });

  await createVisitGoal({
    org: "eldersQuorum",
    title: "Visit every household this year",
    cadence: "annual",
    goalPeriodStart: "2026-01-01",
    goalPeriodEnd: "2026-12-31",
    createdBy: eqPresident.id,
  });

  await createVisitGoal({
    org: "reliefSociety",
    title: "Visit every sister twice this year",
    cadence: "biannual",
    goalPeriodStart: "2026-01-01",
    goalPeriodEnd: "2026-12-31",
    createdBy: rsPresident.id,
  });

  // The visit the private note hangs off. Its shared note is deliberately ordinary and its
  // private note deliberately distinctive, so a Ctrl+F on the bishop's page has something
  // unmistakable to fail to find.
  const brooksVisit = await createVisitLog({
    org: "eldersQuorum",
    householdId: households[0],
    recordedBy: eqPresident.id,
    visitDate: "2026-02-08",
    sharedNotes: EQ_SHARED_NOTE,
  });

  await createVisitLog({
    org: "eldersQuorum",
    householdId: households[1],
    recordedBy: eqPresident.id,
    visitDate: "2026-02-15",
    sharedNotes: "Shared: caught them on the way out, agreed to call back next month.",
  });

  await createVisitLog({
    org: "eldersQuorum",
    householdId: households[2],
    recordedBy: eqPresident.id,
    visitDate: "2026-03-01",
    // No shared notes at all — the empty state has to be on screen beside the filled ones, or
    // nothing proves the list renders it as an ordinary visit rather than a broken row.
  });

  await createVisitLog({
    org: "reliefSociety",
    householdId: households[3],
    recordedBy: rsPresident.id,
    visitDate: "2026-03-08",
    sharedNotes: "Shared: sister is recovering well and asked after the Relief Society lesson.",
  });

  // Written as the EQ PRESIDENT, so the bishop's view of this same visit is the check.
  await createVisitPrivateNote({
    visitLogId: brooksVisit,
    userId: eqPresident.id,
    notes: EQ_PRIVATE_NOTE,
  });
}
