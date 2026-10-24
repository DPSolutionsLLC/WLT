// Slice B of ITER-045: compares the member list the Sacrament Planner WILL be served (the app's
// `members` table, through toPlannerWardList — the same function the frame route calls) with the
// list the Planner was built on, and lists every name its records use that the new list lacks.
//
//   npm run planner:check -- --ward <uuid>
//
// READ-ONLY. It writes nothing to the database. Its one output is a Markdown report, and because
// that report is full of members' names it may only be written under
// sacrament-planner-handoff/data/, which is gitignored.
//
// WHY IT READS THE MEMBERS ITSELF: lib/roster/queries.ts and lib/ward/wardTimezone.ts import the
// server Supabase client, which pulls in `next/headers`, and plain Node cannot load that. So the
// two reads are repeated here with the frame route's exact filter (statuses active and
// do_not_contact), and the mapping — the part that decides what the Planner sees — goes through
// the shared toPlannerWardList.

import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import {
  plannerNameOf,
  toPlannerWardList,
  type PlannerWardMember,
  type PlannerWardRow,
} from "@/lib/sacramentPlanner/wardList";
import { wardDateOnly } from "@/lib/ward/wardDate";
import { createServiceSupabaseClient } from "@/lib/supabase/service";
import { loadEnvironment } from "@/testing/infrastructure/envLoader";
import { MEMBER_CATEGORIES, MEMBER_GENDERS } from "@/types/domain";

type CheckClient = ReturnType<typeof createServiceSupabaseClient>;

type PlannerListEntry = {
  name: string;
  age: number | null;
  gender: string;
  phone: string;
  phoneVia: string;
  email: string;
};

type ExportCollections = Record<string, Record<string, Record<string, unknown>>>;

type HistoryFile = { rows: string[][] };

type Arguments = {
  wardId: string;
  listPath: string;
  exportPath: string;
  historyPath: string;
  outPath: string;
};

type MemberSourceRow = {
  household_id: string | null;
  first_name: string;
  last_name: string;
  preferred_name: string | null;
  full_name: string | null;
  birth_date: string | null;
  gender: string | null;
  phone: string | null;
  email: string | null;
  category: string | null;
};

const REPO_ROOT = path.resolve(import.meta.dirname, "..", "..");
const PRIVATE_DIRECTORY = path.join(REPO_ROOT, "sacrament-planner-handoff", "data");
const DEFAULTS = {
  listPath: "sacrament-planner-handoff/data/ward-list-used-by-planner.json",
  exportPath: "sacrament-planner-handoff/data/database-export.json",
  historyPath: "sacrament-planner-handoff/app/src/data.json",
  outPath: "sacrament-planner-handoff/data/ward-list-check.md",
};
const USAGE =
  "Usage: npm run planner:check -- --ward <ward uuid> [--list <file>] [--export <file>] " +
  "[--history <file>] [--out <file under sacrament-planner-handoff/data/>]";
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const READ_CAP = 1000;
const FALLBACK_TIME_ZONE = "America/Denver";
const NOT_A_MEMBER = "__none__";
const NAMED_COLLECTIONS = ["deferrals", "considers", "goesBy", "marks", "holds", "people"] as const;

// The Planner's history rows are tuples; these positions come from `DATA.rows.map` in
// lib/sacramentPlanner/assets/body.html.
const ROW_ID = 0;
const ROW_AUTO = 5;
const ROW_KEY = 8;

function flagValue(argv: readonly string[], flag: string): string | undefined {
  const index = argv.indexOf(flag);
  return index === -1 ? undefined : argv[index + 1];
}

function readArguments(argv: readonly string[]): Arguments {
  const wardId = flagValue(argv, "--ward");
  if (!wardId || !UUID_PATTERN.test(wardId)) throw new Error(USAGE);

  const outPath = path.resolve(REPO_ROOT, flagValue(argv, "--out") ?? DEFAULTS.outPath);
  if (!outPath.startsWith(PRIVATE_DIRECTORY + path.sep)) {
    throw new Error(
      `The report is full of members' names, so it may only be written under ` +
        `sacrament-planner-handoff/data/, which git ignores. Refusing to write ${outPath}.`,
    );
  }

  return {
    wardId,
    listPath: path.resolve(REPO_ROOT, flagValue(argv, "--list") ?? DEFAULTS.listPath),
    exportPath: path.resolve(REPO_ROOT, flagValue(argv, "--export") ?? DEFAULTS.exportPath),
    historyPath: path.resolve(REPO_ROOT, flagValue(argv, "--history") ?? DEFAULTS.historyPath),
    outPath,
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

function isUsableTimeZone(value: unknown): value is string {
  if (typeof value !== "string" || value.trim() === "" || /^[+-]/.test(value)) return false;
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: value });
    return true;
  } catch {
    return false;
  }
}

