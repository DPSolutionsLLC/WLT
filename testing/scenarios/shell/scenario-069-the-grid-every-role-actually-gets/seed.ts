import {
  createTestUser,
  ensureTestWard,
  seedNotificationTriggers,
} from "../../../infrastructure/seedUtils.ts";

// THE GRID EVERY ROLE ACTUALLY GETS.
//
// SEEDING IS MOST OF THE VALUE HERE, and the value is arithmetic: reaching five roles by hand
// means five invite-and-register flows before a single tile is read. The scenario is a sweep
// across roles, so the cost of setting it up is what would otherwise stop it being walked.
//
// THE FIVE ARE CHOSEN, NOT ARBITRARY. Each one answers a different question about the grid:
//
//   bishop                      — every BUILT module, and NEITHER of the two unbuilt ones. This
//                                 is the standing broken-link bug (CLAUDE.md §9) being closed;
//                                 a bishop holds `audit.view` and `sacrament.view_assignments`,
//                                 so before P3 both were offered and both went nowhere.
//   music_coordinator           — a narrow calling. It proves LOCKED tiles say why in words
//                                 rather than being greyed out, and that Visits, Tithing and
//                                 Admin are genuinely unreachable.
//   ward_council_member         — the widest role with NO organization at all, which is where
//                                 an org-scoped assumption would show up.
//   org_president (RS)          — the organization-aware matrix (P2). A Relief Society president
//                                 sees youth activities but does not manage them.
//   resource_center_specialist  — P2's "PRINTING, NEVER APPROVING" decision, on screen. They hold
//                                 exactly `program.view` + `program.distribute`, so the grid shows
//                                 ONE open tile and everything else locked. **Corrected during the
//                                 walk of 2026-09-22:** this file used to describe the role as
//                                 holding an empty list, which it did until proto-d changed it on
//                                 2026-09-21 (CLAUDE.md §7 records the change). The check was
//                                 written from the stale sentence and the app was right.
//   stake_president             — THE ROLE THAT GENUINELY HOLDS NOTHING. STAKE_OFFICER_PERMISSIONS
//                                 is empty, and CLAUDE.md §7 says stake officers reach NOTHING —
//                                 a claim nothing had ever walked in the real app. They are what
//                                 makes the empty-state SENTENCE reachable, and telling that
//                                 sentence apart from a blank page is the whole point of the check.
//
// ⚠️ NOBODY HERE HOLDS A SECOND CALLING, DELIBERATELY. `listSwitchableWards()` returns [] for
// anybody holding one calling, so the ward switcher must be absent for all five. Scenario 065
// walks the same guarantee from the other side; this one is the cheap re-check after the control
// finally exists.

export async function seed(): Promise<void> {
  await ensureTestWard({ name: "Harness Test Ward" });
  await seedNotificationTriggers();

  await createTestUser({
    handle: "bishop",
    role: "bishop",
    firstName: "Mark",
    lastName: "Andersen",
  });

  await createTestUser({
    handle: "music-coordinator",
    role: "music_coordinator",
    firstName: "Claire",
    lastName: "Hobbs",
  });

  await createTestUser({
    handle: "ward-council",
    role: "ward_council_member",
    firstName: "Tomas",
    lastName: "Reyes",
  });

  await createTestUser({
    handle: "rs-president",
    role: "org_president",
    org: "reliefSociety",
    firstName: "Priya",
    lastName: "Raman",
  });

  // ONE TILE, NOT NONE. proto-d gave this role `program.view` + `program.distribute` on
  // 2026-09-21 — printing, never approving, because approving is what publishes to an
  // unauthenticated page.
  await createTestUser({
    handle: "resource-center",
    role: "resource_center_specialist",
    firstName: "Glen",
    lastName: "Whitaker",
  });

  // THE ROLE WITH NOTHING. `STAKE_OFFICER_PERMISSIONS` is an empty array by design (CLAUDE.md §7:
  // "STAKE OFFICERS STILL REACH NOTHING"), so this is the account that makes the empty-state
  // sentence reachable at all.
  //
  // NO `unit_assignments` ROW IS CREATED, deliberately. The stake tier is not what is being
  // walked — what is being walked is that a ward calling carrying an empty permission list
  // renders a sentence rather than a blank page. Adding a stake assignment would be scenery that
  // could hide a dependency on it.
  await createTestUser({
    handle: "stake-officer",
    role: "stake_president",
    firstName: "Alan",
    lastName: "Prescott",
  });

  console.log("  ward, 6 users with one calling each");
}
