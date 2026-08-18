import { describe, expect, it } from "vitest";
import type { ColumnMapping } from "@/lib/roster/csv/columnMapping";
import { normalizeRows } from "@/lib/roster/csv/normalizeRow";
import { parseCsvText } from "@/lib/roster/csv/parseCsv";

// The contract this file exists to pin: normalizeRows NEVER throws. Every failure is a
// RowProblem carrying a row number the user can find in their spreadsheet. A malformed file
// must produce a list of problems, not a 500 that reads as the server's fault.

const MAPPING: ColumnMapping = {
  firstName: 0,
  lastName: 1,
  familyName: 2,
  address: 3,
  category: 4,
  gender: 5,
  phone: 6,
};

function row(...values: string[]): string[] {
  return values;
}

describe("normalizeRows", () => {
  it("reads a complete row", () => {
    const { rows, problems } = normalizeRows(
      [row("Mark", "Andersen", "Andersen", "12 Oak Street", "Adult", "M", "555-0101")],
      MAPPING,
    );

    expect(problems).toEqual([]);
    expect(rows[0]).toEqual({
      rowNumber: 2,
      firstName: "Mark",
      lastName: "Andersen",
      familyName: "Andersen",
      address: "12 Oak Street",
      category: "adult",
      gender: "male",
      phone: "555-0101",
    });
  });

  // The number the user sees in a spreadsheet, with the header as row 1. An off-by-one here is
  // invisible in a test written against the same helper, so it is asserted as a literal.
  it("numbers the first data row 2", () => {
    const { rows } = normalizeRows(
      [
        row("Mark", "Andersen", "Andersen"),
        row("Julia", "Andersen", "Andersen"),
        row("Ethan", "Andersen", "Andersen"),
      ],
      MAPPING,
    );

    expect(rows.map((entry) => entry.rowNumber)).toEqual([2, 3, 4]);
  });

  it("uses the parser's row numbers when they are supplied", () => {
    const parsed = parseCsvText(
      "First,Last,Household\nMark,Andersen,Andersen\n,,\nJulia,Andersen,Andersen\n",
    );

    const { rows } = normalizeRows(parsed.rows, MAPPING, parsed.rowNumbers);

    // The blank line was dropped, so the second member is on file row 4 — not row 3, which is
    // what an index calculation would have reported.
    expect(rows.map((entry) => entry.rowNumber)).toEqual([2, 4]);
  });

  describe("required fields", () => {
    it("excludes a row missing a first name and names the row", () => {
      const { rows, problems } = normalizeRows(
        [row("Mark", "Andersen", "Andersen"), row("", "Brooks", "Brooks")],
        MAPPING,
      );

      expect(rows).toHaveLength(1);
      expect(problems).toHaveLength(1);
      expect(problems[0].rowNumber).toBe(3);
      expect(problems[0].field).toBe("firstName");
      expect(problems[0].message).toMatch(/First name is missing/);
    });

    it("excludes a row missing a last name", () => {
      const { rows, problems } = normalizeRows([row("Mark", "  ", "Andersen")], MAPPING);

      expect(rows).toEqual([]);
      expect(problems[0].field).toBe("lastName");
    });

    it("excludes a row missing a family name", () => {
      const { rows, problems } = normalizeRows([row("Mark", "Andersen", "")], MAPPING);

      expect(rows).toEqual([]);
      expect(problems[0].field).toBe("familyName");
    });

    // Per-row, not all-or-nothing. A 40-row export with two bad rows is worth importing.
    it("still imports the good rows around a bad one", () => {
      const { rows } = normalizeRows(
        [
          row("Mark", "Andersen", "Andersen"),
          row("", "", ""),
          row("Julia", "Andersen", "Andersen"),
        ],
        MAPPING,
      );

      expect(rows.map((entry) => entry.firstName)).toEqual(["Mark", "Julia"]);
    });

    it("reports every missing required field on the same row", () => {
      const { problems } = normalizeRows([row("", "", "")], MAPPING);

      expect(problems.map((problem) => problem.field)).toEqual([
        "firstName",
        "lastName",
        "familyName",
      ]);
    });
  });

  describe("category", () => {
    it("accepts the three values case-insensitively", () => {
      const { rows } = normalizeRows(
        [
          row("A", "One", "One", "", "ADULT"),
          row("B", "Two", "Two", "", "youth"),
          row("C", "Three", "Three", "", "Child"),
        ],
        MAPPING,
      );

      expect(rows.map((entry) => entry.category)).toEqual(["adult", "youth", "child"]);
    });

    it("maps the LCR spellings", () => {
      const { rows, problems } = normalizeRows(
        [
          row("A", "One", "One", "", "Young Women"),
          row("B", "Two", "Two", "", "Young Men"),
          row("C", "Three", "Three", "", "Primary"),
        ],
        MAPPING,
      );

      expect(rows.map((entry) => entry.category)).toEqual(["youth", "youth", "child"]);
      expect(problems).toEqual([]);
    });

    // A missing category is recoverable from the member page. A dropped person is not
    // recoverable from anywhere, so the row still imports.
    it("reports an unrecognised category and imports the member without one", () => {
      const { rows, problems } = normalizeRows(
        [row("Ada", "Okafor", "Okafor", "", "Senior")],
        MAPPING,
      );

      expect(rows).toHaveLength(1);
      expect(rows[0].category).toBeNull();
      expect(problems).toHaveLength(1);
      expect(problems[0].field).toBe("category");
      expect(problems[0].message).toContain("Senior");
      expect(problems[0].message).toMatch(/adult, youth, or child/);
    });
  });

  describe("gender", () => {
    it("accepts the short and long forms in either case", () => {
      const { rows } = normalizeRows(
        [
          row("A", "One", "One", "", "", "m"),
          row("B", "Two", "Two", "", "", "Female"),
          row("C", "Three", "Three", "", "", "F"),
        ],
        MAPPING,
      );

      expect(rows.map((entry) => entry.gender)).toEqual(["male", "female", "female"]);
    });

    it("reports an unrecognised gender and imports the member without one", () => {
      const { rows, problems } = normalizeRows(
        [row("Sam", "Whitfield", "Whitfield", "", "", "unknown")],
        MAPPING,
      );

      expect(rows[0].gender).toBeNull();
      expect(problems[0].field).toBe("gender");
    });
  });

  describe("optional fields", () => {
    it("trims every value and turns an empty optional into null", () => {
      const { rows } = normalizeRows(
        [row("  Mark  ", " Andersen ", " Andersen ", "   ", "", "", "  ")],
        MAPPING,
      );

      expect(rows[0].firstName).toBe("Mark");
      expect(rows[0].familyName).toBe("Andersen");
      expect(rows[0].address).toBeNull();
      expect(rows[0].phone).toBeNull();
    });

    // The number is handed to the OS in an sms: link later. Reformatting is how you break a
    // number that already worked.
    it("keeps a phone number exactly as written", () => {
      const { rows } = normalizeRows(
        [
          row("A", "One", "One", "", "", "", "+1 (801) 555-0101"),
          row("B", "Two", "Two", "", "", "", "801.555.0102 x12"),
        ],
        MAPPING,
      );

      expect(rows.map((entry) => entry.phone)).toEqual([
        "+1 (801) 555-0101",
        "801.555.0102 x12",
      ]);
    });

    it("reads an unmapped field as null rather than reaching for a column", () => {
      const { rows } = normalizeRows(
        [row("Mark", "Andersen", "Andersen", "12 Oak Street")],
        { firstName: 0, lastName: 1, familyName: 2 },
      );

      expect(rows[0].address).toBeNull();
      expect(rows[0].phone).toBeNull();
    });

    it("reads a short row's missing columns as empty rather than failing", () => {
      const { rows, problems } = normalizeRows([row("Mark", "Andersen", "Andersen")], MAPPING);

      expect(problems).toEqual([]);
      expect(rows[0].phone).toBeNull();
    });
  });

  // The `csv-malformed` guarantee, exercised the only way it can be: at volume, with input
  // nobody designed. A single throw anywhere in here is a 500 in production.
  it("never throws on 200 rows of random garbage", () => {
    const alphabet = ' ,"\n\t\\αøΩ😀0123456789abcXYZ';
    let seed = 1;

    const random = (): number => {
      // A fixed-seed generator rather than Math.random, so a failure is reproducible.
      seed = (seed * 1103515245 + 12345) % 2147483648;
      return seed / 2147483648;
    };

    const garbage = Array.from({ length: 200 }, () =>
      Array.from({ length: Math.floor(random() * 12) }, () =>
        Array.from({ length: Math.floor(random() * 20) }, () =>
          alphabet[Math.floor(random() * alphabet.length)],
        ).join(""),
      ),
    );

    const run = () => normalizeRows(garbage, MAPPING);

    expect(run).not.toThrow();
    const { rows, problems } = run();
    expect(rows.length + new Set(problems.map((p) => p.rowNumber)).size).toBeGreaterThan(0);
  });

  it("never throws on the rows a malformed file actually parses to", () => {
    const parsed = parseCsvText(
      'First,Last,Household\n"unterminated,Andersen,Andersen\n,,\nonly-one-column\n',
    );

    expect(() => normalizeRows(parsed.rows, MAPPING, parsed.rowNumbers)).not.toThrow();
  });
});
