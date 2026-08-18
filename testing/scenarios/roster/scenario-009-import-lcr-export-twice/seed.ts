import {
  createHousehold,
  createMember,
  createMemberNote,
  createTestUser,
  ensureTestWard,
  seedNotificationTriggers,
} from "../../../infrastructure/seedUtils.ts";

// A roster that ALREADY HAS DATA, because an import into an empty ward proves nothing. The
// guarantee this scenario exists to observe — running the same import twice changes nothing and
// loses no notes — needs rows to leave alone in the first place.
//
// Three of the seeded households match rows in fixtures/lcr-export.csv exactly, on the same key
// apply_roster_import uses: family name plus address, both case-insensitive. Change an address
// here and the preview starts reporting a new household where it should report a match.

export async function seed(): Promise<void> {
  await ensureTestWard({ name: "Harness Test Ward" });

  // The notification triggers are the whole set, because the import fires new_household_added
  // and a ward created outside supabase/seed/ward.sql has no notification_settings rows at all.
  await seedNotificationTriggers();

  const bishop = await createTestUser({
    handle: "bishop",
    role: "bishop",
    org: "bishopric",
    firstName: "Mark",
    lastName: "Andersen",
  });

  // Holds roster.view but NOT roster.import. The two 403 checks in the scenario are what prove
  // the route is doing that work — migration 019's ward-scoped policy loop would happily let
  // this account insert members (roster-a Decision 3).
  await createTestUser({
    handle: "secretary",
    role: "ward_secretary",
    firstName: "Ruth",
    lastName: "Kaufman",
  });

  await createTestUser({
    handle: "eqpres",
    role: "org_president",
    org: "eldersQuorum",
    firstName: "Tomas",
    lastName: "Ruiz",
  });

  // --- The three households the CSV must MATCH rather than create -------------------
  // The address on the Andersen household carries a comma, so it only matches if the parser
  // read the quoted field in the CSV correctly. That is the check hiding inside this fixture.
  const andersen = await createHousehold({
    familyName: "Andersen",
    address: "12 Oak Street, Apt 4",
  });
  const brooks = await createHousehold({
    familyName: "Brooks",
    address: "48 Willow Lane",
  });
  const nguyen = await createHousehold({
    familyName: "Nguyen",
    address: "7 Cedar Court",
  });

  // --- Seven members, six of them in the CSV ----------------------------------------

  // Mark's row in the CSV has a BLANK phone column. His number must survive the import: a blank
  // cell in an export means "the export does not carry this", never "clear what the ward typed".
  await createMember({
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
  });

  // Moved out, and present in the CSV. He must be MATCHED and left moved out — not duplicated,
  // and not resurrected. Status is not in the import payload and is never written on update.
  await createMember({
    firstName: "Carlos",
    lastName: "Andersen",
    householdId: andersen,
    category: "adult",
    gender: "male",
    status: "moved_out",
  });

  const sarah = await createMember({
    firstName: "Sarah",
    lastName: "Brooks",
    householdId: brooks,
    category: "adult",
    gender: "female",
  });

  await createMember({
    firstName: "Grace",
    lastName: "Brooks",
    householdId: brooks,
    category: "youth",
    gender: "female",
  });

  await createMember({
    firstName: "David",
    lastName: "Nguyen",
    householdId: nguyen,
    category: "adult",
    gender: "male",
  });

  // NOT in the CSV. Decision 5: an import never marks, deactivates, or removes anyone, and the
  // preview has to say so out loud rather than leave the user wondering.
  await createMember({
    firstName: "Helen",
    lastName: "Nguyen",
    householdId: nguyen,
    category: "adult",
    gender: "female",
    status: "do_not_contact",
  });

  // --- The irreplaceable rows -------------------------------------------------------
  // Two notes on a member who also appears in the CSV, so a re-import has every opportunity to
  // clobber them. The LCR export does not contain notes and nothing can recover them.
  await createMemberNote({
    memberId: sarah,
    body: "Prefers a visit on a Sunday afternoon, after the block.",
    createdBy: bishop.id,
  });

  await createMemberNote({
    memberId: sarah,
    body: "Recovering from surgery — no stairs until March.",
    createdBy: bishop.id,
  });

  console.log(
    "  ward, 3 users, 3 households, 7 members (1 moved out, 1 with a phone, 1 absent from " +
      "the CSV), 2 member notes, all notification triggers",
  );
}
