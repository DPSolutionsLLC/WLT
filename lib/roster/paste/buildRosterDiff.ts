import type { DateOnly } from "@/lib/calendar/dates";
import {
  personMatchKey,
  type ImportProblem,
  type ReportPerson,
} from "@/lib/roster/paste/normalizeReportRow";
import type { ReportColumnKey } from "@/lib/roster/paste/reportColumns";
import type { MemberCategory, MemberGender, MemberStatus } from "@/types/domain";

// Current roster + the people in a paste → the checklist. PURE: no I/O, no writes. Both the preview
// route and the apply route call this on the same inputs, which is what makes "the checklist you
// reviewed is what gets applied" provable rather than hoped for (roster-c-csv-import's lesson: one
// definition of "the same person", never two).

export type SnapshotMember = {
  id: string;
  householdId: string | null;
  firstName: string;
  lastName: string;
  preferredName: string | null;
  fullName: string | null;
  birthDate: DateOnly | null;
  gender: MemberGender | null;
  phone: string | null;
  email: string | null;
  category: MemberCategory | null;
  status: MemberStatus;
  classAssignment: string | null;
  callings: string | null;
  callingsSustained: string | null;
  callingsSetApart: string | null;
  ministeringBrothers: string | null;
  ministeringSisters: string | null;
  hasMinisteringBrothers: boolean | null;
  hasMinisteringSisters: boolean | null;
};

export type SnapshotHousehold = { id: string; familyName: string; address: string | null };

export type RosterSnapshot = {
  members: readonly SnapshotMember[];
  households: readonly SnapshotHousehold[];
};

export type ReviewedField =
  | "firstName"
  | "lastName"
  | "preferredName"
  | "fullName"
  | "birthDate"
  | "gender"
  | "phone"
  | "email"
  | "household";

export type FieldChange = {
  field: ReviewedField;
  label: string;
  before: string | null;
  after: string | null;
  kind: "changed" | "added" | "removed";
};

export type HouseholdTarget = { householdId: string } | { householdKey: string };

export type MemberColumnSet = Record<string, string | boolean | null>;

export type NewPersonItem = {
  id: string;
  name: string;
  person: ReportPerson;
  household: HouseholdTarget;
  householdLabel: string;
  isNewHousehold: boolean;
  defaultSelected: true;
};

export type ChangedPersonItem = {
  id: string;
  memberId: string;
  name: string;
  changes: FieldChange[];
  returning: boolean;
  set: MemberColumnSet;
  householdChange: HouseholdTarget | null;
  defaultSelected: true;
};

export type HouseholdAddressItem = {
  id: string;
  householdId: string;
  name: string;
  before: string | null;
  after: string | null;
  defaultSelected: true;
};

export type MovedOutItem = {
  id: string;
  memberId: string;
  name: string;
  householdName: string | null;
  defaultSelected: false;
};

export type SilentUpdate = { memberId: string; set: MemberColumnSet };

export type NewHousehold = { key: string; familyName: string; address: string | null };

export type PartialPasteGuard = {
  movedOutCount: number;
  activeCount: number;
  suspicious: boolean;
};

export type RosterDiff = {
  newPeople: NewPersonItem[];
  changedPeople: ChangedPersonItem[];
  householdAddresses: HouseholdAddressItem[];
  movedOut: MovedOutItem[];
  silentUpdates: SilentUpdate[];
  unchangedCount: number;
  newHouseholds: NewHousehold[];
  guard: PartialPasteGuard;
  problems: ImportProblem[];
};

const FIELD_LABELS: Record<ReviewedField, string> = {
  firstName: "First name",
  lastName: "Last name",
  preferredName: "Preferred name",
  fullName: "Full name",
  birthDate: "Birth date",
  gender: "Gender",
  phone: "Phone",
  email: "Email",
  household: "Household",
};

type ComparedField = {
  field: Exclude<ReviewedField, "household">;
  column: string;
  suppliedBy: ReportColumnKey | null;
  read: (member: SnapshotMember) => string | null;
  incoming: (person: ReportPerson) => string | null;
};

