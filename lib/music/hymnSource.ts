import { parseCsvText, type CsvRowProblem } from "@/lib/roster/csv/parseCsv";

// The rules for a partially-seeded hymnbook, and the parser that replaces it with a real one.
//
// PURE. It imports parseCsvText, which itself imports nothing, and nothing else — no client, no
// next/headers, no Supabase. That is what lets supabase/scripts/hymns.ts run it under plain Node
// and lets a client component call isPlaceholderTitle() without a round trip
// (plans/retros/roster-b-picker-and-orgs.md).

export const HYMN_SOURCES = ["authoritative", "placeholder"] as const;
export type HymnSource = (typeof HYMN_SOURCES)[number];

// The standard hymnbook. Used for GENERATING placeholders, not for validating an import — see
// MAX_IMPORT_HYMN_NUMBER below.
export const HYMNBOOK_SIZE = 341;

const PLACEHOLDER_PREFIX = "[Placeholder] Hymn ";

// DELIBERATELY UGLY, and that is the safety property rather than an oversight.
//
// A placeholder exists so the app has 341 searchable numbers to be built and tested against
// while the real hymnbook is unavailable. If one ever reaches a printed programme, the
// congregation must be able to see that at a glance — which a plausible-looking invented title
// would not allow. This codebase prefers safe-by-construction over safe-by-a-flag-somebody-
// notices, the same instinct as program-c omitting fields from PublicProgram rather than nulling
// them (lib/program/publicProjection.ts).
//
// Do not "improve" these into something that reads like a hymn.
export function placeholderTitle(hymnNumber: number): string {
  return `${PLACEHOLDER_PREFIX}${hymnNumber}`;
}

// Matches on the TITLE rather than on the source column, because the two callers that need it
// cannot see the column: the import parser refusing a placeholder title in an uploaded file, and
// a stored program draft, which snapshots the hymn title and not a hymn id
// (lib/program/draft.ts).
export function isPlaceholderTitle(title: string): boolean {
  return title.trimStart().startsWith(PLACEHOLDER_PREFIX);
}

export type PlaceholderHymnRow = {
  number: number;
  title: string;
  topicTags: string[];
  source: HymnSource;
};

// Takes the numbers already present rather than querying for them, so it stays pure and testable
// and so it can NEVER overwrite a verified row: a number that exists is simply not in the output.
// Running it twice is harmless.
//
// NO TOPIC TAGS. A synthetic tag would make topic search LOOK populated while returning
// meaningless results, which is worse for testing than an honestly empty result — a coordinator
// testing "sacrament" would get two hundred hits and learn nothing about whether search works.
export function buildPlaceholderRows(
  existingNumbers: Iterable<number>,
): PlaceholderHymnRow[] {
  const taken = new Set(existingNumbers);
  const rows: PlaceholderHymnRow[] = [];

  for (let hymnNumber = 1; hymnNumber <= HYMNBOOK_SIZE; hymnNumber += 1) {
    if (taken.has(hymnNumber)) continue;
    rows.push({
      number: hymnNumber,
      title: placeholderTitle(hymnNumber),
      topicTags: [],
      source: "placeholder",
    });
  }

  return rows;
}

// ---------------------------------------------------------------------------------------------
// Importing a real hymnbook
// ---------------------------------------------------------------------------------------------

export type HymnImportRow = {
  number: number;
  title: string;
  topicTags: string[];
};

export type HymnImportProblem = CsvRowProblem;

export type HymnImportResult = {
  rows: HymnImportRow[];
  problems: HymnImportProblem[];
};

// NOT bounded by HYMNBOOK_SIZE. A future hymnbook may renumber or extend, and a constant in this
// file is the wrong place for that to be decided — refusing hymn 342 would mean a code change
// before a ward could load a book it is holding in its hands. The bound that IS enforced catches
// a typo (a cell holding a year, a copy-paste of a page count) rather than a legitimate number.
export const MAX_IMPORT_HYMN_NUMBER = 999;

const TITLE_MAX_LENGTH = 200;

// Header names an export might plausibly use, lowercased and stripped of spaces and underscores.
const NUMBER_HEADERS = ["number", "no", "num", "hymnnumber", "hymnno"];
const TITLE_HEADERS = ["title", "name", "hymntitle", "hymn"];
const TAG_HEADERS = ["topictags", "tags", "topics", "topic"];

function normalizeHeader(header: string): string {
  return header.toLowerCase().replace(/[\s_-]/g, "");
}

function findColumn(headers: readonly string[], candidates: readonly string[]): number {
  return headers.findIndex((header) => candidates.includes(normalizeHeader(header)));
}

// Tags separate on a semicolon as well as a comma. A comma inside a quoted CSV field survives
// parsing intact, so one cell reading "sacrament,atonement" is a single field holding two tags;
// splitting on both means neither convention has to be guessed at.
function splitTags(value: string): string[] {
  return value
    .split(/[;,]/)
    .map((tag) => tag.trim().toLowerCase().replace(/\s+/g, "_"))
    .filter((tag) => tag !== "");
}

type CandidateRow = {
  rowNumber: number;
  number: unknown;
  title: unknown;
  topicTags: unknown;
};

