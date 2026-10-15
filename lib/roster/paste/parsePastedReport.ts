// Pasted text → a header row and records. Pure and browser-safe: the paste box calls it to check
// the headers before posting, and the server calls it again from scratch.
//
// LCR's copy is NOT a CSV. Each header comes on its own line (separated by blank lines), the data
// rows are tab-separated, and a cell holding a line break — the callings cells do — splits its row
// across several lines with NO QUOTING. So a record is rebuilt by gathering lines until it holds
// exactly one tab fewer than there are headers. Verified on the user's real paste: 353 records,
// none left over.

export const MAX_PASTE_CHARACTERS = 1_000_000;
export const MAX_PASTE_ROWS = 2000;

export type ImportProblem = { rowNumber: number; message: string };

export type ParsedRecord = { rowNumber: number; cells: string[] };

export type ParsedReport = {
  headers: string[];
  rows: ParsedRecord[];
  problems: ImportProblem[];
  // A failure of the whole paste rather than of one row. Rows and headers are empty when set.
  error: string | null;
};

const NOTHING_RECOGNISABLE =
  "Nothing that looks like the ward list report was pasted. In LCR, select the whole table, " +
  "from the first header to the last row, copy it, and paste it again.";

function countTabs(text: string): number {
  let count = 0;
  for (const character of text) {
    if (character === "\t") count += 1;
  }
  return count;
}

// Only a paste that went through Google Sheets or Excel is quoted, and only around a cell that
// holds a line break or a quote. LCR's own copy has no quote characters at all.
function unquoteCell(cell: string): string {
  const isQuoted =
    cell.length >= 2 &&
    cell.startsWith('"') &&
    cell.endsWith('"') &&
    (cell.includes("\n") || cell.includes('""'));

  return isQuoted ? cell.slice(1, -1).replace(/""/g, '"') : cell;
}

function splitRecord(text: string): string[] {
  return text.split("\t").map((cell) => unquoteCell(cell.trim()).trim());
}

function failure(message: string): ParsedReport {
  return { headers: [], rows: [], problems: [], error: message };
}

function unreadableRow(rowNumber: number): ImportProblem {
  return {
    rowNumber,
    message: `This row could not be read. Copy the whole table from LCR again.`,
  };
}

function readHeaders(lines: readonly string[]): { headers: string[]; dataStart: number } {
  const firstContent = lines.findIndex((line) => line.trim() !== "");
  if (firstContent === -1) return { headers: [], dataStart: lines.length };

  if (lines[firstContent].includes("\t")) {
    return {
      headers: splitRecord(lines[firstContent]),
      dataStart: firstContent + 1,
    };
  }

  const headers: string[] = [];
  let index = firstContent;

  while (index < lines.length && !lines[index].includes("\t")) {
    const header = lines[index].trim();
    if (header !== "") headers.push(header);
    index += 1;
  }

  return { headers, dataStart: index };
}

export function parsePastedReport(text: string): ParsedReport {
  if (text.length > MAX_PASTE_CHARACTERS) {
    return failure(
      `That paste is longer than ${MAX_PASTE_CHARACTERS / 1_000_000} million characters, ` +
        "which is more than a ward list report should be. Check that only the report was copied.",
    );
  }

  const lines = text.replace(/^﻿/, "").replace(/\r/g, "").split("\n");
  const { headers, dataStart } = readHeaders(lines);

  // A single header with no tab anywhere is a paragraph of text, not a report.
  if (headers.length < 2) return failure(NOTHING_RECOGNISABLE);

  const expectedTabs = headers.length - 1;
  const rows: ParsedRecord[] = [];
  const problems: ImportProblem[] = [];
  let buffer: string | null = null;
  let recordNumber = 0;

  function startRecord(line: string): void {
    const tabs = countTabs(line);

    if (tabs === expectedTabs) {
      recordNumber += 1;
      rows.push({ rowNumber: recordNumber, cells: splitRecord(line) });
      buffer = null;
    } else if (tabs > expectedTabs) {
      recordNumber += 1;
      problems.push(unreadableRow(recordNumber));
      buffer = null;
    } else {
      buffer = line;
    }
  }

  for (let index = dataStart; index < lines.length; index += 1) {
    const line = lines[index];

    if (buffer === null) {
      if (line.trim() === "") continue;
      startRecord(line);
    } else {
      const joined: string = `${buffer}\n${line}`;
      const tabs = countTabs(joined);

      if (tabs === expectedTabs) {
        recordNumber += 1;
        rows.push({ rowNumber: recordNumber, cells: splitRecord(joined) });
        buffer = null;
      } else if (tabs > expectedTabs) {
        recordNumber += 1;
        problems.push(unreadableRow(recordNumber));
        startRecord(line);
      } else {
        buffer = joined;
      }
    }

    if (rows.length > MAX_PASTE_ROWS) {
      return failure(
        `That paste has more than ${MAX_PASTE_ROWS} rows, which is more than a ward list ` +
          "report should be. Check that only the report was copied.",
      );
    }
  }

  if (buffer !== null && (buffer as string).trim() !== "") {
    recordNumber += 1;
    problems.push(unreadableRow(recordNumber));
  }

  if (rows.length === 0 && problems.length === 0) return failure(NOTHING_RECOGNISABLE);

  return { headers, rows, problems, error: null };
}
