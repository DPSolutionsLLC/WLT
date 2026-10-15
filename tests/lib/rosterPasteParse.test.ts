import { describe, expect, it } from "vitest";
import {
  MAX_PASTE_CHARACTERS,
  MAX_PASTE_ROWS,
  parsePastedReport,
} from "@/lib/roster/paste/parsePastedReport";
import {
  LCR_HEADERS,
  SAMPLE_PEOPLE,
  buildPaste,
  toLcrRow,
} from "@/tests/fixtures/roster/lcr-paste-synthetic";

// LCR's copy is not a CSV: headers one per line, and a cell with a line break splits its row across
// several lines with no quoting. The record rebuild counts tabs, and these tests pin that.

describe("parsePastedReport", () => {
  it("recognises the LCR header block, one header per line", () => {
    const parsed = parsePastedReport(buildPaste(SAMPLE_PEOPLE.map(toLcrRow)));

    expect(parsed.error).toBeNull();
    expect(parsed.headers).toEqual([...LCR_HEADERS]);
  });

  it("rebuilds a row split across four lines by its multi-line callings cells into one record", () => {
    const paste = buildPaste([toLcrRow(SAMPLE_PEOPLE[0])]);
    expect(paste.split("\r\n").filter((line) => line.includes("\t"))).toHaveLength(4);

    const parsed = parsePastedReport(paste);

    expect(parsed.problems).toEqual([]);
    expect(parsed.rows).toHaveLength(1);
    expect(parsed.rows[0].cells).toHaveLength(17);
    expect(parsed.rows[0].cells[10]).toBe("Primary Teacher\nWard Activities Committee Member");
    expect(parsed.rows[0].cells[12]).toContain("\n");
    expect(parsed.rows[0].cells[16]).toBe("No");
  });

  it("numbers records from 1 in the order they appear", () => {
    const parsed = parsePastedReport(buildPaste(SAMPLE_PEOPLE.map(toLcrRow)));

    expect(parsed.rows.map((row) => row.rowNumber)).toEqual([1, 2, 3]);
    expect(parsed.rows.map((row) => row.cells[0])).toEqual([
      "Example, Ann",
      "Example, Bo",
      "Sample, Cy",
    ]);
  });

  it("accepts a spreadsheet copy whose first line is a tab-separated header row", () => {
    const text = `${LCR_HEADERS.join("\t")}\n${toLcrRow(SAMPLE_PEOPLE[1]).join("\t")}\n`;
    const parsed = parsePastedReport(text);

    expect(parsed.headers).toEqual([...LCR_HEADERS]);
    expect(parsed.rows).toHaveLength(1);
    expect(parsed.rows[0].cells[0]).toBe("Example, Bo");
  });

  it("unquotes a Google Sheets cell that holds a line break", () => {
    const cells = toLcrRow(SAMPLE_PEOPLE[0]);
    cells[10] = '"Primary Teacher\nWard Activities Committee Member"';
    cells[11] = '"Says ""hello"""';
    const text = `${LCR_HEADERS.join("\t")}\n${cells.join("\t")}\n`;

    const parsed = parsePastedReport(text);

    expect(parsed.rows[0].cells[10]).toBe("Primary Teacher\nWard Activities Committee Member");
    expect(parsed.rows[0].cells[11]).toBe('Says "hello"');
  });

  it("skips blank lines between records", () => {
    const rows = SAMPLE_PEOPLE.map((person) => toLcrRow(person).join("\t"));
    const text = buildPaste([]) + `${rows[1]}\r\n\r\n\r\n${rows[2]}\r\n\r\n`;

    const parsed = parsePastedReport(text);

    expect(parsed.problems).toEqual([]);
    expect(parsed.rows).toHaveLength(2);
  });

  it("reports an overlong record and resynchronises so the next record still reads", () => {
    const tooMany = [...toLcrRow(SAMPLE_PEOPLE[1]), "extra"].join("\t");
    const good = toLcrRow(SAMPLE_PEOPLE[2]).join("\t");
    const parsed = parsePastedReport(buildPaste([]) + `${tooMany}\r\n${good}\r\n`);

    expect(parsed.problems).toHaveLength(1);
    expect(parsed.problems[0].rowNumber).toBe(1);
    expect(parsed.rows).toHaveLength(1);
    expect(parsed.rows[0]).toMatchObject({ rowNumber: 2 });
    expect(parsed.rows[0].cells[0]).toBe("Sample, Cy");
  });

  it("reports a record cut short at the end of the paste", () => {
    const good = toLcrRow(SAMPLE_PEOPLE[1]).join("\t");
    const partial = toLcrRow(SAMPLE_PEOPLE[2]).slice(0, 6).join("\t");
    const parsed = parsePastedReport(buildPaste([]) + `${good}\r\n${partial}`);

    expect(parsed.rows).toHaveLength(1);
    expect(parsed.problems).toEqual([
      { rowNumber: 2, message: expect.stringContaining("could not be read") },
    ]);
  });

  it("refuses an empty paste or plain text as not the report", () => {
    for (const text of ["", "   \r\n  ", "Hello, this is just a sentence.", "one\ntwo\nthree"]) {
      const parsed = parsePastedReport(text);
      expect(parsed.error).toContain("Nothing that looks like the ward list report");
      expect(parsed.rows).toEqual([]);
    }
  });

  it("refuses a paste over the character cap with a sentence rather than a throw", () => {
    const parsed = parsePastedReport("x".repeat(MAX_PASTE_CHARACTERS + 1));

    expect(parsed.error).toContain("longer than");
  });

  it("refuses a paste over the row cap", () => {
    const row = toLcrRow({
      preferredName: "Row, A",
      fullName: "Row, A",
      birthDate: "1 Jan 1990",
      household: "Row, A",
    });
    const rows = Array.from({ length: MAX_PASTE_ROWS + 1 }, () => row);

    const parsed = parsePastedReport(buildPaste(rows));

    expect(parsed.error).toContain(`more than ${MAX_PASTE_ROWS} rows`);
  });

  it("strips a byte order mark and carriage returns", () => {
    const parsed = parsePastedReport(`﻿${buildPaste([toLcrRow(SAMPLE_PEOPLE[1])])}`);

    expect(parsed.headers[0]).toBe("Preferred Name");
    expect(parsed.rows[0].cells.every((cell) => !cell.includes("\r"))).toBe(true);
  });
});
