import { getAdminClient } from "../../../infrastructure/adminClient.ts";
import {
  TEST_SECOND_WARD_ID,
  TEST_SECOND_WARD_ORG_IDS,
  createHousehold,
  createMember,
  createTestUser,
  ensureSecondTestWard,
  ensureTestWard,
  seedNotificationTriggers,
  testUuid,
} from "../../../infrastructure/seedUtils.ts";

// ONE PERSON, TWO REAL CALLINGS. Relief Society president in ward 1, ward secretary in ward 2 —
// a different role, a different organization and a different set of permissions in each, from one
// account and one `users` row.
//
// SEEDING IS THE WHOLE VALUE OF THIS SCENARIO. There is no UI for assigning a second calling
// until proto-d, so this state cannot be reached by hand at all — not by an admin and not by a
// super admin. Without this file the model has no way to be walked.
//
// ⚠️ THERE IS DELIBERATELY NO STAKE HERE, AND THAT IS PART OF THE POINT. Scenario 064 needed one,
// because the visiting-officer model reached ward 2 by walking wards.unit_id → parent_id. Under
// the calling model can_act_in_ward() asks only "do you hold an active calling there" (migration
// 070a), so the hierarchy is not involved in a switch at all. If this scenario starts needing
// ensureTestUnits() to pass, the unit_assignments arm has come back.
//
// THE SECOND WARD'S ROWS ARE WRITTEN DIRECTLY, not through the seed factories. Every factory in
// seedUtils.ts hardcodes TEST_WARD_ID, which is correct — one harness ward is the right default,
// and parameterising forty factories to serve one scenario would be a large change for a small
// need. `createTestUser` takes `ward` and `secondCalling` because an ACCOUNT and a CALLING are
// the two things a person has to be able to sign in as and act under.

