// Gives the TEST ward's existing members made-up values for the columns migration 090 added, so the
// test ward has the same shape as a ward whose roster came from an LCR paste.
//
//   npm run roster:fill-test-fields -- --ward <uuid>            dry run: prints what it would write
//   npm run roster:fill-test-fields -- --ward <uuid> --apply    writes it
//
// ONE-OFF AND REFUSING BY DESIGN. It refuses a ward where ANY member already has a full name,
// because that means a real paste happened there, and this must never overwrite a real roster.
// It only UPDATES: it never inserts or deletes a member.
//
// Every value is derived from the member's id, so a re-run (on a ward it has not yet filled) plans
// exactly the same values. Birth dates agree with each member's existing category; the category
// itself is left as it is.

import { formatDateOnly, type DateOnly } from "@/lib/calendar/dates";
import { ageGroupOn } from "@/lib/roster/ageGroup";
import { createServiceSupabaseClient } from "@/lib/supabase/service";
import { loadEnvironment } from "@/testing/infrastructure/envLoader";
import type { MemberCategory } from "@/types/domain";

type FillClient = ReturnType<typeof createServiceSupabaseClient>;

type MemberToFill = {
  id: string;
  first_name: string;
  last_name: string;
  category: string | null;
  full_name: string | null;
};

type PlannedValues = {
  full_name: string;
  preferred_name: string;
  birth_date: DateOnly;
  email: string;
  class_assignment: string | null;
  callings: string | null;
  ministering_brothers: null;
  ministering_sisters: null;
  has_ministering_brothers: false;
  has_ministering_sisters: false;
};

const USAGE = "Usage: npm run roster:fill-test-fields -- --ward <ward uuid> [--apply]";
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const READ_LIMIT = 1000;

const CLASS_ASSIGNMENTS = [
  "Elders Quorum",
  "Relief Society",
  "Young Women",
  "Aaronic Priesthood",
  "Primary",
  "Gospel Doctrine",
] as const;

const CALLINGS = [
  "Primary Teacher",
  "Ward Activities Committee Member",
  "Sunday School Teacher",
  "Ward Missionary",
  "Primary Teacher\nWard Activities Committee Member",
  "Ministering Secretary",
] as const;

// Ages chosen well inside each band, so the January and birthday edges can never put a member in
// the wrong group. ageGroupOn() checks it anyway, below.
const AGE_RANGES: Record<MemberCategory, readonly [number, number]> = {
  child: [5, 10],
  youth: [13, 16],
  adult: [19, 85],
};

