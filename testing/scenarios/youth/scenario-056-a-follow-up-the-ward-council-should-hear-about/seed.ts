import {
  addMemberToOrganization,
  createActivityAttendee,
  createActivityEvent,
  createActivityLog,
  createHousehold,
  createMember,
  createTestUser,
  createYouthActivityProfile,
  ensureTestWard,
  seedNotificationTriggers,
} from "../../../infrastructure/seedUtils.ts";

// THREE OWNERSHIP SHAPES, WHICH IS THE ONLY WAY DECISION 1's BOUNDARY IS VISIBLE.
//
// Migration 057 gives `activity_logs` an org-scoped SELECT — the one read Phase 8 narrows — while
// the activity CALENDAR stays ward-wide. That produces a state a leader will find surprising: they
// can see every organization's games and only some organizations' follow-ups. This scenario is
// where somebody decides whether the sentence explaining that is one a leader accepts.
//
//   Young Men activity      → a follow-up only the Young Men, the bishopric and its author see.
//   Young Women activity    → the same, from the other side.
//   WARD-WIDE activity      → `org_id` null. Readable by EVERYBODY, and it is the branch a
//                             careless policy loses (an inner join instead of a left one, or a
//                             missing `org_id is null` arm — the talks-d hole in its fourth place).
//
// Without the third, "org-scoped" and "hidden from anybody outside the organization" look like the
// same rule, and the walk would not notice that they are not.
//
// ---------------------------------------------------------------------------------------------
// A WARD COUNCIL MEMBER WITH NO ORGANIZATION, WHICH IS THE ACCOUNT THAT PAYS FOR THE DECISION
// ---------------------------------------------------------------------------------------------
// Migration 054d says in as many words that `ward_council_member` is the role most likely to have
// no organization at all, and it is one of the two roles this module was built for. Under an
// org-scoped read they see the ward-wide follow-up and their own, and nothing else. That is the
// price of the decision rather than a bug, and this account is how a person judges whether the
// price is acceptable.
//
// ---------------------------------------------------------------------------------------------
// AN EXECUTIVE SECRETARY WHO HOLDS NO YOUTH PERMISSION AT ALL
// ---------------------------------------------------------------------------------------------
// That is not a gap to patch — it is what makes the notification rule STRUCTURALLY true rather
// than a rule to remember. The flag reaches them as a one-liner naming which follow-up to bring
// up, and they cannot open it. Check `lib/auth/permissions.ts`: `executive_secretary` holds
// `agendas.*` and none of `youth_activities.*`.
//
// ---------------------------------------------------------------------------------------------
// CROSS-ORG VISIBILITY SEEDED **OFF**, AND THE WALK TURNS IT ON HALF WAY THROUGH
// ---------------------------------------------------------------------------------------------
// Both sides of the setting are the assertion. Seeding it on would make every read succeed and the
// narrowing invisible; seeding it off and never turning it on would leave the widening untested.
// There is no admin UI for this setting yet, so the walk changes it in Supabase — the scenario
// says so rather than pretending otherwise.

const DAY_MS = 86_400_000;

// An offset-bearing instant, always. `activity_events.event_date` is a timestamptz and the app's
// own validator refuses a floating time (lib/validation/youth.ts).
function daysFromNow(days: number, hour: number): string {
  const instant = new Date(Date.now() + days * DAY_MS);
  instant.setHours(hour, 0, 0, 0);
  return instant.toISOString();
}

