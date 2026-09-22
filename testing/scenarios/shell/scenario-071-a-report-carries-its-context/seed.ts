import {
  createTestUser,
  ensureSecondTestWard,
  ensureTestWard,
  seedNotificationTriggers,
} from "../../../infrastructure/seedUtils.ts";

// A REPORT CARRIES ITS CONTEXT.
//
// THE SECOND WARD IS THE EXPENSIVE PART AND THE REASON THIS IS SEEDED. `issue_reports` has the
// most open INSERT policy in the app — any authenticated member of the ward may write one, with
// no permission gating it at all (there is no `issues.*` permission and there must not be one) —
// so the only thing standing between a report and another ward is `ward_id = current_ward_id()`.
// Proving that by hand means building a second ward with its own bishop, which nothing in the app
// offers a screen for.
//
// THREE PEOPLE, EACH WITH A JOB:
//
//   org-president (ward 1)  — THE REPORTER. Deliberately NOT a bishop: the row must be tagged
//                             `org_president` from the SESSION, and a bishop reporting would make
//                             a body-supplied role indistinguishable from the real one.
//   bishop (ward 1)         — THE READER. `issue_reports_select` is the ward's admins, so this is
//                             who confirms the rows exist.
//   bishop (ward 2)         — THE BOUNDARY. Must see neither row.
//
// ⚠️ NO REPORTS ARE SEEDED. Every row in this scenario is written by a person using the modal,
// because WHERE THEY WERE WHEN THEY PRESSED IT is the fact under test — a seeded row would carry
// whatever `page_path` this file typed, which proves nothing.

export async function seed(): Promise<void> {
  await ensureTestWard({ name: "Harness Test Ward" });
  await ensureSecondTestWard({ name: "Harness Second Ward" });
  await seedNotificationTriggers();

  await createTestUser({
    handle: "bishop",
    role: "bishop",
    firstName: "Mark",
    lastName: "Andersen",
  });

  await createTestUser({
    handle: "rs-president",
    role: "org_president",
    org: "reliefSociety",
    firstName: "Priya",
    lastName: "Raman",
  });

  await createTestUser({
    handle: "ward-b-bishop",
    role: "bishop",
    ward: "second",
    firstName: "Daniel",
    lastName: "Okafor",
  });

  console.log("  2 wards, 3 users, no reports — every row is written by hand");
}