// `suppliedBy: null` means a required column, which every accepted paste carries.
const COMPARED_FIELDS: readonly ComparedField[] = [
  {
    field: "firstName",
    column: "first_name",
    suppliedBy: null,
    read: (member) => member.firstName,
    incoming: (person) => person.firstName,
  },
  {
    field: "lastName",
    column: "last_name",
    suppliedBy: null,
    read: (member) => member.lastName,
    incoming: (person) => person.lastName,
  },
  {
    field: "preferredName",
    column: "preferred_name",
    suppliedBy: null,
    read: (member) => member.preferredName,
    incoming: (person) => person.preferredName,
  },
  {
    field: "fullName",
    column: "full_name",
    suppliedBy: null,
    read: (member) => member.fullName,
    incoming: (person) => person.fullName,
  },
  {
    field: "birthDate",
    column: "birth_date",
    suppliedBy: null,
    read: (member) => member.birthDate,
    incoming: (person) => person.birthDate,
  },
  {
    field: "gender",
    column: "gender",
    suppliedBy: "gender",
    read: (member) => member.gender,
    incoming: (person) => person.gender,
  },
  {
    field: "phone",
    column: "phone",
    suppliedBy: "phone",
    read: (member) => member.phone,
    incoming: (person) => person.phone,
  },
  {
    field: "email",
    column: "email",
    suppliedBy: "email",
    read: (member) => member.email,
    incoming: (person) => person.email,
  },
];

type SilentField = {
  column: string;
  suppliedBy: ReportColumnKey;
  read: (member: SnapshotMember) => string | boolean | null;
  incoming: (person: ReportPerson) => string | boolean | null;
};

const SILENT_FIELDS: readonly SilentField[] = [
  {
    column: "class_assignment",
    suppliedBy: "classAssignment",
    read: (member) => member.classAssignment,
    incoming: (person) => person.silent.classAssignment,
  },
  {
    column: "callings",
    suppliedBy: "callings",
    read: (member) => member.callings,
    incoming: (person) => person.silent.callings,
  },
  {
    column: "callings_sustained",
    suppliedBy: "callingsSustained",
    read: (member) => member.callingsSustained,
    incoming: (person) => person.silent.callingsSustained,
  },
  {
    column: "callings_set_apart",
    suppliedBy: "callingsSetApart",
    read: (member) => member.callingsSetApart,
    incoming: (person) => person.silent.callingsSetApart,
  },
  {
    column: "ministering_brothers",
    suppliedBy: "ministeringBrothers",
    read: (member) => member.ministeringBrothers,
    incoming: (person) => person.silent.ministeringBrothers,
  },
  {
    column: "ministering_sisters",
    suppliedBy: "ministeringSisters",
    read: (member) => member.ministeringSisters,
    incoming: (person) => person.silent.ministeringSisters,
  },
  {
    column: "has_ministering_brothers",
    suppliedBy: "hasMinisteringBrothers",
    read: (member) => member.hasMinisteringBrothers,
    incoming: (person) => person.silent.hasMinisteringBrothers,
  },
  {
    column: "has_ministering_sisters",
    suppliedBy: "hasMinisteringSisters",
    read: (member) => member.hasMinisteringSisters,
    incoming: (person) => person.silent.hasMinisteringSisters,
  },
];

const PARTIAL_PASTE_MINIMUM = 10;
const PARTIAL_PASTE_SHARE = 0.25;

function lower(value: string): string {
  return value.trim().toLowerCase();
}

function householdKeyFor(name: string): string {
  return `household:${lower(name)}`;
}

function changeKind(before: string | null, after: string | null): FieldChange["kind"] {
  if (before === null) return "added";
  if (after === null) return "removed";
  return "changed";
}

function byName<Item>(nameOf: (item: Item) => { lastName: string; firstName: string }) {
  return (left: Item, right: Item): number => {
    const a = nameOf(left);
    const b = nameOf(right);
    return (
      a.lastName.localeCompare(b.lastName, "en", { sensitivity: "base" }) ||
      a.firstName.localeCompare(b.firstName, "en", { sensitivity: "base" })
    );
  };
}