async function readWard(
  supabase: CheckClient,
  wardId: string,
): Promise<{ name: string; timeZone: string }> {
  const { data, error } = await supabase
    .from("wards")
    .select("name, settings")
    .eq("id", wardId)
    .maybeSingle();

  if (error) throw new Error(`Could not read the ward: ${error.message}`);
  if (!data) throw new Error(`No ward has the id ${wardId}.`);

  const settings = data.settings as Record<string, unknown> | null;
  const zone = settings?.timezone;
  if (zone !== undefined && zone !== null && !isUsableTimeZone(zone)) {
    console.warn(`The ward's time zone setting is not usable; using ${FALLBACK_TIME_ZONE}.`);
  }

  return { name: data.name, timeZone: isUsableTimeZone(zone) ? zone.trim() : FALLBACK_TIME_ZONE };
}

function toKnownValue<Value extends string>(
  value: string | null,
  allowed: readonly Value[],
  column: string,
): Value | null {
  if (value === null) return null;
  if (!(allowed as readonly string[]).includes(value)) {
    throw new Error(`members.${column} holds "${value}", which is not a known value.`);
  }
  return value as Value;
}

async function readMembers(supabase: CheckClient, wardId: string): Promise<MemberSourceRow[]> {
  const { data, error } = await supabase
    .from("members")
    .select(
      "household_id, first_name, last_name, preferred_name, full_name, birth_date, gender, phone, email, category",
    )
    .eq("ward_id", wardId)
    .in("status", ["active", "do_not_contact"])
    .limit(READ_CAP);

  if (error) throw new Error(`Could not read the ward's members: ${error.message}`);

  const rows = data ?? [];
  if (rows.length >= READ_CAP) {
    throw new Error(`The member read reached ${READ_CAP} rows, so the list would be incomplete.`);
  }
  return rows;
}

function toPlannerWardMember(row: MemberSourceRow): PlannerWardMember {
  return {
    householdId: row.household_id,
    firstName: row.first_name,
    lastName: row.last_name,
    preferredName: row.preferred_name,
    fullName: row.full_name,
    birthDate: row.birth_date,
    gender: toKnownValue(row.gender, MEMBER_GENDERS, "gender"),
    phone: row.phone,
    email: row.email,
    category: toKnownValue(row.category, MEMBER_CATEGORIES, "category"),
  };
}

function readPlannerList(filePath: string): PlannerListEntry[] {
  const raw = readJsonFile(filePath, "Planner's ward list");
  if (!Array.isArray(raw)) throw new Error(`${filePath} is not a list.`);
  return raw.map((entry, index) => {
    if (typeof entry?.name !== "string") {
      throw new Error(`Entry ${index} in ${filePath} has no name.`);
    }
    return {
      name: entry.name,
      age: typeof entry.age === "number" ? entry.age : null,
      gender: String(entry.gender ?? ""),
      phone: String(entry.phone ?? ""),
      phoneVia: String(entry.phoneVia ?? ""),
      email: String(entry.email ?? ""),
    };
  });
}

function readExportCollections(filePath: string): ExportCollections {
  const raw = readJsonFile(filePath, "database export") as { collections?: unknown };
  if (raw === null || typeof raw.collections !== "object" || raw.collections === null) {
    throw new Error(`${filePath} has no "collections".`);
  }
  return raw.collections as ExportCollections;
}

function readHistory(filePath: string): HistoryFile {
  const raw = readJsonFile(filePath, "agenda history") as { rows?: unknown };
  if (!Array.isArray(raw?.rows)) throw new Error(`${filePath} has no "rows".`);
  return { rows: raw.rows as string[][] };
}

function lastNameOf(name: string): string {
  const comma = name.indexOf(",");
  return (comma === -1 ? name.split(" ").at(-1) ?? name : name.slice(0, comma)).trim().toLowerCase();
}

function firstNamesOf(name: string): string {
  const comma = name.indexOf(",");
  return (comma === -1 ? name : name.slice(comma + 1)).trim().toLowerCase();
}

function editDistance(left: string, right: string): number {
  const previous = Array.from({ length: right.length + 1 }, (_, index) => index);
  for (let row = 1; row <= left.length; row += 1) {
    let diagonal = previous[0];
    previous[0] = row;
    for (let column = 1; column <= right.length; column += 1) {
      const above = previous[column];
      previous[column] = Math.min(
        previous[column] + 1,
        previous[column - 1] + 1,
        diagonal + (left[row - 1] === right[column - 1] ? 0 : 1),
      );
      diagonal = above;
    }
  }
  return previous[right.length];
}

