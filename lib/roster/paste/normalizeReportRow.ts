import { isValidDateOnly, type DateOnly } from "@/lib/calendar/dates";
import { ageGroupOn } from "@/lib/roster/ageGroup";
import type { ImportProblem, ParsedReport } from "@/lib/roster/paste/parsePastedReport";
import {
  REPORT_COLUMNS,
  type ColumnIndex,
  type ReportColumnKey,
} from "@/lib/roster/paste/reportColumns";
import type { MemberCategory, MemberGender } from "@/types/domain";

export type { ImportProblem };

export type SilentFields = {
  classAssignment: string | null;
  callings: string | null;
  callingsSustained: string | null;
  callingsSetApart: string | null;
  ministeringBrothers: string | null;
  ministeringSisters: string | null;
  hasMinisteringBrothers: boolean | null;
  hasMinisteringSisters: boolean | null;
};

export type ReportPerson = {
  rowNumber: number;
  preferredName: string;
  fullName: string;
  firstName: string;
  lastName: string;
  birthDate: DateOnly;
  gender: MemberGender | null;
  phone: string | null;
  email: string | null;
  address: string | null;
  householdName: string;
  category: MemberCategory;
  silent: SilentFields;
  // The OPTIONAL columns this paste carries. A column that is not here is "not supplied", and the
  // diff never reads its absence as a blank.
  supplied: ReadonlySet<ReportColumnKey>;
};

const MONTHS: Record<string, number> = {
  jan: 1,
  feb: 2,
  mar: 3,
  apr: 4,
  may: 5,
  jun: 6,
  jul: 7,
  aug: 8,
  sep: 9,
  oct: 10,
  nov: 11,
  dec: 12,
};

const LCR_DATE_PATTERN = /^(\d{1,2}) ([A-Za-z]{3}) (\d{4})$/;

// By hand, never `new Date("13 Jun 1986")`, which parses in the process's own zone.
export function parseLcrDate(value: string): DateOnly | null {
  const match = LCR_DATE_PATTERN.exec(value.trim());
  if (!match) return null;

  const month = MONTHS[match[2].toLowerCase()];
  if (month === undefined) return null;

  const candidate = `${match[3]}-${String(month).padStart(2, "0")}-${match[1].padStart(2, "0")}`;
  return isValidDateOnly(candidate) ? candidate : null;
}

// The CHECK limits in migration 090. One over-long cell would otherwise fail the whole apply.
const CELL_LIMITS: readonly { key: ReportColumnKey; label: string; limit: number }[] = [
  { key: "preferredName", label: "Preferred Name", limit: 200 },
  { key: "fullName", label: "Full Name", limit: 200 },
  { key: "email", label: "Individual E-mail", limit: 320 },
  { key: "classAssignment", label: "Class Assignment", limit: 1000 },
  { key: "callings", label: "Callings", limit: 4000 },
  { key: "callingsSustained", label: "Callings with Date Sustained", limit: 4000 },
  { key: "callingsSetApart", label: "Callings with Date Sustained and Set Apart", limit: 4000 },
  { key: "ministeringBrothers", label: "Ministering Brothers", limit: 1000 },
  { key: "ministeringSisters", label: "Ministering Sisters", limit: 1000 },
];

const GENDERS: Record<string, MemberGender> = {
  m: "male",
  male: "male",
  f: "female",
  female: "female",
};

function readCell(cells: readonly string[], index: number | undefined): string {
  if (index === undefined) return "";
  return (cells[index] ?? "").trim();
}

function blankToNull(value: string): string | null {
  return value === "" ? null : value;
}

function readYesNo(value: string): boolean | null {
  const lowered = value.toLowerCase();
  if (lowered === "yes") return true;
  if (lowered === "no") return false;
  return null;
}

export function splitPreferredName(
  preferredName: string,
): { firstName: string; lastName: string } | null {
  const comma = preferredName.indexOf(",");
  if (comma === -1) return null;

  const lastName = preferredName.slice(0, comma).trim();
  const firstName = preferredName.slice(comma + 1).trim();
  if (lastName === "" || firstName === "") return null;

  return { firstName, lastName };
}

