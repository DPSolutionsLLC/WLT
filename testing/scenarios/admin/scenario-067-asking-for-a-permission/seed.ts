import { getAdminClient } from "../../../infrastructure/adminClient.ts";
import {
  TEST_SECOND_WARD_ID,
  TEST_WARD_ID,
  createTestUser,
  createUnitAssignment,
  ensureSecondTestWard,
  ensureTestWard,
  seedNotificationTriggers,
  testUuid,
} from "../../../infrastructure/seedUtils.ts";

// A WARD ASKS FOR A PERMISSION, AND SOMEBODY ELSE ANSWERS.
//
// SEEDING IS MOST OF THE VALUE. Two states here cannot be reached by hand at all:
//
//   * A SUPER ADMIN. There is no screen anywhere that creates one — `super_admin` is out of
//     INVITABLE_ROLES and out of updateUserSchema's role enum, deliberately (CLAUDE.md §7), and
//     the assignment lives in `unit_assignments`, which has no INSERT policy.
//   * AN ALREADY-DENIED REQUEST with a note, which is what the "can the requester read the
//     outcome" check needs on the first page load rather than after driving the whole flow.
//
// ⚠️ NO UNITS ARE CREATED, and that is deliberate. A super admin's assignment is `unit_id: null`
// — "every unit" — which the `unit_assignments_scope` CHECK permits only for that role
// (migration 065b). Deciding a request never consults the hierarchy, so a stake here would be
// scenery that could hide a dependency on it.
//
// ⚠️ THE SECOND WARD CARRIES A DELIBERATE UNRELATED OVERRIDE. It is the canary for a wholesale
// settings write: approving a request for ward 1 must leave it byte-identical. That failure is
// invisible from inside the ward that asked, which is exactly why the scenario seeds a second
// ward it otherwise has no use for.

export async function seed(): Promise<void> {
  const supabase = getAdminClient();

  await ensureTestWard({ name: "Harness Test Ward" });
  await ensureSecondTestWard({ name: "Harness Second Ward" });
  await seedNotificationTriggers();

  // ---------------------------------------------------------------------------
  // The canary
  // ---------------------------------------------------------------------------
  //
  // Written straight onto the second ward's settings rather than through ensureSecondTestWard(),
  // because it must sit BESIDE the keys that helper already wrote — `cross_org_visibility` and
  // `timezone` — so the assertion has both a sibling key and a sibling role to check.
  const { error: canaryError } = await supabase
    .from("wards")
    .update({
      settings: {
        cross_org_visibility: false,
        timezone: "America/Denver",
        role_access: {
          music_coordinator: { remove: ["music.manage"] },
        },
      },
    })
    .eq("id", TEST_SECOND_WARD_ID);

  if (canaryError) {
    throw new Error(`Could not seed the second ward's override: ${canaryError.message}`);
  }

  // ---------------------------------------------------------------------------
  // People
  // ---------------------------------------------------------------------------

  const bishop = await createTestUser({
    handle: "bishop",
    role: "bishop",
    firstName: "Mark",
    lastName: "Andersen",
  });

  // A second ward-1 leader who is NOT in the bishopric. They hold no `admin.*` permission, so the
  // page should refuse them — which is the check that the request form is not simply open to
  // anybody who can reach /admin.
  await createTestUser({
    handle: "eq-president",
    role: "org_president",
    org: "eldersQuorum",
    firstName: "Miguel",
    lastName: "Cortez",
  });

  // THE PERSON WHO DECIDES. Their ACCOUNT lives in ward 1 — a super admin is a person with a
  // calling somewhere, plus an app-wide assignment — and `unit_id: null` is what makes the
  // assignment app-wide rather than scoped to one stake.
  const superAdmin = await createTestUser({
    handle: "super-admin",
    // BOTH GRANTS, matching the `superAdmin` fixture in tests/helpers/seed.ts. The ward calling is
    // `super_admin` and the app-wide authority is the `unit_assignments` row below.
    //
    // The walk of scenario 067 found this seeded only the second, and the person was refused the
    // whole /admin section. The LAYOUT was fixed to admit a structural super admin either way —
    // so this is no longer load-bearing — but the two fixtures should describe one kind of person.
    role: "super_admin",
    firstName: "Dana",
    lastName: "Whitmore",
  });

  await createUnitAssignment({
    userId: superAdmin.id,
    role: "super_admin",
    unitId: null,
  });

  // ---------------------------------------------------------------------------
  // The requests
  // ---------------------------------------------------------------------------
  //
  // Written with the service client because there is NO AUTHENTICATED WRITE PATH on
  // `access_requests` (migration 073b) — which is the property the scenario is walking, so the
  // seed cannot use the ordinary one even in principle.

  const { error } = await supabase.from("access_requests").upsert(
    [
      {
        id: testUuid("access-request:pending"),
        ward_id: TEST_WARD_ID,
        requested_by: bishop.id,
        role: "org_president",
        module: "agendas",
        level: "F",
        reason:
          "Our organization presidents build most of the ward council agenda before the " +
          "meeting, and at the moment they have to send it to the executive secretary to type in.",
        status: "pending",
      },
      {
        // ALREADY DECIDED, so "can the requester read the outcome" is answerable on the first
        // page load rather than only after driving the whole flow. The note is the thing being
        // read — a denial with nothing to read is the gap the prototype shipped and caught.
        id: testUuid("access-request:denied"),
        ward_id: TEST_WARD_ID,
        requested_by: bishop.id,
        role: "org_secretary",
        module: "roster",
        level: "F",
        reason:
          "Our secretaries keep the roster more current than anybody, and they are the ones " +
          "who notice when a family moves in.",
        status: "denied",
        decided_by: superAdmin.id,
        decision_note:
          "Editing the roster stays with the bishopric and the clerk for now — a wrong address " +
          "reaches the visit dashboard, the program and the ministering lists all at once. Ask " +
          "again if the clerk is struggling to keep up and we will look at it properly.",
        decided_at: new Date("2026-09-15T17:00:00Z").toISOString(),
      },
    ],
    { onConflict: "id" },
  );

  if (error) {
    throw new Error(`Could not seed the access requests: ${error.message}`);
  }
}
