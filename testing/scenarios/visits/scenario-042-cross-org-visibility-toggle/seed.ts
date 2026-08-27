import {
  createHousehold,
  createMember,
  createTestUser,
  createVisitGoal,
  createVisitLog,
  createVisitParticipant,
  createVisitPrivateNote,
  ensureTestWard,
  seedNotificationTriggers,
} from "../../../infrastructure/seedUtils.ts";

// THE STATE THIS SEEDS IS A WARD THAT ALREADY HAS SETTINGS WORTH LOSING.
//
// `wards.settings` is ONE jsonb column holding role_access, timezone, default_speaking_slots and
// cross_org_visibility. A toggle that wrote the object wholesale rather than merging into it would
// silently delete the ward's permission overrides — a switch about who can READ quietly changing
// who can DO. The write is a success either way and nothing on the visibility screen would look
// wrong, which is why the only way to see the bug is to seed a ward that already carries an
// override and go and look at it afterwards.
//
// So this ward arrives with:
//   role_access           — the ward secretary has been granted visits.view, which they do not
//                           hold by default (lib/auth/permissions.ts)
//   default_speaking_slots — 5, not the fallback of 3
//
// Both are checked AFTER the toggle, on the screens that read them, not in the database.
//
// ---------------------------------------------------------------------------------------------
// BOTH ORGANIZATIONS NEED REPORTS AND A GOAL
// ---------------------------------------------------------------------------------------------
// With visibility on, an EQ leader READS Relief Society reports and still cannot read the Relief
// Society GOAL: `visit_logs_select` has a cross-org branch and `visit_goals_select` does not
// (migration 019). That asymmetry is deliberate and recorded as an open item at the end of Phase
// 7 — so both organizations get a goal here, and "the RS goal is still not visible" is a check
// rather than a surprise.
//
// ---------------------------------------------------------------------------------------------
// THE PRIVATE NOTE IS THE RELIEF SOCIETY PRESIDENT'S
// ---------------------------------------------------------------------------------------------
// Turning visibility ON is exactly the moment somebody would expect a private note to travel with
// the shared one. It must not, in either mode. The note's author is the person whose reports are
// about to become readable to everybody else.

const EQ_VISIT_DATES = ["2026-08-16", "2026-08-09", "2026-08-02", "2026-07-26"];
const RS_VISIT_DATES = ["2026-08-14", "2026-08-07", "2026-07-24", "2026-07-10"];

const ROLE_ACCESS_OVERRIDE = {
  ward_secretary: { add: ["visits.view"] },
};

const DEFAULT_SPEAKING_SLOTS = 5;

export async function seed(): Promise<void> {
  await ensureTestWard({
    name: "Harness Test Ward",
    crossOrgVisibility: false,
    roleAccess: ROLE_ACCESS_OVERRIDE,
    settings: { default_speaking_slots: DEFAULT_SPEAKING_SLOTS },
  });

  // The toggle notifies the other two bishopric members. Without these rows emitNotification()
  // warns and sends nothing, and the notification check would pass for the wrong reason.
  await seedNotificationTriggers();

  await createTestUser({
    handle: "bishop",
    role: "bishop",
    firstName: "Mark",
    lastName: "Andersen",
  });

  // BOTH counselors, because the checklist asks a counselor to toggle it back off. Bishopric admin
  // authority is shared and identical (CLAUDE.md §7), and one of the two also has to be on the
  // receiving end of the notification the other one's change sends.
  await createTestUser({
    handle: "counselor-1",
    role: "counselor",
    counselorPosition: 1,
    firstName: "Aaron",
    lastName: "Pike",
  });

  await createTestUser({
    handle: "counselor-2",
    role: "counselor",
    counselorPosition: 2,
    firstName: "Samuel",
    lastName: "Rios",
  });

  // Holds the seeded role_access override. If the toggle clobbers settings, this account loses
  // visits.view and /visits starts reading "Not permitted" — which is how the bug shows on screen.
  await createTestUser({
    handle: "ward-secretary",
    role: "ward_secretary",
    firstName: "Wendy",
    lastName: "Okafor",
  });

  const eqPresident = await createTestUser({
    handle: "eq-president",
    role: "org_president",
    org: "eldersQuorum",
    firstName: "Miguel",
    lastName: "Cortez",
  });

  const rsPresident = await createTestUser({
    handle: "rs-president",
    role: "org_president",
    org: "reliefSociety",
    firstName: "Ruth",
    lastName: "Delacroix",
  });

  const familyNames = [
    "Andersen",
    "Brooks",
    "Calderon",
    "Doyle",
    "Ellsworth",
    "Fairbanks",
    "Grant",
    "Halvorsen",
  ];

  const households: string[] = [];

  for (const familyName of familyNames) {
    const householdId = await createHousehold({
      familyName,
      address: `${200 + households.length} Canyon Road`,
    });

    await createMember({
      firstName: "Adult",
      lastName: familyName,
      householdId,
      category: "adult",
      gender: "female",
    });

    households.push(householdId);
  }

  await createVisitGoal({
    org: "eldersQuorum",
    title: "Every household this year",
    cadenceAmount: 1,
    cadenceUnit: "year",
    noticeAmount: 2,
    noticeUnit: "month",
    createdBy: eqPresident.id,
  });

  await createVisitGoal({
    org: "reliefSociety",
    title: "Every sister twice this year",
    cadenceAmount: 6,
    cadenceUnit: "month",
    noticeAmount: 5,
    noticeUnit: "week",
    createdBy: rsPresident.id,
  });

  for (const [index, visitDate] of EQ_VISIT_DATES.entries()) {
    const visitId = await createVisitLog({
      org: "eldersQuorum",
      householdId: households[index],
      recordedBy: eqPresident.id,
      visitDate,
      sharedNotes: `Elders Quorum called on the ${familyNames[index]} family.`,
    });

    await createVisitParticipant({
      org: "eldersQuorum",
      visitLogId: visitId,
      userId: eqPresident.id,
    });
  }

  const rsVisitIds: string[] = [];

  for (const [index, visitDate] of RS_VISIT_DATES.entries()) {
    const householdIndex = EQ_VISIT_DATES.length + index;

    const visitId = await createVisitLog({
      org: "reliefSociety",
      householdId: households[householdIndex],
      recordedBy: rsPresident.id,
      visitDate,
      sharedNotes: `Relief Society called on the ${familyNames[householdIndex]} family.`,
    });

    await createVisitParticipant({
      org: "reliefSociety",
      visitLogId: visitId,
      userId: rsPresident.id,
    });

    rsVisitIds.push(visitId);
  }

  await createVisitPrivateNote({
    visitLogId: rsVisitIds[0],
    userId: rsPresident.id,
    notes: "PRIVATE-CHARLIE: she asked us to keep this between the presidency and herself.",
  });

  console.log(
    "  ward (role_access override + 5 speaking slots, visibility OFF), 6 users, 8 households, " +
      "8 visits (4 EQ / 4 RS), 2 goals, 1 RS private note",
  );
}