export function personMatchKey(fullName: string, birthDate: DateOnly): string {
  return `${fullName.trim().toLowerCase()}|${birthDate}`;
}

function suppliedOptionalColumns(columnIndex: ColumnIndex): Set<ReportColumnKey> {
  return new Set(
    REPORT_COLUMNS.filter(
      (column) => !column.required && columnIndex[column.key] !== undefined,
    ).map((column) => column.key),
  );
}

export function normalizeReportRows(
  parsed: Pick<ParsedReport, "rows">,
  columnIndex: ColumnIndex,
  asOf: DateOnly,
): { people: ReportPerson[]; problems: ImportProblem[] } {
  const people: ReportPerson[] = [];
  const problems: ImportProblem[] = [];
  const supplied = suppliedOptionalColumns(columnIndex);
  const seenKeys = new Set<string>();

  for (const { rowNumber, cells } of parsed.rows) {
    const read = (key: ReportColumnKey) => readCell(cells, columnIndex[key]);

    const preferredName = read("preferredName");
    const fullName = read("fullName");
    const householdName = read("household");
    const birthCell = read("birthDate");

    if (fullName === "") {
      problems.push({ rowNumber, message: `Full Name is blank, so this row was skipped.` });
      continue;
    }

    if (householdName === "") {
      problems.push({
        rowNumber,
        message: `Head of House and Spouse is blank, so this row was skipped.`,
      });
      continue;
    }

    const names = splitPreferredName(preferredName);
    if (!names) {
      problems.push({
        rowNumber,
        message: `The Preferred Name "${preferredName}" is not in "Last, First" form, so this row was skipped.`,
      });
      continue;
    }

    const birthDate = parseLcrDate(birthCell);
    if (!birthDate) {
      problems.push({
        rowNumber,
        message:
          birthCell === ""
            ? `Birth Date is blank, so this row was skipped.`
            : `The Birth Date "${birthCell}" is not a date like "13 Jun 1986", so this row was skipped.`,
      });
      continue;
    }

    const tooLong = CELL_LIMITS.find(
      ({ key: column, limit }) => read(column).length > limit,
    );
    if (tooLong) {
      problems.push({
        rowNumber,
        message: `${tooLong.label} is longer than ${tooLong.limit} characters, so this row was skipped.`,
      });
      continue;
    }

    const key = personMatchKey(fullName, birthDate);
    if (seenKeys.has(key)) {
      problems.push({
        rowNumber,
        message: `${fullName} is listed twice in this paste. Only the first was used.`,
      });
      continue;
    }
    seenKeys.add(key);

    const genderCell = read("gender");
    const gender = genderCell === "" ? null : (GENDERS[genderCell.toLowerCase()] ?? null);
    if (genderCell !== "" && gender === null) {
      problems.push({
        rowNumber,
        message: `"${genderCell}" is not a gender this app knows, so it was left blank.`,
      });
    }

    people.push({
      rowNumber,
      preferredName,
      fullName,
      firstName: names.firstName,
      lastName: names.lastName,
      birthDate,
      gender,
      phone: blankToNull(read("phone")),
      email: blankToNull(read("email")),
      address: blankToNull(read("address")),
      householdName,
      category: ageGroupOn(birthDate, asOf),
      silent: {
        classAssignment: blankToNull(read("classAssignment")),
        callings: blankToNull(read("callings")),
        callingsSustained: blankToNull(read("callingsSustained")),
        callingsSetApart: blankToNull(read("callingsSetApart")),
        ministeringBrothers: blankToNull(read("ministeringBrothers")),
        ministeringSisters: blankToNull(read("ministeringSisters")),
        hasMinisteringBrothers: readYesNo(read("hasMinisteringBrothers")),
        hasMinisteringSisters: readYesNo(read("hasMinisteringSisters")),
      },
      supplied,
    });
  }

  return { people, problems };
}
