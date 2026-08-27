import {
  createHousehold,
  createMember,
  createTestUser,
  createVisitGoal,
  createVisitLog,
  createVisitParticipant,
  ensureTestWard,
  seedNotificationTriggers,
} from "../../../infrastructure/seedUtils.ts";

// THE STATE THIS SEEDS IS A DENOMINATOR THAT IS SMALLER THAN THE WARD.
//
// Eight households, six of which this organization can visit. The other two are the whole point:
// listHouseholds() filters the members it ATTACHES, not the households it RETURNS, so a household
// whose people have all moved out comes back present with an empty member list. Counting it holds
// a ward's progress down forever — 07-visits.md §Pitfalls: "Counting moved-out households makes
// every org look behind and erodes trust in the number."
//
// Both shapes of that bug are here: one household emptied by `moved_out` and one by
// `do_not_contact`. DEFAULT_MEMBER_STATUSES is ["active"], so both attach nothing.
//
// NOTE THE OTHER do-not-contact, WHICH IS NOT HERE. ITER-018 added a HOUSEHOLD-level
// `do_not_contact` flag whose behaviour is the opposite of the member status above: that
// household stays VISIBLE, marked, and counted in nothing. Scenario 045 owns it. This scenario
// keeps the member-status shape it was written for, and the two must not be confused — one
// removes a household from the page, the other deliberately does not.
//
// ---------------------------------------------------------------------------------------------
// WHY THE DATES ARE RELATIVE AND NOT PINNED
// ---------------------------------------------------------------------------------------------
// Scenario 044 pins every timestamp, and was right to: "missed" is a MONOTONE property — a date
// that is past stays past, so a pinned fixture keeps its meaning as it ages.
//
// A priority band is a WINDOW, not a threshold. "Approaching" means inside the warning window and
// not yet due, and a household pinned into that window in August walks out of it by November.
// Pinning here would produce a scenario that quietly stops demonstrating the thing it was written
// for, which is worse than one whose dates move.
//
// So every date below is derived from ONE `TODAY`, read once at seed time, and each household is
// placed at a precise distance from it. The checklist names bands rather than dates for the same
// reason.
//
// ---------------------------------------------------------------------------------------------
// FOUR BANDS, NOT FIVE BUCKETS
// ---------------------------------------------------------------------------------------------
// This scenario used to seed five statuses, one of which was `attempted_never_reached`. That was
// a REASON wearing a position's clothes: a household somebody had knocked on three times could
// not ALSO read "overdue", because the reason displaced the urgency.
//
// ITER-018 splits them. There are four bands — never visited, overdue, approaching, on track —
// and the attempt count is a MARK BESIDE the badge at any level of urgency. So Ferreira below
// reads **Never visited** *and* carries "Attempted ×2", while Nakamura reads **Never visited**
// with no mark: the same band, visibly different problems. That pairing is the single most
// important thing to look at on this page now.

const MS_PER_DAY = 86_400_000;

const TODAY = new Date();

function dateOnly(date: Date): string {
  return date.toISOString().slice(0, 10);
}

// UTC milliseconds, never setDate() — a local-time write is how a fixture lands a day off for
// anybody west of UTC (lib/calendar/dates.ts opens on that bug).
function daysAgo(days: number): string {
  return dateOnly(new Date(TODAY.getTime() - days * MS_PER_DAY));
}

// The goal is EVERY 1 YEAR with a 2-MONTH warning window, and it has no dates at all. Progress is
// measured from each household's own last completed visit, so the distances below are distances
// from that visit rather than from a shared period boundary:
//
//   due       = lastVisit + 1 year   (365 days)
//   warns from= due - 2 months       (~61 days before due, so from about day 304)
//
const VISITED_RECENTLY = daysAgo(30); //   8% of the interval  -> On track
const VISITED_EARLIER = daysAgo(95); //   26%                  -> On track
const VISITED_INSIDE_NOTICE = daysAgo(320); // 88%, past day 304 -> Approaching
const VISITED_13_MONTHS_AGO = daysAgo(396); // 108%             -> Overdue

const ATTEMPTED_EARLY = daysAgo(120);
const ATTEMPTED_RECENTLY = daysAgo(12);

