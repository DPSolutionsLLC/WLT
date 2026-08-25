// The hymnbook's three maintenance commands.
//
//   npm run hymns:placeholders          fill every missing number with a synthetic row
//   npm run hymns:reset                 delete every placeholder, keep every verified row
//   npm run hymns:import -- <file>      load a real hymnbook from JSON or CSV
//
// WHY THIS IS A SCRIPT AND NOT A ROUTE: `hymns` is the one table with no ward_id (migration
// 006), so none of this is a ward's data to edit. Replacing the hymnbook is an operator action
// taken once, deliberately, by somebody who has the file in front of them — not a button in an
// app where a mis-click costs 341 rows.
//
// It uses the SERVICE-ROLE client because RLS grants `hymns` SELECT to authenticated users and
// no write at all (migration 019); the seed is the only other writer and it runs as service_role
// too. Env comes through testing/infrastructure/envLoader.ts, which already solves loading
// .env.local from a plain node process, exactly as ingestStandardWorks.ts does.
//
// The parsing and the placeholder rules live in lib/music/hymnSource.ts and are shared with the
// app, so a title this script refuses is a title the app would refuse.

import { readFile } from "node:fs/promises";
import {
  HYMNBOOK_SIZE,
  buildPlaceholderRows,
  parseHymnImport,
  type HymnImportProblem,
} from "@/lib/music/hymnSource";
import { createServiceSupabaseClient } from "@/lib/supabase/service";
import { loadEnvironment } from "@/testing/infrastructure/envLoader";

const COMMANDS = ["placeholders", "reset", "import"] as const;
type Command = (typeof COMMANDS)[number];

// Supabase caps a single insert; the hymnbook is 341 rows, so one statement is fine — but an
// imported book could be larger, and a batch size means the failure mode is a named batch rather
// than a request that is simply too big.
const BATCH_SIZE = 200;

function isCommand(value: string | undefined): value is Command {
  return value !== undefined && (COMMANDS as readonly string[]).includes(value);
}

type HymnClient = ReturnType<typeof createServiceSupabaseClient>;

async function readExistingNumbers(supabase: HymnClient): Promise<Map<number, string>> {
  const { data, error } = await supabase.from("hymns").select("number, source");

  if (error) {
    throw new Error(`Could not read the hymns table: ${error.message}`);
  }

  return new Map((data ?? []).map((row) => [row.number, row.source]));
}

// Inserts only what is MISSING. buildPlaceholderRows takes the numbers already present and omits
// them, so this cannot overwrite one of the 42 verified rows and running it twice is harmless.
async function runPlaceholders(supabase: HymnClient): Promise<void> {
  const existing = await readExistingNumbers(supabase);
  const rows = buildPlaceholderRows(existing.keys());

  if (rows.length === 0) {
    console.log(
      `All ${HYMNBOOK_SIZE} hymn numbers are already present. Nothing was added.`,
    );
    return;
  }

  for (let start = 0; start < rows.length; start += BATCH_SIZE) {
    const batch = rows.slice(start, start + BATCH_SIZE);
    const { error } = await supabase.from("hymns").insert(
      batch.map((row) => ({
        number: row.number,
        title: row.title,
        topic_tags: row.topicTags,
        source: row.source,
      })),
    );

    if (error) {
      throw new Error(
        `Could not insert placeholders ${batch[0].number}–${batch[batch.length - 1].number}: ${error.message}`,
      );
    }
  }

  console.log(`Added ${rows.length} placeholder ${rows.length === 1 ? "hymn" : "hymns"}.`);
  console.log(`Left ${existing.size} existing ${existing.size === 1 ? "row" : "rows"} alone.`);
  console.log(
    "These are BUILD-AND-TEST rows. A ward must not print a programme from one — run " +
      "`npm run hymns:reset` and then `npm run hymns:import` once a real hymnbook is available.",
  );
}