function isSupplied(person: ReportPerson, column: ReportColumnKey | null): boolean {
  return column === null || person.supplied.has(column);
}

function matchPeople(
  members: readonly SnapshotMember[],
  people: readonly ReportPerson[],
  problems: ImportProblem[],
): Map<ReportPerson, SnapshotMember> {
  const matches = new Map<ReportPerson, SnapshotMember>();
  const claimed = new Set<string>();

  const claim = (person: ReportPerson, member: SnapshotMember) => {
    matches.set(person, member);
    claimed.add(member.id);
  };

  const byKey = new Map<string, SnapshotMember[]>();
  for (const member of members) {
    if (member.fullName === null || member.birthDate === null) continue;
    const key = personMatchKey(member.fullName, member.birthDate);
    byKey.set(key, [...(byKey.get(key) ?? []), member]);
  }

  for (const person of people) {
    const candidate = byKey
      .get(personMatchKey(person.fullName, person.birthDate))
      ?.find((member) => !claimed.has(member.id));
    if (candidate) claim(person, candidate);
  }

  // Legacy members (no full name yet: anybody created before the first paste) match on first and
  // last name, and only when exactly one person on EACH side has that name.
  const legacyNameKey = (firstName: string, lastName: string) =>
    `${lower(firstName)}|${lower(lastName)}`;

  const unmatchedPeopleByName = new Map<string, number>();
  for (const person of people) {
    if (matches.has(person)) continue;
    const key = legacyNameKey(person.firstName, person.lastName);
    unmatchedPeopleByName.set(key, (unmatchedPeopleByName.get(key) ?? 0) + 1);
  }

  for (const person of people) {
    if (matches.has(person)) continue;

    const key = legacyNameKey(person.firstName, person.lastName);
    const candidates = members.filter(
      (member) =>
        member.fullName === null &&
        !claimed.has(member.id) &&
        legacyNameKey(member.firstName, member.lastName) === key,
    );

    if (candidates.length === 0) continue;

    const displayName = `${person.firstName} ${person.lastName}`;

    if (candidates.length > 1) {
      problems.push({
        rowNumber: person.rowNumber,
        message:
          `More than one person named "${displayName}" is already in the roster, so this row ` +
          "was treated as new. Merge them by hand if needed.",
      });
      continue;
    }

    if ((unmatchedPeopleByName.get(key) ?? 0) > 1) {
      problems.push({
        rowNumber: person.rowNumber,
        message:
          `More than one person in this paste is named "${displayName}", so this row was ` +
          "treated as new rather than guessed onto the one already in the roster.",
      });
      continue;
    }

    claim(person, candidates[0]);
  }

  for (const person of people) {
    if (matches.has(person)) continue;

    const candidates = members.filter(
      (member) =>
        member.fullName !== null &&
        !claimed.has(member.id) &&
        lower(member.fullName) === lower(person.fullName),
    );

    if (candidates.length === 1) claim(person, candidates[0]);
  }

  return matches;
}

function compareReviewedFields(
  member: SnapshotMember,
  person: ReportPerson,
): { changes: FieldChange[]; set: MemberColumnSet } {
  const changes: FieldChange[] = [];
  const set: MemberColumnSet = {};

  for (const compared of COMPARED_FIELDS) {
    if (!isSupplied(person, compared.suppliedBy)) continue;

    const before = compared.read(member);
    const after = compared.incoming(person);
    if (before === after) continue;

    changes.push({
      field: compared.field,
      label: FIELD_LABELS[compared.field],
      before,
      after,
      kind: changeKind(before, after),
    });
    set[compared.column] = after;
  }

  return { changes, set };
}

function compareSilentFields(member: SnapshotMember, person: ReportPerson): MemberColumnSet {
  const set: MemberColumnSet = {};

  for (const silent of SILENT_FIELDS) {
    if (!person.supplied.has(silent.suppliedBy)) continue;
    const incoming = silent.incoming(person);
    if (silent.read(member) !== incoming) set[silent.column] = incoming;
  }

  if (member.category !== person.category) set.category = person.category;

  return set;
}

