import {
  TEST_WARD_ID,
  createHousehold,
  createMember,
  createPlannerDocument,
  createTestUser,
  createUnitAssignment,
  ensureTestWard,
  seedNotificationTriggers,
  setPlannerHistory,
  setReleasedModules,
} from "../../../infrastructure/seedUtils.ts";

// THE SACRAMENT PLANNER INSIDE THE APP (ITER-045, migration 093).
//
// Two bishopric logins whose display names the Planner's own `settings/bishopric` lists, so each
// opens as themselves; a music coordinator who must get no tile; and a super admin whose calling
// here is NOT bishopric, so the old hub at /sacrament still opens for them and the Planner does
// not. Every name is fake.
//
// Document ids follow the Planner's own rules, so a save from the screen UPDATES the seeded
// document rather than creating a second one beside it: a deferral, a hold and a mark are keyed
// by the Planner's `hash()` (ported below, byte for byte), a Sunday by its date, a consider by
// its own `id`.

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

function nextSunday(from: Date): string {
  const date = new Date(Date.UTC(from.getFullYear(), from.getMonth(), from.getDate()));
  date.setUTCDate(date.getUTCDate() + ((7 - date.getUTCDay()) % 7 || 7));
  return date.toISOString().slice(0, 10);
}

const BISHOP_NAME = "Mark Andersen";
const COUNSELOR_NAME = "Dana Whitmore";

const FIRST_SUNDAY = nextSunday(new Date());
const SECOND_SUNDAY = addDays(FIRST_SUNDAY, 7);
const PAST_SUNDAYS = [addDays(FIRST_SUNDAY, -21), addDays(FIRST_SUNDAY, -14), addDays(FIRST_SUNDAY, -7)];

