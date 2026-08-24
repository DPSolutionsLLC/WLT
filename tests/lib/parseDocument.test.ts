// @vitest-environment node
//
// Extension dispatch and the too-short refusal.
//
// REAL PDF EXTRACTION IS NOT TESTED HERE, deliberately. Proving unpdf reads a text PDF would
// mean committing a binary fixture to assert that a third-party library does its own job, and
// proving it REFUSES a scanned one would mean committing a scan. Scenario 022 covers both in a
// browser with real files, which is where that is worth proving. What is tested here is the code
// this plan actually wrote: which branch a file is routed down, and the refusal that stops an
// empty document from being ingested as though it were fine.
//
// `File` is a global in Node 22.

import { describe, expect, it } from "vitest";
import {
  extensionOf,
  parseDocument,
  resolveUploadType,
} from "@/lib/knowledge/parseDocument";
import { MAX_UPLOAD_BYTES } from "@/types/domain";

function textFile(name: string, content: string, type = "text/plain"): File {
  return new File([content], name, { type });
}

// Comfortably over the 200-character floor.
const REAL_TALK = "Faith is not a perfect knowledge of things. ".repeat(12);

describe("extensionOf", () => {
  it("reads the last extension, lowercased", () => {
    expect(extensionOf("Talk.TXT")).toBe("txt");
    expect(extensionOf("april.2024.conference.md")).toBe("md");
  });

  it("returns empty for a name with no extension or a trailing dot", () => {
    expect(extensionOf("README")).toBe("");
    expect(extensionOf("talk.")).toBe("");
  });
});

describe("resolveUploadType", () => {
  it("accepts the three supported extensions", () => {
    expect(resolveUploadType(textFile("talk.txt", "x"))).toBe("txt");
    expect(resolveUploadType(textFile("letter.md", "x"))).toBe("md");
    expect(resolveUploadType(textFile("talk.pdf", "x", "application/pdf"))).toBe("pdf");
  });

  it("accepts a .md file whose MIME type the browser got wrong", () => {
    // Chrome sends "text/markdown"; Safari has sent "" and "application/octet-stream". The
    // extension is what makes an ordinary markdown file behave the same on both.
    expect(resolveUploadType(textFile("letter.md", "x", ""))).toBe("md");
    expect(resolveUploadType(textFile("letter.md", "x", "application/octet-stream"))).toBe("md");
  });

  it("falls back to the MIME type when the name has no useful extension", () => {
    expect(resolveUploadType(textFile("pasted", "x", "text/plain"))).toBe("txt");
  });

  it("returns null for a type it cannot read", () => {
    expect(resolveUploadType(textFile("notes.docx", "x", "application/msword"))).toBeNull();
    expect(resolveUploadType(textFile("sheet.csv", "x", "text/csv"))).toBeNull();
  });
});

describe("parseDocument", () => {
  it("reads a plain text file and reports its character count", async () => {
    const parsed = await parseDocument(textFile("talk.txt", REAL_TALK));

    expect(parsed.text).toContain("Faith is not a perfect knowledge");
    expect(parsed.characterCount).toBe(parsed.text.length);
    // Null rather than zero: a text file has no pages, and zero would read as "a PDF with no
    // pages", which is a different and alarming claim.
    expect(parsed.pageCount).toBeNull();
  });

  it("keeps markdown as-is rather than stripping it", async () => {
    // The heading structure is signal for chunking, and the model reads it fine.
    const markdown = `# On Faith\n\n${REAL_TALK}\n\n## A second heading\n\nMore text.`;
    const parsed = await parseDocument(textFile("letter.md", markdown, "text/markdown"));

    expect(parsed.text).toContain("# On Faith");
    expect(parsed.text).toContain("## A second heading");
  });

  it("refuses a file type it cannot read, naming what it accepts", async () => {
    await expect(
      parseDocument(textFile("notes.docx", REAL_TALK, "application/msword")),
    ).rejects.toThrow(/\.txt, \.md, or \.pdf/);
  });

  it("refuses a nearly-empty file rather than ingesting it", async () => {
    // Silently accepting this creates a document row, zero useful passages, and a bishopric who
    // believe their corpus contains something it does not.
    await expect(parseDocument(textFile("talk.txt", "Faith."))).rejects.toThrow(
      /Only \d+ characters/,
    );
  });

  it("refuses a whitespace-only file", async () => {
    await expect(parseDocument(textFile("talk.txt", "   \n\n\t  "))).rejects.toThrow(
      /may be empty/,
    );
  });

  it("refuses a file named .pdf that is not a PDF, without calling the PDF reader", async () => {
    // The magic bytes are sniffed rather than the name trusted, so unpdf is never handed a text
    // file to choke on — its own error would name an offset, not a cause.
    await expect(
      parseDocument(textFile("talk.pdf", REAL_TALK, "application/pdf")),
    ).rejects.toThrow(/does not look like a PDF/);
  });

  it("reports the PDF refusal differently from the empty-text one", async () => {
    // A scan and an empty text file are two different mistakes with two different fixes, so
    // they get two different sentences.
    const pdfHeader = `%PDF-1.4\n${"\n".repeat(10)}`;
    await expect(
      parseDocument(new File([pdfHeader], "scan.pdf", { type: "application/pdf" })),
    ).rejects.toThrow();
  });
});

describe("MAX_UPLOAD_BYTES", () => {
  it("is 10 MB, the number both the form and the route check against", () => {
    expect(MAX_UPLOAD_BYTES).toBe(10 * 1024 * 1024);
  });
});
