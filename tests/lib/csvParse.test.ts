import { describe, expect, it } from "vitest";
import {
  CsvLimitError,
  isCsvLimitError,
  parseCsvStream,
  parseCsvText,
} from "@/lib/roster/csv/parseCsv";

// The parser is hand-written and dependency-free (roster-c Decision 1), so its escape rules are
// this project's responsibility rather than a library's. That trade was accepted on the grounds
// that it is the easiest part of the import to test exhaustively — this file is that side of
// the bargain being paid.

function streamOf(bytes: Uint8Array, chunkSize = 8): ReadableStream<Uint8Array> {
  let offset = 0;

  return new ReadableStream<Uint8Array>({
    pull(controller) {
      if (offset >= bytes.length) {
        controller.close();
        return;
      }
      controller.enqueue(bytes.slice(offset, offset + chunkSize));
      offset += chunkSize;
    },
  });
}

function streamOfText(text: string, chunkSize = 8): ReadableStream<Uint8Array> {
  return streamOf(new TextEncoder().encode(text), chunkSize);
}

describe("parseCsvText", () => {
  it("reads headers and rows", () => {
    const parsed = parseCsvText("First,Last\nMark,Andersen\nJulia,Andersen\n");

    expect(parsed.headers).toEqual(["First", "Last"]);
    expect(parsed.rows).toEqual([
      ["Mark", "Andersen"],
      ["Julia", "Andersen"],
    ]);
    expect(parsed.rowCount).toBe(2);
    expect(parsed.problems).toEqual([]);
  });

  it("reads CRLF line endings identically to LF", () => {
    const crlf = parseCsvText("First,Last\r\nMark,Andersen\r\n");
    const lf = parseCsvText("First,Last\nMark,Andersen\n");

    expect(crlf.rows).toEqual(lf.rows);
    expect(crlf.headers).toEqual(lf.headers);
  });

  it("reads a file with no trailing newline", () => {
    const parsed = parseCsvText("First,Last\nMark,Andersen");

    expect(parsed.rows).toEqual([["Mark", "Andersen"]]);
  });

  it("keeps a comma inside a quoted field", () => {
    const parsed = parseCsvText('Name,Address\nAndersen,"12 Oak Street, Apt 4"\n');

    expect(parsed.rows).toEqual([["Andersen", "12 Oak Street, Apt 4"]]);
  });

  it("keeps a newline inside a quoted field", () => {
    const parsed = parseCsvText('Name,Address\nAndersen,"12 Oak Street\nApt 4"\n');

    expect(parsed.rows).toEqual([["Andersen", "12 Oak Street\nApt 4"]]);
    expect(parsed.rowCount).toBe(1);
  });

  it("reads a doubled quote inside a quoted field as one literal quote", () => {
    const parsed = parseCsvText('Name,Note\nAndersen,"They said ""hello"" twice"\n');

    expect(parsed.rows).toEqual([["Andersen", 'They said "hello" twice']]);
  });

  it("reads a quoted field at the start, middle and end of a row", () => {
    const parsed = parseCsvText('A,B,C\n"one","two, still two","three"\n');

    expect(parsed.rows).toEqual([["one", "two, still two", "three"]]);
  });

  it("strips a leading BOM from the first header only", () => {
    const parsed = parseCsvText("﻿First,Last\nMark,﻿Andersen\n");

    expect(parsed.headers).toEqual(["First", "Last"]);
    // A BOM anywhere else is content, and stripping it would quietly alter a value.
    expect(parsed.rows).toEqual([["Mark", "﻿Andersen"]]);
  });

  it("ignores trailing blank lines", () => {
    const parsed = parseCsvText("First,Last\nMark,Andersen\n\n\n");

    expect(parsed.rows).toEqual([["Mark", "Andersen"]]);
    expect(parsed.skippedBlankRowCount).toBe(2);
    expect(parsed.problems).toEqual([]);
  });

  it("skips a fully empty row without counting it as data", () => {
    const parsed = parseCsvText("First,Last\nMark,Andersen\n,\nJulia,Andersen\n");

    expect(parsed.rowCount).toBe(2);
    expect(parsed.skippedBlankRowCount).toBe(1);
  });

  // The reason rowNumbers exists at all. After a blank line is dropped, the index of a row in
  // `rows` no longer names the line the user sees in their spreadsheet.
  it("reports the file row number of each row, past a skipped blank line", () => {
    const parsed = parseCsvText("First,Last\nMark,Andersen\n,\nJulia,Andersen\n");

    expect(parsed.rowNumbers).toEqual([2, 4]);
  });

  it("pads a short row and keeps the extra columns of a long row", () => {
    const parsed = parseCsvText("A,B,C\nonly-one\none,two,three,four\n");

    expect(parsed.rows[0]).toEqual(["only-one", "", ""]);
    expect(parsed.rows[1]).toEqual(["one", "two", "three", "four"]);
    expect(parsed.problems).toEqual([]);
  });

  it("suffixes duplicate headers so the mapping UI can tell them apart", () => {
    const parsed = parseCsvText("Phone,Phone,Phone\n1,2,3\n");

    expect(parsed.headers).toEqual(["Phone", "Phone (2)", "Phone (3)"]);
  });

  it("reports a quoted value followed by stray text as a row problem, not a throw", () => {
    const parsed = parseCsvText('A,B\n"one"stray,two\n');

    expect(parsed.problems).toHaveLength(1);
    expect(parsed.problems[0].rowNumber).toBe(2);
    expect(parsed.problems[0].message).toMatch(/quoted value/i);
    // The row still comes through — one malformed cell must not cost the user the whole file.
    expect(parsed.rows).toHaveLength(1);
  });

  it("reports an unterminated quote as a row problem, not a throw", () => {
    const parsed = parseCsvText('A,B\none,"two\nthree,four\n');

    expect(parsed.problems).toHaveLength(1);
    expect(parsed.problems[0].message).toMatch(/no closing quote/i);
    expect(parsed.rowCount).toBe(1);
  });

  it("counts U+FFFD produced by decoding Windows-1252 as UTF-8", () => {
    // 0xF8 is "ø" in Windows-1252 and an invalid lead byte in UTF-8, so a non-fatal decoder
    // turns it into a replacement character rather than throwing — Decision 4's whole premise.
    const windows1252 = new Uint8Array([
      ...new TextEncoder().encode("Name\nS"),
      0xf8,
      ...new TextEncoder().encode("rensen\n"),
    ]);

    const decoded = new TextDecoder("utf-8").decode(windows1252);
    const parsed = parseCsvText(decoded);

    expect(parsed.replacementCharacterCount).toBe(1);
    expect(parsed.rows[0][0]).toContain("�");
  });

  it("counts no replacement characters for a well-formed UTF-8 file", () => {
    const parsed = parseCsvText("Name\nSørensen\n");

    expect(parsed.replacementCharacterCount).toBe(0);
    expect(parsed.rows).toEqual([["Sørensen"]]);
  });
});

