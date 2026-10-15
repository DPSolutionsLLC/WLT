import { describe, expect, it } from "vitest";
import {
  normalizeReportRows,
  parseLcrDate,
  splitPreferredName,
} from "@/lib/roster/paste/normalizeReportRow";
import { matchReportColumns } from "@/lib/roster/paste/reportColumns";
import {
  LCR_HEADERS,
  SAMPLE_PEOPLE,
  toLcrRow,
  type SyntheticPerson,
} from "@/tests/fixtures/roster/lcr-paste-synthetic";

const AS_OF = "2026-10-14";
const { columnIndex } = matchReportColumns(LCR_HEADERS);

function normalize(people: readonly SyntheticPerson[], index = columnIndex) {
  return normalizeReportRows(
    { rows: people.map((person, position) => ({ rowNumber: position + 1, cells: toLcrRow(person) })) },
    index,
    AS_OF,
  );
}

function person(overrides: Partial<SyntheticPerson>): SyntheticPerson {
  return { ...SAMPLE_PEOPLE[1], ...overrides };
}

describe("splitPreferredName", () => {
  it("splits at the FIRST comma, keeping a multi-word last name whole", () => {
    expect(splitPreferredName("Van De Voorde, Marsha")).toEqual({
      lastName: "Van De Voorde",
      firstName: "Marsha",
    });
  });

  it("keeps everything after the first comma as the first name", () => {
    expect(splitPreferredName("Furnival, Robert David Jr.")).toEqual({
      lastName: "Furnival",
      firstName: "Robert David Jr.",
    });
  });

  it("refuses a name with no comma or an empty side", () => {
    expect(splitPreferredName("Cher")).toBeNull();
    expect(splitPreferredName(", Ann")).toBeNull();
    expect(splitPreferredName("Example, ")).toBeNull();
  });
});

describe("parseLcrDate", () => {
  it("reads LCR's D Mon YYYY by hand into a date-only string", () => {
    expect(parseLcrDate("13 Jun 1986")).toBe("1986-06-13");
    expect(parseLcrDate("2 jan 1984")).toBe("1984-01-02");
  });

  it("refuses a date that does not exist, or another format", () => {
    expect(parseLcrDate("31 Feb 2000")).toBeNull();
    expect(parseLcrDate("1986-06-13")).toBeNull();
    expect(parseLcrDate("")).toBeNull();
  });
});

describe("normalizeReportRows", () => {
  it("builds a person from a full LCR row", () => {
    const { people, problems } = normalize([SAMPLE_PEOPLE[0]]);

    expect(problems).toEqual([]);
    expect(people[0]).toMatchObject({
      rowNumber: 1,
      firstName: "Ann",
      lastName: "Example",
      fullName: "Example, Ann Marie",
      birthDate: "1986-06-13",
      gender: "female",
      phone: "555-0101",
      email: "ann@example.com",
      address: "1 Test Lane",
      householdName: "Example, Bo & Ann",
      category: "adult",
    });
    expect(people[0].silent.callings).toBe("Primary Teacher\nWard Activities Committee Member");
  });

  it("excludes a row whose Preferred Name has no comma", () => {
    const { people, problems } = normalize([person({ preferredName: "Bo" })]);

    expect(people).toEqual([]);
    expect(problems[0].message).toContain('"Last, First"');
  });

  it("excludes a row with an impossible or blank birth date", () => {
    expect(normalize([person({ birthDate: "31 Feb 2000" })]).people).toEqual([]);

    const blank = normalize([person({ birthDate: "" })]);
    expect(blank.people).toEqual([]);
    expect(blank.problems[0].message).toContain("Birth Date is blank");
  });

  it("excludes a row with a blank full name or household", () => {
    expect(normalize([person({ fullName: "" })]).problems[0].message).toContain("Full Name");
    expect(normalize([person({ household: "" })]).problems[0].message).toContain(
      "Head of House and Spouse",
    );
  });

  it("reads M and F, and keeps a row with an unknown gender while reporting it", () => {
    expect(normalize([person({ gender: "M" })]).people[0].gender).toBe("male");
    expect(normalize([person({ gender: "F" })]).people[0].gender).toBe("female");

    const unknown = normalize([person({ gender: "X" })]);
    expect(unknown.people[0].gender).toBeNull();
    expect(unknown.problems).toHaveLength(1);
  });

  it("reads Yes, No and blank as true, false and null", () => {
    const [read] = normalize([
      person({ hasMinisteringBrothers: "Yes", hasMinisteringSisters: "No" }),
    ]).people;
    expect(read.silent.hasMinisteringBrothers).toBe(true);
    expect(read.silent.hasMinisteringSisters).toBe(false);

    const [blank] = normalize([person({ hasMinisteringBrothers: "" })]).people;
    expect(blank.silent.hasMinisteringBrothers).toBeNull();
  });

  it("turns a blank optional cell into null", () => {
    const [read] = normalize([person({ email: "", phone: "" })]).people;

    expect(read.email).toBeNull();
    expect(read.phone).toBeNull();
  });

  it("excludes the second of two rows with the same full name and birth date", () => {
    const { people, problems } = normalize([SAMPLE_PEOPLE[1], SAMPLE_PEOPLE[1]]);

    expect(people).toHaveLength(1);
    expect(problems).toEqual([{ rowNumber: 2, message: expect.stringContaining("listed twice") }]);
  });

  it("excludes a row with a cell longer than the column allows", () => {
    const { people, problems } = normalize([person({ fullName: "A, ".concat("b".repeat(250)) })]);

    expect(people).toEqual([]);
    expect(problems[0].message).toContain("longer than 200");
  });

  it("derives the category from the birth date on the import date", () => {
    expect(normalize([SAMPLE_PEOPLE[2]]).people[0].category).toBe("youth");
    expect(normalize([person({ birthDate: "1 Mar 2018" })]).people[0].category).toBe("child");
  });

  it("records which optional columns the paste supplied", () => {
    const withoutEmail = matchReportColumns(
      LCR_HEADERS.filter((header) => header !== "Individual E-mail"),
    );
    const rows = [
      {
        rowNumber: 1,
        cells: toLcrRow(SAMPLE_PEOPLE[1]).filter((_, index) => LCR_HEADERS[index] !== "Individual E-mail"),
      },
    ];
    const { people } = normalizeReportRows({ rows }, withoutEmail.columnIndex, AS_OF);

    expect(people[0].supplied.has("phone")).toBe(true);
    expect(people[0].supplied.has("email")).toBe(false);
    expect(people[0].email).toBeNull();
  });
});
