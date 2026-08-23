import {
  createHousehold,
  createMember,
  createPrayerAssignment,
  createSunday,
  createTestUser,
  ensureTestWard,
} from "../../../infrastructure/seedUtils.ts";

// June 2026 opens on a MONDAY, so 06-07 is the first Sunday and therefore the fast Sunday. It
// carries speaking_slots = 0, which is the case this scenario exists to catch: a fast Sunday
// still has an invocation and a benediction. Gating prayers on the speaker slot count would make
// the one Sunday a month with the most prayers the only one that could not have any.
//
// Twelve members in three deliberate groups:
//   4 with prayers at `done`, spread across eighteen months  -> a label
//   2 with prayers stuck at `ask`                            -> NO label
//   6 with no prayer history at all                          -> NO label
//
// The two stuck at `ask` are the point of the whole seed. They are what a naive implementation
// gets wrong — reading the most recent prayer row for a member rather than the most recent one
// AT `done` — which produces a plausible label for somebody who has never prayed and quietly
// suppresses them from consideration for months.

// The Sundays the history hangs off. Outside June 2026, so they never appear in the month view;
// they exist only to give the four members with history a date to be labelled from.
const HISTORY_SUNDAYS = [
  "2025-02-02",
  "2025-06-01",
  "2025-09-07",
  "2025-11-02",
  "2026-01-04",
  "2026-04-05",
] as const;

const JUNE_SUNDAYS = ["2026-06-07", "2026-06-14", "2026-06-21", "2026-06-28"] as const;

export async function seed(): Promise<void> {
  await ensureTestWard({ name: "Harness Test Ward" });

  const bishop = await createTestUser({
    handle: "bishop",
    role: "bishop",
    org: "bishopric",
    firstName: "Mark",
    lastName: "Andersen",
  });

  await createTestUser({
    handle: "counselor1",
    role: "counselor",
    org: "bishopric",
    counselorPosition: 1,
    firstName: "Peter",
    lastName: "Nakamura",
  });

  // Holds talks.view and NOT talks.plan. The likelier wiring mistake is not a missing page but a
  // read-only viewer who still gets a picker, which looks entirely normal until they use it.
  await createTestUser({
    handle: "secretary",
    role: "ward_secretary",
    firstName: "Ruth",
    lastName: "Kaufman",
  });

  // --- Twelve members, one household each ---------------------------------------------------
  // Twelve is enough that the picker needs scrolling at 375px, which is the width the "can a
  // bishopric scan this and see who to consider" judgement has to be made at.
  const NAMES: ReadonlyArray<readonly [string, string]> = [
    ["Sarah", "Whitfield"],
    ["Andre", "Bell"],
    ["Claire", "Bennett"],
    ["Tomas", "Ruiz"],
    ["Miriam", "Okonkwo"],
    ["David", "Lindqvist"],
    ["Hannah", "Ereora"],
    ["Josef", "Bauman"],
    ["Leila", "Nasser"],
    ["Robert", "Cassidy"],
    ["Priya", "Raman"],
    ["Nathan", "Follett"],
  ];

  const memberIds: string[] = [];

  for (const [firstName, lastName] of NAMES) {
    const householdId = await createHousehold({ familyName: lastName });
    memberIds.push(
      await createMember({
        firstName,
        lastName,
        householdId,
        category: "adult",
        status: "active",
      }),
    );
  }

  // --- The Sundays the history hangs off -----------------------------------------------------
  const historySundayIds: string[] = [];

  for (const date of HISTORY_SUNDAYS) {
    historySundayIds.push(
      await createSunday({
        date,
        // The first Sunday of each of these months, so `fast_sunday` is what generation would
        // produce anyway. Zero slots proves the same point retroactively.
        type: "fast_sunday",
        speakingSlots: 0,
        conductingUserId: bishop.id,
      }),
    );
  }

  // --- Four members with real history --------------------------------------------------------
  // Spread across eighteen months so the labels differ from each other at a glance. Six months
  // would put every date in the same handful of labels and the difference would not be readable.
  //
  // Sarah is the most recent (April 2026) and Tomas the oldest (February 2025), so the spread is
  // obvious in the picker without the tester having to compare dates.
  const withHistory: ReadonlyArray<readonly [number, number, "invocation" | "benediction"]> = [
    [3, 0, "invocation"], // Tomas Ruiz     — February 2025
    [1, 2, "benediction"], // Andre Bell     — September 2025
    [2, 4, "invocation"], // Claire Bennett — January 2026
    [0, 5, "benediction"], // Sarah Whitfield — April 2026
  ];

  for (const [memberIndex, sundayIndex, prayerType] of withHistory) {
    await createPrayerAssignment({
      sundayId: historySundayIds[sundayIndex],
      memberId: memberIds[memberIndex],
      prayerType,
      // The one stage that means the prayer was actually given. createPrayerAssignment fills in
      // asked_at and confirmed_at from this, so it is a real completed prayer rather than a row
      // with a stage column set.
      stage: "done",
      askedBy: bishop.id,
    });
  }

  // --- Two members stuck at `ask` ------------------------------------------------------------
  // Asked, never confirmed, never given. These must show NO label. Reading the most recent
  // prayer row rather than the most recent `done` one labels them, which is the bug.
  //
  // On the two history Sundays not already carrying a `done` prayer of the same type, because
  // migration 028's unique index allows only one invocation and one benediction per Sunday.
  await createPrayerAssignment({
    sundayId: historySundayIds[1],
    memberId: memberIds[4], // Miriam Okonkwo
    prayerType: "invocation",
    stage: "ask",
    askedBy: bishop.id,
  });

  await createPrayerAssignment({
    sundayId: historySundayIds[3],
    memberId: memberIds[5], // David Lindqvist
    prayerType: "invocation",
    stage: "ask",
    askedBy: bishop.id,
  });

  // --- The remaining six have NO prayer history at all ---------------------------------------
  // Hannah, Josef, Leila, Robert, Priya and Nathan. They must render with nothing beside their
  // name — not "Never", which reads as a judgement about a person rather than as an absence of
  // data (lib/prayers/lastPrayed.ts).

  // --- June 2026, the month under test --------------------------------------------------------
  for (const date of JUNE_SUNDAYS) {
    await createSunday({
      date,
      // 06-07 is the first Sunday of the month, so generation would type it fast_sunday anyway.
      // ZERO SPEAKING SLOTS is the whole point of including it: the prayer board must offer both
      // prayers regardless.
      type: date === "2026-06-07" ? "fast_sunday" : "standard",
      speakingSlots: date === "2026-06-07" ? 0 : 3,
      conductingUserId: bishop.id,
    });
  }

  // June is deliberately left with NO prayers assigned. The tester assigns them, which is what
  // puts the picker — and the last-prayed labels — on screen.

  console.log(
    "  ward, 3 users, 12 households, 12 adult members (4 with `done` prayers across 18 months, " +
      "2 stuck at `ask`, 6 with no history), 6 history Sundays carrying that history, and " +
      "June 2026 with no prayers assigned (06-07 fast with 0 speaking slots)",
  );
}