export async function seed(): Promise<void> {
  const supabase = getAdminClient();

  await ensureTestWard({ name: "Harness Test Ward" });
  await ensureSecondTestWard({ name: "Harness Second Ward" });
  await seedNotificationTriggers();

  // ---------------------------------------------------------------------------
  // People
  // ---------------------------------------------------------------------------

  // THE PERSON THE SCENARIO IS ABOUT. Their ACCOUNT lives in ward 1 — `users.ward_id`, the home
  // ward, which no switch ever changes — and they hold two callings that disagree on purpose:
  //
  //   ward 1: org_president of the Relief Society  → holds visits.*, no agendas.*
  //   ward 2: ward_secretary, no organization      → holds agendas.*, no visits.manage_goals
  //
  // So "which role is this session" has a VISIBLE answer in the navigation rather than only a
  // stored one, and a page that read the role off the person instead of off the calling would
  // show the wrong modules rather than merely the wrong label.
  const twoCallings = await createTestUser({
    handle: "two-callings",
    role: "org_president",
    org: "reliefSociety",
    firstName: "Marianne",
    lastName: "Whitfield",
    secondCalling: { ward: "second", role: "ward_secretary" },
  });

  await createTestUser({
    handle: "bishop",
    role: "bishop",
    firstName: "Mark",
    lastName: "Andersen",
  });

  // The control must be invisible to this person on every page. They hold exactly one calling,
  // which is the state every leader in every real ward is in.
  await createTestUser({
    handle: "eq-president",
    role: "org_president",
    org: "eldersQuorum",
    firstName: "Miguel",
    lastName: "Cortez",
  });

  // Ward 2's own bishop. They author the private note, so it belongs to somebody in ward 2 and to
  // nobody the two-calling person could claim to be — which is what makes "she cannot read it"
  // mean anything. She IS an ordinary ward 2 leader there; rule 5 is not about visitors.
  const secondWardBishop = await createTestUser({
    handle: "second-ward-bishop",
    role: "bishop",
    ward: "second",
    firstName: "Dale",
    lastName: "Okonkwo",
  });

  const secondWardEqPresident = await createTestUser({
    handle: "second-ward-eq-president",
    role: "org_president",
    org: "eldersQuorum",
    ward: "second",
    firstName: "Rosa",
    lastName: "Delgado",
  });

  // ---------------------------------------------------------------------------
  // Ward 1 content, so "before switching" is not an empty screen
  // ---------------------------------------------------------------------------

  const wardOneHousehold = await createHousehold({
    familyName: "Brooks",
    address: "2201 Canyon Road",
  });

  await createMember({
    firstName: "Ethan",
    lastName: "Brooks",
    householdId: wardOneHousehold,
    category: "youth",
    gender: "male",
  });

  await createMember({
    firstName: "Janet",
    lastName: "Brooks",
    householdId: wardOneHousehold,
    category: "adult",
    gender: "female",
  });

  // ---------------------------------------------------------------------------
  // Ward 2 content — what she works with while acting there
  // ---------------------------------------------------------------------------

  const secondWardId = TEST_SECOND_WARD_ID;
  const familyNames = ["Nakamura", "Oyelaran", "Petersen", "Quintana"];

  const householdIds = familyNames.map((familyName) =>
    testUuid(`ward2-household:${familyName}`),
  );

  const { error: householdError } = await supabase.from("households").upsert(
    householdIds.map((id, index) => ({
      id,
      ward_id: secondWardId,
      family_name: familyNames[index],
      address: `${120 + index * 14} Second Ward Lane`,
    })),
    { onConflict: "id" },
  );
  if (householdError) {
    throw new Error(`Could not seed the second ward's households: ${householdError.message}`);
  }

  const memberRows = householdIds.flatMap((householdId, index) => {
    const familyName = familyNames[index];
    return [
      {
        id: testUuid(`ward2-member:${familyName}:adult`),
        ward_id: secondWardId,
        household_id: householdId,
        first_name: ["Kenji", "Bolu", "Anders", "Marisol"][index],
        last_name: familyName,
        category: "adult",
        gender: index % 2 === 0 ? "male" : "female",
      },
      {
        id: testUuid(`ward2-member:${familyName}:youth`),
        ward_id: secondWardId,
        household_id: householdId,
        first_name: ["Hana", "Tayo", "Ingrid", "Diego"][index],
        last_name: familyName,
        category: "youth",
        gender: index % 2 === 0 ? "female" : "male",
      },
    ];
  });

  const { error: memberError } = await supabase
    .from("members")
    .upsert(memberRows, { onConflict: "id" });
  if (memberError) {
    throw new Error(`Could not seed the second ward's members: ${memberError.message}`);
  }

  const visitLogIds = [testUuid("ward2-visit:1"), testUuid("ward2-visit:2")];

  const { error: visitError } = await supabase.from("visit_logs").upsert(
    [
      {
        id: visitLogIds[0],
        ward_id: secondWardId,
        org_id: TEST_SECOND_WARD_ORG_IDS.eldersQuorum,
        household_id: householdIds[0],
        visit_date: "2026-09-06",
        shared_notes: "Dropped by after church. Kenji is back at work.",
        recorded_by: secondWardEqPresident.id,
      },
      {
        id: visitLogIds[1],
        ward_id: secondWardId,
        org_id: TEST_SECOND_WARD_ORG_IDS.eldersQuorum,
        household_id: householdIds[1],
        visit_date: "2026-09-13",
        shared_notes: "Short visit on the doorstep.",
        recorded_by: secondWardEqPresident.id,
      },
    ],
    { onConflict: "id" },
  );
  if (visitError) {
    throw new Error(`Could not seed the second ward's visit logs: ${visitError.message}`);
  }

  // THE ROW THE WHOLE SCENARIO IS JUDGED BY (CLAUDE.md rule 5). Authored by ward 2's BISHOP, on a
  // visit ward 2's EQ president recorded — so it belongs to somebody else entirely.
  //
  // It must not appear in any form, anywhere, for the two-calling person, and the reason is worth
  // being precise about: not because she is a visitor (she is not — she is a ward 2 leader), but
  // because `visit_private_notes` is `user_id = auth.uid()` for EVERYBODY. Not the bishop, not an
  // admin, not a support query.
  const { error: noteError } = await supabase.from("visit_private_notes").upsert(
    {
      id: testUuid("ward2-private-note"),
      ward_id: secondWardId,
      visit_log_id: visitLogIds[0],
      user_id: secondWardBishop.id,
      notes: "PRIVATE: personal circumstances the bishop is aware of. Must never leave ward 2.",
    },
    { onConflict: "id" },
  );
  if (noteError) {
    throw new Error(`Could not seed the second ward's private note: ${noteError.message}`);
  }

  // Two Sundays in ward 2, because a ward secretary's modules are the calendar and the agenda —
  // an empty calendar would make "the nav changed and the pages work" impossible to tell apart
  // from "the nav changed and the pages are empty".
  const { error: sundayError } = await supabase.from("sundays").upsert(
    [
      { id: testUuid("ward2-sunday:1"), ward_id: secondWardId, date: "2026-10-04" },
      { id: testUuid("ward2-sunday:2"), ward_id: secondWardId, date: "2026-10-11" },
    ],
    { onConflict: "id" },
  );
  if (sundayError) {
    throw new Error(`Could not seed the second ward's Sundays: ${sundayError.message}`);
  }

  console.log(
    `  2 wards, 5 users, 6 callings (${twoCallings.handle} holds two),\n` +
      "  ward 2: 4 households, 8 members, 2 visit logs (1 carrying a private note), 2 Sundays",
  );
}
