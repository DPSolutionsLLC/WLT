// Slice C of ITER-045: brings the Sacrament Planner's real records into the app.
//
//   npm run planner:import -- --ward <uuid>            dry run: checks everything, writes nothing
//   npm run planner:import -- --ward <uuid> --apply    writes it
//
// It copies every document in the Planner's export into `planner_documents` (the real layer,
// under its original id, with every field), and the agenda history into `planner_history`.
// Practice (`t_`) collections are skipped. If any document fails the same checks the app's save
// route applies, NOTHING is written.
//
// IT NEVER DELETES. A fresh export overwrites documents with the same id and adds new ones; a
// document that exists in the app but not in the export is left alone. So it is safe to re-run.
//
// It uses the service role because `planner_history` has no write policy at all — nobody but this
// script may change it. The audit row it writes has no user, because nobody signed in to run it.
//
// WHY IT WRITES THE AUDIT ROW ITSELF: lib/audit/writeAuditLog.ts imports the server Supabase
// client, which pulls in `next/headers`, and plain Node cannot load that. The detail holds only
// counts, so writeAuditLog's redaction has nothing to remove.

import { readFileSync } from "node:fs";
import path from "node:path";
import {
  canonicalJson,
  countByCollection,
  planPlannerImport,
  type ExportedCollections,
  type PlannedDocument,
  type SettingsDefaults,
} from "@/lib/sacramentPlanner/importPlan";
import { PLANNER_COLLECTIONS } from "@/lib/sacramentPlanner/collections";
import { createServiceSupabaseClient } from "@/lib/supabase/service";
import { loadEnvironment } from "@/testing/infrastructure/envLoader";
import type { Json } from "@/types/database";

type ImportClient = ReturnType<typeof createServiceSupabaseClient>;

type History = { rows: unknown[]; meetings: Record<string, unknown>; conduct: Record<string, unknown> };

type Arguments = {
  wardId: string;
  exportPath: string;
  historyPath: string;
  defaultsPath: string;
  apply: boolean;
};

type StoredDocument = { collection: string; document_id: string; data: unknown };

const REPO_ROOT = path.resolve(import.meta.dirname, "..", "..");
const DEFAULTS = {
  exportPath: "sacrament-planner-handoff/data/database-export.json",
  historyPath: "sacrament-planner-handoff/app/src/data.json",
  defaultsPath: "sacrament-planner-handoff/data/settings-defaults.json",
};
const USAGE =
  "Usage: npm run planner:import -- --ward <ward uuid> [--export <file>] [--history <file>] " +
  "[--settings-defaults <file>] [--apply]";
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const WRITE_BATCH = 100;
const READ_PAGE = 1000;

function flagValue(argv: readonly string[], flag: string): string | undefined {
  const index = argv.indexOf(flag);
  return index === -1 ? undefined : argv[index + 1];
}

function readArguments(argv: readonly string[]): Arguments {
  const wardId = flagValue(argv, "--ward");
  if (!wardId || !UUID_PATTERN.test(wardId)) throw new Error(USAGE);

  return {
    wardId,
    exportPath: path.resolve(REPO_ROOT, flagValue(argv, "--export") ?? DEFAULTS.exportPath),
    historyPath: path.resolve(REPO_ROOT, flagValue(argv, "--history") ?? DEFAULTS.historyPath),
    defaultsPath: path.resolve(
      REPO_ROOT,
      flagValue(argv, "--settings-defaults") ?? DEFAULTS.defaultsPath,
    ),
    apply: argv.includes("--apply"),
  };
}

