import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";
import { listAssignments, type Assignment } from "@/lib/assignments/queries";
import {
  bishopricDisplayName,
  getSunday,
  listBishopricUsers,
  type Sunday,
} from "@/lib/calendar/queries";
import {
  getMusicalNumber as readMusicalNumberRow,
  listSelections,
} from "@/lib/music/queries";
import { listPrayers, type Prayer } from "@/lib/prayers/queries";
import { listMembers } from "@/lib/roster/queries";
import { listTopicOptions } from "@/lib/topics/queries";
import type { Database } from "@/types/database";
import { MEMBER_STATUSES, type HymnType } from "@/types/domain";

// The I/O half of the program builder. Everything assembleDraft() needs, read once.
//
// This is the ONLY file in lib/program that touches Supabase. assembleDraft.ts and diff.ts are
// pure so they can be tested without a network and rendered by program-b without a session.
//
// SERVER-ONLY — it reads through modules that import next/headers. A client component importing
// this file fails `npm run build` while passing lint and typecheck
// (plans/retros/roster-b-picker-and-orgs.md).
//
// EVERY READ GOES THROUGH AN EXISTING QUERY MODULE. No `.from("prayer_assignments")` here, no
// `.from("assignments")`, no `.from("sundays")`, no `.from("hymn_selections")` — talks-c asked
// for exactly that, because a second reader of a table is a second place for the ward scope and
// the stage rules to drift.
//
// The last two exceptions closed with program-e. hymn_selections and musical_numbers were read
// inline here because no module owned them; lib/music/queries.ts does now, and this file is the
// only one outside that plan that changed (program-a §Integration Notes).

export type HymnSelection = {
  hymnType: HymnType;
  hymnNumber: number | null;
  hymnTitle: string | null;
};

export type MusicalNumber = {
  performer: string | null;
  pieceTitle: string | null;
  notes: string | null;
};

export type ProgramLeadershipContact = {
  role: string;
  name: string;
  phone: string | null;
};

export type ProgramTemplate = {
  wardName: string | null;
  churchName: string | null;
  coverImageUrl: string | null;
  fontFamily: string | null;
  primaryColor: string | null;
};

export type ProgramWardSettings = {
  leadershipContacts: ProgramLeadershipContact[];
  missionaries: string | null;
  // Read here and carried, but NOT stored in the draft: it describes how the PDF looks rather
  // than what the meeting is, so program-d reads it at render time. It lives in this type so that
  // program-d has one reader of wards.settings rather than a second one of its own.
  template: ProgramTemplate;
};

export type ProgramSources = {
  sunday: Sunday;
  assignments: Assignment[];
  prayers: Prayer[];
  memberNames: Record<string, string>;
  topicTitles: Record<string, string>;
  hymnSelections: HymnSelection[];
  musicalNumber: MusicalNumber | null;
  bishopName: string | null;
  conductingName: string | null;
  wardSettings: ProgramWardSettings;
};

// Every field defaults, and a malformed entry is DROPPED rather than throwing. A ward whose
// settings are `{}` — which is every ward until somebody fills in Phase 11's admin screen — must
// still produce a program. A settings blob that cannot be parsed is a missing back panel, not a
// builder that refuses to open.
const leadershipContactSchema = z.object({
  role: z.string().catch(""),
  name: z.string().catch(""),
  phone: z.string().nullable().catch(null),
});

const programSettingsSchema = z.object({
  leadership_contacts: z
    .array(leadershipContactSchema)
    .catch([])
    .transform((contacts) => contacts.filter((contact) => contact.name !== "")),
  missionaries: z.string().nullable().catch(null),
  program_template: z
    .object({
      ward_name: z.string().nullable().catch(null),
      church_name: z.string().nullable().catch(null),
      cover_image_url: z.string().nullable().catch(null),
      font_family: z.string().nullable().catch(null),
      primary_color: z.string().nullable().catch(null),
    })
    .catch({
      ward_name: null,
      church_name: null,
      cover_image_url: null,
      font_family: null,
      primary_color: null,
    }),
});

export function parseProgramWardSettings(settings: unknown): ProgramWardSettings {
  const source =
    settings === null || typeof settings !== "object" || Array.isArray(settings)
      ? {}
      : (settings as Record<string, unknown>);

  const parsed = programSettingsSchema.parse({
    leadership_contacts: source.leadership_contacts ?? [],
    missionaries: source.missionaries ?? null,
    program_template: source.program_template ?? {},
  });

  return {
    leadershipContacts: parsed.leadership_contacts,
    missionaries: parsed.missionaries === "" ? null : parsed.missionaries,
    template: {
      wardName: parsed.program_template.ward_name,
      churchName: parsed.program_template.church_name,
      coverImageUrl: parsed.program_template.cover_image_url,
      fontFamily: parsed.program_template.font_family,
      primaryColor: parsed.program_template.primary_color,
    },
  };
}

async function readWardSettings(
  supabase: SupabaseClient<Database>,
  wardId: string,
): Promise<ProgramWardSettings> {
  const { data, error } = await supabase
    .from("wards")
    .select("settings")
    .eq("id", wardId)
    .maybeSingle();

  if (error) {
    console.error(`Could not read the ward's program settings — ${error.message}`, {
      wardId,
    });
    throw new Error(`Could not read the ward's program settings: ${error.message}`);
  }

  return parseProgramWardSettings(data?.settings ?? null);
}

