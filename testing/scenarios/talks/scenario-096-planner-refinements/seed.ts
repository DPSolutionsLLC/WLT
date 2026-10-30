import {
  TEST_WARD_ID,
  createMember,
  createPlannerDocument,
  createTestUser,
  ensureTestWard,
  seedNotificationTriggers,
  setPlannerHistory,
  setReleasedModules,
} from "../../../infrastructure/seedUtils.ts";

// SACRAMENT PLANNER REFINEMENTS (GROUP-04: ITER-057, ITER-056, ITER-048, ITER-049, ITER-050).
//
// Every state this walk needs takes many clicks to reach by hand: a full Sunday, a month card, a
// Sunday two weeks past with a decline on it. Dates are computed from today, as scenario 093's are.
//
// The rotation has the bishop alone, so every seeded Sunday is his month and his default filters on
// Sundays and Calls show them all. Document ids follow the Planner's own rules (a hold by its hash(),
// a Sunday by its date, a consider by its id), so a save from the screen updates the seeded row.
// Every name is fake.

function plannerHash(text: string): string {
  let value = 0x811c9dc5;
  for (const character of text) {
    value ^= character.codePointAt(0) ?? 0;
    value = Math.imul(value, 0x01000193) >>> 0;
  }
  return `k${value.toString(16)}-${[...text].length}`;
}

function addDays(date: string, days: number): string {
  const next = new Date(`${date}T00:00:00Z`);
  next.setUTCDate(next.getUTCDate() + days);
  return next.toISOString().slice(0, 10);
}

function todayIso(): string {
  const now = new Date();
  return new Date(Date.UTC(now.getFullYear(), now.getMonth(), now.getDate())).toISOString().slice(0, 10);
}

function nextSundayAfter(date: string): string {
  const day = new Date(`${date}T00:00:00Z`).getUTCDay();
  return addDays(date, (7 - day) % 7 || 7);
}

const dayOfMonth = (date: string) => Number(date.slice(8));

// S1 and the Sunday after it are both kept clear of a first Sunday, so neither starts as Fast & Testimony.
function firstClearSunday(from: string): string {
  let sunday = nextSundayAfter(from);
  while (dayOfMonth(sunday) < 8 || dayOfMonth(sunday) > 24) sunday = addDays(sunday, 7);
  return sunday;
}

function firstSundayOfFollowingMonth(date: string): string {
  const [year, month] = date.split("-").map(Number);
  let first = new Date(Date.UTC(year, month, 1)).toISOString().slice(0, 10);
  while (new Date(`${first}T00:00:00Z`).getUTCDay() !== 0) first = addDays(first, 1);
  return first;
}

const BISHOP_NAME = "Mark Andersen";
const COUNSELOR_NAME = "Dana Whitmore";

const TODAY = todayIso();
const S1 = firstClearSunday(TODAY);
const S2 = addDays(S1, 7);
const FIRST_SUNDAY_NEXT_MONTH = firstSundayOfFollowingMonth(S2);
const P1 = addDays(TODAY, -(new Date(`${TODAY}T00:00:00Z`).getUTCDay() || 7));
const P2 = addDays(P1, -14);
const P3 = addDays(P1, -28);

const open = (id: string, role: string) => ({ id, role, name: "", topic: "", status: "open" });
const penciled = (id: string, role: string, name: string, topic = "") => ({ id, role, name, topic, status: "tentative" });

function pastSunday(date: string, decliner: string) {
  return {
    date,
    type: "Regular",
    notes: "",
    owner: BISHOP_NAME,
    v: 2,
    slots: [
      { id: "o", role: "Opening Prayer", name: "Brooks, Laura", topic: "", status: "accepted", answeredBy: BISHOP_NAME, answeredAt: addDays(date, -8) },
      { id: "s0", role: "Speaker", name: "Okafor, Grace", topic: "Faith in small things", status: "accepted", answeredBy: BISHOP_NAME, answeredAt: addDays(date, -9), refs: [] },
      { id: "s1", role: "Speaker", name: "Tanaka, Ken", topic: "Serving quietly", status: "calling", msgAt: addDays(date, -5), refs: [] },
      {
        id: "s2",
        role: "Speaker",
        name: "",
        topic: "Hope",
        status: "open",
        refs: [],
        history: [{ name: decliner, at: addDays(date, -6), by: BISHOP_NAME, reason: "Out of town or unavailable that date", note: "" }],
      },
      { id: "c", role: "Closing Prayer", name: "Price, June", topic: "", status: "accepted", answeredBy: BISHOP_NAME, answeredAt: addDays(date, -8) },
    ],
  };
}

