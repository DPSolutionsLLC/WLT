// Bulk-load the standard works into one ward's knowledge base.
//
//   npm run knowledge:ingest -- --corpus ./corpus/standard-works.json --ward <uuid>
//
// WHY THIS IS A SCRIPT AND NOT A ROUTE: the standard works are tens of thousands of passages and
// hundreds of embedding batches. A serverless function times out an order of magnitude short of
// finishing (05-ai-platform.md, first pitfall). This has no timeout.
//
// THE CORPUS FILE IS YOURS AND IS GITIGNORED. Nothing copyrighted enters this repository.
// Expected shape — a flat array of verses:
//
//   [
//     { "volume": "book_of_mormon", "book": "Alma", "chapter": 32, "verse": 21, "text": "…" }
//   ]
//
// `volume` is a StandardWork value from types/domain.ts. Verses may arrive in any order; they
// are grouped and sorted here.
//
// It uses the SERVICE-ROLE client because it runs outside any session and writes on behalf of a
// ward whose bishopric is not signed in. Env comes through testing/infrastructure/envLoader.ts,
// which already solves loading .env.local from a plain node process.

import { readFile } from "node:fs/promises";
import { z } from "zod";
import { chunkByBoundaries, type LabelledSection } from "@/lib/knowledge/chunk";
import { ingestChunks } from "@/lib/knowledge/ingest";
import { createDocument, listDocuments } from "@/lib/knowledge/queries";
import { createServiceSupabaseClient } from "@/lib/supabase/service";
import { STANDARD_WORKS, STANDARD_WORK_LABELS, type StandardWork } from "@/types/domain";
import { loadEnvironment } from "@/testing/infrastructure/envLoader";

const verseSchema = z.object({
  volume: z.enum(STANDARD_WORKS),
  book: z.string().trim().min(1),
  chapter: z.number().int().positive(),
  verse: z.number().int().positive(),
  text: z.string().trim().min(1),
});

type Verse = z.infer<typeof verseSchema>;

type VolumeSummary = {
  volume: StandardWork;
  chunkCount: number;
  embeddedCount: number;
  failedCount: number;
};

function parseArguments(argv: readonly string[]): { corpus: string; ward: string } {
  const values = new Map<string, string>();

  for (let index = 0; index < argv.length; index += 1) {
    const flag = argv[index];
    if (flag === "--corpus" || flag === "--ward") {
      const value = argv[index + 1];
      if (!value || value.startsWith("--")) {
        throw new Error(`${flag} needs a value.`);
      }
      values.set(flag.slice(2), value);
      index += 1;
    }
  }

  const corpus = values.get("corpus");
  const ward = values.get("ward");

  if (!corpus || !ward) {
    throw new Error(
      "Usage: npm run knowledge:ingest -- --corpus ./corpus/standard-works.json --ward <uuid>",
    );
  }

  return { corpus, ward };
}

