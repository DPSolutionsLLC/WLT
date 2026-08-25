import { z } from "zod";
import { dateOnlySchema } from "@/lib/validation/calendar";
import { MISSING_FIELD_KEYS, SUNDAY_TYPES } from "@/types/domain";

// The shape of a sacrament program, and the ONE schema that validates it.
//
// ---------------------------------------------------------------------------------------------
// THE DRAFT IS A SNAPSHOT, NOT A VIEW
// ---------------------------------------------------------------------------------------------
// Once written, a draft stops tracking the calendar, the assignments and the prayers it came
// from. An approved program that silently changes after the bishop approved it is a trust
// problem, not a bug — so moving it forward is an explicit refresh that shows a diff first
// (POST /api/programs/[id]/refresh). Nothing here re-derives anything on read.
//
// ---------------------------------------------------------------------------------------------
// EVERY NAME IS A PAIR
// ---------------------------------------------------------------------------------------------
// `printedName` is what goes on the paper handed round a chapel. `publicName` is what may reach
// the open internet on /public/[slug]. A ward member is "Sarah Whitfield" printed and "Sarah W."
// public, because the roster is private data the ward never consented to publish.
//
// An external speaker is BOTH, in full: their name was typed by the bishopric specifically in
// order to be printed, there is no member record to protect, and a visiting stake president is
// named in full on every paper program there has ever been (ITER-004).
//
// program-c's toPublicProgram() reads ONLY publicName. That is what makes the public page safe by
// construction rather than by a SQL CASE a later migration could get wrong. DO NOT add a plain
// `name: string` convenience field to any of these objects — one field exists so the other cannot
// be reached by accident, and a third would defeat both.
//
// ---------------------------------------------------------------------------------------------
// SERVER AND CLIENT BOTH IMPORT THIS
// ---------------------------------------------------------------------------------------------
// program-b renders the editor from these types in a client component, so nothing server-only may
// be imported here (plans/retros/roster-b-picker-and-orgs.md). Zod, the shared date schema and
// types/domain only.

// `printedName` and `publicName` are independently nullable rather than the pair being nullable
// together, because an assembled draft can know a printed name and still be edited to blank one
// half in program-b. A field with no person at all is the enclosing `.nullable()`, not this.
export const nameFieldSchema = z.object({
  printedName: z.string().nullable(),
  publicName: z.string().nullable(),
});
export type NameField = z.infer<typeof nameFieldSchema>;

// BOTH the number and the title, always.
//
// The number alone would mean the snapshot re-resolves a title on every render, which is exactly
// the live-view behaviour this type exists to prevent — and the hymnbook is only partially seeded
// until program-e (42 of 341), so "a number whose title cannot be resolved" is a state that WILL
// occur rather than a hypothetical.
export const hymnRefSchema = z.object({
  number: z.number().int().positive(),
  title: z.string(),
});
export type HymnRef = z.infer<typeof hymnRefSchema>;

// `performer` carries the name pair like every other person on the program. Both halves hold the
// same string: the performer is free text somebody typed in order to have it printed, with no
// member record behind it — the external-speaker case, not the roster case. Applying the
// first-name-plus-initial rule to "The Primary children" would produce "The Primary c.".
export const musicalNumberSchema = z.object({
  performer: nameFieldSchema,
  pieceTitle: z.string(),
  notes: z.string().nullable(),
});
export type MusicalNumberField = z.infer<typeof musicalNumberSchema>;

// A leadership contact carries a PHONE NUMBER, which is why program-c's public projection omits
// this array entirely rather than redacting inside it.
export const contactSchema = z.object({
  role: z.string(),
  name: z.string(),
  phone: z.string().nullable(),
});
export type ContactField = z.infer<typeof contactSchema>;

// `kind` mirrors SPEAKER_KINDS in types/domain.ts. It is stored rather than inferred from whether
// a name is null, because "empty" and "a member whose name could not be resolved" are different
// states and program-b words them differently.
export const programSpeakerSchema = z.object({
  slotNumber: z.number().int().positive(),
  kind: z.enum(["member", "external", "empty"]),
  printedName: z.string().nullable(),
  publicName: z.string().nullable(),
  topic: z.string().nullable(),
});
export type ProgramSpeaker = z.infer<typeof programSpeakerSchema>;

// `version` is not decoration. draft_data is untyped jsonb that will outlive this plan, and a
// stored draft with no version is a migration nobody can write safely later. It is a literal, so
// a draft written by a future version fails the parse loudly instead of being read as this one.
export const PROGRAM_DRAFT_VERSION = 1;

export const programDraftSchema = z.object({
  version: z.literal(PROGRAM_DRAFT_VERSION),
  // null on a standard Sunday, "Ward Conference" on a ward conference. program-d renders NOTHING
  // when it is null — not an empty element (talks-c: an absence renders as an absence).
  heading: z.string().nullable(),
  date: dateOnlySchema,
  sundayType: z.enum(SUNDAY_TYPES),
  presiding: nameFieldSchema,
  conducting: nameFieldSchema,
  organist: nameFieldSchema.nullable(),
  chorister: nameFieldSchema.nullable(),
  openingHymn: hymnRefSchema.nullable(),
  invocation: nameFieldSchema.nullable(),
  wardBusiness: z.string().nullable(),
  sacramentHymn: hymnRefSchema.nullable(),
  specialNotes: z.string().nullable(),
  musicalNumber: musicalNumberSchema.nullable(),
  speakers: z.array(programSpeakerSchema),
  closingHymn: hymnRefSchema.nullable(),
  benediction: nameFieldSchema.nullable(),
  announcements: z.string().nullable(),
  leadershipContacts: z.array(contactSchema),
  missionaries: z.string().nullable(),
  missing: z.array(z.enum(MISSING_FIELD_KEYS)),
});
export type ProgramDraft = z.infer<typeof programDraftSchema>;
