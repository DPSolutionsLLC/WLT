import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";
import { listAssignments, type Assignment } from "@/lib/assignments/queries";
import {
  bishopricDisplayName,
  getSunday,
  listBishopricUsers,
  type Sunday,
} from "@/lib/calendar/queries";
import { listPrayers, type Prayer } from "@/lib/prayers/queries";
import { listMembers } from "@/lib/roster/queries";
import { listTopicOptions } from "@/lib/topics/queries";
import type { Database } from "@/types/database";
import { HYMN_TYPES, MEMBER_STATUSES, type HymnType } from "@/types/domain";

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
// `.from("assignments")`, no `.from("sundays")` — talks-c asked for exactly that, because a
// second reader of a table is a second place for the ward scope and the stage rules to drift.
// The two exceptions are hymn_selections and musical_numbers, which have no query module yet;
// see the comment above readHymnSelections().

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

// TEMPORARY HOME. hymn_selections and musical_numbers have no query module, because nothing has
// needed to read them until now. program-e builds lib/music/queries.ts and owns them properly;
// when it does, these two functions are deleted and gather.ts calls that module instead — it is
// the only file that changes (program-a §Integration Notes).
//
// Kept narrow on purpose: ward-scoped, one Sunday, no writes, no business rules. A hymn that is
// stored with a number and no title is returned as it is stored, because the hymnbook is only
// partially seeded and the snapshot must record what was actually chosen.
async function readHymnSelections(
  supabase: SupabaseClient<Database>,
  wardId: string,
  sundayId: string,
): Promise<HymnSelection[]> {
  const { data, error } = await supabase
    .from("hymn_selections")
    .select("hymn_type, hymn_number, hymn_title")
    .eq("ward_id", wardId)
    .eq("sunday_id", sundayId);

  if (error) {
    console.error(`Could not read the Sunday's hymns — ${error.message}`, {
      wardId,
      sundayId,
    });
    throw new Error(`Could not read the hymn selections: ${error.message}`);
  }

  return (data ?? []).flatMap((row) =>
    row.hymn_type !== null && (HYMN_TYPES as readonly string[]).includes(row.hymn_type)
      ? [
          {
            hymnType: row.hymn_type as HymnType,
            hymnNumber: row.hymn_number,
            hymnTitle: row.hymn_title,
          },
        ]
      : [],
  );
}

// See readHymnSelections() above — same temporary home, same program-e handover.
async function readMusicalNumber(
  supabase: SupabaseClient<Database>,
  wardId: string,
  sundayId: string,
): Promise<MusicalNumber | null> {
  const { data, error } = await supabase
    .from("musical_numbers")
    .select("performer, piece_title, notes")
    .eq("ward_id", wardId)
    .eq("sunday_id", sundayId)
    .order("created_at")
    .limit(1)
    .maybeSingle();

  if (error) {
    console.error(`Could not read the Sunday's musical number — ${error.message}`, {
      wardId,
      sundayId,
    });
    throw new Error(`Could not read the musical number: ${error.message}`);
  }

  if (!data) return null;

  return {
    performer: data.performer,
    pieceTitle: data.piece_title,
    notes: data.notes,
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
    readHymnSelections(supabase, wardId, sundayId),
    readMusicalNumber(supabase, wardId, sundayId),
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