function likelySamePerson(left: string, right: string): string | null {
  const a = left.toLowerCase();
  const b = right.toLowerCase();
  if (lastNameOf(a) === lastNameOf(b)) {
    const firstA = firstNamesOf(a);
    const firstB = firstNamesOf(b);
    if (firstA.startsWith(firstB) || firstB.startsWith(firstA)) return "same last name, first name is a prefix";
    if (firstA.split(" ")[0] === firstB.split(" ")[0]) return "same last and first name, middle differs";
  }
  const distance = editDistance(a, b);
  return distance <= 2 ? `${distance} letter${distance === 1 ? "" : "s"} apart` : null;
}

function digitsOf(phone: string): string {
  return phone.replace(/\D/g, "");
}

function addUse(uses: Map<string, Map<string, number>>, name: unknown, source: string): void {
  if (typeof name !== "string") return;
  const trimmed = name.trim();
  if (trimmed === "" || trimmed === NOT_A_MEMBER) return;
  const bySource = uses.get(trimmed) ?? new Map<string, number>();
  bySource.set(source, (bySource.get(source) ?? 0) + 1);
  uses.set(trimmed, bySource);
}

// Every name a record links a person by. History rows count by the person they RESOLVE to, the
// way body.html's resolve() does: a row fix wins over a name fix, which wins over the automatic
// match. The row's `key` is the name as printed on the agenda, which is not a link to anybody.
function collectRecordNames(
  collections: ExportCollections,
  history: HistoryFile,
): Map<string, Map<string, number>> {
  const uses = new Map<string, Map<string, number>>();

  for (const collection of NAMED_COLLECTIONS) {
    for (const document of Object.values(collections[collection] ?? {})) {
      addUse(uses, document.name, collection);
    }
  }

  for (const sunday of Object.values(collections.sundays ?? {})) {
    const slots = Array.isArray(sunday.slots) ? sunday.slots : [];
    for (const slot of slots) addUse(uses, (slot as { name?: unknown }).name, "sundays (slot)");
  }

  const nameFixes = collections.nameFixes ?? {};
  const rowFixes = collections.rowFixes ?? {};
  for (const fix of Object.values(nameFixes)) addUse(uses, fix.person, "nameFixes");
  for (const fix of Object.values(rowFixes)) addUse(uses, fix.person, "rowFixes");

  const nameFixByKey = new Map<string, unknown>();
  for (const fix of Object.values(nameFixes)) {
    if (typeof fix.key === "string") nameFixByKey.set(fix.key, fix.person);
  }

  for (const row of history.rows) {
    const rowFix = rowFixes[row[ROW_ID]]?.person;
    const nameFix = row[ROW_KEY] ? nameFixByKey.get(row[ROW_KEY]) : undefined;
    const person = rowFix || nameFix || row[ROW_AUTO];
    addUse(uses, person, "history (resolved)");
  }

  return uses;
}

function bulletList(lines: readonly string[]): string {
  return lines.length === 0 ? "_None._" : lines.map((line) => `- ${line}`).join("\n");
}

function countMatches(names: readonly (string | null)[], listNames: ReadonlySet<string>): string {
  const present = names.filter((name): name is string => !!name && name.trim() !== "");
  const matched = present.filter((name) => listNames.has(name.trim())).length;
  return `${matched} of ${present.length} filled in match a Planner name`;
}