// A deadline, purely so the banner has one to show. It drives NO arithmetic (ITER-018
// Decision 1) — it is the ward saying "we would like to have got round everybody by then".
const DEADLINE = dateOnly(new Date(TODAY.getTime() + 120 * MS_PER_DAY));

export async function seed(): Promise<void> {
  await ensureTestWard({ name: "Harness Test Ward" });
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

  // The RECORDER on every visit below, and never a participant. A "Conducted by" column that fell
  // back to whoever typed a visit up would name this person on all four, which is exactly the
  // ambiguity visits-d split `recorded_by` out to remove.
  const eqSecretary = await createTestUser({
    handle: "eq-secretary",
    role: "org_secretary",
    org: "eldersQuorum",
    firstName: "Peter",
    lastName: "Nakamura",
  });

  // The Relief Society has NO GOAL. Switching to it is how a bishopric member sees "no goal set"
  // rather than a zero denominator — a made-up number is worse than an absent one.
  await createTestUser({
    handle: "rs-president",
    role: "org_president",
    org: "reliefSociety",
    firstName: "Ruth",
    lastName: "Delacroix",
  });

  // EXPLICIT IDS. createHousehold keys its id on the family name plus address, so two households
  // sharing both would collide on the primary key
  // (plans/retros/seed-household-id-collision.md). These differ, but naming them explicitly is
  // what keeps that true when somebody edits the list.
  const [brooks, whitfield, okonkwo, halvorsen, ferreira, nakamura, departed, quiet] =
    await Promise.all(
      [
        { familyName: "Brooks", address: "2201 Canyon Road" },
        { familyName: "Whitfield", address: "88 Elm Street" },
        { familyName: "Okonkwo", address: "14 Larkspur Lane" },
        { familyName: "Halvorsen", address: "902 Ridgeview Drive" },
        { familyName: "Ferreira", address: "31 Willow Court" },
        { familyName: "Nakamura", address: "755 Aspen Way" },
        { familyName: "Delgado", address: "410 Sunset Boulevard" },
        { familyName: "Sorensen", address: "6 Chapel Close" },
      ].map((household) => createHousehold(household)),
    );

  await Promise.all([
    createMember({ firstName: "David", lastName: "Brooks", householdId: brooks }),
    createMember({ firstName: "Sarah", lastName: "Whitfield", householdId: whitfield }),
    createMember({ firstName: "Emeka", lastName: "Okonkwo", householdId: okonkwo }),
    createMember({ firstName: "Inge", lastName: "Halvorsen", householdId: halvorsen }),
    createMember({ firstName: "Ana", lastName: "Ferreira", householdId: ferreira }),
    createMember({ firstName: "Kenji", lastName: "Nakamura", householdId: nakamura }),

    // BOTH ITS MEMBERS HAVE MOVED OUT. The household row survives — a ward keeps the address —
    // and listHouseholds() returns it with `members: []`.
    createMember({
      firstName: "Rosa",
      lastName: "Delgado",
      householdId: departed,
      status: "moved_out",
    }),
    createMember({
      firstName: "Tomas",
      lastName: "Delgado",
      householdId: departed,
      status: "moved_out",
    }),

    // The other shape of the same bug, and note that it is the MEMBER status rather than the
    // household flag: this household attaches no active member, so it is absent from the page
    // entirely. A household-level do-not-contact would behave in the opposite way — present and
    // marked — which is scenario 045's job to show.
    createMember({
      firstName: "Greta",
      lastName: "Sorensen",
      householdId: quiet,
      status: "do_not_contact",
    }),
  ]);

  await createVisitGoal({
    org: "eldersQuorum",
    title: "Visit every household",
    cadenceAmount: 1,
    cadenceUnit: "year",
    noticeAmount: 2,
    noticeUnit: "month",
    deadline: DEADLINE,
    createdBy: eqPresident.id,
  });

  // -------------------------------------------------------------------------------------------
  // ON TRACK — two of them, well inside the interval
  // -------------------------------------------------------------------------------------------
  const brooksVisit = await createVisitLog({
    org: "eldersQuorum",
    householdId: brooks,
    recordedBy: eqSecretary.id,
    visitDate: VISITED_RECENTLY,
    outcome: "completed",
    arrangement: "appointment",
    sharedNotes: "Shared: good long conversation, they are doing well.",
  });

  // TWO people went, and neither of them is the recorder. This is the row that proves "Conducted
  // by" names who WENT.
  await createVisitParticipant({
    org: "eldersQuorum",
    visitLogId: brooksVisit,
    userId: eqPresident.id,
  });
  await createVisitParticipant({
    org: "eldersQuorum",
    visitLogId: brooksVisit,
    label: "Sister Alvarez, ministering",
  });

  // NOBODY IS RECORDED as having gone on this one — a legitimate state, not missing data: the
  // secretary typed up a visit and did not know who from the presidency was there. It must read
  // "Nobody recorded" rather than crediting the secretary.
  await createVisitLog({
    org: "eldersQuorum",
    householdId: whitfield,
    recordedBy: eqSecretary.id,
    visitDate: VISITED_EARLIER,
    outcome: "completed",
    arrangement: "drop_in",
  });

  // -------------------------------------------------------------------------------------------
  // APPROACHING — 88% of the way through the interval, inside the two-month warning window
  // -------------------------------------------------------------------------------------------
  // The badge carries the fraction, and this is the row that proves it earns its place: Brooks at
  // 8% and Okonkwo at 88% are both "visited" in any ordinary sense of the word, and the old
  // dashboard rendered them identically.
  const okonkwoVisit = await createVisitLog({
    org: "eldersQuorum",
    householdId: okonkwo,
    recordedBy: eqSecretary.id,
    visitDate: VISITED_INSIDE_NOTICE,
    outcome: "completed",
    arrangement: "appointment",
  });

  await createVisitParticipant({
    org: "eldersQuorum",
    visitLogId: okonkwoVisit,
    userId: eqPresident.id,
  });

  // -------------------------------------------------------------------------------------------
  // OVERDUE — thirteen months ago, so about 108% of a one-year interval
  // -------------------------------------------------------------------------------------------
  // The row that proves the "Last visited" column shows a year: this date is in a different
  // calendar year from every other visit here, and without a year it reads like last month's.
  const halvorsenVisit = await createVisitLog({
    org: "eldersQuorum",
    householdId: halvorsen,
    recordedBy: eqSecretary.id,
    visitDate: VISITED_13_MONTHS_AGO,
    outcome: "completed",
    arrangement: "drop_in",
  });

  await createVisitParticipant({
    org: "eldersQuorum",
    visitLogId: halvorsenVisit,
    label: "Brother Whitmore",
  });

  // -------------------------------------------------------------------------------------------
  // NEVER VISITED, WITH AN ATTEMPTS MARK — two knocks, nobody home, no completed visit ever
  // -------------------------------------------------------------------------------------------
  // Half of the pairing this scenario now exists to show. Ferreira and Nakamura below are in the
  // SAME band, and the page has to make them look like the different problems they are: somebody
  // has been trying here and the answer is to try something other than knocking.
  //
  // An attempt still counts towards nothing. It is shown, and it is not a visit.
  await createVisitLog({
    org: "eldersQuorum",
    householdId: ferreira,
    recordedBy: eqSecretary.id,
    visitDate: ATTEMPTED_EARLY,
    outcome: "attempted",
    arrangement: "drop_in",
    sharedNotes: "Shared: knocked on the way past, no answer.",
  });

  const secondAttempt = await createVisitLog({
    org: "eldersQuorum",
    householdId: ferreira,
    recordedBy: eqSecretary.id,
    visitDate: ATTEMPTED_RECENTLY,
    outcome: "attempted",
    arrangement: "appointment",
    sharedNotes: "Shared: they had agreed to Tuesday, car on the drive, still no answer.",
  });

  await createVisitParticipant({
    org: "eldersQuorum",
    visitLogId: secondAttempt,
    userId: eqPresident.id,
  });

  // -------------------------------------------------------------------------------------------
  // NEVER VISITED, WITH NO MARK — the Nakamura household gets no log at all, deliberately.
  // -------------------------------------------------------------------------------------------
  // The other half of the pairing. Same band as Ferreira, no attempts mark.
}
