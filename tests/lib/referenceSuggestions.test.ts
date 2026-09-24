import { describe, expect, it } from "vitest";
import {
  SNIPPET_LENGTH,
  toReferenceSuggestions,
  toSnippet,
  type SuggestionChunk,
  type SuggestionDocument,
} from "@/lib/references/suggestions";

// Scored passages → citations a person chooses between (p4-sacrament-c). Pure, no network.

const TALK: SuggestionDocument = {
  id: "doc-talk",
  title: "The Power of Covenants",
  typeTag: "general_conference",
  speaker: "Elder Example",
  conferenceDate: "2025-04-01",
};

const BOOK: SuggestionDocument = {
  id: "doc-bom",
  title: "Book of Mormon",
  typeTag: "standard_works",
  speaker: null,
  conferenceDate: null,
};

const LETTER: SuggestionDocument = {
  id: "doc-letter",
  title: "Ward Council Letter",
  typeTag: "other",
  speaker: null,
  conferenceDate: null,
};

function chunk(overrides: Partial<SuggestionChunk>): SuggestionChunk {
  return {
    documentId: TALK.id,
    sourceLabel: TALK.title,
    content: "Some passage text.",
    similarity: 0.4,
    ...overrides,
  };
}

describe("toReferenceSuggestions — conference talks", () => {
  it("makes ONE suggestion per talk, from its best chunk", () => {
    const suggestions = toReferenceSuggestions(
      [
        chunk({ similarity: 0.35, content: "weaker" }),
        chunk({ similarity: 0.44, content: "best" }),
        chunk({ similarity: 0.31, content: "weakest" }),
      ],
      [TALK],
    );

    expect(suggestions).toHaveLength(1);
    expect(suggestions[0]).toMatchObject({
      kind: "talk",
      citation: "The Power of Covenants — Elder Example, April 2025",
      documentId: TALK.id,
      snippet: "best",
      similarity: 0.44,
    });
  });

  it("omits a missing speaker without a dangling separator", () => {
    const [suggestion] = toReferenceSuggestions([chunk({})], [{ ...TALK, speaker: null }]);

    expect(suggestion.citation).toBe("The Power of Covenants — April 2025");
  });

  it("omits a missing date without a dangling comma", () => {
    const [suggestion] = toReferenceSuggestions([chunk({})], [{ ...TALK, conferenceDate: null }]);

    expect(suggestion.citation).toBe("The Power of Covenants — Elder Example");
  });

  it("reads the title alone with neither", () => {
    const [suggestion] = toReferenceSuggestions(
      [chunk({})],
      [{ ...TALK, speaker: null, conferenceDate: null }],
    );

    expect(suggestion.citation).toBe("The Power of Covenants");
  });
});

describe("toReferenceSuggestions — scripture", () => {
  it("cites the chunk's own label, without the book title or a part suffix", () => {
    const [suggestion] = toReferenceSuggestions(
      [
        chunk({
          documentId: BOOK.id,
          sourceLabel: "Book of Mormon — Alma 32:1–25 (part 2 of 3)",
        }),
      ],
      [BOOK],
    );

    expect(suggestion).toMatchObject({ kind: "scripture", citation: "Alma 32:1–25" });
  });

  it("collapses two parts of the same range into one suggestion", () => {
    const suggestions = toReferenceSuggestions(
      [
        chunk({
          documentId: BOOK.id,
          sourceLabel: "Book of Mormon — Alma 32:1–25 (part 1 of 3)",
          similarity: 0.33,
        }),
        chunk({
          documentId: BOOK.id,
          sourceLabel: "Book of Mormon — Alma 32:1–25 (part 2 of 3)",
          similarity: 0.41,
        }),
      ],
      [BOOK],
    );

    expect(suggestions).toHaveLength(1);
    expect(suggestions[0].similarity).toBe(0.41);
  });

  it("keeps two DIFFERENT ranges in one book apart", () => {
    const suggestions = toReferenceSuggestions(
      [
        chunk({ documentId: BOOK.id, sourceLabel: "Book of Mormon — Alma 32:1–25" }),
        chunk({ documentId: BOOK.id, sourceLabel: "Book of Mormon — Moroni 10:3–5" }),
      ],
      [BOOK],
    );

    expect(suggestions.map((suggestion) => suggestion.citation).sort()).toEqual([
      "Alma 32:1–25",
      "Moroni 10:3–5",
    ]);
  });

  it("falls back to the title when a chunk has no label", () => {
    const [suggestion] = toReferenceSuggestions(
      [chunk({ documentId: BOOK.id, sourceLabel: "Book of Mormon" })],
      [BOOK],
    );

    expect(suggestion.citation).toBe("Book of Mormon");
  });
});

describe("toReferenceSuggestions — everything else", () => {
  it("cites any other document by its title, as kind `other`", () => {
    const [suggestion] = toReferenceSuggestions(
      [chunk({ documentId: LETTER.id, sourceLabel: "Ward Council Letter — Section 2" })],
      [LETTER],
    );

    expect(suggestion).toMatchObject({ kind: "other", citation: "Ward Council Letter" });
  });

  it("treats an untagged document as `other`", () => {
    const [suggestion] = toReferenceSuggestions(
      [chunk({ documentId: LETTER.id })],
      [{ ...LETTER, typeTag: null }],
    );

    expect(suggestion.kind).toBe("other");
  });

  // Never guessed at: a citation nobody can trace is worse than one fewer result.
  it("drops a chunk whose document is missing", () => {
    expect(toReferenceSuggestions([chunk({ documentId: "doc-gone" })], [TALK])).toEqual([]);
  });

  it("sorts by similarity descending, whatever order it was given", () => {
    const suggestions = toReferenceSuggestions(
      [
        chunk({ documentId: LETTER.id, similarity: 0.32 }),
        chunk({ documentId: TALK.id, similarity: 0.45 }),
        chunk({ documentId: BOOK.id, sourceLabel: "Book of Mormon — Alma 32:21", similarity: 0.38 }),
      ],
      [LETTER, TALK, BOOK],
    );

    expect(suggestions.map((suggestion) => suggestion.similarity)).toEqual([0.45, 0.38, 0.32]);
  });
});

describe("toSnippet", () => {
  it("collapses whitespace", () => {
    expect(toSnippet("  faith\n\n  is   a\tprinciple  ")).toBe("faith is a principle");
  });

  it("leaves a short passage whole, with no ellipsis", () => {
    expect(toSnippet("Short.")).toBe("Short.");
  });

  it("cuts a long passage on a word boundary with an ellipsis", () => {
    const long = Array.from({ length: 80 }, (_, index) => `word${index}`).join(" ");
    const snippet = toSnippet(long);

    expect(snippet.length).toBeLessThanOrEqual(SNIPPET_LENGTH + 1);
    expect(snippet.endsWith("…")).toBe(true);

    const withoutEllipsis = snippet.slice(0, -1);
    expect(long.startsWith(withoutEllipsis)).toBe(true);
    expect(long.charAt(withoutEllipsis.length)).toBe(" ");
  });
});
