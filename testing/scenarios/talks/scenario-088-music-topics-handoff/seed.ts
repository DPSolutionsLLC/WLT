import {
  createAssignment,
  createConductingRotation,
  createHousehold,
  createHymnSelection,
  createMember,
  createSunday,
  createSundayMusic,
  createTestUser,
  createTodo,
  ensureTestWard,
  seedNotificationTriggers,
} from "../../../infrastructure/seedUtils.ts";

// ---------------------------------------------------------------------------
// FINALIZING TOPICS TELLS THE MUSIC COORDINATOR — ITER-038 mc
// (plans/sacrament-music-handoff-and-approval.md)
// ---------------------------------------------------------------------------
// Finalizing a Sunday's topics puts "Choose the music" on the coordinator's To Do; un-finalizing
// returns submitted music to draft; finalizing again says the topics changed. It also re-walks the
// send-back change built after scenario 087's walk (the conductor's review stays open).
//
//   A  Peter conducts. Two talks with topics and a NAMED SPEAKER; topics NOT final; no music.
//   B  Peter conducts. Topics final. Music complete and SUBMITTED by Hannah; Peter holds the
//      review; Hannah's "Choose the music for B" is DONE (as submitting leaves it).
//
// RELATIVE TO TODAY, with a whole calendar from this month through the month after next — every
// Sunday, first Sundays pinned Fast Sundays (scenarios 073 and 079's lessons).

function addDays(date: string, days: number): string {
  const next = new Date(`${date}T00:00:00Z`);
  next.setUTCDate(next.getUTCDate() + days);
  return next.toISOString().slice(0, 10);
}

function sundayOnOrBefore(today: Date): string {
  const date = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate()));
  date.setUTCDate(date.getUTCDate() - date.getUTCDay());
  return date.toISOString().slice(0, 10);
}

function isFirstSundayOfMonth(date: string): boolean {
  return Number(date.slice(8, 10)) <= 7;
}

function monthAfter(month: string): string {
  const [year, monthNumber] = month.split("-").map(Number);
  return monthNumber === 12
    ? `${year + 1}-01`
    : `${year}-${String(monthNumber + 1).padStart(2, "0")}`;
}

const TODAY = new Date().toISOString().slice(0, 10);
const THIS_SUNDAY = sundayOnOrBefore(new Date());
const LAST_MONTH = monthAfter(monthAfter(TODAY.slice(0, 7)));
const FIRST_SUNDAY_OF_MONTH = (() => {
  let date = THIS_SUNDAY;
  while (!isFirstSundayOfMonth(date)) date = addDays(date, -7);
  return date;
})();
const CALENDAR = Array.from({ length: 15 }, (_, week) =>
  addDays(FIRST_SUNDAY_OF_MONTH, week * 7),
).filter((date) => date.slice(0, 7) <= LAST_MONTH);

const ORDINARY_AHEAD = CALENDAR.filter(
  (date) => date >= addDays(THIS_SUNDAY, 7) && !isFirstSundayOfMonth(date),
);
export const SUNDAY_A = ORDINARY_AHEAD[0] as string;
export const SUNDAY_B = ORDINARY_AHEAD[1] as string;