export async function seed(): Promise<void> {
  await ensureTestWard({ name: "Harness Test Ward" });
  await seedNotificationTriggers();
  await setReleasedModules(TEST_WARD_ID, null);

  await createTestUser({ handle: "bishop", role: "bishop", org: "bishopric", firstName: "Mark", lastName: "Andersen" });
  await createTestUser({
    handle: "counselor",
    role: "counselor",
    org: "bishopric",
    counselorPosition: 1,
    firstName: "Dana",
    lastName: "Whitmore",
  });

  const members: [string, string, "male" | "female", string][] = [
    ["Grace", "Okafor", "female", "1971-11-30"],
    ["Samuel", "Okafor", "male", "1969-05-18"],
    ["Ruth", "Okafor", "female", "1998-04-22"],
    ["Laura", "Brooks", "female", "1984-03-12"],
    ["Ethan", "Brooks", "male", "2011-07-02"],
    ["Nora", "Lindqvist", "female", "1995-02-09"],
    ["Ken", "Tanaka", "male", "1978-09-14"],
    ["Elise", "Moreau", "female", "1988-01-27"],
    ["Omar", "Haddad", "male", "1990-06-03"],
    ["June", "Price", "female", "1965-12-08"],
    ["Lena", "Varga", "female", "1982-08-19"],
  ];
  for (const [firstName, lastName, gender, birthDate] of members) {
    await createMember({ firstName, lastName, preferredName: `${lastName}, ${firstName}`, gender, birthDate, phone: "307-555-0100" });
  }

  await createPlannerDocument({
    collection: "settings",
    documentId: "bishopric",
    data: {
      members: [
        { name: BISHOP_NAME, role: "Bishop" },
        { name: COUNSELOR_NAME, role: "1st Counselor" },
        { name: "Paul Hendry", role: "2nd Counselor" },
      ],
    },
  });
  await createPlannerDocument({
    collection: "settings",
    documentId: "rotation",
    data: { start: P3.slice(0, 7), order: [BISHOP_NAME] },
  });

  // Ruth Okafor is on the do-not-ask list, so Place on Sunday must skip her and name why.
  await createPlannerDocument({
    collection: "holds",
    documentId: plannerHash("Okafor, Ruth"),
    data: {
      name: "Okafor, Ruth",
      until: addDays(TODAY, 120),
      status: "on",
      addedBy: BISHOP_NAME,
      addedAt: addDays(TODAY, -10),
      log: [{ at: addDays(TODAY, -10), by: BISHOP_NAME, action: "Added", until: addDays(TODAY, 120) }],
    },
  });

  // S1: every speaking slot named, both prayers open.
  await createPlannerDocument({
    collection: "sundays",
    documentId: S1,
    data: {
      date: S1,
      type: "Regular",
      notes: "",
      owner: BISHOP_NAME,
      v: 2,
      slots: [
        open("o", "Opening Prayer"),
        penciled("s0", "Speaker", "Tanaka, Ken", "Covenant belonging"),
        penciled("s1", "Speaker", "Moreau, Elise"),
        penciled("s2", "Speaker", "Haddad, Omar"),
        open("c", "Closing Prayer"),
      ],
    },
  });
  // S2: two open speaking slots, both prayers named.
  await createPlannerDocument({
    collection: "sundays",
    documentId: S2,
    data: {
      date: S2,
      type: "Regular",
      notes: "",
      owner: BISHOP_NAME,
      v: 2,
      slots: [
        penciled("o", "Opening Prayer", "Price, June"),
        open("s0", "Speaker"),
        open("s1", "Speaker"),
        penciled("c", "Closing Prayer", "Varga, Lena"),
      ],
    },
  });
  await createPlannerDocument({ collection: "sundays", documentId: P1, data: pastSunday(P1, "Lindqvist, Nora") });
  await createPlannerDocument({ collection: "sundays", documentId: P2, data: pastSunday(P2, "Haddad, Omar") });
  await createPlannerDocument({ collection: "sundays", documentId: P3, data: pastSunday(P3, "Varga, Lena") });

  const consider = (id: string, kind: "talk" | "prayer", name: string, target: string, month: string) =>
    createPlannerDocument({
      collection: "considers",
      documentId: id,
      data: { id, kind, name, owner: BISHOP_NAME, target, month, topic: "", at: addDays(TODAY, -3) },
    });
  await consider("xharness096a", "talk", "Brooks, Laura", S1, S1.slice(0, 7));
  await consider("xharness096b", "talk", "Lindqvist, Nora", "", S2.slice(0, 7));
  await consider("xharness096c", "prayer", "Brooks, Ethan", S2, S2.slice(0, 7));

  // P3 is in the agenda history, so the Calls past view must show it read-only.
  const line = (code: string, role: string, printed: string, wardName: string) => [
    `${P3}-${code}`,
    P3,
    "regular",
    role,
    printed,
    wardName,
    "Exact",
    "",
    printed,
    `${P3}_agenda.png`,
  ];
  await setPlannerHistory({
    agendaRows: [
      line("O1-0", "Opening Prayer", "Laura Brooks", "Brooks, Laura"),
      line("S1-0", "Speaker", "Grace Okafor", "Okafor, Grace"),
      line("S2-0", "Speaker", "Ken Tanaka", "Tanaka, Ken"),
      line("C1-0", "Closing Prayer", "June Price", "Price, June"),
    ],
    meetings: { [P3]: ["Regular", `${P3}_agenda.png`, ""] },
    conducting: { [P3]: BISHOP_NAME },
  });

  console.log(
    `  2 users, ${members.length} members. S1 ${S1} (full), S2 ${S2} (2 open talks), first Sunday of next month ` +
      `${FIRST_SUNDAY_NEXT_MONTH} (no document). Past: P1 ${P1} (editable), P2 ${P2} (locked), P3 ${P3} (agenda history)`,
  );
}