export function newPersonColumns(person: ReportPerson): MemberColumnSet {
  return {
    first_name: person.firstName,
    last_name: person.lastName,
    preferred_name: person.preferredName,
    full_name: person.fullName,
    birth_date: person.birthDate,
    gender: person.gender,
    phone: person.phone,
    email: person.email,
    category: person.category,
    class_assignment: person.silent.classAssignment,
    callings: person.silent.callings,
    callings_sustained: person.silent.callingsSustained,
    callings_set_apart: person.silent.callingsSetApart,
    ministering_brothers: person.silent.ministeringBrothers,
    ministering_sisters: person.silent.ministeringSisters,
    has_ministering_brothers: person.silent.hasMinisteringBrothers,
    has_ministering_sisters: person.silent.hasMinisteringSisters,
  };
}

export function buildRosterDiff(
  current: RosterSnapshot,
  people: readonly ReportPerson[],
): RosterDiff {
  const problems: ImportProblem[] = [];
  const orderedPeople = [...people].sort((left, right) => left.rowNumber - right.rowNumber);

  const householdsById = new Map(current.households.map((household) => [household.id, household]));
  const householdsByName = new Map<string, SnapshotHousehold>();
  for (const household of current.households) {
    const key = lower(household.familyName);
    if (!householdsByName.has(key)) householdsByName.set(key, household);
  }

  const newHouseholds = new Map<string, NewHousehold>();
  const incomingAddressByHousehold = new Map<string, string | null>();

  const resolveHousehold = (person: ReportPerson): HouseholdTarget => {
    const existing = householdsByName.get(lower(person.householdName));

    if (existing) {
      if (person.supplied.has("address") && !incomingAddressByHousehold.has(existing.id)) {
        incomingAddressByHousehold.set(existing.id, person.address);
      }
      return { householdId: existing.id };
    }

    const key = householdKeyFor(person.householdName);
    if (!newHouseholds.has(key)) {
      newHouseholds.set(key, {
        key,
        familyName: person.householdName,
        address: person.supplied.has("address") ? person.address : null,
      });
    }
    return { householdKey: key };
  };

  const matches = matchPeople(current.members, orderedPeople, problems);

  const newPeople: NewPersonItem[] = [];
  const changedPeople: ChangedPersonItem[] = [];
  const silentUpdates: SilentUpdate[] = [];
  const changedSortNames = new Map<string, ReportPerson>();
  let unchangedCount = 0;

  for (const person of orderedPeople) {
    const household = resolveHousehold(person);
    const member = matches.get(person);
    const name = `${person.firstName} ${person.lastName}`;

    if (!member) {
      newPeople.push({
        id: `new:${personMatchKey(person.fullName, person.birthDate)}`,
        name,
        person,
        household,
        householdLabel: person.householdName,
        isNewHousehold: "householdKey" in household,
        defaultSelected: true,
      });
      continue;
    }

    const { changes, set } = compareReviewedFields(member, person);

    const movesHousehold =
      "householdKey" in household || household.householdId !== member.householdId;

    if (movesHousehold) {
      const before =
        member.householdId === null
          ? null
          : (householdsById.get(member.householdId)?.familyName ?? null);
      changes.push({
        field: "household",
        label: FIELD_LABELS.household,
        before,
        after: person.householdName,
        kind: changeKind(before, person.householdName),
      });
    }

    const silent = compareSilentFields(member, person);
    if (Object.keys(silent).length > 0) silentUpdates.push({ memberId: member.id, set: silent });

    const returning = member.status === "moved_out";

    if (changes.length === 0 && !returning) {
      unchangedCount += 1;
      continue;
    }

    changedSortNames.set(member.id, person);
    changedPeople.push({
      id: `member:${member.id}`,
      memberId: member.id,
      name,
      changes,
      returning,
      set,
      householdChange: movesHousehold ? household : null,
      defaultSelected: true,
    });
  }

  const householdAddresses: HouseholdAddressItem[] = [];
  for (const [householdId, after] of incomingAddressByHousehold) {
    const household = householdsById.get(householdId);
    if (!household || household.address === after) continue;
    householdAddresses.push({
      id: `household:${householdId}`,
      householdId,
      name: household.familyName,
      before: household.address,
      after,
      defaultSelected: true,
    });
  }

  const matchedIds = new Set([...matches.values()].map((member) => member.id));
  const stillListed = (member: SnapshotMember) =>
    member.status === "active" || member.status === "do_not_contact";

  const movedOut: MovedOutItem[] = current.members
    .filter((member) => stillListed(member) && !matchedIds.has(member.id))
    .map((member) => ({
      id: `moveout:${member.id}`,
      memberId: member.id,
      name: `${member.firstName} ${member.lastName}`,
      householdName:
        member.householdId === null
          ? null
          : (householdsById.get(member.householdId)?.familyName ?? null),
      defaultSelected: false as const,
    }));

  const activeCount = current.members.filter(stillListed).length;
  const movedOutCount = movedOut.length;

  const memberNames = new Map(current.members.map((member) => [member.id, member]));

  return {
    newPeople: newPeople.sort(byName((item) => item.person)),
    changedPeople: changedPeople.sort(
      byName((item) => changedSortNames.get(item.memberId) ?? { firstName: item.name, lastName: "" }),
    ),
    householdAddresses: householdAddresses.sort((left, right) =>
      left.name.localeCompare(right.name, "en", { sensitivity: "base" }),
    ),
    movedOut: movedOut.sort(
      byName((item) => memberNames.get(item.memberId) ?? { firstName: item.name, lastName: "" }),
    ),
    silentUpdates,
    unchangedCount,
    newHouseholds: [...newHouseholds.values()],
    guard: {
      movedOutCount,
      activeCount,
      suspicious:
        movedOutCount >= PARTIAL_PASTE_MINIMUM && movedOutCount > activeCount * PARTIAL_PASTE_SHARE,
    },
    problems,
  };
}

