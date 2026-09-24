import { formatConferenceDate } from "@/lib/knowledge/conferenceMetadata";
import type { ReferenceKind } from "@/types/domain";

// ---------------------------------------------------------------------------
// SCORED PASSAGES → CITABLE SUGGESTIONS. PURE: no client, no clock, no next/headers.
// ---------------------------------------------------------------------------
// retrieveChunks() returns PASSAGES — several per document, labelled for a prompt. A person
// choosing references wants CITATIONS: one conference talk once, one scripture range once. This
// turns the first into the second and nothing else; the passage text is shown as a snippet so the
// reader can judge the match, and nothing here is generated (CLAUDE.md rule 3).
//
// tests/lib/referenceSuggestions.test.ts asserts every rule below.

export type SuggestionDocument = {
  id: string;
  title: string;
  typeTag: string | null;
  speaker: string | null;
  conferenceDate: string | null;
};

export type SuggestionChunk = {
  documentId: string;
  sourceLabel: string;
  content: string;
  similarity: number;
};

export type ReferenceSuggestion = {
  kind: ReferenceKind;
  citation: string;
  documentId: string;
  snippet: string;
  similarity: number;
};

export const SNIPPET_LENGTH = 160;

// lib/knowledge/chunk.ts appends this when one labelled section is split across chunks. A
// citation names the range, never the chunk.
const PART_SUFFIX = /\s*\(part \d+ of \d+\)\s*$/;

// A TALK IS A CITABLE UNIT: title, speaker, conference. Whichever of the last two is missing is
// dropped cleanly rather than leaving a dangling separator.
function conferenceCitation(document: SuggestionDocument): string {
  const attribution = [
    document.speaker?.trim() || null,
    document.conferenceDate ? formatConferenceDate(document.conferenceDate) : null,
  ].filter((part): part is string => part !== null && part !== "");

  return attribution.length === 0
    ? document.title
    : `${document.title} — ${attribution.join(", ")}`;
}

// A SCRIPTURE IS CITED BY ITS OWN LABEL. retrieveChunks() prefixes the label with the document
// title (`Book of Mormon — Alma 32:1–25`), which is right for a prompt and wrong for a citation.
function scriptureCitation(chunk: SuggestionChunk, document: SuggestionDocument): string {
  const prefix = `${document.title} — `;
  const label = chunk.sourceLabel.startsWith(prefix)
    ? chunk.sourceLabel.slice(prefix.length)
    : "";

  const cleaned = label.replace(PART_SUFFIX, "").trim();
  return cleaned === "" ? document.title : cleaned;
}

export function toSnippet(content: string): string {
  const collapsed = content.replace(/\s+/g, " ").trim();
  if (collapsed.length <= SNIPPET_LENGTH) return collapsed;

  const cut = collapsed.slice(0, SNIPPET_LENGTH);
  const lastSpace = cut.lastIndexOf(" ");
  const onWord = lastSpace > 0 ? cut.slice(0, lastSpace) : cut;

  return `${onWord.trimEnd()}…`;
}

function kindOf(typeTag: string | null): ReferenceKind {
  if (typeTag === "general_conference") return "talk";
  if (typeTag === "standard_works") return "scripture";
  return "other";
}

export function toReferenceSuggestions(
  chunks: readonly SuggestionChunk[],
  documents: readonly SuggestionDocument[],
): ReferenceSuggestion[] {
  const documentById = new Map(documents.map((document) => [document.id, document]));
  const best = new Map<string, ReferenceSuggestion>();

  for (const chunk of chunks) {
    // A passage whose document we could not read is DROPPED, never guessed at. A citation nobody
    // can trace is worse than one fewer result.
    const document = documentById.get(chunk.documentId);
    if (document === undefined) continue;

    const kind = kindOf(document.typeTag);
    const citation =
      kind === "scripture"
        ? scriptureCitation(chunk, document)
        : kind === "talk"
          ? conferenceCitation(document)
          : document.title;

    // Scripture dedupes per CITATION (two parts of one range collapse, two ranges in one book do
    // not); everything else per DOCUMENT.
    const key = kind === "scripture" ? `${document.id}:${citation}` : document.id;

    const existing = best.get(key);
    if (existing !== undefined && existing.similarity >= chunk.similarity) continue;

    best.set(key, {
      kind,
      citation,
      documentId: document.id,
      snippet: toSnippet(chunk.content),
      similarity: chunk.similarity,
    });
  }

  return [...best.values()].sort((left, right) => right.similarity - left.similarity);
}
