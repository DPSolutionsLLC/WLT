import type { MemberCategory, MemberGender } from "@/types/domain";
import type { ColumnMapping, ImportField } from "@/lib/roster/csv/columnMapping";
import { FIELD_LABELS } from "@/lib/roster/csv/columnMapping";
import type { CsvRowProblem } from "@/lib/roster/csv/parseCsv";

// Structurally compatible with CsvRowProblem, so the parser's problems and this module's can be
// concatenated into one list without a translation step.
export type RowProblem = CsvRowProblem & { field?: ImportField };

export type NormalizedRow = {
  rowNumber: number;
  familyName: string;
  address: string | null;
  firstName: string;
  lastName: string;
  category: MemberCategory | null;
  gender: MemberGender | null;
  phone: string | null;
};

// LCR spells these several ways and none of them are the database's three values. An
// unrecognised value is never guessed at — it becomes a problem and a null category.
const CATEGORY_ALIASES: Record<string, MemberCategory> = {
  adult: "adult",
  adults: "adult",
  eldersquorum: "adult",
  reliefsociety: "adult",
  youth: "youth",
  youngmen: "youth",
  youngwomen: "youth",
  youngman: "youth",
  youngwoman: "youth",
  ym: "youth",
  yw: "youth",
  child: "child",
  children: "child",
  primary: "child",
};

const GENDER_ALIASES: Record<string, MemberGender> = {
  m: "male",
  male: "male",
  man: "male",
  f: "female",
  female: "female",
  woman: "female",
};

function normalizeLookupValue(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]/g, "");
}

function readCell(row: readonly string[], index: number | undefined): string {
  if (index === undefined) return "";
  return (row[index] ?? "").trim();
}

function emptyToNull(value: string): string | null {
  return value === "" ? null : value;
}

// The line number as a spreadsheet shows it, with the header counted as row 1 — so the first
// data row is 2. `rowNumbers` comes from the parser and is exact even after a blank line has
// been dropped; the +2 fallback is for callers that build rows by hand, such as the tests.
// A number the user cannot find in their file is worse than no number at all.
function resolveRowNumber(index: number, rowNumbers?: readonly number[]): number {
  return rowNumbers?.[index] ?? index + 2;
}

export function normalizeRows(
  rows: readonly (readonly string[])[],
  mapping: ColumnMapping,
  rowNumbers?: readonly number[],
): { rows: NormalizedRow[]; problems: RowProblem[] } {
  const normalized: NormalizedRow[] = [];
  const problems: RowProblem[] = [];

  rows.forEach((row, index) => {
    const rowNumber = resolveRowNumber(index, rowNumbers);

    // Never throws, by contract. Every failure below is a RowProblem, and this catch is the
    // backstop for the ones nobody anticipated — a file of random bytes must produce a list of
    // problems, not a 500 that reads as the server's fault.
    try {
      const firstName = readCell(row, mapping.firstName);
      const lastName = readCell(row, mapping.lastName);
      const familyName = readCell(row, mapping.familyName);

      const missing: ImportField[] = [];
      if (firstName === "") missing.push("firstName");
      if (lastName === "") missing.push("lastName");
      if (familyName === "") missing.push("familyName");

      // Excluded, not guessed at — and only this row. The rest of the file still imports, which
      // is what makes a 40-row export with two bad rows worth importing at all.
      if (missing.length > 0) {
        for (const field of missing) {
          problems.push({
            rowNumber,
            field,
            message: `${FIELD_LABELS[field]} is missing, so this row was not imported.`,
          });
        }
        return;
      }

      const categoryCell = readCell(row, mapping.category);
      let category: MemberCategory | null = null;

      if (categoryCell !== "") {
        const resolved = CATEGORY_ALIASES[normalizeLookupValue(categoryCell)];
        if (resolved) {
          category = resolved;
        } else {
          // The member still imports. A missing category is recoverable from the member page;
          // a dropped person is not recoverable from anywhere.
          problems.push({
            rowNumber,
            field: "category",
            message: `"${categoryCell}" is not a category this app knows. Use adult, youth, or child. This member was imported without one.`,
          });
        }
      }

      const genderCell = readCell(row, mapping.gender);
      let gender: MemberGender | null = null;

      if (genderCell !== "") {
        const resolved = GENDER_ALIASES[normalizeLookupValue(genderCell)];
        if (resolved) {
          gender = resolved;
        } else {
          problems.push({
            rowNumber,
            field: "gender",
            message: `"${genderCell}" is not a gender this app knows. Use male or female. This member was imported without one.`,
          });
        }
      }

      normalized.push({
        rowNumber,
        familyName,
        address: emptyToNull(readCell(row, mapping.address)),
        firstName,
        lastName,
        category,
        gender,
        // Kept exactly as written. The number is handed to the OS in an sms: link later, and
        // reformatting is how you break a number that already worked.
        phone: emptyToNull(readCell(row, mapping.phone)),
      });
    } catch (error) {
      console.error(
        `Could not read row ${rowNumber} of the import — ${
          error instanceof Error ? `${error.name}: ${error.message}` : String(error)
        }`,
      );

      problems.push({
        rowNumber,
        message: "This row could not be read and was not imported.",
      });
    }
  });

  return { rows: normalized, problems };
}