// FNV-1a over the id plus a salt: small, deterministic and good enough to spread sample values.
function seededNumber(id: string, salt: string): number {
  let hash = 0x811c9dc5;
  for (const character of `${salt}:${id}`) {
    hash ^= character.charCodeAt(0);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash;
}

function pick<Value>(values: readonly Value[], id: string, salt: string): Value {
  return values[seededNumber(id, salt) % values.length];
}

function blankAboutThirtyPercent(id: string, salt: string): boolean {
  return seededNumber(id, `${salt}:blank`) % 10 < 3;
}

function toCategory(value: string | null): MemberCategory {
  return value === "child" || value === "youth" ? value : "adult";
}

function planBirthDate(member: MemberToFill, today: DateOnly): DateOnly {
  const category = toCategory(member.category);
  const [youngest, oldest] = AGE_RANGES[category];
  const age = youngest + (seededNumber(member.id, "age") % (oldest - youngest + 1));
  const year = Number(today.slice(0, 4)) - age;
  const month = seededNumber(member.id, "month") % 12;
  const day = 1 + (seededNumber(member.id, "day") % 28);
  const birthDate = formatDateOnly(new Date(Date.UTC(year, month, day)));

  if (ageGroupOn(birthDate, today) !== category) {
    throw new Error(
      `The planned birth date for member ${member.id} does not match their category. ` +
        "AGE_RANGES in this script and lib/roster/ageGroup.ts have drifted.",
    );
  }

  return birthDate;
}

function planValues(member: MemberToFill, today: DateOnly): PlannedValues {
  const lcrName = `${member.last_name}, ${member.first_name}`;
  const emailName = `${member.first_name}.${member.last_name}`.toLowerCase().replace(/\s+/g, "");

  return {
    full_name: lcrName,
    preferred_name: lcrName,
    birth_date: planBirthDate(member, today),
    email: `${emailName}@example.com`,
    class_assignment: blankAboutThirtyPercent(member.id, "class")
      ? null
      : pick(CLASS_ASSIGNMENTS, member.id, "class"),
    callings: blankAboutThirtyPercent(member.id, "callings")
      ? null
      : pick(CALLINGS, member.id, "callings"),
    ministering_brothers: null,
    ministering_sisters: null,
    has_ministering_brothers: false,
    has_ministering_sisters: false,
  };
}

function readArguments(argv: readonly string[]): { wardId: string; apply: boolean } {
  const wardFlag = argv.indexOf("--ward");
  const wardId = wardFlag === -1 ? undefined : argv[wardFlag + 1];

  if (!wardId || !UUID_PATTERN.test(wardId)) throw new Error(USAGE);

  return { wardId, apply: argv.includes("--apply") };
}

async function readWardName(supabase: FillClient, wardId: string): Promise<string> {
  const { data, error } = await supabase.from("wards").select("name").eq("id", wardId).maybeSingle();

  if (error) throw new Error(`Could not read the ward: ${error.message}`);
  if (!data) throw new Error(`No ward has the id ${wardId}.`);

  return data.name;
}

async function readMembers(supabase: FillClient, wardId: string): Promise<MemberToFill[]> {
  const { data, error } = await supabase
    .from("members")
    .select("id, first_name, last_name, category, full_name")
    .eq("ward_id", wardId)
    .order("id")
    .limit(READ_LIMIT);

  if (error) throw new Error(`Could not read the ward's members: ${error.message}`);

  const members = data ?? [];
  if (members.length >= READ_LIMIT) {
    throw new Error(
      `This ward has ${READ_LIMIT} or more members, which is not a test ward. Nothing was written.`,
    );
  }

  return members;
}

async function writeValues(
  supabase: FillClient,
  wardId: string,
  memberId: string,
  values: PlannedValues,
): Promise<void> {
  const { error } = await supabase
    .from("members")
    .update(values)
    .eq("ward_id", wardId)
    .eq("id", memberId)
    .is("full_name", null);

  if (error) {
    throw new Error(`Could not update member ${memberId}: ${error.message}`);
  }
}

async function main(): Promise<void> {
  loadEnvironment();

  const { wardId, apply } = readArguments(process.argv.slice(2));
  const supabase = createServiceSupabaseClient();

  const wardName = await readWardName(supabase, wardId);
  const members = await readMembers(supabase, wardId);

  if (members.length === 0) {
    throw new Error(`"${wardName}" has no members. Nothing was written.`);
  }

  const alreadyNamed = members.filter((member) => member.full_name !== null).length;
  if (alreadyNamed > 0) {
    throw new Error(
      `"${wardName}" already has ${alreadyNamed} members with a full name, which means a real ` +
        "roster paste happened there. This script only fills a test ward. Nothing was written.",
    );
  }

  const today = formatDateOnly(new Date());
  const planned = members.map((member) => ({ member, values: planValues(member, today) }));

  console.log(`Ward: ${wardName}`);
  console.log(`Members to fill: ${planned.length}`);
  console.log("Sample of planned values:");
  for (const { member, values } of planned.slice(0, 5)) {
    console.log(
      `  ${member.first_name} ${member.last_name} (${toCategory(member.category)}): born ` +
        `${values.birth_date}, ${values.email}, class ${values.class_assignment ?? "(blank)"}, ` +
        `callings ${values.callings?.replace(/\n/g, " / ") ?? "(blank)"}`,
    );
  }

  if (!apply) {
    console.log("\nDry run. Nothing was written. Add --apply to write these values.");
    return;
  }

  for (const { member, values } of planned) {
    await writeValues(supabase, wardId, member.id, values);
  }

  console.log(`\nWrote made-up values for ${planned.length} members.`);
}

main().catch((error: unknown) => {
  console.error(`\n${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
});
