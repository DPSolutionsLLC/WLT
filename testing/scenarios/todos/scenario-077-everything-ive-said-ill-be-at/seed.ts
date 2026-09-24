import { wallClockToInstant } from "../../../../lib/youth/ics/resolveInstant.ts";
import { wardDateOnly } from "../../../../lib/ward/wardDate.ts";
import {
  addMemberToOrganization,
  createActivityAttendee,
  createActivityEvent,
  createHousehold,
  createMember,
  createTestUser,
  createTodo,
  createVisitAppointment,
  ensureTestWard,
} from "../../../infrastructure/seedUtils.ts";

// ---------------------------------------------------------------------------
// EVERYTHING THE PRESIDENT HAS SAID THEY WILL BE AT — AND FOUR THINGS THAT MUST NOT APPEAR
// ---------------------------------------------------------------------------
//   UPCOMING (4), grouped by the ward's day
//     to-do     TODAY 12:05 AM — already passed, so GREYED, still today's  "Call the stake clerk"
//     visit     tomorrow 7:00 PM                  "Visit — Okafor family"
//     to-do     next Friday 7:30 PM, with Samuel  "Drop off the moving boxes"
//     youth     next Friday 7:30 PM               "Varsity basketball vs Roosevelt"
//   PAST (3), most recent first
//     to-do     6 days ago 10:00 AM, not done     "Meet about the quorum budget"
//     visit     7 days ago 7:00 PM, kept          "Visit — Okafor family"
//     youth     8 days ago, ALL DAY               "Regional volleyball tournament"
//   NEVER SHOWN
//     visit     in 3 days, CANCELLED
//     youth     in 2 days, event CANCELLED        "Rained-out soccer game"
//     visit     tomorrow 6:00 PM, made by the BISHOP
//     to-do     never scheduled                   "Order new hymnbooks"
//
// EVENING TIMES ON PURPOSE. 7:30 PM Friday in Denver is 01:30 or 02:30 UTC on SATURDAY; a
// formatter that omits the ward's zone shows the wrong day, which is the production defect in
// CLAUDE.md §9. Every time is built from the WARD's wall clock with the app's own
// wallClockToInstant(), so the seed and the page agree about which day and hour it is.

const WARD_ZONE = "America/Denver";
const DAY_MS = 86_400_000;

const today = wardDateOnly(new Date(), WARD_ZONE);

function addDays(dateOnly: string, days: number): string {
  const [year, month, day] = dateOnly.split("-").map(Number);
  return new Date(Date.UTC(year, month - 1, day) + days * DAY_MS).toISOString().slice(0, 10);
}

function wardInstant(dateOnly: string, hour: number, minute: number): string {
  const [year, month, day] = dateOnly.split("-").map(Number);
  return wallClockToInstant({ year, month, day, hour, minute, second: 0 }, WARD_ZONE).toISOString();
}

// The Friday AFTER today — never today, so "upcoming" holds whatever hour the seed runs at.
function nextFriday(dateOnly: string): string {
  const [year, month, day] = dateOnly.split("-").map(Number);
  const weekday = new Date(Date.UTC(year, month - 1, day)).getUTCDay();
  const ahead = (5 - weekday + 7) % 7 || 7;
  return addDays(dateOnly, ahead);
}

export async function seed(): Promise<void> {
  await ensureTestWard({ name: "Harness Test Ward", timezone: WARD_ZONE });

  const bishop = await createTestUser({
    handle: "bishop",
    role: "bishop",
    org: "bishopric",
    firstName: "Mark",
    lastName: "Andersen",
  });

  const president = await createTestUser({
    handle: "eq-president",
    role: "org_president",
    org: "eldersQuorum",
    firstName: "Miguel",
    lastName: "Cortez",
  });

  const household = await createHousehold({ familyName: "Okafor" });
  const samuel = await createMember({
    firstName: "Samuel",
    lastName: "Okafor",
    householdId: household,
  });
  // In the president's own organization: "Schedule this" offers the org leader's own
  // organization by default (MemberPicker's defaultOrganizationFilter), so a member in no
  // organization cannot be picked at all. Found walking this scenario, 2026-09-24.
  await addMemberToOrganization({ memberId: samuel, org: "eldersQuorum" });
  // In NO organization: "Schedule this" offers the whole ward (the user's decision, 2026-09-24),
  // so she must be pickable by the Elders Quorum president.
  await createMember({ firstName: "Grace", lastName: "Nguyen" });

  const tomorrow = addDays(today, 1);
  const friday = nextFriday(today);

  await createVisitAppointment({
    org: "eldersQuorum",
    householdId: household,
    madeBy: president.id,
    scheduledFor: wardInstant(tomorrow, 19, 0),
  });
  await createVisitAppointment({
    org: "eldersQuorum",
    householdId: household,
    madeBy: president.id,
    scheduledFor: wardInstant(addDays(today, -7), 19, 0),
    status: "kept",
  });
  await createVisitAppointment({
    org: "eldersQuorum",
    householdId: household,
    madeBy: president.id,
    scheduledFor: wardInstant(addDays(today, 3), 19, 0),
    status: "cancelled",
  });
  await createVisitAppointment({
    org: "eldersQuorum",
    householdId: household,
    madeBy: bishop.id,
    scheduledFor: wardInstant(tomorrow, 18, 0),
  });

  await createTodo({
    userId: president.id,
    title: "Drop off the moving boxes",
    scheduledFor: wardInstant(friday, 19, 30),
    scheduledWithMemberId: samuel,
  });
  await createTodo({
    userId: president.id,
    title: "Meet about the quorum budget",
    scheduledFor: wardInstant(addDays(today, -6), 10, 0),
  });
  await createTodo({
    userId: president.id,
    title: "Order new hymnbooks",
  });
  // Five minutes past the ward's midnight: already passed whenever the walk runs (bar the first
  // five minutes of the day), and still today — so it must stay on the list, greyed.
  await createTodo({
    userId: president.id,
    title: "Call the stake clerk",
    scheduledFor: wardInstant(today, 0, 5),
  });

  const game = await createActivityEvent({
    title: "Varsity basketball vs Roosevelt",
    eventDate: wardInstant(friday, 19, 30),
    eventType: "home",
  });
  // An all-day event is stored at the WARD's midnight (migration 055).
  const tournament = await createActivityEvent({
    title: "Regional volleyball tournament",
    eventDate: wardInstant(addDays(today, -8), 0, 0),
    allDay: true,
    eventType: "away",
  });
  const rainedOut = await createActivityEvent({
    title: "Rained-out soccer game",
    eventDate: wardInstant(addDays(today, 2), 17, 0),
    status: "cancelled",
  });

  for (const eventId of [game, tournament, rainedOut]) {
    await createActivityAttendee({ eventId, userId: president.id });
  }

  console.log(
    `  ward, 2 users, 4 visit appointments, 4 to-dos, 3 youth events, 2 members — today is ${today}, the Friday is ${friday} in ${WARD_ZONE}`,
  );
}