// FAILS ON THE FIRST MALFORMED RECORD AND NAMES ITS INDEX. Validating up front rather than
// lazily is the whole point: a bad record 30,000 rows in, discovered after twenty minutes of
// embedding, is the worst possible time to find out — the spend is gone and the corpus is half
// loaded.
async function readCorpus(path: string): Promise<Verse[]> {
  let raw: string;
  try {
    raw = await readFile(path, "utf8");
  } catch (error) {
    throw new Error(
      `Could not read the corpus file at ${path}. ${error instanceof Error ? error.message : ""}`.trim(),
    );
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (error) {
    throw new Error(
      `${path} is not valid JSON. ${error instanceof Error ? error.message : ""}`.trim(),
    );
  }

  if (!Array.isArray(parsed)) {
    throw new Error(`${path} must contain an ARRAY of verses, not a single object.`);
  }

  return parsed.map((record, index) => {
    const result = verseSchema.safeParse(record);
    if (!result.success) {
      const issue = result.error.issues[0];
      throw new Error(
        `Record ${index} in ${path} is not a valid verse: ${issue.path.join(".") || "(root)"} — ${issue.message}. ` +
          "Nothing was written and no embedding was spent.",
      );
    }
    return result.data;
  });
}

// Grouped into CHAPTERS, which is the boundary a citation points at and the boundary a reader
// can open. Verses are joined with a blank line so chunkText's paragraph splitting lands between
// verses when a chapter has to be subdivided — that is what keeps a chunk from splitting
// mid-verse, which is the entire reason this path exists instead of chunkText over one long
// string.
function toChapterSections(verses: readonly Verse[]): LabelledSection[] {
  const chapters = new Map<string, Verse[]>();

  for (const verse of verses) {
    const key = `${verse.book}|${verse.chapter}`;
    const existing = chapters.get(key);
    if (existing) {
      existing.push(verse);
    } else {
      chapters.set(key, [verse]);
    }
  }

  return [...chapters.values()]
    .map((chapterVerses) => {
      const sorted = [...chapterVerses].sort((left, right) => left.verse - right.verse);
      const first = sorted[0];
      return {
        label: `${first.book} ${first.chapter}:${sorted[0].verse}–${sorted[sorted.length - 1].verse}`,
        text: sorted.map((verse) => `${verse.verse} ${verse.text}`).join("\n\n"),
        book: first.book,
        chapter: first.chapter,
      };
    })
    .sort((left, right) =>
      left.book === right.book
        ? left.chapter - right.chapter
        : left.book.localeCompare(right.book),
    )
    .map(({ label, text }) => ({ label, text }));
}

async function main(): Promise<void> {
  loadEnvironment();

  const { corpus: corpusPath, ward: wardId } = parseArguments(process.argv.slice(2));

  console.log(`Reading ${corpusPath}…`);
  const verses = await readCorpus(corpusPath);
  console.log(`${verses.length} verses read and validated.`);

  const supabase = createServiceSupabaseClient();

  // IDEMPOTENCY BY REFUSAL, NOT BY UPSERT. Re-running must not double the corpus, and silently
  // replacing something somebody spent twenty minutes building is not a decision a script gets
  // to make. It names what is in the way and stops.
  const existing = await listDocuments(wardId, supabase);
  const byTitle = new Map(existing.map((document) => [document.title, document]));

  const byVolume = new Map<StandardWork, Verse[]>();
  for (const verse of verses) {
    const list = byVolume.get(verse.volume);
    if (list) {
      list.push(verse);
    } else {
      byVolume.set(verse.volume, [verse]);
    }
  }

  for (const volume of byVolume.keys()) {
    const title = STANDARD_WORK_LABELS[volume];
    const clash = byTitle.get(title);
    if (clash) {
      throw new Error(
        `"${title}" is already in this ward's knowledge base (${clash.chunkCount} passages, added ${clash.uploadedAt}). ` +
          "Delete it from /knowledge first if you mean to reload it. Nothing was written.",
      );
    }
  }

  const summaries: VolumeSummary[] = [];

  // Volumes in canonical order rather than whatever order the file happened to list them.
  const volumes = STANDARD_WORKS.filter((volume) => byVolume.has(volume));

  for (const volume of volumes) {
    const title = STANDARD_WORK_LABELS[volume];
    const sections = toChapterSections(byVolume.get(volume) ?? []);
    const chunks = chunkByBoundaries(sections);

    console.log(`\n${title} — ${sections.length} chapters, ${chunks.length} passages.`);

    const document = await createDocument(
      wardId,
      // file_url is null: there is no uploaded file, and uploaded_by is null because no user
      // did this. Both columns are nullable in migration 014 for exactly this path.
      { title, typeTag: "standard_works", fileUrl: null },
      null,
      supabase,
    );

    let lastReported = 0;
    const summary = await ingestChunks(
      wardId,
      document.id,
      chunks,
      supabase,
      (progress) => {
        // Progress PRINTS rather than going silent for twenty minutes. Throttled to every 500
        // so a 6,000-passage volume produces a dozen lines, not sixty.
        if (progress.phase !== "embedding") return;
        if (progress.done - lastReported < 500 && progress.done !== progress.total) return;
        lastReported = progress.done;
        console.log(`  ${title} — ${progress.done}/${progress.total} passages embedded`);
      },
    );

    summaries.push({
      volume,
      chunkCount: summary.chunkCount,
      embeddedCount: summary.embeddedCount,
      failedCount: summary.failedChunkIndexes.length,
    });
  }

  console.log("\nDone.\n");
  console.table(
    summaries.map((summary) => ({
      Volume: STANDARD_WORK_LABELS[summary.volume],
      Passages: summary.chunkCount,
      Embedded: summary.embeddedCount,
      Failed: summary.failedCount,
    })),
  );

  // EXIT NON-ZERO IF ANY VOLUME EMBEDDED NOTHING. A volume with zero embedded passages is
  // invisible to retrieval — the text is there, the search cannot reach it — and that must not
  // read as a successful run.
  const dead = summaries.filter((summary) => summary.embeddedCount === 0);
  if (dead.length > 0) {
    console.error(
      `\n${dead.map((summary) => STANDARD_WORK_LABELS[summary.volume]).join(", ")} embedded ZERO passages. ` +
        "The text was saved but nothing in those volumes is searchable. Check OPENAI_API_KEY and re-run after deleting them.",
    );
    process.exitCode = 1;
  }
}

main().catch((error: unknown) => {
  console.error(`\n${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
});