function readJsonFile(filePath: string, label: string): unknown {
  try {
    return JSON.parse(readFileSync(filePath, "utf8"));
  } catch (error) {
    throw new Error(
      `Could not read the ${label} at ${filePath}: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function readExport(filePath: string): { exportedAt: string; collections: ExportedCollections } {
  const raw = readJsonFile(filePath, "database export");
  if (!isRecord(raw) || !isRecord(raw.collections)) {
    throw new Error(`${filePath} has no "collections".`);
  }
  return {
    exportedAt: typeof raw.exportedAt === "string" ? raw.exportedAt : "unknown",
    collections: raw.collections as ExportedCollections,
  };
}

function readHistory(filePath: string): History {
  const raw = readJsonFile(filePath, "agenda history");
  if (!isRecord(raw) || !Array.isArray(raw.rows) || !isRecord(raw.meetings) || !isRecord(raw.conduct)) {
    throw new Error(`${filePath} needs "rows" (a list), "meetings" and "conduct".`);
  }
  return { rows: raw.rows, meetings: raw.meetings, conduct: raw.conduct };
}

function readSettingsDefaults(filePath: string): SettingsDefaults {
  const raw = readJsonFile(filePath, "settings defaults");
  if (!isRecord(raw) || !Array.isArray(raw.bishopric) || !isRecord(raw.rotation)) {
    throw new Error(`${filePath} needs "bishopric" (a list) and "rotation".`);
  }
  return { bishopric: raw.bishopric, rotation: raw.rotation };
}

async function readWardName(supabase: ImportClient, wardId: string): Promise<string> {
  const { data, error } = await supabase.from("wards").select("name").eq("id", wardId).maybeSingle();
  if (error) throw new Error(`Could not read the ward: ${error.message}`);
  if (!data) throw new Error(`No ward has the id ${wardId}.`);
  return data.name;
}

async function readStoredDocuments(supabase: ImportClient, wardId: string): Promise<StoredDocument[]> {
  const stored: StoredDocument[] = [];
  for (let from = 0; ; from += READ_PAGE) {
    const { data, error } = await supabase
      .from("planner_documents")
      .select("collection, document_id, data")
      .eq("ward_id", wardId)
      .eq("layer", "real")
      .order("id")
      .range(from, from + READ_PAGE - 1);
    if (error) throw new Error(`Could not read the ward's Planner records: ${error.message}`);
    stored.push(...(data ?? []));
    if ((data ?? []).length < READ_PAGE) return stored;
  }
}

async function readStoredHistory(
  supabase: ImportClient,
  wardId: string,
): Promise<{ rows: number; imported_at: string } | null> {
  const { data, error } = await supabase
    .from("planner_history")
    .select("agenda_rows, imported_at")
    .eq("ward_id", wardId)
    .maybeSingle();
  if (error) throw new Error(`Could not read the ward's agenda history: ${error.message}`);
  if (!data) return null;
  return {
    rows: Array.isArray(data.agenda_rows) ? data.agenda_rows.length : 0,
    imported_at: data.imported_at,
  };
}

function storedKey(collection: string, documentId: string): string {
  return `${collection}/${documentId}`;
}

async function writeDocuments(
  supabase: ImportClient,
  wardId: string,
  documents: readonly PlannedDocument[],
): Promise<void> {
  const updatedAt = new Date().toISOString();
  for (let start = 0; start < documents.length; start += WRITE_BATCH) {
    const batch = documents.slice(start, start + WRITE_BATCH).map((document) => ({
      ward_id: wardId,
      layer: "real",
      collection: document.collection,
      document_id: document.documentId,
      data: document.data as Json,
      updated_at: updatedAt,
      updated_by: null,
    }));
    const { error } = await supabase
      .from("planner_documents")
      .upsert(batch, { onConflict: "ward_id,layer,collection,document_id" });
    if (error) {
      throw new Error(
        `Writing records ${start + 1}–${start + batch.length} failed: ${error.message}. ` +
          "Records before them were saved; re-running the import is safe and finishes the rest.",
      );
    }
  }
}

async function writeHistory(supabase: ImportClient, wardId: string, history: History): Promise<void> {
  const { error } = await supabase.from("planner_history").upsert(
    {
      ward_id: wardId,
      agenda_rows: history.rows as Json,
      meetings: history.meetings as Json,
      conducting: history.conduct as Json,
      imported_at: new Date().toISOString(),
    },
    { onConflict: "ward_id" },
  );
  if (error) throw new Error(`Writing the agenda history failed: ${error.message}`);
}

async function writeImportAudit(
  supabase: ImportClient,
  wardId: string,
  counts: Record<string, number>,
  historyRows: number,
): Promise<void> {
  const { error } = await supabase.from("audit_log").insert({
    ward_id: wardId,
    user_id: null,
    action: "planner.imported",
    module: "sacrament",
    detail: { counts, historyRows } as Json,
  });
  if (error) {
    throw new Error(
      `The records were imported, but the audit row could not be written: ${error.message}`,
    );
  }
}

function printCountTable(
  planned: Record<string, number>,
  stored: Record<string, number>,
  label: string,
): void {
  console.log(`\n  Collection    In export   ${label}`);
  for (const collection of PLANNER_COLLECTIONS) {
    const exported = planned[collection] ?? 0;
    const inApp = stored[collection] ?? 0;
    console.log(`  ${collection.padEnd(12)}  ${String(exported).padStart(9)}   ${String(inApp).padStart(5)}`);
  }
}

// Every exported document must be in the app, under its id, with exactly its data. Documents
// the app has that the export does not are allowed — they were added after the export, and the
// import never deletes.
function verify(planned: readonly PlannedDocument[], stored: readonly StoredDocument[]): string[] {
  const storedByKey = new Map(stored.map((row) => [storedKey(row.collection, row.document_id), row.data]));
  const problems: string[] = [];
  for (const document of planned) {
    const key = storedKey(document.collection, document.documentId);
    if (!storedByKey.has(key)) {
      problems.push(`${key} is missing.`);
    } else if (canonicalJson(storedByKey.get(key)) !== canonicalJson(document.data)) {
      problems.push(`${key} does not match the export.`);
    }
  }
  return problems;
}

async function main(): Promise<void> {
  loadEnvironment();

  const args = readArguments(process.argv.slice(2));
  const supabase = createServiceSupabaseClient();

  const exported = readExport(args.exportPath);
  const history = readHistory(args.historyPath);
  const plan = planPlannerImport(exported.collections, readSettingsDefaults(args.defaultsPath));

  const wardName = await readWardName(supabase, args.wardId);
  console.log(`Ward: ${wardName}`);
  console.log(`Export taken: ${exported.exportedAt}`);

  if (plan.skippedPracticeCollections.length > 0) {
    console.log(`Practice collections skipped: ${plan.skippedPracticeCollections.join(", ")}`);
  }
  if (plan.addedSettings.length > 0) {
    console.log(`Settings the export lacked, added from the defaults file: ${plan.addedSettings.join(", ")}`);
  }

  if (plan.unknownCollections.length > 0 || plan.failures.length > 0) {
    for (const name of plan.unknownCollections) {
      console.error(`  "${name}" is not a Sacrament Planner collection.`);
    }
    for (const failure of plan.failures) console.error(`  ${failure}`);
    throw new Error("The export has records the Planner could not read. Nothing was written.");
  }

  const plannedCounts = countByCollection(plan.documents);
  const storedBefore = await readStoredDocuments(supabase, args.wardId);
  const storedKeys = new Set(storedBefore.map((row) => storedKey(row.collection, row.document_id)));
  const overwriting = plan.documents.filter((document) =>
    storedKeys.has(storedKey(document.collection, document.documentId)),
  ).length;
  const historyBefore = await readStoredHistory(supabase, args.wardId);

  printCountTable(plannedCounts, countByCollection(storedBefore), "In the app now");
  console.log(
    `\n${plan.documents.length} records to write: ${plan.documents.length - overwriting} new, ` +
      `${overwriting} replacing a record with the same id.`,
  );
  console.log(
    `Agenda history: ${history.rows.length} lines, ${Object.keys(history.meetings).length} meetings` +
      (historyBefore ? ` (replacing ${historyBefore.rows} lines imported ${historyBefore.imported_at}).` : "."),
  );
  console.log("Nothing in the app is ever deleted by this import.");

  if (!args.apply) {
    console.log("\nDry run. Nothing was written. Add --apply to import.");
    return;
  }

  await writeDocuments(supabase, args.wardId, plan.documents);
  await writeHistory(supabase, args.wardId, history);
  await writeImportAudit(supabase, args.wardId, plannedCounts, history.rows.length);

  const storedAfter = await readStoredDocuments(supabase, args.wardId);
  const historyAfter = await readStoredHistory(supabase, args.wardId);
  printCountTable(plannedCounts, countByCollection(storedAfter), "In the app after");

  const problems = verify(plan.documents, storedAfter);
  if (historyAfter?.rows !== history.rows.length) {
    problems.push(`The agenda history holds ${historyAfter?.rows ?? 0} lines, not ${history.rows.length}.`);
  }
  if (problems.length > 0) {
    for (const problem of problems) console.error(`  ${problem}`);
    throw new Error("The import finished but did not check out. See the lines above.");
  }

  console.log(
    `\nImported and checked: every one of the ${plan.documents.length} records is in the app ` +
      `exactly as exported, and all ${history.rows.length} history lines are there.`,
  );
}

main().catch((error: unknown) => {
  console.error(`\n${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
});
