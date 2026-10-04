import {
  createAssignment,
  createConductingRotation,
  createHousehold,
  createHymnSelection,
  createMember,
  createMusicalNumber,
  createSunday,
  createSundayMusic,
  createTestUser,
  createTodo,
  ensureTestWard,
} from "../../../infrastructure/seedUtils.ts";

// ---------------------------------------------------------------------------
// MUSIC SUBMIT AND REVIEW — ITER-038 mb (plans/sacrament-music-handoff-and-approval.md)
// ---------------------------------------------------------------------------
// The music coordinator submits a Sunday's music; the conductor's To Do gets "Review the music";
// the bishopric approves or sends it back with a note; any change returns it to draft.
//
//   A  topics final, Peter conducts. 3 hymns + chorister; NO ORGANIST. Hannah holds "Choose the music".
//   B  topics final, Peter conducts. Everything + a musical number; SUBMITTED by Hannah, review on Peter.
//   C  topics final, Peter conducts. Everything; SUBMITTED by the BISHOP, review on Peter.
//   D  topics NOT final. Two hymns. Shows `Topics pending`.
//
// RELATIVE TO TODAY (scenario 073's lesson), with a whole calendar from this month through the
// month after next — every Sunday, first Sundays pinned Fast Sundays (scenario 079's lesson).

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
export const SUNDAY_C = ORDINARY_AHEAD[2] as string;
export const SUNDAY_D = ORDINARY_AHEAD[3] as string;

const TOPICS: Record<string, string> = {
  A: "Faith in Jesus Christ",
  B: "The blessings of the temple",
  C: "Ministering as the Savior did",
  D: "Gratitude",
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

  const ruth = await createMember({
    firstName: "Ruth",
    lastName: "Hale",
    householdId: await createHousehold({ familyName: "Hale" }),
    category: "adult",
    status: "active",
  });

  const finalizedAt = new Date().toISOString();
  const sundayIds = new Map<string, string>();
  for (const date of CALENDAR) {
    const fast = isFirstSundayOfMonth(date);
    const ours = [SUNDAY_A, SUNDAY_B, SUNDAY_C, SUNDAY_D].includes(date);
    sundayIds.set(
      date,
      await createSunday({
        date,
        type: fast ? "fast_sunday" : "standard",
        speakingSlots: fast ? 0 : 3,
        fastSundayPinned: fast,
        ...(ours ? { conductingUserId: counselor1.id } : {}),
        ...(ours && date !== SUNDAY_D ? { topicsFinalizedAt: finalizedAt } : {}),
      }),
    );
  }
  const idOf = (date: string) => sundayIds.get(date) as string;
  const [a, b, c, d] = [idOf(SUNDAY_A), idOf(SUNDAY_B), idOf(SUNDAY_C), idOf(SUNDAY_D)];

  for (const [key, sundayId] of [["A", a], ["B", b], ["C", c], ["D", d]] as const) {
    await createAssignment({ sundayId, slotNumber: 1, topicTitle: TOPICS[key] });
  }

  const hymns = async (sundayId: string, types: readonly ("opening" | "sacrament" | "closing")[]) => {
    const numbers = { opening: 2, sacrament: 169, closing: 85 } as const;
    const titles = {
      opening: "The Spirit of God",
      sacrament: "As Now We Take the Sacrament",
      closing: "How Firm a Foundation",
    } as const;
    for (const hymnType of types) {
      await createHymnSelection({
        sundayId,
        hymnType,
        hymnNumber: numbers[hymnType],
        hymnTitle: titles[hymnType],
        selectedBy: music.id,
      });
    }
  };
  const ALL = ["opening", "sacrament", "closing"] as const;
  await hymns(a, ALL);
  await hymns(b, ALL);
  await hymns(c, ALL);
  await hymns(d, ["opening", "sacrament"]);

  await createMusicalNumber({ sundayId: b, performer: "The Jansen family", pieceTitle: "I Am a Child of God" });

  const submittedAt = new Date().toISOString();
  await createSundayMusic({ sundayId: a, choristerMemberId: ruth });
  await createSundayMusic({
    sundayId: b,
    choristerMemberId: ruth,
    organistName: "Brother Visiting",
    status: "submitted",
    submittedAt,
    submittedBy: music.id,
  });
  await createSundayMusic({
    sundayId: c,
    choristerName: "Sister Peake",
    organistName: "Brother Visiting",
    status: "submitted",
    submittedAt,
    submittedBy: bishop.id,
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
    title: `Choose the music for ${label(SUNDAY_A)}`,
    tag: "Music",
    musicSundayId: a,
    musicRole: "choose",
  });
  for (const [date, sundayId] of [[SUNDAY_B, b], [SUNDAY_C, c]] as const) {
    await createTodo({
      userId: counselor1.id,
      assignedBy: music.id,
      title: `Review the music for ${label(date)}`,
      notes: "Open the music to approve it or send it back with a note.",
      tag: "Music",
      musicSundayId: sundayId,
      musicRole: "review",
    });
  }

  console.log(
    "  ward (America/Denver), 4 users (bishop Mark Andersen, counselor1 Peter Nakamura, " +
      "counselor2 David Okafor, music Hannah Restrepo), a whole calendar, and four Sundays:\n" +
      `  A ${SUNDAY_A} — Peter conducts; 3 hymns + chorister Ruth Hale, no organist; Hannah holds "Choose the music".\n` +
      `  B ${SUNDAY_B} — submitted by Hannah, with a musical number; Peter holds the review.\n` +
      `  C ${SUNDAY_C} — submitted by the bishop; Peter holds the review.\n` +
      `  D ${SUNDAY_D} — topics not finalized; two hymns.`,
  );
}
