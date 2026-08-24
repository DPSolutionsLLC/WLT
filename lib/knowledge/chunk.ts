export type Chunk = { content: string; chunkIndex: number };

export type LabelledSection = { label: string; text: string };
export type LabelledChunk = Chunk & { label: string };

export const TARGET_CHUNK_TOKENS = 500;
export const CHUNK_OVERLAP_TOKENS = 50;

// There is no tokenizer in this project and adding one is not worth a dependency. Four
// characters per token is the usual English approximation, and OVERSHOOT IS HARMLESS HERE:
// chunk size decides retrieval granularity, not correctness. A chunk 15% over target retrieves
// slightly more context than intended; nothing breaks.
//
// Named rather than inlined so nobody reads `2000` below as a character limit somebody chose.
export const CHARS_PER_TOKEN_ESTIMATE = 4;

// PURE. No imports, no I/O, no dates. This is the easiest module here to get subtly wrong and
// the cheapest to test, which is why it is separated from everything that touches a network.

function estimateCharacters(tokens: number): number {
  return tokens * CHARS_PER_TOKEN_ESTIMATE;
}

function normalise(text: string): string {
  return text
    .replace(/\r\n?/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function splitIntoParagraphs(text: string): string[] {
  return normalise(text)
    .split(/\n\s*\n/)
    .map((paragraph) => paragraph.trim())
    .filter((paragraph) => paragraph !== "");
}

// Sentence-ish. A period followed by whitespace and a capital or an opening quote. Deliberately
// conservative: over-splitting a scripture verse is worse than leaving two sentences together,
// and this only ever runs on a paragraph that is ALREADY over target.
function splitIntoSentences(paragraph: string): string[] {
  const sentences = paragraph
    .split(/(?<=[.!?])\s+(?=["'“‘(\[]?[A-Z0-9])/)
    .map((sentence) => sentence.trim())
    .filter((sentence) => sentence !== "");

  return sentences.length > 0 ? sentences : [paragraph];
}

// Last resort, reached only when a single sentence exceeds the target on its own — a wall of
// text with no punctuation. Splitting mid-word is ugly; leaving a 40,000-character "chunk" that
// blows the embedding request is worse.
function splitByCharacters(text: string, limit: number): string[] {
  const pieces: string[] = [];
  for (let start = 0; start < text.length; start += limit) {
    pieces.push(text.slice(start, start + limit));
  }
  return pieces;
}

// A paragraph over the target becomes several units on sentence boundaries; anything else is
// left whole. The result is the list of atoms the accumulator below packs into chunks.
function toPackableUnits(paragraphs: readonly string[], limit: number): string[] {
  const units: string[] = [];

  for (const paragraph of paragraphs) {
    if (paragraph.length <= limit) {
      units.push(paragraph);
      continue;
    }

    let pending = "";
    for (const sentence of splitIntoSentences(paragraph)) {
      if (sentence.length > limit) {
        if (pending !== "") {
          units.push(pending);
          pending = "";
        }
        units.push(...splitByCharacters(sentence, limit));
        continue;
      }

      const candidate = pending === "" ? sentence : `${pending} ${sentence}`;
      if (candidate.length > limit && pending !== "") {
        units.push(pending);
        pending = sentence;
      } else {
        pending = candidate;
      }
    }

    if (pending !== "") units.push(pending);
  }

  return units;
}

// The tail of the chunk just emitted, carried into the next one so a passage split across a
// boundary is still retrievable from either side. Whole units, taken from the end, until they
// sum to at least the overlap — or the last unit alone when one already exceeds it.
function overlapUnits(units: readonly string[], overlapChars: number): string[] {
  if (units.length === 0 || overlapChars <= 0) return [];

  const carried: string[] = [];
  let total = 0;

  for (let index = units.length - 1; index >= 0; index -= 1) {
    carried.unshift(units[index]);
    total += units[index].length;
    if (total >= overlapChars) break;
  }

  // Never carry the ENTIRE previous chunk: chunk n+1 would begin as a copy of chunk n, and a
  // document of two paragraphs would produce two near-identical chunks forever.
  if (carried.length === units.length && units.length > 1) carried.shift();

  return carried;
}

export function chunkText(
  text: string,
  options?: { targetTokens?: number; overlapTokens?: number },
): Chunk[] {
  const limit = estimateCharacters(options?.targetTokens ?? TARGET_CHUNK_TOKENS);
  const overlapChars = estimateCharacters(
    options?.overlapTokens ?? CHUNK_OVERLAP_TOKENS,
  );

  const paragraphs = splitIntoParagraphs(text);

  // Empty or whitespace-only input yields []. NOT [{ content: "" }] — an empty chunk gets an
  // embedding and then matches every query weakly, forever.
  if (paragraphs.length === 0) return [];

  const units = toPackableUnits(paragraphs, limit);
  const chunks: Chunk[] = [];

  let current: string[] = [];
  let currentLength = 0;

  const emit = () => {
    if (current.length === 0) return;
    chunks.push({ content: current.join("\n\n"), chunkIndex: chunks.length });
  };

  for (const unit of units) {
    const separator = current.length === 0 ? 0 : 2;

    if (current.length > 0 && currentLength + separator + unit.length > limit) {
      emit();
      current = overlapUnits(current, overlapChars);
      currentLength = current.reduce((sum, entry) => sum + entry.length + 2, 0);
    }

    current.push(unit);
    currentLength += unit.length + (current.length === 1 ? 0 : 2);
  }

  emit();

  return chunks;
}

// The scripture path. The caller supplies sections already split on boundaries that MEAN
// something — a chapter, a pericope — and each becomes its own chunk, subdivided by chunkText
// only when a section is genuinely too long.
//
// TWO SECTIONS ARE NEVER MERGED INTO ONE CHUNK. That is the whole reason this exists rather
// than concatenating everything and calling chunkText: a chunk that spans the end of Alma 32
// and the start of Alma 33 retrieves badly and cites worse.
//
// When a section is subdivided, every piece keeps the section's label plus a part number, so a
// citation still points at something a reader can open.
export function chunkByBoundaries(
  sections: readonly LabelledSection[],
  options?: { targetTokens?: number; overlapTokens?: number },
): LabelledChunk[] {
  const chunks: LabelledChunk[] = [];

  for (const section of sections) {
    const pieces = chunkText(section.text, options);
    if (pieces.length === 0) continue;

    for (const [index, piece] of pieces.entries()) {
      chunks.push({
        content: piece.content,
        chunkIndex: chunks.length,
        label:
          pieces.length === 1
            ? section.label
            : `${section.label} (part ${index + 1} of ${pieces.length})`,
      });
    }
  }

  return chunks;
}