// What the checklist SHOWS, and nothing the apply needs. The browser never receives the column
// sets or household targets; the apply route recomputes those from the paste.
export type RosterReview = {
  newPeople: {
    id: string;
    name: string;
    householdLabel: string;
    isNewHousehold: boolean;
    birthDate: DateOnly;
    category: MemberCategory;
  }[];
  changedPeople: { id: string; name: string; changes: FieldChange[]; returning: boolean }[];
  householdAddresses: { id: string; name: string; before: string | null; after: string | null }[];
  movedOut: { id: string; name: string; householdName: string | null }[];
  silentUpdateCount: number;
  unchangedCount: number;
  newHouseholdCount: number;
  guard: PartialPasteGuard;
};

export function toReviewView(diff: RosterDiff): RosterReview {
  return {
    newPeople: diff.newPeople.map((item) => ({
      id: item.id,
      name: item.name,
      householdLabel: item.householdLabel,
      isNewHousehold: item.isNewHousehold,
      birthDate: item.person.birthDate,
      category: item.person.category,
    })),
    changedPeople: diff.changedPeople.map((item) => ({
      id: item.id,
      name: item.name,
      changes: item.changes,
      returning: item.returning,
    })),
    householdAddresses: diff.householdAddresses.map((item) => ({
      id: item.id,
      name: item.name,
      before: item.before,
      after: item.after,
    })),
    movedOut: diff.movedOut.map((item) => ({
      id: item.id,
      name: item.name,
      householdName: item.householdName,
    })),
    silentUpdateCount: diff.silentUpdates.length,
    unchangedCount: diff.unchangedCount,
    newHouseholdCount: diff.newHouseholds.length,
    guard: diff.guard,
  };
}

// The ticks a checklist starts with: everything except a move-out, so every move-out is chosen.
export function defaultSelectedIds(review: RosterReview): string[] {
  return [
    ...review.newPeople.map((item) => item.id),
    ...review.changedPeople.map((item) => item.id),
    ...review.householdAddresses.map((item) => item.id),
  ];
}