// One validator for both formats, so a JSON file and a CSV file cannot be judged by different
// rules and report different problems for the same data.
function validateRows(
  candidates: readonly CandidateRow[],
  problems: HymnImportProblem[],
): HymnImportRow[] {
  const rows: HymnImportRow[] = [];
  const seenNumbers = new Map<number, number>();

  for (const candidate of candidates) {
    const hymnNumber =
      typeof candidate.number === "string"
        ? Number.parseInt(candidate.number.trim(), 10)
        : candidate.number;

    if (typeof hymnNumber !== "number" || !Number.isInteger(hymnNumber)) {
      problems.push({
        rowNumber: candidate.rowNumber,
        message: "The hymn number is missing or is not a whole number.",
      });
      continue;
    }

    if (hymnNumber < 1 || hymnNumber > MAX_IMPORT_HYMN_NUMBER) {
      problems.push({
        rowNumber: candidate.rowNumber,
        message: `Hymn number ${hymnNumber} is outside 1 to ${MAX_IMPORT_HYMN_NUMBER}.`,
      });
      continue;
    }

    const title = typeof candidate.title === "string" ? candidate.title.trim() : "";

    if (title === "") {
      problems.push({
        rowNumber: candidate.rowNumber,
        message: `Hymn ${hymnNumber} has no title.`,
      });
      continue;
    }

    if (title.length > TITLE_MAX_LENGTH) {
      problems.push({
        rowNumber: candidate.rowNumber,
        message: `Hymn ${hymnNumber} has a title longer than ${TITLE_MAX_LENGTH} characters.`,
      });
      continue;
    }

    // A placeholder title in an import file would be written back under the `authoritative`
    // label — an unverifiable title wearing the badge that means "safe to print", which is the
    // exact confusion migration 042's column exists to prevent. Almost always this means
    // somebody exported the table they are trying to replace.
    if (isPlaceholderTitle(title)) {
      problems.push({
        rowNumber: candidate.rowNumber,
        message:
          `Hymn ${hymnNumber} is titled "${title}", which is a placeholder this app wrote. ` +
          "Import a real hymnbook, not an export of this table.",
      });
      continue;
    }

    const firstSeenAt = seenNumbers.get(hymnNumber);
    if (firstSeenAt !== undefined) {
      problems.push({
        rowNumber: candidate.rowNumber,
        message: `Hymn ${hymnNumber} appears more than once in this file — also on row ${firstSeenAt}.`,
      });
      continue;
    }

    const tags = Array.isArray(candidate.topicTags)
      ? candidate.topicTags
          .filter((tag): tag is string => typeof tag === "string")
          .flatMap(splitTags)
      : typeof candidate.topicTags === "string"
        ? splitTags(candidate.topicTags)
        : [];

    seenNumbers.set(hymnNumber, candidate.rowNumber);
    rows.push({ number: hymnNumber, title, topicTags: [...new Set(tags)] });
  }

  return rows;
}

function parseJsonImport(text: string, problems: HymnImportProblem[]): CandidateRow[] {
  let parsed: unknown;

  try {
    parsed = JSON.parse(text);
  } catch (error) {
    problems.push({
      rowNumber: 0,
      message: `This file starts like JSON but could not be read as JSON. ${
        error instanceof Error ? error.message : ""
      }`.trim(),
    });
    return [];
  }

  if (!Array.isArray(parsed)) {
    problems.push({
      rowNumber: 0,
      message: "A JSON hymnbook must be an ARRAY of hymns, not a single object.",
    });
    return [];
  }

  return parsed.map((entry, index) => {
    const record =
      entry !== null && typeof entry === "object" && !Array.isArray(entry)
        ? (entry as Record<string, unknown>)
        : {};

    return {
      // 1-based, so a problem names an entry a person can count to in the file.
      rowNumber: index + 1,
      number: record.number ?? record.no,
      title: record.title ?? record.name,
      topicTags: record.topicTags ?? record.topic_tags ?? record.tags,
    };
  });
}

function parseCsvImport(text: string, problems: HymnImportProblem[]): CandidateRow[] {
  const parsed = parseCsvText(text);

  // The parser's OWN problems travel with the validation ones. A caller that saw only the
  // validation problems would report a clean import of a partly unreadable file (roster-c).
  problems.push(...parsed.problems);

  const numberColumn = findColumn(parsed.headers, NUMBER_HEADERS);
  const titleColumn = findColumn(parsed.headers, TITLE_HEADERS);

  if (numberColumn === -1 || titleColumn === -1) {
    problems.push({
      rowNumber: 1,
      message:
        "This file needs a number column and a title column. Its columns are: " +
        `${parsed.headers.join(", ") || "(none)"}.`,
    });
    return [];
  }

  const tagColumn = findColumn(parsed.headers, TAG_HEADERS);

  return parsed.rows.map((row, index) => ({
    // parsed.rowNumbers, NOT the index. Blank records are dropped by the parser, so after the
    // first dropped one an index names the wrong line (lib/roster/csv/parseCsv.ts).
    rowNumber: parsed.rowNumbers[index] ?? index + 1,
    number: row[numberColumn],
    title: row[titleColumn],
    topicTags: tagColumn === -1 ? undefined : row[tagColumn],
  }));
}

// Accepts JSON or CSV, decided by CONTENT rather than by file extension. An export renamed by
// hand is not a reason to refuse a file, and a .txt holding a valid JSON array is unambiguous.
//
// REPORTS EVERY BAD ROW AND STILL RETURNS THE GOOD ONES — roster-c's rule. A file is normally
// 99% fine, and refusing all of it means somebody hand-edits a spreadsheet in the dark.
export function parseHymnImport(text: string): HymnImportResult {
  const problems: HymnImportProblem[] = [];
  const trimmed = text.trimStart();

  const candidates =
    trimmed.startsWith("[") || trimmed.startsWith("{")
      ? parseJsonImport(text, problems)
      : parseCsvImport(text, problems);

  const rows = validateRows(candidates, problems);

  // "Nothing was loaded and nothing was wrong with it" is not a state a caller can report
  // honestly, so it is turned into a problem here rather than left to each caller to notice.
  if (rows.length === 0 && problems.length === 0) {
    problems.push({ rowNumber: 0, message: "This file holds no hymns." });
  }

  return { rows, problems };
}
