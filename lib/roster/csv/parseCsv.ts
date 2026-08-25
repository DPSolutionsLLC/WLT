// A hand-written RFC 4180 parser, chosen over papaparse and csv-parse deliberately
// (roster-c-csv-import.md Decision 1): one well-understood file format from one source, escape
// rules that fit on a page, and no permanent addition to the bundle or the audit surface.
//
// This module imports nothing. It runs unchanged in a route handler and in the browser, which
// is what lets the wizard read the headers for its mapping step without a round trip.

export type CsvRowProblem = {
  rowNumber: number;
  message: string;
};

export type ParsedCsv = {
  headers: string[];
  rows: string[][];
  // Parallel to `rows`: the record number each row had in the FILE, with the header counted as
  // record 1. It is a separate array rather than an index calculation because blank records are
  // dropped, and after the first dropped one an index no longer names the row the user sees.
  rowNumbers: number[];
  rowCount: number;
  skippedBlankRowCount: number;
  replacementCharacterCount: number;
  problems: CsvRowProblem[];
};

export type ParseCsvOptions = {
  maxRows?: number;
  maxBytes?: number;
  // Called with each decoded chunk, in order. Exists so the file hash Decision 2 requires can be
  // computed in the same pass as the parse — the alternative is buffering the whole 5MB file a
  // second time purely to hash it.
  onDecodedChunk?: (text: string) => void;
};

export type CsvLimitKind = "rows" | "bytes";

// Thrown the moment a cap is passed, never after the whole file has been read. 02-roster.md is
// explicit that "a malformed one claiming 2 million rows should be rejected, not loaded" — a
// parser that reads everything and then checks the count has already done the damage.
export class CsvLimitError extends Error {
  readonly kind: CsvLimitKind;
  readonly limit: number;
  readonly rowsParsed: number;

  constructor(kind: CsvLimitKind, limit: number, rowsParsed: number) {
    super(
      kind === "rows"
        ? `This file has more than ${limit} rows.`
        : `This file is larger than ${limit} bytes.`,
    );
    this.name = "CsvLimitError";
    this.kind = kind;
    this.limit = limit;
    this.rowsParsed = rowsParsed;
  }
}

export function isCsvLimitError(error: unknown): error is CsvLimitError {
  return error instanceof CsvLimitError;
}

const BYTE_ORDER_MARK = "﻿";
const REPLACEMENT_CHARACTER = "�";

type State = "fieldStart" | "unquoted" | "quoted" | "quoteEnd";

// Duplicate headers are suffixed rather than deduplicated. An export carrying "Phone" twice is
// two different phone numbers, and the mapping UI has to be able to name which one the user
// picked.
function disambiguateHeaders(headers: readonly string[]): string[] {
  const seen = new Map<string, number>();

  return headers.map((header) => {
    const trimmed = header.trim();
    const count = (seen.get(trimmed) ?? 0) + 1;
    seen.set(trimmed, count);
    return count === 1 ? trimmed : `${trimmed} (${count})`;
  });
}

class CsvAssembler {
  private state: State = "fieldStart";
  private field = "";
  private row: string[] = [];
  private pendingRecord = false;
  private isFirstCharacter = true;
  private recordNumber = 0;

  private headers: string[] = [];
  private readonly rows: string[][] = [];
  private readonly rowNumbers: number[] = [];
  private readonly problems: CsvRowProblem[] = [];
  private skippedBlankRowCount = 0;
  private replacementCharacterCount = 0;
  private byteCount = 0;

  private readonly options: ParseCsvOptions;

  // Written out longhand rather than as a constructor parameter property. A parameter property is
  // one of the few TypeScript constructs that EMITS code rather than only removing types, so
  // Node's --experimental-strip-types refuses the whole file with
  // ERR_UNSUPPORTED_TYPESCRIPT_SYNTAX. supabase/scripts/hymns.ts runs under plain Node and reaches
  // this module through lib/music/hymnSource.ts, so the shorthand would make it unloadable — the
  // same class of constraint that makes lib/knowledge/queries.ts import its client dynamically.
  constructor(options: ParseCsvOptions = {}) {
    this.options = options;
  }

  countBytes(byteLength: number): void {
    this.byteCount += byteLength;

    const maxBytes = this.options.maxBytes;
    if (maxBytes !== undefined && this.byteCount > maxBytes) {
      throw new CsvLimitError("bytes", maxBytes, this.rows.length);
    }
  }

  push(text: string): void {
    for (const character of text) {
      if (character === REPLACEMENT_CHARACTER) {
        this.replacementCharacterCount += 1;
      }
      this.consume(character);
    }
  }

