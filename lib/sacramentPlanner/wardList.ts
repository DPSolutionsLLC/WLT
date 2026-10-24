import type { Member } from "@/lib/roster/queries";

// The Planner's built-in member list was a tuple per person: [name, age, gender, phone, phoneVia,
// email] (`DATA.ward` in assets/body.html). The frame route now serves it from the app's own
// `members` table, through this one pure function, and the Slice B check script maps through it
// too, so the report checks exactly what the frame serves.
export type PlannerWardRow = [
  name: string,
  age: number | null,
  gender: "M" | "F" | "",
  phone: string,
  phoneVia: string,
  email: string,
];

export type PlannerWardMember = Pick<
  Member,
  | "householdId"
  | "firstName"
  | "lastName"
  | "preferredName"
  | "fullName"
  | "birthDate"
  | "gender"
  | "phone"
  | "email"
  | "category"
>;

const ADULT_AGE = 18;

// The Planner names people "Last, First Middle". LCR's Preferred Name is already that form.
export function plannerNameOf(member: PlannerWardMember): string {
  const preferred = member.preferredName?.trim();
  if (preferred) return preferred;
  const full = member.fullName?.trim();
  if (full) return full;
  return `${member.lastName.trim()}, ${member.firstName.trim()}`;
}

// Whole years from a birth date to the ward's today, both as YYYY-MM-DD. Compared as calendar
// parts, never as instants, so the answer cannot move with the server's zone (rule 12).
export function ageOn(birthDate: string | null, todayInWardZone: string): number | null {
  if (birthDate === null) return null;
  const birth = /^(\d{4})-(\d{2})-(\d{2})$/.exec(birthDate);
  const today = /^(\d{4})-(\d{2})-(\d{2})$/.exec(todayInWardZone);
  if (!birth || !today) return null;

  const [, birthYear, birthMonth, birthDay] = birth.map(Number);
  const [, year, month, day] = today.map(Number);
  const hadBirthdayThisYear = month > birthMonth || (month === birthMonth && day >= birthDay);
  const age = year - birthYear - (hadBirthdayThisYear ? 0 : 1);
  return age >= 0 ? age : null;
}

function genderCode(gender: PlannerWardMember["gender"]): PlannerWardRow[2] {
  if (gender === "male") return "M";
  if (gender === "female") return "F";
  return "";
}

type Person = { member: PlannerWardMember; name: string; age: number | null; phone: string };

function isAdult(person: Person): boolean {
  return person.age === null ? person.member.category === "adult" : person.age >= ADULT_AGE;
}

// Oldest first, by birth date; somebody with no birth date sorts after everyone who has one.
function olderFirst(left: Person, right: Person): number {
  const a = left.member.birthDate;
  const b = right.member.birthDate;
  if (a === b) return 0;
  if (a === null) return 1;
  if (b === null) return -1;
  return a < b ? -1 : 1;
}

// A person with no phone of their own is reached through the oldest adult in their household who
// has one, and the Planner says whose phone it is.
function householdContact(person: Person, household: readonly Person[]): Person | null {
  const candidates = household
    .filter((other) => other !== person && other.phone !== "" && isAdult(other))
    .sort(olderFirst);
  return candidates[0] ?? null;
}

export function toPlannerWardList(
  members: readonly PlannerWardMember[],
  todayInWardZone: string,
): PlannerWardRow[] {
  const people: Person[] = members.map((member) => ({
    member,
    name: plannerNameOf(member),
    age: ageOn(member.birthDate, todayInWardZone),
    phone: member.phone?.trim() ?? "",
  }));

  const households = new Map<string, Person[]>();
  for (const person of people) {
    const householdId = person.member.householdId;
    if (householdId === null) continue;
    households.set(householdId, [...(households.get(householdId) ?? []), person]);
  }

  const rows = people.map((person): PlannerWardRow => {
    const household = person.member.householdId
      ? (households.get(person.member.householdId) ?? [])
      : [];
    const contact = person.phone === "" ? householdContact(person, household) : null;

    return [
      person.name,
      person.age,
      genderCode(person.member.gender),
      contact ? contact.phone : person.phone,
      contact ? contact.name : "",
      person.member.email?.trim() ?? "",
    ];
  });

  // The Planner's list was sorted by plain string order, which is what Array.prototype.sort does.
  return rows.sort((left, right) => (left[0] < right[0] ? -1 : left[0] > right[0] ? 1 : 0));
}
