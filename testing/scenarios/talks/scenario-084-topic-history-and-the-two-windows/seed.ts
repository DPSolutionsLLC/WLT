import {
  createAssignment,
  createAssignmentHistory,
  createConductingRotation,
  createHousehold,
  createMember,
  createSunday,
  createTestUser,
  ensureTestWard,
} from "../../../infrastructure/seedUtils.ts";

// ---------------------------------------------------------------------------
// A TOPIC HISTORY AND A SPEAKING HISTORY, BOTH RELATIVE TO TODAY
// ---------------------------------------------------------------------------
// The "Used before" hint, "N months ago" and the speaker order are all measured from today, so
// nothing here is a fixed date — scenario 073's lesson. Do not tidy these into fixed dates.
//
// Topics given (completed talks):
//   ~2 months ago   "Faith in Jesus Christ"  Maria Lopez
//   ~8 months ago   "Faith and works"        Brother Visitor (outside speaker)
//   ~14 months ago  "Gratitude"              Sister Visitor (outside speaker)
//   ~3 years ago    "Hope in Christ"         Oliver Brooks
// Coming up:
//   ~5 weeks ahead  "Faith in Jesus Christ"  President Hale (outside speaker, titled "President")
// Cancelled, and must NOT appear anywhere:
//   ~6 weeks ago    "Tithing blessings"
//
// Speakers:
//   Emma Clark      never spoken                                 -> first in the speaker list
//   Oliver Brooks   last spoke ~3 years ago                       -> second
//   Maria Lopez     spoke ~2 months ago, declined twice before   -> last; History shows both
//
// B is the first ordinary Sunday at least three weeks out: 3 empty slots, counselor1 conducting,
// where the walker opens the topic and speaker windows. The current month through the month after
// next is a whole calendar (every Sunday, first Sundays pinned Fast Sundays — scenario 079's
// lesson); the past Sundays exist only as the history needs them.

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

// A past or future Sunday about `weeks` away, never a month's first (so never a Fast Sunday).
function ordinarySunday(weeks: number): string {
  let date = addDays(THIS_SUNDAY, weeks * 7);
  while (isFirstSundayOfMonth(date)) date = addDays(date, 7);
  return date;
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
const CALENDAR = Array.from({ length: 15 }, (_, week) => addDays(FIRST_SUNDAY_OF_MONTH, week * 7)).filter(
  (date) => date.slice(0, 7) <= LAST_MONTH,
);

export const SUNDAY_B = CALENDAR.find(
  (date) => date >= addDays(THIS_SUNDAY, 21) && !isFirstSundayOfMonth(date),
) as string;
const UPCOMING = ordinarySunday(5) === SUNDAY_B ? ordinarySunday(6) : ordinarySunday(5);

const PAST = {
  faith: ordinarySunday(-9),
  cancelled: ordinarySunday(-6),
  works: ordinarySunday(-35),
  declinedA: ordinarySunday(-30),
  declinedB: ordinarySunday(-20),
  gratitude: ordinarySunday(-61),
  hope: ordinarySunday(-157),
};

export async function seed(): Promise<void> {
  await ensureTestWard({ name: "Harness Test Ward" });

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
  await createTestUser({
    handle: "music",
    role: "music_coordinator",
    firstName: "Hannah",
    lastName: "Price",
  });

  await createConductingRotation({
    effectiveFrom: CALENDAR[0],
    userIds: [counselor1.id, counselor2.id, bishop.id],
  });

  const member = async (firstName: string, lastName: string) =>
    createMember({
      firstName,
      lastName,
      householdId: await createHousehold({ familyName: lastName }),
      category: "adult",
      status: "active",
    });

  const maria = await member("Maria", "Lopez");
  const oliver = await member("Oliver", "Brooks");
  await member("Emma", "Clark");

  const sundayIds = new Map<string, string>();
  for (const date of CALENDAR) {
    const fast = isFirstSundayOfMonth(date);
    sundayIds.set(
      date,
      await createSunday({
        date,
        type: fast ? "fast_sunday" : "standard",
        speakingSlots: fast ? 0 : 3,
        fastSundayPinned: fast,
        ...(date === SUNDAY_B ? { conductingUserId: counselor1.id } : {}),
      }),
    );
  }
  for (const date of Object.values(PAST)) {
    if (!sundayIds.has(date)) {
      sundayIds.set(date, await createSunday({ date, type: "standard", speakingSlots: 3 }));
    }
  }
  const sunday = (date: string) => sundayIds.get(date) as string;

  const faithTalk = await createAssignment({
    sundayId: sunday(PAST.faith),
    slotNumber: 1,
    memberId: maria,
    topicTitle: "Faith in Jesus Christ",
    pipelineStage: "complete",
  });
  await createAssignmentHistory({ memberId: maria, assignmentId: faithTalk, outcome: "completed" });

  await createAssignment({
    sundayId: sunday(PAST.works),
    slotNumber: 1,
    externalSpeakerName: "Brother Visitor",
    topicTitle: "Faith and works",
    pipelineStage: "complete",
  });
  await createAssignment({
    sundayId: sunday(PAST.gratitude),
    slotNumber: 1,
    externalSpeakerName: "Sister Visitor",
    topicTitle: "Gratitude",
    pipelineStage: "complete",
  });

  const hopeTalk = await createAssignment({
    sundayId: sunday(PAST.hope),
    slotNumber: 1,
    memberId: oliver,
    topicTitle: "Hope in Christ",
    pipelineStage: "complete",
  });
  await createAssignmentHistory({ memberId: oliver, assignmentId: hopeTalk, outcome: "completed" });

  // Maria's two declines. A decline clears the speaker, so the talks carry nobody and no topic.
  for (const [date, reason, notes] of [
    [PAST.declinedA, "not_available", "Out of town that week"],
    [PAST.declinedB, "other", "Asked to be given more notice"],
  ] as const) {
    const talk = await createAssignment({
      sundayId: sunday(date),
      slotNumber: 2,
      pipelineStage: "plan",
      requestOutcome: "declined",
    });
    await createAssignmentHistory({
      memberId: maria,
      assignmentId: talk,
      outcome: "declined",
      declineReason: reason,
      notes,
    });
  }

  await createAssignment({
    sundayId: sunday(PAST.cancelled),
    slotNumber: 1,
    externalSpeakerName: "Brother Gone",
    topicTitle: "Tithing blessings",
    pipelineStage: "request",
    cancelledAt: new Date().toISOString(),
    cancelledReason: "no_meeting",
  });

  await createAssignment({
    sundayId: sunday(UPCOMING),
    slotNumber: 1,
    externalSpeakerName: "Hale",
    externalSpeakerTitle: "President",
    topicTitle: "Faith in Jesus Christ",
    pipelineStage: "plan",
  });

  console.log(
    `  ward, 4 users (bishop, counselor1, counselor2, music).\n` +
      `  Calendar ${CALENDAR[0]} to ${CALENDAR[CALENDAR.length - 1]}.\n` +
      `  Topics: Faith in Jesus Christ ${PAST.faith} (Maria), Faith and works ${PAST.works},\n` +
      `          Gratitude ${PAST.gratitude}, Hope in Christ ${PAST.hope} (Oliver),\n` +
      `          coming up Faith in Jesus Christ ${UPCOMING} (President Hale),\n` +
      `          cancelled Tithing blessings ${PAST.cancelled} — must not appear.\n` +
      `  B ${SUNDAY_B}: 3 open slots, counselor1 conducting.`,
  );
}