describe("parseCsvStream", () => {
  it("produces the same result as the text parser across chunk boundaries", async () => {
    const text = 'A,B\n"one, still one","two\nstill two"\nthree,four\n';

    // A one-byte chunk size splits every multi-byte character and every quoted run, which is
    // exactly where a stateful assembler breaks if it is not actually stateful.
    const streamed = await parseCsvStream(streamOfText(text, 1));

    expect(streamed.rows).toEqual(parseCsvText(text).rows);
  });

  it("decodes a multi-byte character split across two chunks", async () => {
    const bytes = new TextEncoder().encode("Name\nSørensen\n");
    const parsed = await parseCsvStream(streamOf(bytes, 1));

    expect(parsed.rows).toEqual([["Sørensen"]]);
    expect(parsed.replacementCharacterCount).toBe(0);
  });

  it("reports every decoded chunk in order", async () => {
    const chunks: string[] = [];
    await parseCsvStream(streamOfText("A,B\none,two\n", 4), {
      onDecodedChunk: (text) => chunks.push(text),
    });

    expect(chunks.join("")).toBe("A,B\none,two\n");
  });

  // The assertion 02-roster.md asks for: "a malformed one claiming 2 million rows should be
  // rejected, not loaded". A parser that reads everything and checks afterwards has already
  // done the damage, and only the partial count can tell the two apart.
  it("throws the moment maxRows is passed, having parsed no more than the cap", async () => {
    const text = ["A", "1", "2", "3", "4", "5"].join("\n");

    const error = await parseCsvStream(streamOfText(text, 1), { maxRows: 2 }).catch(
      (thrown: unknown) => thrown,
    );

    expect(isCsvLimitError(error)).toBe(true);
    const limitError = error as CsvLimitError;
    expect(limitError.kind).toBe("rows");
    expect(limitError.limit).toBe(2);
    expect(limitError.rowsParsed).toBeLessThanOrEqual(2);
  });

  it("accepts a file with exactly maxRows rows", async () => {
    const parsed = await parseCsvStream(streamOfText("A\n1\n2\n"), { maxRows: 2 });

    expect(parsed.rowCount).toBe(2);
  });

  it("throws when maxBytes is passed", async () => {
    const error = await parseCsvStream(streamOfText("A\n1\n2\n3\n4\n5\n", 2), {
      maxBytes: 4,
    }).catch((thrown: unknown) => thrown);

    expect(isCsvLimitError(error)).toBe(true);
    expect((error as CsvLimitError).kind).toBe("bytes");
  });

  it("stops reading the stream once a cap is passed", async () => {
    let cancelled = false;

    const stream = new ReadableStream<Uint8Array>({
      pull(controller) {
        controller.enqueue(new TextEncoder().encode("row\n"));
      },
      cancel() {
        cancelled = true;
      },
    });

    await parseCsvStream(stream, { maxRows: 3 }).catch(() => undefined);

    expect(cancelled).toBe(true);
  });
});
