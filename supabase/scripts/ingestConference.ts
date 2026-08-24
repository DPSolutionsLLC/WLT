// Load one general conference into a ward's knowledge base, WITH the metadata that makes each
// talk reachable by a filter.
//
//   npm run knowledge:ingest-conference -- --source ./corpus/2026-10/manifest.json --ward <uuid>
//   npm run knowledge:ingest-conference -- --source ./corpus/2026-10/manifest.json --ward <uuid> --conference 2026-10
//
// WHY THIS EXISTS AT ALL, given the upload form does the same thing one file at a time: a
// conference is roughly thirty-five talks, and thirty-five trips through UploadForm is where
// somebody starts leaving the speaker blank. A conference talk with no speaker, calling or date
// is invisible to every filter — and per migration 033 that means it is silently ALWAYS
// INCLUDED, however narrow the ward believes its scope to be. Filling the three columns is the
// entire reason this script exists rather than a note in the docs.
//
// ---------------------------------------------------------------------------------------------
// THIS SCRIPT INGESTS FILES ALREADY ON DISK. IT DOES NOT FETCH ANYTHING.
// ---------------------------------------------------------------------------------------------
// READ CLAUDE.md §9 BEFORE ADDING A FETCHING STEP. The decision recorded there is that
// acquisition is human-triggered, and that automated bulk downloading from
// churchofjesuschrist.org is governed by that site's terms of use and robots.txt — which must be
// read first, along with a check for a sanctioned bulk or export source. There is also to be no
// scheduled scraper: it would break silently when markup changed, it would break between
// conferences so the failure surfaces exactly when the corpus is needed, and a cron job writing
// thirty-five documents unattended is the one place CLAUDE.md rule 3 would not be holding.
//
// If a fetching step is ever added it goes behind an explicit confirm and is a SEPARATE TASK,
// not a flag on this one.
//
// ---------------------------------------------------------------------------------------------
// The manifest
// ---------------------------------------------------------------------------------------------
// A JSON file naming each talk's file, title, speaker and calling. Paths are resolved relative
// to the manifest's own directory, so the manifest can sit beside the talks it describes.
//
//   {
//     "conference": "October 2026",
//     "talks": [
//       {
//         "file": "nelson-peacemakers.txt",
//         "title": "Peacemakers Needed",
//         "speaker": "Russell M. Nelson",
//         "speakerRole": "prophet"
//       }
//     ]
//   }
//
// `conference` may be given per talk instead, or on the command line with --conference. A talk
// with no conference date resolvable from any of the three is a hard failure, because the whole
// point of this script is that the column is not null.
//
// THE CORPUS FILES ARE YOURS AND ARE GITIGNORED. Nothing copyrighted enters this repository.
//
// It uses the SERVICE-ROLE client because it runs outside any session and writes on behalf of a
// ward whose bishopric is not signed in. Env comes through testing/infrastructure/envLoader.ts,
// which already solves loading .env.local from a plain node process.

import { readFile } from "node:fs/promises";
import path from "node:path";
import { z } from "zod";
import { chunkText } from "@/lib/knowledge/chunk";
import {
  formatConferenceDate,
  parseConferenceDate,
} from "@/lib/knowledge/conferenceMetadata";
import { ingestChunks } from "@/lib/knowledge/ingest";
import { parseDocument } from "@/lib/knowledge/parseDocument";
import { createDocument, listDocuments } from "@/lib/knowledge/queries";
import { createServiceSupabaseClient } from "@/lib/supabase/service";
import { SPEAKER_ROLES } from "@/types/domain";
import { loadEnvironment } from "@/testing/infrastructure/envLoader";

const talkSchema = z.object({
  file: z.string().trim().min(1),
  title: z.string().trim().min(1).max(200),
  speaker: z.string().trim().min(1).max(80),
  // The SAME union types/domain.ts holds and migration 033's CHECK constraint permits. A
  // manifest naming a role the constraint would reject fails here, before any embedding is
  // spent, rather than as a database error thirty talks in.
  speakerRole: z.enum(SPEAKER_ROLES),
  conference: z.string().trim().min(1).optional(),
});

const manifestSchema = z.object({
  conference: z.string().trim().min(1).optional(),
  talks: z.array(talkSchema).min(1),
});

type Talk = z.infer<typeof talkSchema>;