// DELIBERATELY HAS NO --all.
//
// Deleting the verified rows is not something anybody should be one flag away from, and a short
// import file would otherwise leave the ward with FEWER hymns than it started with. The only way
// to remove a verified row is by hand, in SQL, having decided to.
async function runReset(supabase: HymnClient): Promise<void> {
  const { data, error } = await supabase
    .from("hymns")
    .delete()
    .eq("source", "placeholder")
    .select("number");

  if (error) {
    throw new Error(`Could not delete the placeholder hymns: ${error.message}`);
  }

  const deleted = data?.length ?? 0;
  const remaining = await readExistingNumbers(supabase);

  console.log(`Deleted ${deleted} placeholder ${deleted === 1 ? "hymn" : "hymns"}.`);
  console.log(
    `${remaining.size} verified ${remaining.size === 1 ? "hymn remains" : "hymns remain"}.`,
  );
}

function reportProblems(problems: readonly HymnImportProblem[]): void {
  if (problems.length === 0) return;

  console.log(`\n${problems.length} ${problems.length === 1 ? "problem" : "problems"}:`);
  for (const problem of problems) {
    // Row 0 is a whole-file problem — unreadable JSON, a missing column — rather than a line.
    const where = problem.rowNumber === 0 ? "File" : `Row ${problem.rowNumber}`;
    console.log(`  ${where}: ${problem.message}`);
  }
}

// Marks everything it writes `authoritative`, which is the whole point of the command: these
// rows came from a real hymnbook that a person chose to load. parseHymnImport refuses a row whose
// title is one of our own placeholders, so an export of this table cannot be laundered into the
// verified set.
async function runImport(supabase: HymnClient, path: string): Promise<void> {
  let text: string;
  try {
    text = await readFile(path, "utf8");
  } catch (error) {
    throw new Error(
      `Could not read ${path}. ${error instanceof Error ? error.message : ""}`.trim(),
    );
  }

  const { rows, problems } = parseHymnImport(text);

  reportProblems(problems);

  if (rows.length === 0) {
    console.log("\nNothing was written.");
    process.exitCode = 1;
    return;
  }

  // Read BEFORE the write so added and updated are counted rather than guessed. Upsert reports
  // neither, and "341 rows written" hides the one fact worth knowing: how many verified rows
  // this file replaced.
  const existing = await readExistingNumbers(supabase);
  const added = rows.filter((row) => !existing.has(row.number)).length;
  const replacedPlaceholders = rows.filter(
    (row) => existing.get(row.number) === "placeholder",
  ).length;
  const replacedVerified = rows.filter(
    (row) => existing.get(row.number) === "authoritative",
  ).length;

  for (let start = 0; start < rows.length; start += BATCH_SIZE) {
    const batch = rows.slice(start, start + BATCH_SIZE);
    const { error } = await supabase.from("hymns").upsert(
      batch.map((row) => ({
        number: row.number,
        title: row.title,
        topic_tags: row.topicTags,
        source: "authoritative",
      })),
      { onConflict: "number" },
    );

    if (error) {
      throw new Error(
        `Could not write hymns ${batch[0].number}–${batch[batch.length - 1].number}: ${error.message}`,
      );
    }
  }

  console.log(`\nLoaded ${rows.length} ${rows.length === 1 ? "hymn" : "hymns"} from ${path}.`);
  console.log(`  ${added} new`);
  console.log(`  ${replacedPlaceholders} replaced a placeholder`);
  console.log(`  ${replacedVerified} replaced a previously verified row`);
  console.log(`  ${problems.length} refused`);
  console.log(
    "\nRecord where this file came from — a migration comment or a note beside it. The next " +
      "person to doubt a hymn number needs to know.",
  );
}

async function main(): Promise<void> {
  loadEnvironment();

  const [command, ...rest] = process.argv.slice(2);

  if (!isCommand(command)) {
    throw new Error(
      "Usage: npm run hymns:placeholders | npm run hymns:reset | npm run hymns:import -- <file>",
    );
  }

  const supabase = createServiceSupabaseClient();

  if (command === "placeholders") {
    await runPlaceholders(supabase);
    return;
  }

  if (command === "reset") {
    await runReset(supabase);
    return;
  }

  const path = rest[0];
  if (!path || path.startsWith("--")) {
    throw new Error("Usage: npm run hymns:import -- ./path/to/hymnbook.json");
  }

  await runImport(supabase, path);
}

main().catch((error: unknown) => {
  console.error(`\n${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
});
