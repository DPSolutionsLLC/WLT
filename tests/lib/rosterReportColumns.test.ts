import { describe, expect, it } from "vitest";
import {
  REPORT_COLUMNS,
  columnsNotSupplied,
  describeMissingColumns,
  matchReportColumns,
  normalizeHeader,
} from "@/lib/roster/paste/reportColumns";
import { LCR_HEADERS } from "@/tests/fixtures/roster/lcr-paste-synthetic";

describe("matchReportColumns", () => {
  it("matches every LCR header to its key, including the dated Birth Date header", () => {
    const match = matchReportColumns(LCR_HEADERS);

    expect(match.missing).toEqual([]);
    expect(match.ignored).toEqual([]);
    expect(match.duplicates).toEqual([]);
    for (const column of REPORT_COLUMNS) {
      expect(match.columnIndex[column.key], column.key).toBeDefined();
    }
    expect(match.columnIndex.birthDate).toBe(LCR_HEADERS.indexOf("Birth Date (1 Jan 1990)"));
  });

  it("does not depend on the order of the columns", () => {
    const reversed = [...LCR_HEADERS].reverse();
    const match = matchReportColumns(reversed);

    expect(match.missing).toEqual([]);
    expect(match.columnIndex.preferredName).toBe(reversed.indexOf("Preferred Name"));
    expect(match.columnIndex.household).toBe(reversed.indexOf("Head of House and Spouse"));
  });

  it("keeps Callings apart from the dated callings columns", () => {
    const match = matchReportColumns(LCR_HEADERS);

    expect(match.columnIndex.callings).toBe(LCR_HEADERS.indexOf("Callings"));
    expect(match.columnIndex.callingsSustained).toBe(
      LCR_HEADERS.indexOf("Callings with Date Sustained"),
    );
    expect(match.columnIndex.callingsSetApart).toBe(
      LCR_HEADERS.indexOf("Callings with Date Sustained and Set Apart"),
    );
    expect(match.columnIndex.hasMinisteringSisters).not.toBe(match.columnIndex.ministeringSisters);
  });

  it("lists an unknown header as ignored", () => {
    const match = matchReportColumns([...LCR_HEADERS, "Priesthood Office"]);

    expect(match.ignored).toEqual(["Priesthood Office"]);
    expect(match.missing).toEqual([]);
  });

  it("names a missing required column and says how to add it in LCR", () => {
    const match = matchReportColumns(LCR_HEADERS.filter((header) => !header.startsWith("Birth")));

    expect(match.missing.map((column) => column.key)).toEqual(["birthDate"]);
    const [sentence] = describeMissingColumns(match.missing);
    expect(sentence).toContain('"Birth Date"');
    expect(sentence).toContain("In LCR");
  });

  it("detects a header that appears twice", () => {
    const match = matchReportColumns([...LCR_HEADERS, "Gender"]);

    expect(match.duplicates).toEqual(["Gender"]);
    expect(match.columnIndex.gender).toBe(LCR_HEADERS.indexOf("Gender"));
  });

  it("treats a missing optional column as not supplied, never as missing", () => {
    const match = matchReportColumns(LCR_HEADERS.filter((header) => header !== "Individual E-mail"));

    expect(match.missing).toEqual([]);
    expect(columnsNotSupplied(match.columnIndex)).toEqual(["Individual E-mail"]);
  });
});

describe("normalizeHeader", () => {
  it("drops parentheticals, case and punctuation", () => {
    expect(normalizeHeader("Birth Date (1 Jan 1990)")).toBe("birthdate");
    expect(normalizeHeader("Individual E-mail")).toBe("individualemail");
    expect(normalizeHeader("Address - Street 1")).toBe("addressstreet1");
  });
});