// The two music readers, now thin adapters over lib/music/queries.ts.
//
// They stay as named functions rather than becoming inline calls because the draft's shape is
// NARROWER than the table's: a snapshot needs the slot, the number and the title, and has no use
// for the row id, who chose it, or whether the AI suggested it. Mapping here means a field added
// to hymn_selections cannot leak into a stored program by accident.
//
// A hymn stored with a number and no title is returned exactly as it is stored. The hymnbook is
// only partly verified, and the snapshot must record what was actually chosen (lib/pdf/values.ts
// prints the number alone for that case).
async function readHymnSelections(
  wardId: string,
  sundayId: string,
  supabase: SupabaseClient<Database>,
): Promise<HymnSelection[]> {
  const selections = await listSelections(wardId, { sundayId }, supabase);

  return selections.map((selection) => ({
    hymnType: selection.hymnType,
    hymnNumber: selection.hymnNumber,
    hymnTitle: selection.hymnTitle,
  }));
}

async function readMusicalNumber(
  wardId: string,
  sundayId: string,
  supabase: SupabaseClient<Database>,
): Promise<MusicalNumber | null> {
  const musicalNumber = await readMusicalNumberRow(wardId, sundayId, supabase);

  if (musicalNumber === null) return null;

  return {
    performer: musicalNumber.performer,
    pieceTitle: musicalNumber.pieceTitle,
    notes: musicalNumber.notes,
  };
}

// EVERY status, not the active-only default.
//
// A member who moved out in June still spoke in May, and their name still has to print on that
// program. DEFAULT_MEMBER_STATUSES exists to stop a moved-out member inflating a rotation or a
// visit denominator (lib/roster/queries.ts); resolving a name that an assignment already points
// at is the opposite situation, and filtering here would silently blank a real speaker.
//
// One query for the whole roster rather than one per referenced id. A ward is a few hundred rows
// and this runs on an explicit build or refresh, never in a render loop. If listMembers ever
// grows an id filter, this is the call site that wants it.
async function readMemberNames(
  supabase: SupabaseClient<Database>,
  wardId: string,
): Promise<Record<string, string>> {
  const members = await listMembers(wardId, { statuses: MEMBER_STATUSES }, supabase);

  return Object.fromEntries(
    members.map((member) => [
      member.id,
      [member.firstName, member.lastName].filter(Boolean).join(" ").trim(),
    ]),
  );
}

async function readTopicTitles(
  wardId: string,
  supabase: SupabaseClient<Database>,
): Promise<Record<string, string>> {
  const topics = await listTopicOptions(wardId, supabase);
  return Object.fromEntries(topics.map((topic) => [topic.id, topic.title]));
}

// Returns null when the Sunday is not in this ward — the route turns that into a 404. It does not
// throw: a row that is not in this ward and a row RLS refused are indistinguishable here, and both
// mean "not yours" (plans/retros/foundation-c-services.md).
export async function gatherProgramSources(
  wardId: string,
  sundayId: string,
  supabase: SupabaseClient<Database>,
): Promise<ProgramSources | null> {
  const sunday = await getSunday(wardId, sundayId, supabase);
  if (!sunday) return null;

  // Independent reads, so they run together. None of them needs another's result — only the
  // Sunday lookup above had to happen first, because everything else is keyed on its id.
  const [
    assignments,
    prayers,
    memberNames,
    topicTitles,
    hymnSelections,
    musicalNumber,
    bishopric,
    wardSettings,
  ] = await Promise.all([
    listAssignments(wardId, { sundayId }, supabase),
    listPrayers(wardId, { sundayId }, supabase),
    readMemberNames(supabase, wardId),
    readTopicTitles(wardId, supabase),
    readHymnSelections(wardId, sundayId, supabase),
    readMusicalNumber(wardId, sundayId, supabase),
    listBishopricUsers(wardId, supabase),
    readWardSettings(supabase, wardId),
  ]);

  const bishop = bishopric.find((member) => member.role === "bishop") ?? null;
  const conducting =
    sunday.conductingUserId === null
      ? null
      : (bishopric.find((member) => member.id === sunday.conductingUserId) ?? null);

  return {
    sunday,
    assignments,
    prayers,
    memberNames,
    topicTitles,
    hymnSelections,
    musicalNumber,
    bishopName: bishop === null ? null : bishopricDisplayName(bishop),
    conductingName: conducting === null ? null : bishopricDisplayName(conducting),
    wardSettings,
  };
}

// ---------------------------------------------------------------------------------------------
// program-d's reader
// ---------------------------------------------------------------------------------------------
// The template and the ward's own name, in one read, for the PDF renderer.
//
// This is what the ProgramWardSettings comment above means by "program-d reads it at render
// time": the template describes how the programme LOOKS, so it is deliberately not stored in the
// snapshot, and this is the one function that fetches it. Not a second reader of wards.settings —
// the same parseProgramWardSettings() every other caller uses.
//
// `wards.name` comes along because resolveTheme() needs a fallback for a ward that has never
// filled in program_template.ward_name, which is every ward until Phase 11's admin screen exists.
export async function readProgramRenderSettings(
  wardId: string,
  client: SupabaseClient<Database>,
): Promise<{ settings: ProgramWardSettings; wardName: string }> {
  const { data, error } = await client
    .from("wards")
    .select("name, settings")
    .eq("id", wardId)
    .maybeSingle();

  if (error) {
    console.error(`Could not read the ward's program settings — ${error.message}`, {
      wardId,
    });
    throw new Error(`Could not read the ward's program settings: ${error.message}`);
  }

  return {
    settings: parseProgramWardSettings(data?.settings ?? null),
    wardName: data?.name ?? "",
  };
}
