import { z } from "zod";
import { dateOnlySchema } from "@/lib/validation/calendar";
import type { HymnRef, NameField, ProgramDraft } from "@/lib/program/draft";

// THE PRIVACY BOUNDARY OF THIS APPLICATION. Read this before adding a field.
//
// ---------------------------------------------------------------------------------------------
// WHAT THIS FILE IS
// ---------------------------------------------------------------------------------------------
// /public/[slug] is unauthenticated and indexable. Everything else in the app can be wrong and be
// fixed; this can be wrong and be crawled. toPublicProgram() is the ONE place that decides what a
// stranger may read, and `programs.public_data` stores nothing but its output.
//
// ---------------------------------------------------------------------------------------------
// THE RULE, STATED ONCE (SPEC.md §Public Pages holds the same table)
// ---------------------------------------------------------------------------------------------
//   Ward name, meeting date, meeting order   PUBLIC   the point of the page
//   Hymn number and title                    PUBLIC   printed on every paper program
//   EVERY person's name                      PUBLIC, IN FULL — first and last, the same on the
//                                                     paper and on the web (see below)
//   Announcements, ward business, notes      PUBLIC   written to be read aloud to everyone
//   Phone numbers                            NEVER
//   Street addresses and emails              NEVER
//   Leadership contacts                      NEVER    names AND phone numbers of real people
//   Missionary information                   NEVER    same, and often a personal phone
//   Member ids, user ids, any identifier     NEVER
//   Anything not in that list                NEVER    default deny
//
// ---------------------------------------------------------------------------------------------
// NAMES ARE PUBLISHED IN FULL. A DECISION MADE ON 2026-08-24, NOT AN OVERSIGHT.
// ---------------------------------------------------------------------------------------------
// This page used to shorten a ward member to "Sarah W." while naming a visiting speaker in full.
// Walking scenario 032 with a person reading the real page settled that the split read as a BUG
// sitting next to the visitor's full name rather than as a rule. A sacrament programme names the
// people taking part, and it names all of them the same way.
//
// So the shortening is gone (publicNameFor in lib/program/assembleDraft.ts). Nothing else in the
// table moved — and the rows below the names are where the real exposure always was. A full name
// is what a congregation already reads off a handout in the foyer. A phone number, a street
// address and a list of leaders with their mobiles are not, and this file is still the only thing
// standing between those and the open internet.
//
// The page is served with `noindex`, so the ward's names are reachable by anyone holding the link
// and are not gathered into a search index (app/public/layout.tsx). That is a smaller promise
// than the shortening was. It is deliberate.
//
// If the decision is ever revisited it is one function in assembleDraft.ts plus the stored
// publicName of any programme already approved. It does not belong in this file.
//
// ---------------------------------------------------------------------------------------------
// THREE PROPERTIES THAT MAKE IT SAFE. DO NOT WEAKEN ANY OF THEM.
// ---------------------------------------------------------------------------------------------
// 1. IT SELECTS, IT DOES NOT TRANSFORM. Every name here reads `publicName`, which
//    lib/program/assembleDraft.ts defaulted when the draft was assembled and which the bishopric
//    can edit per programme. The word `printedName` does not appear in this file and must never
//    appear in it. The two now default to the SAME text, which makes reading either one look
//    harmless — that is exactly why the rule has to be kept out of habit rather than because the
//    output would visibly differ. `publicName` is the field a ward edits when it wants the web to
//    say something the handout does not; reading `printedName` would silently discard that edit.
//
// 2. THE OBJECT IS BUILT FIELD BY FIELD, LITERALLY. Never `{ ...draft }` followed by deleting
//    keys. A spread-then-delete publishes every field added to ProgramDraft afterwards, and it
//    fails silently — nothing throws, nothing logs, the leak is simply on the page.
//
// 3. THE FORBIDDEN FIELDS ARE ABSENT FROM THE TYPE, NOT SET TO NULL. PublicProgram has no
//    `leadershipContacts`, no `missionaries` and no `missing`. A field that does not exist cannot
//    be accidentally populated by a later edit, and an attempt to render one is a type error
//    rather than a review miss.
//
// ---------------------------------------------------------------------------------------------
// IF YOU ARE HERE TO ADD A FIELD
// ---------------------------------------------------------------------------------------------
// Adding a field here is a DECISION to publish it to the open internet, not a plumbing change.
// Add it to the table above and to SPEC.md §Public Pages in the same change, and make sure
// tests/lib/publicProjection.test.ts still passes — it scans the serialised output for the
// fixture's phone number, street address, email and member id, so a field carrying one of them
// fails without anybody having to remember to update the assertion.

export const PUBLIC_PROGRAM_VERSION = 1;

