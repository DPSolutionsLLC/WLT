// Phase 5 test **chunking**.
//
// lib/knowledge/chunk.ts is pure — no imports, no I/O — so this suite needs no database, no
// network and no mock. That is the reason chunking was separated from everything that touches
// one: it is the easiest module in this plan to get subtly wrong and the cheapest to prove.

import { describe, expect, it } from "vitest";
import {
  CHARS_PER_TOKEN_ESTIMATE,
  TARGET_CHUNK_TOKENS,
  chunkByBoundaries,
  chunkText,
} from "@/lib/knowledge/chunk";

const TARGET_CHARS = TARGET_CHUNK_TOKENS * CHARS_PER_TOKEN_ESTIMATE;

function paragraph(word: string, characters: number): string {
  return `${word} `.repeat(Math.ceil(characters / (word.length + 1))).trim();
}

describe("chunkText", () => {
  it("returns exactly one chunk for a document shorter than the target", () => {
    const chunks = chunkText("A short talk about faith.\n\nIt has two paragraphs.");

    // Not zero, and not one plus an empty tail — both were real risks in the accumulator.
    expect(chunks).toHaveLength(1);
    expect(chunks[0].chunkIndex).toBe(0);
    expect(chunks[0].content).toContain("two paragraphs");
  });

  it("returns [] for empty or whitespace-only input", () => {
    // An empty chunk would be embedded and then match every query weakly, forever.
    expect(chunkText("")).toEqual([]);
    expect(chunkText("   \n\n  \t \n ")).toEqual([]);
  });

  it("overlaps — chunk n's tail appears at the head of chunk n+1", () => {
    const tail = "This final paragraph is the one that should be carried forward.";
    const text = [
      paragraph("alpha", TARGET_CHARS / 2),
      paragraph("beta", TARGET_CHARS / 2),
      tail,
      paragraph("gamma", TARGET_CHARS),
    ].join("\n\n");

    const chunks = chunkText(text);

    expect(chunks.length).toBeGreaterThan(1);

    const carried = chunks.some(
      (chunk, index) => index > 0 && chunk.content.startsWith(tail),
    );
    expect(carried).toBe(true);
  });

  it("never carries the entire previous chunk forward", () => {
    // Two paragraphs that each fit but together do not. Carrying everything would make chunk 2
    // a copy of chunk 1.
    const first = paragraph("alpha", TARGET_CHARS * 0.6);
    const second = paragraph("beta", TARGET_CHARS * 0.6);

    const chunks = chunkText(`${first}\n\n${second}`);

    expect(chunks).toHaveLength(2);
    expect(chunks[1].content).not.toBe(chunks[0].content);
  });

  it("prefers paragraph boundaries", () => {
    const chunks = chunkText(
      [
        paragraph("alpha", TARGET_CHARS * 0.7),
        paragraph("beta", TARGET_CHARS * 0.7),
      ].join("\n\n"),
    );

    // Each paragraph is whole in some chunk: nothing was cut mid-paragraph when a clean
    // boundary was available.
    expect(chunks.some((chunk) => chunk.content.includes(paragraph("alpha", TARGET_CHARS * 0.7)))).toBe(true);
    expect(chunks.some((chunk) => chunk.content.includes(paragraph("beta", TARGET_CHARS * 0.7)))).toBe(true);
  });

  it("splits a single over-long paragraph on sentence boundaries", () => {
    // One paragraph, no blank lines — a scripture chapter pasted as a wall of text. Without
    // sentence splitting this becomes one enormous chunk.
    const sentence = "Faith is not a perfect knowledge of things. ";
    const text = sentence.repeat(Math.ceil((TARGET_CHARS * 2.5) / sentence.length));

    const chunks = chunkText(text);

    expect(chunks.length).toBeGreaterThan(1);

    for (const chunk of chunks) {
      // Sentence-aligned: no chunk begins part-way through a word.
      expect(chunk.content.startsWith("Faith")).toBe(true);
    }
  });

  it("keeps every chunk at or near the target size", () => {
    const text = Array.from({ length: 12 }, (_, index) =>
      paragraph(`para${index}`, TARGET_CHARS * 0.4),
    ).join("\n\n");

    for (const chunk of chunkText(text)) {
      // Overshoot is harmless (chunk size affects granularity, not correctness) but it must be
      // bounded — the overlap carried in is what pushes a chunk past the raw target.
      expect(chunk.content.length).toBeLessThanOrEqual(TARGET_CHARS * 2);
    }
  });

  it("numbers chunks contiguously from zero with no gaps", () => {
    const text = Array.from({ length: 15 }, (_, index) =>
      paragraph(`para${index}`, TARGET_CHARS * 0.5),
    ).join("\n\n");

    const chunks = chunkText(text);

    expect(chunks.map((chunk) => chunk.chunkIndex)).toEqual(
      chunks.map((_, index) => index),
    );
  });

  it("collapses runs of blank lines rather than emitting empty chunks", () => {
    const chunks = chunkText("First paragraph.\n\n\n\n\n\nSecond paragraph.");

    expect(chunks).toHaveLength(1);
    expect(chunks[0].content).toBe("First paragraph.\n\nSecond paragraph.");
  });
});

describe("chunkByBoundaries", () => {
  it("never merges two labelled sections into one chunk", () => {
    // THE reason this entry point exists. A chunk spanning the end of Alma 32 and the start of
    // Alma 33 retrieves badly and cites worse.
    const chunks = chunkByBoundaries([
      { label: "Alma 32:21", text: "And now as I said concerning faith." },
      { label: "Alma 33:1", text: "Now after Alma had spoken these words." },
    ]);

    expect(chunks).toHaveLength(2);
    expect(chunks[0].content).not.toContain("Now after Alma");
    expect(chunks[1].content).not.toContain("concerning faith");
  });

  it("keeps each section's label on its chunk", () => {
    const chunks = chunkByBoundaries([
      { label: "Alma 32:21", text: "And now as I said concerning faith." },
    ]);

    expect(chunks[0].label).toBe("Alma 32:21");
  });

  it("subdivides an over-long section and carries the label onto every part", () => {
    const sentence = "Faith is not a perfect knowledge of things. ";
    const long = sentence.repeat(Math.ceil((TARGET_CHARS * 2) / sentence.length));

    const chunks = chunkByBoundaries([{ label: "Alma 32", text: long }]);

    expect(chunks.length).toBeGreaterThan(1);
    for (const chunk of chunks) {
      // A citation still points at something a reader can open.
      expect(chunk.label).toContain("Alma 32");
      expect(chunk.label).toContain("part");
    }
  });

  it("numbers chunks contiguously across sections", () => {
    const chunks = chunkByBoundaries([
      { label: "Alma 32", text: "First chapter text." },
      { label: "Alma 33", text: "Second chapter text." },
      { label: "Alma 34", text: "Third chapter text." },
    ]);

    expect(chunks.map((chunk) => chunk.chunkIndex)).toEqual([0, 1, 2]);
  });

  it("skips an empty section rather than emitting an empty chunk", () => {
    const chunks = chunkByBoundaries([
      { label: "Alma 32", text: "Real text." },
      { label: "Alma 33", text: "   " },
    ]);

    expect(chunks).toHaveLength(1);
    expect(chunks[0].label).toBe("Alma 32");
  });
});
