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

// EVERYTHING SCENARIO 038 SEEDS, PLUS AN EXECUTIVE SECRETARY AND AN ALREADY-FLAGGED VISIT.
//
// It repeats 038's fixture rather than running with --no-clean after it, because the two
// scenarios check different things and either should be walkable on its own. Every builder here
// is idempotent on the harness ward, so seeding this after 038 is also safe.
//
// ---------------------------------------------------------------------------------------------
// WHY A VISIT ARRIVES ALREADY FLAGGED, WITH flag_sent_at SET
// ---------------------------------------------------------------------------------------------
// This is the only reason this scenario needs a seed at all. The route notifies on
// false -> true ONLY while flag_sent_at is null (07-visits.md §Step 3), so the re-flag path —
// "flagging something that has already been raised sends nothing" — is unreachable from an empty
// database in one sitting. A tester would have to flag, unflag and re-flag first, which is the
// very sequence the scenario is trying to test independently.
//
// The Halvorsen visit therefore arrives flagged with a timestamp already on it. Pressing the flag
// on it must send NOTHING.
//
// ---------------------------------------------------------------------------------------------
// WHY THE LONG SHARED NOTE
// ---------------------------------------------------------------------------------------------
// The notification body is the one-liner and nothing else. A short shared note could be omitted
// by accident and nobody would notice; a long, unmistakable one either appears in the bell menu
// or it does not. The private note is there for the same reason, one level worse.
//
// ---------------------------------------------------------------------------------------------
// WHY THE EXECUTIVE SECRETARY HOLDS NO visits.view
// ---------------------------------------------------------------------------------------------
// That is not an oversight to work around in the fixture. It is what makes "the notification
// carries the one-liner only" structurally true rather than a rule somebody has to remember —
// the recipient could not open the visit even if the body tempted them to.

const CANARY_SHARED_NOTE =
  "Shared: the family have been through a very difficult month and would welcome more contact " +
  "from the quorum. SHARED-NOTE-CANARY-039 — this sentence must never appear in a notification.";

const CANARY_PRIVATE_NOTE =
  "Private: a confidence that was asked to be kept. PRIVATE-NOTE-CANARY-039 — this sentence " +
  "must never leave this box.";

export async function seed(): Promise<void> {
  await ensureTestWard({ name: "Harness Test Ward" });

  // Without this the ward has no notification_settings rows, emitNotification() warns
  // "Unknown notification trigger" and sends nothing — which would make every check below pass
  // for the wrong reason.
  await seedNotificationTriggers();

  await createTestUser({
    handle: "bishop",
    role: "bishop",
    firstName: "Mark",
    lastName: "Andersen",
  });

  await createTestUser({
    handle: "exec-secretary",
    role: "executive_secretary",
    firstName: "Grace",
    lastName: "Lindqvist",
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
    ].map((member) => createMember({ ...member, category: "adult", status: "active" })),
  );

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

  // UNFLAGGED, and carrying the long shared note. This is the one the tester raises.
  const brooksVisit = await createVisitLog({
    org: "eldersQuorum",
    householdId: households[0],
    recordedBy: eqPresident.id,
    visitDate: "2026-02-08",
    sharedNotes: CANARY_SHARED_NOTE,
  });

  await createVisitPrivateNote({
    visitLogId: brooksVisit,
    userId: eqPresident.id,
    notes: CANARY_PRIVATE_NOTE,
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
  });

  // ALREADY FLAGGED, AND ALREADY SENT. Pressing the flag on this one must notify nobody.
  await createVisitLog({
    org: "eldersQuorum",
    householdId: households[3],
    recordedBy: eqPresident.id,
    visitDate: "2026-03-22",
    sharedNotes: "Shared: raised with the quorum presidency last week.",
    flaggedForWardCouncil: true,
    flagSentAt: "2026-03-23T18:00:00.000Z",
  });

  await createVisitLog({
    org: "reliefSociety",
    householdId: households[4],
    recordedBy: rsPresident.id,
    visitDate: "2026-03-08",
    sharedNotes: "Shared: sister is recovering well and asked after the Relief Society lesson.",
  });
}