export async function seed(): Promise<void> {
  await ensureTestWard({ name: "Harness Test Ward" });
  await seedNotificationTriggers();
  await setReleasedModules(TEST_WARD_ID, null);

  await createTestUser({
    handle: "bishop",
    role: "bishop",
    org: "bishopric",
    firstName: "Mark",
    lastName: "Andersen",
  });
  await createTestUser({
    handle: "counselor",
    role: "counselor",
    org: "bishopric",
    counselorPosition: 1,
    firstName: "Dana",
    lastName: "Whitmore",
  });
  await createTestUser({
    handle: "music",
    role: "music_coordinator",
    firstName: "Iris",
    lastName: "Calloway",
  });
  const admin = await createTestUser({
    handle: "admin",
    role: "ward_secretary",
    firstName: "Theo",
    lastName: "Brandt",
  });
  await createUnitAssignment({ userId: admin.id, role: "super_admin", unitId: null });

  // The member list the Planner reads. Ethan has no phone of his own, so the Planner reaches him
  // through his mother's, and says so.
  const brooks = await createHousehold({ familyName: "Brooks", address: "2201 Canyon Road" });
  await createMember({
    firstName: "Laura",
    lastName: "Brooks",
    preferredName: "Brooks, Laura",
    householdId: brooks,
    gender: "female",
    birthDate: "1984-03-12",
    phone: "307-555-0141",
    email: "laura.brooks@example.com",
  });
  await createMember({
    firstName: "Ethan",
    lastName: "Brooks",
    preferredName: "Brooks, Ethan",
    householdId: brooks,
    category: "youth",
    gender: "male",
    birthDate: "2011-07-02",
  });
  const okafor = await createHousehold({ familyName: "Okafor", address: "14 Ridge Lane" });
  await createMember({
    firstName: "Grace",
    lastName: "Okafor",
    preferredName: "Okafor, Grace",
    householdId: okafor,
    gender: "female",
    birthDate: "1971-11-30",
    phone: "307-555-0177",
  });
  await createMember({
    firstName: "Samuel",
    lastName: "Okafor",
    preferredName: "Okafor, Samuel",
    householdId: okafor,
    gender: "male",
    birthDate: "1969-05-18",
    phone: "307-555-0178",
  });
  await createMember({
    firstName: "Nora",
    lastName: "Lindqvist",
    preferredName: "Lindqvist, Nora",
    gender: "female",
    birthDate: "1995-02-09",
    phone: "307-555-0199",
  });

  // Eight real documents.
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
    data: { start: FIRST_SUNDAY.slice(0, 7), order: [BISHOP_NAME, COUNSELOR_NAME, "Paul Hendry"] },
  });
  await createPlannerDocument({
    collection: "sundays",
    documentId: FIRST_SUNDAY,
    data: {
      date: FIRST_SUNDAY,
      type: "Regular",
      notes: "",
      owner: BISHOP_NAME,
      v: 2,
      slots: [
        { id: "o", role: "Opening Prayer", name: "", topic: "", status: "open" },
        {
          id: "s0",
          role: "Speaker",
          name: "Okafor, Grace",
          topic: "Gratitude in hard seasons",
          status: "tentative",
          refs: [],
        },
        { id: "s1", role: "Speaker", name: "", topic: "", status: "open", refs: [] },
        { id: "c", role: "Closing Prayer", name: "", topic: "", status: "open" },
      ],
    },
  });
  await createPlannerDocument({
    collection: "sundays",
    documentId: SECOND_SUNDAY,
    data: {
      date: SECOND_SUNDAY,
      type: "Regular",
      notes: "",
      owner: COUNSELOR_NAME,
      v: 2,
      slots: [
        { id: "o", role: "Opening Prayer", name: "", topic: "", status: "open" },
        { id: "s0", role: "Speaker", name: "", topic: "", status: "open", refs: [] },
        { id: "c", role: "Closing Prayer", name: "", topic: "", status: "open" },
      ],
    },
  });
  await createPlannerDocument({
    collection: "deferrals",
    documentId: plannerHash("Lindqvist, Nora"),
    data: {
      name: "Lindqvist, Nora",
      status: "deferred",
      scope: "all",
      away: false,
      approvals: [],
      count: 1,
      until: addDays(FIRST_SUNDAY, 90),
      log: [{ at: PAST_SUNDAYS[2], by: "Everyone agreed", action: "Deferred" }],
    },
  });
  await createPlannerDocument({
    collection: "deferrals",
    documentId: plannerHash("Okafor, Samuel"),
    data: {
      name: "Okafor, Samuel",
      status: "pending",
      scope: "all",
      away: false,
      approvals: [BISHOP_NAME],
      count: 0,
      until: "",
      log: [
        {
          at: PAST_SUNDAYS[2],
          by: BISHOP_NAME,
          action: "Proposed deferral",
          note: "",
          reason: "Lives elsewhere right now",
        },
      ],
    },
  });
  await createPlannerDocument({
    collection: "considers",
    documentId: "xharness093a",
    data: {
      id: "xharness093a",
      kind: "talk",
      name: "Brooks, Laura",
      owner: BISHOP_NAME,
      month: SECOND_SUNDAY.slice(0, 7),
      target: "",
      topic: "Ministering",
      at: PAST_SUNDAYS[2],
    },
  });
  await createPlannerDocument({
    collection: "considers",
    documentId: "xharness093b",
    data: {
      id: "xharness093b",
      kind: "prayer",
      name: "Brooks, Ethan",
      owner: COUNSELOR_NAME,
      month: SECOND_SUNDAY.slice(0, 7),
      target: "",
      topic: "",
      at: PAST_SUNDAYS[2],
    },
  });

  // Ten agenda lines across three past Sundays, in the Planner's tuple:
  // [id, date, type, role, printed, auto, status, note, key, file]. `auto` is the ward-list name the
  // line was matched to, and it is what the Planner counts; `key` is the printed name, used only by
  // Name Review.
  const line = (date: string, code: string, role: string, printed: string, wardName: string) => [
    `${date}-${code}`,
    date,
    "regular",
    role,
    printed,
    wardName,
    "Exact",
    "",
    printed,
    `${date}_agenda.png`,
  ];
  await setPlannerHistory({
    agendaRows: [
      line(PAST_SUNDAYS[0], "O1-0", "Opening Prayer", "Laura Brooks", "Brooks, Laura"),
      line(PAST_SUNDAYS[0], "S1-0", "Speaker", "Grace Okafor", "Okafor, Grace"),
      line(PAST_SUNDAYS[0], "S2-0", "Speaker", "Samuel Okafor", "Okafor, Samuel"),
      line(PAST_SUNDAYS[0], "C1-0", "Closing Prayer", "Nora Lindqvist", "Lindqvist, Nora"),
      line(PAST_SUNDAYS[1], "O1-0", "Opening Prayer", "Samuel Okafor", "Okafor, Samuel"),
      line(PAST_SUNDAYS[1], "Y1-0", "Youth Speaker", "Ethan Brooks", "Brooks, Ethan"),
      line(PAST_SUNDAYS[1], "C1-0", "Closing Prayer", "Grace Okafor", "Okafor, Grace"),
      line(PAST_SUNDAYS[2], "O1-0", "Opening Prayer", "Nora Lindqvist", "Lindqvist, Nora"),
      line(PAST_SUNDAYS[2], "S1-0", "Speaker", "Laura Brooks", "Brooks, Laura"),
      line(PAST_SUNDAYS[2], "C1-0", "Closing Prayer", "Ethan Brooks", "Brooks, Ethan"),
    ],
    meetings: Object.fromEntries(
      PAST_SUNDAYS.map((date) => [date, ["Regular", `${date}_agenda.png`, ""]]),
    ),
    conducting: {
      [PAST_SUNDAYS[0]]: BISHOP_NAME,
      [PAST_SUNDAYS[1]]: COUNSELOR_NAME,
      [PAST_SUNDAYS[2]]: "Paul Hendry",
    },
  });

  console.log(
    `  4 users, 5 members, 8 Planner documents (Sundays ${FIRST_SUNDAY} and ${SECOND_SUNDAY}), ` +
      "10 agenda history lines",
  );
}