  private consume(character: string): void {
    // The BOM is stripped from the very first character of the file only. Strip it per field and
    // an address legitimately containing one would lose it; strip it per row and the second row
    // of a file that happens to start with one would be altered.
    if (this.isFirstCharacter) {
      this.isFirstCharacter = false;
      if (character === BYTE_ORDER_MARK) return;
    }

    // A carriage return outside a quoted field is discarded, which turns \r\n into \n without a
    // lookahead. Inside a quoted field it is content and falls through to the quoted branch.
    if (character === "\r" && this.state !== "quoted") return;

    this.pendingRecord = true;

    switch (this.state) {
      case "fieldStart":
        if (character === '"') {
          this.state = "quoted";
        } else if (character === ",") {
          this.endField();
        } else if (character === "\n") {
          this.endField();
          this.endRecord();
        } else {
          this.field += character;
          this.state = "unquoted";
        }
        return;

      case "unquoted":
        if (character === ",") {
          this.endField();
          this.state = "fieldStart";
        } else if (character === "\n") {
          this.endField();
          this.endRecord();
        } else {
          this.field += character;
        }
        return;

      case "quoted":
        if (character === '"') {
          this.state = "quoteEnd";
        } else {
          this.field += character;
        }
        return;

      case "quoteEnd":
        if (character === '"') {
          // "" inside a quoted field is a literal quote, and the field continues.
          this.field += '"';
          this.state = "quoted";
        } else if (character === ",") {
          this.endField();
          this.state = "fieldStart";
        } else if (character === "\n") {
          this.endField();
          this.endRecord();
        } else {
          // A quoted value followed by anything else is malformed. It is a row-level problem
          // rather than a throw: one bad row must not cost the user the other 1999.
          this.reportProblem(
            "A quoted value is followed by unexpected text. Everything after the quote was " +
              "read as part of the same column.",
          );
          this.field += character;
          this.state = "unquoted";
        }
        return;
    }
  }

  private reportProblem(message: string): void {
    const rowNumber = this.recordNumber + 1;

    // One problem per record. A row with a run of stray characters would otherwise produce one
    // entry per character and bury every other problem in the file.
    if (this.problems.some((problem) => problem.rowNumber === rowNumber)) return;

    this.problems.push({ rowNumber, message });
  }

  private endField(): void {
    this.row.push(this.field);
    this.field = "";
    this.state = "fieldStart";
  }

  private endRecord(): void {
    const row = this.row;
    this.row = [];
    this.pendingRecord = false;
    this.state = "fieldStart";
    this.recordNumber += 1;

    if (this.recordNumber === 1) {
      this.headers = disambiguateHeaders(row);
      return;
    }

    // LCR exports end with blank lines, and a blank line reported as "first name is missing" is
    // noise that hides the real problems. Counted rather than discarded silently, so the preview
    // can say how many rows the file actually carried.
    if (row.every((value) => value.trim() === "")) {
      this.skippedBlankRowCount += 1;
      return;
    }

    // Short rows are padded and long rows keep their extra columns. Neither is an exception:
    // a row missing only an optional trailing column is a perfectly good member, and
    // normalizeRows is where a row that is genuinely unusable gets reported.
    while (row.length < this.headers.length) row.push("");

    const maxRows = this.options.maxRows;
    if (maxRows !== undefined && this.rows.length >= maxRows) {
      throw new CsvLimitError("rows", maxRows, this.rows.length);
    }

    this.rows.push(row);
    this.rowNumbers.push(this.recordNumber);
  }

  finish(): ParsedCsv {
    if (this.state === "quoted") {
      this.reportProblem(
        "A quoted value has no closing quote. Everything after it was read as one column.",
      );
    }

    if (this.pendingRecord) {
      this.endField();
      this.endRecord();
    }

    return {
      headers: this.headers,
      rows: this.rows,
      rowNumbers: this.rowNumbers,
      rowCount: this.rows.length,
      skippedBlankRowCount: this.skippedBlankRowCount,
      replacementCharacterCount: this.replacementCharacterCount,
      problems: this.problems,
    };
  }
}

export function parseCsvText(text: string, options: ParseCsvOptions = {}): ParsedCsv {
  const assembler = new CsvAssembler(options);

  if (options.maxBytes !== undefined) {
    assembler.countBytes(new TextEncoder().encode(text).byteLength);
  }

  options.onDecodedChunk?.(text);
  assembler.push(text);

  return assembler.finish();
}

// Decoded non-fatally on purpose. A fatal decoder would throw on Windows-1252, and a throw here
// reads as "the file is broken" when the truthful answer is "the file is in the wrong encoding
// and here is how to fix it" — Decision 4. The U+FFFD count is what carries that answer up.
export async function parseCsvStream(
  stream: ReadableStream<Uint8Array>,
  options: ParseCsvOptions = {},
): Promise<ParsedCsv> {
  const assembler = new CsvAssembler(options);
  const decoder = new TextDecoder("utf-8");
  const reader = stream.getReader();

  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;

      assembler.countBytes(value.byteLength);

      const text = decoder.decode(value, { stream: true });
      options.onDecodedChunk?.(text);
      assembler.push(text);
    }

    const tail = decoder.decode();
    if (tail !== "") {
      options.onDecodedChunk?.(tail);
      assembler.push(tail);
    }

    return assembler.finish();
  } catch (error) {
    // Cancelling stops the upload from being read to the end after a cap is already blown, which
    // is the whole point of streaming this rather than buffering it.
    await reader.cancel().catch(() => undefined);
    throw error;
  } finally {
    reader.releaseLock();
  }
}