type TalkSummary = {
  title: string;
  speaker: string;
  chunkCount: number;
  embeddedCount: number;
  failedCount: number;
};

function parseArguments(argv: readonly string[]): {
  source: string;
  ward: string;
  conference?: string;
} {
  const values = new Map<string, string>();

  for (let index = 0; index < argv.length; index += 1) {
    const flag = argv[index];
    if (flag === "--source" || flag === "--ward" || flag === "--conference") {
      const value = argv[index + 1];
      if (!value || value.startsWith("--")) {
        throw new Error(`${flag} needs a value.`);
      }
      values.set(flag.slice(2), value);
      index += 1;
    }
  }

  const source = values.get("source");
  const ward = values.get("ward");

  if (!source || !ward) {
    throw new Error(
      "Usage: npm run knowledge:ingest-conference -- --source ./corpus/2026-10/manifest.json --ward <uuid> [--conference 2026-10]",
    );
  }

  return { source, ward, conference: values.get("conference") };
}

// FAILS ON THE FIRST MALFORMED RECORD AND NAMES ITS INDEX, exactly as ingestStandardWorks.ts
// does. Validating up front rather than lazily is the whole point: a bad record thirty talks in,
// discovered after ten minutes of embedding, is the worst possible time to find out — the spend
// is gone and the conference is half loaded.
async function readManifest(manifestPath: string): Promise<z.infer<typeof manifestSchema>> {
  let raw: string;
  try {
    raw = await readFile(manifestPath, "utf8");
  } catch (error) {
    throw new Error(
      `Could not read the manifest at ${manifestPath}. ${error instanceof Error ? error.message : ""}`.trim(),
    );
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (error) {
    throw new Error(
      `${manifestPath} is not valid JSON. ${error instanceof Error ? error.message : ""}`.trim(),
    );
  }

  const result = manifestSchema.safeParse(parsed);
  if (!result.success) {
    const issue = result.error.issues[0];
    throw new Error(
      `${manifestPath} is not a valid conference manifest: ${issue.path.join(".") || "(root)"} — ${issue.message}. ` +
        "Nothing was written and no embedding was spent.",
    );
  }

  return result.data;
}

// Per-talk, then manifest-wide, then the command line. Resolved for EVERY talk before anything is
// ingested, so a manifest missing a conference date anywhere fails before the first embedding.
function resolveConferenceDates(
  manifest: z.infer<typeof manifestSchema>,
  fallback: string | undefined,
  manifestPath: string,
): string[] {
  return manifest.talks.map((talk, index) => {
    const source = talk.conference ?? manifest.conference ?? fallback;

    if (!source) {
      throw new Error(
        `Talk ${index} ("${talk.title}") in ${manifestPath} has no conference date, and neither the manifest nor --conference gives one. ` +
          "A talk with no date cannot be reached by any filter, which means it would be searched every time. Nothing was written.",
      );
    }

    const resolved = parseConferenceDate(source);
    if (resolved === null) {
      throw new Error(
        `Talk ${index} ("${talk.title}") in ${manifestPath} has a conference date of "${source}", which is not a month and year. ` +
          'Use something like "October 2026" or "2026-10". Nothing was written.',
      );
    }

    return resolved;
  });
}

// parseDocument needs a File, which is global in Node 22. Reading the bytes and wrapping them is
// what lets this script share the EXACT parse path the upload route uses — a second parser here
// would eventually disagree with the one the app runs, and the disagreement would show up as a
// document that ingested from the command line and refused through the form.
async function readTalkFile(directory: string, talk: Talk): Promise<File> {
  const filePath = path.resolve(directory, talk.file);

  let bytes: Buffer;
  try {
    bytes = await readFile(filePath);
  } catch (error) {
    throw new Error(
      `Could not read "${talk.file}" for "${talk.title}" (looked in ${filePath}). ${
        error instanceof Error ? error.message : ""
      }`.trim(),
    );
  }

  return new File([new Uint8Array(bytes)], path.basename(filePath));
}

async function main(): Promise<void> {
  loadEnvironment();

  const { source, ward: wardId, conference } = parseArguments(process.argv.slice(2));
  const manifestPath = path.resolve(source);
  const directory = path.dirname(manifestPath);

  console.log(`Reading ${manifestPath}…`);
  const manifest = await readManifest(manifestPath);
  const conferenceDates = resolveConferenceDates(manifest, conference, manifestPath);

  console.log(
    `${manifest.talks.length} talks read and validated, ${formatConferenceDate(conferenceDates[0])}.`,
  );

  const supabase = createServiceSupabaseClient();

  // IDEMPOTENCY BY REFUSAL, NOT BY UPSERT, matching ingestStandardWorks.ts. Re-running must not
  // double the corpus, and silently replacing something is not a decision a script gets to make.
  // It names what is in the way and stops.
  const existing = await listDocuments(wardId, supabase);
  const byTitle = new Map(existing.map((document) => [document.title, document]));

  for (const talk of manifest.talks) {
    const clash = byTitle.get(talk.title);
    if (clash) {
      throw new Error(
        `"${talk.title}" is already in this ward's knowledge base (${clash.chunkCount} passages, added ${clash.uploadedAt}). ` +
          "Delete it from /knowledge first if you mean to reload it. Nothing was written.",
      );
    }
  }

  // EVERY FILE IS READ AND PARSED BEFORE THE FIRST ONE IS EMBEDDED. A missing or scanned file
  // discovered at talk thirty means thirty talks of spend and a half-loaded conference — the
  // same reasoning that puts manifest validation up front, applied to the files themselves.
  console.log("Reading and parsing every talk before anything is written…");

  const parsedTalks = [];
  for (const [index, talk] of manifest.talks.entries()) {
    const file = await readTalkFile(directory, talk);

    try {
      const parsed = await parseDocument(file);
      parsedTalks.push({ talk, parsed, conferenceDate: conferenceDates[index] });
    } catch (error) {
      // parseDocument's messages are ALREADY written for a human — "its pages are almost
      // certainly images rather than text — a scan". Naming the talk and preserving that
      // sentence is more useful than replacing it.
      throw new Error(
        `Talk ${index} ("${talk.title}", ${talk.file}) could not be read. ${
          error instanceof Error ? error.message : String(error)
        } Nothing was written.`,
      );
    }
  }

  console.log(`All ${parsedTalks.length} talks parsed. Ingesting.\n`);

  const summaries: TalkSummary[] = [];

  for (const { talk, parsed, conferenceDate } of parsedTalks) {
    const chunks = chunkText(parsed.text);

    console.log(`${talk.title} — ${talk.speaker} — ${chunks.length} passages.`);

    const document = await createDocument(
      wardId,
      {
        title: talk.title,
        typeTag: "general_conference",
        // file_url is null: nothing was uploaded to storage, and uploaded_by is null because no
        // user did this. Both are nullable in migration 014 for exactly this path.
        fileUrl: null,
        // THE ENTIRE REASON THIS SCRIPT EXISTS. A conference ingested through the generic upload
        // path lands with three nulls and is invisible to every filter.
        speaker: talk.speaker,
        speakerRole: talk.speakerRole,
        conferenceDate,
      },
      null,
      supabase,
    );

    const summary = await ingestChunks(wardId, document.id, chunks, supabase);

    summaries.push({
      title: talk.title,
      speaker: talk.speaker,
      chunkCount: summary.chunkCount,
      embeddedCount: summary.embeddedCount,
      failedCount: summary.failedChunkIndexes.length,
    });
  }

  console.log("\nDone.\n");
  console.table(
    summaries.map((summary) => ({
      Talk: summary.title,
      Speaker: summary.speaker,
      Passages: summary.chunkCount,
      Embedded: summary.embeddedCount,
      Failed: summary.failedCount,
    })),
  );

  // EXIT NON-ZERO IF ANY TALK EMBEDDED NOTHING. A talk with zero embedded passages is invisible
  // to retrieval — the text is there, the search cannot reach it — and that must not read as a
  // successful run.
  const dead = summaries.filter((summary) => summary.embeddedCount === 0);
  if (dead.length > 0) {
    console.error(
      `\n${dead.map((summary) => `"${summary.title}"`).join(", ")} embedded ZERO passages. ` +
        "The text was saved but nothing in them is searchable. Check OPENAI_API_KEY and re-run after deleting them.",
    );
    process.exitCode = 1;
  }
}

main().catch((error: unknown) => {
  console.error(`\n${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
});