export async function seed(): Promise<void> {
  await ensureTestWard({
    name: "Harness Test Ward",
    // OFF. The walk turns it on in Supabase half way through and revisits both accounts.
    crossOrgVisibility: false,
  });

  // `youth_activity_flagged_for_ward_council` is migration 057d's key and this seeds it for the
  // harness ward. Without it emitNotification() warns and sends nothing — which would make the
  // flag look broken for a reason that has nothing to do with the flag.
  await seedNotificationTriggers();

  const bishop = await createTestUser({
    handle: "bishop",
    role: "bishop",
    firstName: "Marcus",
    lastName: "Reyes",
  });

  const executiveSecretary = await createTestUser({
    handle: "exec-secretary",
    role: "executive_secretary",
    firstName: "Paul",
    lastName: "Ndiaye",
  });

  const youngMenPresident = await createTestUser({
    handle: "ym-president",
    role: "org_president",
    org: "youngMen",
    firstName: "Miguel",
    lastName: "Cortez",
  });

  const youngWomenPresident = await createTestUser({
    handle: "yw-president",
    role: "org_president",
    org: "youngWomen",
    firstName: "Nora",
    lastName: "Whitfield",
  });

  // NO ORGANIZATION. `createTestUser` leaves `org_id` null when `org` is absent, and that null is
  // the whole point of this account.
  const wardCouncilMember = await createTestUser({
    handle: "ward-council",
    role: "ward_council_member",
    firstName: "Diane",
    lastName: "Okafor",
  });

  const brooks = await createHousehold({ familyName: "Brooks", address: "2201 Canyon Road" });
  const chen = await createHousehold({ familyName: "Chen", address: "418 Meadowlark Lane" });

  const ethan = await createMember({
    firstName: "Ethan",
    lastName: "Brooks",
    householdId: brooks,
    category: "youth",
    gender: "male",
  });

  const ava = await createMember({
    firstName: "Ava",
    lastName: "Chen",
    householdId: chen,
    category: "youth",
    gender: "female",
  });

  await addMemberToOrganization({ memberId: ethan, org: "youngMen" });
  await addMemberToOrganization({ memberId: ava, org: "youngWomen" });

  const basketball = await createYouthActivityProfile({
    memberId: ethan,
    activityName: "Varsity basketball",
    activityType: "sport",
    org: "youngMen",
    enteredBy: youngMenPresident.id,
  });

  const choir = await createYouthActivityProfile({
    memberId: ava,
    activityName: "Concert choir",
    activityType: "performance",
    org: "youngWomen",
    enteredBy: youngWomenPresident.id,
  });

  // NO `org` — ward-wide, which policy 054d permits explicitly and which is the ordinary case for
  // a ward council member. Absent means the whole ward; there is no sentinel organization meaning
  // "everybody".
  const serviceProject = await createYouthActivityProfile({
    memberId: ethan,
    activityName: "Stake service project",
    activityType: "community",
    enteredBy: wardCouncilMember.id,
  });

  const seedFollowUp = async (
    profileId: string,
    title: string,
    daysAgo: number,
    author: { id: string },
    sharedNotes: string,
  ): Promise<string> => {
    const eventId = await createActivityEvent({
      title,
      eventDate: daysFromNow(-daysAgo, 19),
      eventType: "home",
      profileId,
    });

    await createActivityAttendee({
      eventId,
      userId: author.id,
      confirmedAttendance: true,
    });

    return createActivityLog({ eventId, loggedBy: author.id, sharedNotes });
  };

  await seedFollowUp(
    basketball,
    "Game against Roosevelt",
    3,
    youngMenPresident,
    "A close game. Ethan played the whole second half and his father came.",
  );

  await seedFollowUp(
    choir,
    "Winter concert",
    4,
    youngWomenPresident,
    "Ava sang the solo. The hall was full and the family stayed afterwards.",
  );

  await seedFollowUp(
    serviceProject,
    "Food bank morning",
    5,
    wardCouncilMember,
    "Eleven of the youth turned up. The bishop dropped in at the end.",
  );

  console.log(
    "  ward (cross-org OFF), 5 users, 2 households, 2 youth, 3 activities " +
      "(Young Men, Young Women, WARD-WIDE), 3 past events, 3 attendee rows, 3 follow-ups",
  );
  console.log(
    `  bishop=${bishop.email} exec-secretary=${executiveSecretary.email} ` +
      `ym-president=${youngMenPresident.email} yw-president=${youngWomenPresident.email} ` +
      `ward-council=${wardCouncilMember.email}`,
  );
}
