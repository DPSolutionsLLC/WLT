import { z } from "zod";
import { MAX_IMPORT_HYMN_NUMBER } from "@/lib/music/hymnSource";
import { HYMN_TYPES } from "@/types/domain";

// No wardId on any schema here, ever — it comes from the session (conventions.md §Validation).
// A schema that accepts a wardId is a schema someone will eventually trust.

export const MAX_SEARCH_QUERY_LENGTH = 100;
export const MAX_SEARCH_RESULTS = 50;
export const DEFAULT_SEARCH_RESULTS = 25;

// The result count is CAPPED rather than trusted. Nothing on this screen wants more than a
// screenful, and a caller asking for 100,000 rows of a table that holds 341 is either confused
// or probing.
export const searchHymnsQuerySchema = z.object({
  query: z
    .string()
    .trim()
    .max(MAX_SEARCH_QUERY_LENGTH, `Keep the search to ${MAX_SEARCH_QUERY_LENGTH} characters.`)
    .default(""),
  limit: z.coerce
    .number()
    .int("Ask for a whole number of results.")
    .min(1, "Ask for at least one result.")
    .max(MAX_SEARCH_RESULTS, `Ask for at most ${MAX_SEARCH_RESULTS} results.`)
    .default(DEFAULT_SEARCH_RESULTS),
});
export type SearchHymnsQuery = z.infer<typeof searchHymnsQuerySchema>;

// The suggestion route takes only the Sunday. Everything else it needs — the topics assigned to
// that Sunday, the candidate hymns, the model, the effort — is resolved server-side. A caller
// that could name its own candidate list could put anything in the prompt, which is the one thing
// this whole feature exists to prevent (ITER-016).
export const suggestHymnsQuerySchema = z.object({
  sundayId: z.uuid("Choose a Sunday from the calendar."),
  hymnType: z.enum(HYMN_TYPES).nullable().default(null),
});
export type SuggestHymnsQuery = z.infer<typeof suggestHymnsQuerySchema>;

export const MAX_HYMN_TITLE_LENGTH = 200;

// `hymnTitle` is required and is stored beside the number, because the program draft is a
// SNAPSHOT: a program approved today must keep printing the title it was approved with even after
// the hymns table is replaced (lib/music/queries.ts).
//
// `aiSuggested` is the only place in the app that flag is set, and it is what makes "how often is
// the AI actually right" answerable later. It defaults to FALSE: a request that forgets to say
// must not be able to claim credit for a person's own choice.
export const selectHymnSchema = z.object({
  sundayId: z.uuid("Choose a Sunday from the calendar."),
  hymnType: z.enum(HYMN_TYPES),
  hymnNumber: z
    .number()
    .int("A hymn number is a whole number.")
    .min(1, "A hymn number starts at 1.")
    .max(MAX_IMPORT_HYMN_NUMBER, "That is not a hymn number."),
  hymnTitle: z
    .string()
    .trim()
    .min(1, "A hymn needs a title.")
    .max(MAX_HYMN_TITLE_LENGTH, `Keep the title to ${MAX_HYMN_TITLE_LENGTH} characters.`),
  aiSuggested: z.boolean().default(false),
});
export type SelectHymnInput = z.infer<typeof selectHymnSchema>;

export const clearHymnSchema = z.object({
  sundayId: z.uuid("Choose a Sunday from the calendar."),
  hymnType: z.enum(HYMN_TYPES),
});
export type ClearHymnInput = z.infer<typeof clearHymnSchema>;

export const MAX_PERFORMER_LENGTH = 200;
export const MAX_PIECE_TITLE_LENGTH = 200;
export const MAX_MUSICAL_NOTES_LENGTH = 500;

// THE PERFORMER IS FREE TEXT, NOT A MEMBER ID. A visiting quartet has no member record, and
// "the Primary children" is a real answer — roster-b's MemberPicker is deliberately not reached
// for here.
//
// An empty box becomes null rather than an empty string, so a field somebody tabbed through
// behaves exactly like a field they never touched. lib/pdf/values.ts prints nothing for null and
// would print nothing for "" too, but only one of the two is a state the data should be able to
// hold.
const optionalText = (max: number, message: string) =>
  z
    .string()
    .trim()
    .max(max, message)
    .nullable()
    .default(null)
    .transform((value) => (value === null || value === "" ? null : value));

export const logMusicalNumberSchema = z
  .object({
    sundayId: z.uuid("Choose a Sunday from the calendar."),
    performer: optionalText(
      MAX_PERFORMER_LENGTH,
      `Keep the performer to ${MAX_PERFORMER_LENGTH} characters.`,
    ),
    pieceTitle: optionalText(
      MAX_PIECE_TITLE_LENGTH,
      `Keep the piece to ${MAX_PIECE_TITLE_LENGTH} characters.`,
    ),
    notes: optionalText(
      MAX_MUSICAL_NOTES_LENGTH,
      `Keep the notes to ${MAX_MUSICAL_NOTES_LENGTH} characters.`,
    ),
  })
  // A musical number with no performer and no piece is not a musical number. Storing a row of
  // nulls would make the PDF render an empty musical-number line on a Sunday that has none, which
  // is the shape MeetingOrderForm already guards against in the program builder. Clearing one is
  // its own verb (DELETE), not an empty save.
  .refine(
    (input) => input.performer !== null || input.pieceTitle !== null,
    "Give at least a performer or a piece.",
  );
export type LogMusicalNumberInput = z.infer<typeof logMusicalNumberSchema>;

export const clearMusicalNumberSchema = z.object({
  sundayId: z.uuid("Choose a Sunday from the calendar."),
});
export type ClearMusicalNumberInput = z.infer<typeof clearMusicalNumberSchema>;