// The types are INFERRED FROM ZOD SCHEMAS, the same way lib/program/draft.ts does it, because
// public_data comes back out of jsonb untyped and the page must parse rather than cast
// (lib/program/queries.ts mapProgramRow, for the same reason).
//
// It buys a second, quieter guarantee at the read boundary: z.object STRIPS unknown keys, so if a
// field ever reaches that column by some route this file did not write, the page still cannot
// render it. Parse on the way out as well as building carefully on the way in.

export const publicHymnSchema = z.object({
  number: z.number().int().positive(),
  title: z.string(),
});
export type PublicHymn = z.infer<typeof publicHymnSchema>;

export const publicSpeakerSchema = z.object({
  slotNumber: z.number().int().positive(),
  name: z.string().nullable(),
  topic: z.string().nullable(),
});
export type PublicSpeaker = z.infer<typeof publicSpeakerSchema>;

// `performer` and `pieceTitle` are BOTH nullable, which the plan's sketch had as plain strings.
// A musical number with a piece title and nobody yet named is a state the draft can hold, and the
// alternatives were dropping the whole block or storing "" — an empty string renders as a real
// value somebody typed. A null renders as nothing at all (talks-c), which is what an absence is.
export const publicMusicalNumberSchema = z.object({
  performer: z.string().nullable(),
  pieceTitle: z.string().nullable(),
});
export type PublicMusicalNumber = z.infer<typeof publicMusicalNumberSchema>;

// A literal version, for the same reason draft.ts has one: public_data is untyped jsonb that will
// outlive this plan, and a projection written by a future version must fail the parse loudly
// rather than be rendered as though it were this one.
export const publicProgramSchema = z.object({
  version: z.literal(PUBLIC_PROGRAM_VERSION),
  heading: z.string().nullable(),
  date: dateOnlySchema,
  presiding: z.string().nullable(),
  conducting: z.string().nullable(),
  organist: z.string().nullable(),
  chorister: z.string().nullable(),
  openingHymn: publicHymnSchema.nullable(),
  invocation: z.string().nullable(),
  wardBusiness: z.string().nullable(),
  sacramentHymn: publicHymnSchema.nullable(),
  specialNotes: z.string().nullable(),
  musicalNumber: publicMusicalNumberSchema.nullable(),
  speakers: z.array(publicSpeakerSchema),
  closingHymn: publicHymnSchema.nullable(),
  benediction: z.string().nullable(),
  announcements: z.string().nullable(),
});
export type PublicProgram = z.infer<typeof publicProgramSchema>;

// Blank is an absence, and it is normalised HERE rather than in the panel, so every consumer of
// PublicProgram sees one representation of "nobody" instead of two.
function publicText(value: string | null): string | null {
  const trimmed = value?.trim() ?? "";
  return trimmed === "" ? null : trimmed;
}

// The only way a person's name leaves this module.
function publicNameOf(name: NameField | null): string | null {
  return publicText(name?.publicName ?? null);
}

function publicHymnOf(hymn: HymnRef | null): PublicHymn | null {
  if (hymn === null) return null;
  return { number: hymn.number, title: hymn.title.trim() };
}

export function toPublicProgram(draft: ProgramDraft): PublicProgram {
  const musical = draft.musicalNumber;
  const performer = publicNameOf(musical?.performer ?? null);
  const pieceTitle = publicText(musical?.pieceTitle ?? null);

  return {
    version: PUBLIC_PROGRAM_VERSION,
    heading: publicText(draft.heading),
    date: draft.date,
    presiding: publicNameOf(draft.presiding),
    conducting: publicNameOf(draft.conducting),
    organist: publicNameOf(draft.organist),
    chorister: publicNameOf(draft.chorister),
    openingHymn: publicHymnOf(draft.openingHymn),
    invocation: publicNameOf(draft.invocation),
    wardBusiness: publicText(draft.wardBusiness),
    sacramentHymn: publicHymnOf(draft.sacramentHymn),
    specialNotes: publicText(draft.specialNotes),
    // Omitted entirely when there is neither a performer nor a piece — an empty block on a public
    // page reads as a musical number the page failed to load.
    musicalNumber:
      musical === null || (performer === null && pieceTitle === null)
        ? null
        : { performer, pieceTitle },
    // `kind` is NOT carried through. A stranger has no business knowing which names came from the
    // ward roster and which were typed; publishing the discriminator would say "this one is a
    // member" beside every shortened name.
    speakers: draft.speakers.map((speaker) => ({
      slotNumber: speaker.slotNumber,
      name: publicText(speaker.publicName),
      topic: publicText(speaker.topic),
    })),
    closingHymn: publicHymnOf(draft.closingHymn),
    benediction: publicNameOf(draft.benediction),
    announcements: publicText(draft.announcements),
  };
}