async function main(): Promise<void> {
  loadEnvironment();

  const args = readArguments(process.argv.slice(2));
  const supabase = createServiceSupabaseClient();

  const plannerList = readPlannerList(args.listPath);
  const collections = readExportCollections(args.exportPath);
  const history = readHistory(args.historyPath);

  const ward = await readWard(supabase, args.wardId);
  const memberRows = await readMembers(supabase, args.wardId);
  const today = wardDateOnly(new Date(), ward.timeZone);
  const appList: PlannerWardRow[] = toPlannerWardList(memberRows.map(toPlannerWardMember), today);

  const appByName = new Map(appList.map((row) => [row[0], row]));
  const plannerByName = new Map(plannerList.map((entry) => [entry.name, entry]));
  const plannerNames = new Set(plannerByName.keys());

  const appDuplicates = appList.length - appByName.size;
  const onlyInApp = [...appByName.keys()].filter((name) => !plannerByName.has(name)).sort();
  const onlyInPlanner = [...plannerByName.keys()].filter((name) => !appByName.has(name)).sort();

  const likelyPairs: string[] = [];
  for (const appName of onlyInApp) {
    for (const plannerName of onlyInPlanner) {
      const reason = likelySamePerson(appName, plannerName);
      if (reason) likelyPairs.push(`App: **${appName}** ↔ Planner: **${plannerName}** (${reason})`);
    }
  }

  const fieldDifferences: string[] = [];
  let phoneFormatOnly = 0;
  for (const [name, entry] of plannerByName) {
    const row = appByName.get(name);
    if (!row) continue;
    const [, age, gender, phone, phoneVia, email] = row;
    const differences: string[] = [];
    if (age !== entry.age) differences.push(`age ${entry.age ?? "—"} → ${age ?? "—"}`);
    if (gender !== entry.gender) differences.push(`gender "${entry.gender}" → "${gender}"`);
    if (digitsOf(phone) !== digitsOf(entry.phone)) {
      differences.push(`phone "${entry.phone}" → "${phone}"`);
    } else if (phone !== entry.phone) {
      phoneFormatOnly += 1;
    }
    if (phoneVia !== entry.phoneVia) differences.push(`household phone via "${entry.phoneVia}" → "${phoneVia}"`);
    if (email.toLowerCase() !== entry.email.toLowerCase()) {
      differences.push(`email "${entry.email}" → "${email}"`);
    }
    if (differences.length > 0) fieldDifferences.push(`**${name}**: ${differences.join("; ")}`);
  }

  const recordNames = collectRecordNames(collections, history);
  const missingFromApp = [...recordNames.entries()]
    .filter(([name]) => !appByName.has(name))
    .sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0))
    .map(([name, sources]) => {
      const where = [...sources.entries()].map(([source, count]) => `${source} ×${count}`).join(", ");
      const onOldList = plannerByName.has(name) ? "was on the Planner's list" : "on neither list";
      return `**${name}** — ${where} (${onOldList})`;
    });

  const sourceRates = [
    `preferred_name: ${countMatches(memberRows.map((row) => row.preferred_name), plannerNames)}`,
    `full_name: ${countMatches(memberRows.map((row) => row.full_name), plannerNames)}`,
    `"Last, First": ${countMatches(
      memberRows.map((row) => `${row.last_name.trim()}, ${row.first_name.trim()}`),
      plannerNames,
    )}`,
    `name actually served (toPlannerWardList): ${countMatches(
      memberRows.map((row) => plannerNameOf(toPlannerWardMember(row))),
      plannerNames,
    )}`,
  ];

  const report = [
    `# Sacrament Planner — member list check`,
    ``,
    `Ward: **${ward.name}** (${args.wardId}). Ages computed for ${today} in ${ward.timeZone}.`,
    `Generated ${new Date().toISOString()}. Read-only: nothing was written to the database.`,
    ``,
    `| | Count |`,
    `|---|---|`,
    `| People on the app's list (active and do-not-contact) | ${appList.length} |`,
    `| People on the Planner's list | ${plannerList.length} |`,
    `| Same name on both | ${appByName.size - onlyInApp.length} |`,
    `| Names used twice on the app's list | ${appDuplicates} |`,
    `| Only on the app's list | ${onlyInApp.length} |`,
    `| Only on the Planner's list | ${onlyInPlanner.length} |`,
    `| Likely the same person written differently | ${likelyPairs.length} |`,
    `| Matched names with a field difference | ${fieldDifferences.length} |`,
    `| Matched names whose phone differs in formatting only (not listed) | ${phoneFormatOnly} |`,
    `| Names used in the records that are not on the app's list | ${missingFromApp.length} |`,
    ``,
    `## 1. Names on only one list`,
    ``,
    `### Only on the app's list`,
    bulletList(onlyInApp),
    ``,
    `### Only on the Planner's list`,
    bulletList(onlyInPlanner),
    ``,
    `## 2. Likely the same person, written differently`,
    ``,
    bulletList(likelyPairs),
    ``,
    `## 3. Differences for names on both lists (Planner → app)`,
    ``,
    bulletList(fieldDifferences),
    ``,
    `## 4. Names the records use that are not on the app's list`,
    ``,
    `History rows are counted by the person they resolve to (row fix, then name fix, then the`,
    `automatic match), the way the Planner itself decides. "${NOT_A_MEMBER}" is skipped.`,
    ``,
    bulletList(missingFromApp),
    ``,
    `## 5. Which name source matches the Planner's names`,
    ``,
    bulletList(sourceRates),
    ``,
  ].join("\n");

  writeFileSync(args.outPath, report, "utf8");

  console.log(`Ward: ${ward.name}`);
  console.log(`App list ${appList.length}, Planner list ${plannerList.length}`);
  console.log(`Only in app ${onlyInApp.length}, only in Planner ${onlyInPlanner.length}`);
  console.log(`Likely same person ${likelyPairs.length}, field differences ${fieldDifferences.length}`);
  console.log(`Phone formatting-only differences ${phoneFormatOnly}, duplicate app names ${appDuplicates}`);
  console.log(`Record names missing from the app's list ${missingFromApp.length}`);
  for (const line of sourceRates) console.log(`  ${line}`);
  console.log(`\nReport written to ${path.relative(REPO_ROOT, args.outPath)}. Nothing was written to the database.`);
}

main().catch((error: unknown) => {
  console.error(`\n${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
});