export async function seed(): Promise<void> {
  await ensureTestWard({ name: "Harness Test Ward" });
  // The harness ward gets no trigger rows unless a scenario asks; without them the
  // `music_topics_ready` notification row this scenario checks is never written.
  await seedNotificationTriggers();

  const bishop = await createTestUser({
    handle: "bishop",
    role: "bishop",
    org: "bishopric",
    firstName: "Mark",
    lastName: "Andersen",
  });
  const counselor1 = await createTestUser({
    handle: "counselor1",
    role: "counselor",
    org: "bishopric",
    counselorPosition: 1,
    firstName: "Peter",
    lastName: "Nakamura",
  });
  const counselor2 = await createTestUser({
    handle: "counselor2",
    role: "counselor",
    org: "bishopric",
    counselorPosition: 2,
    firstName: "David",
    lastName: "Okafor",
  });
  const music = await createTestUser({
    handle: "music",
    role: "music_coordinator",
    org: "bishopric",
    firstName: "Hannah",
    lastName: "Restrepo",
  });

  await createConductingRotation({
    effectiveFrom: CALENDAR[0],
    userIds: [counselor1.id, counselor2.id, bishop.id],
  });

  const speaker = await createMember({
    firstName: "Eliza",
    lastName: "Thornbury",
    householdId: await createHousehold({ familyName: "Thornbury" }),
    category: "adult",
    status: "active",
  });

  const finalizedAt = new Date().toISOString();
  const sundayIds = new Map<string, string>();
  for (const date of CALENDAR) {
    const fast = isFirstSundayOfMonth(date);
    const ours = date === SUNDAY_A || date === SUNDAY_B;
    sundayIds.set(
      date,
      await createSunday({
        date,
        type: fast ? "fast_sunday" : "standard",
        speakingSlots: fast ? 0 : 3,
        fastSundayPinned: fast,
        ...(ours ? { conductingUserId: counselor1.id } : {}),
        ...(date === SUNDAY_B ? { topicsFinalizedAt: finalizedAt } : {}),
      }),
    );
  }
  const a = sundayIds.get(SUNDAY_A) as string;
  const b = sundayIds.get(SUNDAY_B) as string;

  await createAssignment({ sundayId: a, slotNumber: 1, topicTitle: "Faith in Jesus Christ", memberId: speaker });
  await createAssignment({ sundayId: a, slotNumber: 2, topicTitle: "Keeping the Sabbath day holy" });
  await createAssignment({ sundayId: b, slotNumber: 1, topicTitle: "The blessings of the temple" });

  const hymns = [
    { hymnType: "opening", hymnNumber: 2, hymnTitle: "The Spirit of God" },
    { hymnType: "sacrament", hymnNumber: 169, hymnTitle: "As Now We Take the Sacrament" },
    { hymnType: "closing", hymnNumber: 85, hymnTitle: "How Firm a Foundation" },
  ] as const;
  for (const hymn of hymns) {
    await createHymnSelection({ sundayId: b, ...hymn, selectedBy: music.id });
  }
  const submittedAt = new Date().toISOString();
  await createSundayMusic({
    sundayId: b,
    choristerName: "Sister Peake",
    organistName: "Brother Visiting",
    status: "submitted",
    submittedAt,
    submittedBy: music.id,
  });

  const label = (date: string) =>
    new Intl.DateTimeFormat("en-US", {
      timeZone: "UTC",
      weekday: "long",
      month: "long",
      day: "numeric",
      year: "numeric",
    }).format(new Date(`${date}T00:00:00Z`));

  await createTodo({
    userId: music.id,
    assignedBy: counselor1.id,
    title: `Choose the music for ${label(SUNDAY_B)}`,
    notes: "Topics: The blessings of the temple.",
    tag: "Music",
    musicSundayId: b,
    musicRole: "choose",
    completedAt: submittedAt,
  });
  await createTodo({
    userId: counselor1.id,
    assignedBy: music.id,
    title: `Review the music for ${label(SUNDAY_B)}`,
    notes: "Open the music to approve it or send it back with a note.",
    tag: "Music",
    musicSundayId: b,
    musicRole: "review",
  });

  console.log(
    "  ward (America/Denver), 4 users (bishop Mark Andersen, counselor1 Peter Nakamura, " +
      "counselor2 David Okafor, music Hannah Restrepo), a whole calendar, and two Sundays:\n" +
      `  A ${SUNDAY_A} — Peter conducts; two talks with topics (one by Eliza Thornbury); topics NOT final; no music.\n` +
      `  B ${SUNDAY_B} — topics final; music submitted by Hannah; Peter holds the review.`,
  );
}
