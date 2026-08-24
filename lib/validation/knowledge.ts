import { z } from "zod";
import { parseConferenceDate } from "@/lib/knowledge/conferenceMetadata";
import {
  KNOWLEDGE_STATUSES,
  KNOWLEDGE_TYPE_TAGS,
  MAX_UPLOAD_BYTES,
  SPEAKER_ROLES,
} from "@/types/domain";

// No wardId on any schema here, ever — it comes from the session (conventions.md §Validation).
//
// THIS MODULE MUST STAY CLIENT-SAFE. conventions.md puts /lib/validation on both sides of the
// boundary, and UploadForm imports it. That is why the search ceiling is DEFINED here and
// imported BY lib/ai/retrieve.ts as MAX_MATCH_COUNT, rather than the other way round —
// retrieve.ts reaches next/headers through the Supabase server client, and importing it here
// would break the browser build of every form that validates against these schemas.
//
// THE FILE ITSELF IS NOT DESCRIBED HERE. A `File` is not something Zod should be asked to
// validate: size and type are checked in app/api/knowledge/upload/route.ts against
// MAX_UPLOAD_BYTES and resolveUploadType(), each with its own message, because "too big" and
// "wrong kind of file" are two different mistakes and deserve two different sentences.
// This file validates the metadata that travels ALONGSIDE it.

export const MAX_DOCUMENT_TITLE = 200;
export const MAX_SEARCH_QUERY = 500;

// The most passages any single retrieval may return. Re-exported by lib/ai/retrieve.ts as
// MAX_MATCH_COUNT — one number, two names, because the retrieval module is where a reader
// looks for it and the validation module is where the browser can safely reach it.
export const MAX_SEARCH_RESULTS = 8;

// The weakest score worth showing a reader. Defined here rather than in lib/ai/retrieve.ts for
// the reason above: describeSimilarity() runs in the browser and the two belong together.
// Re-exported by retrieve.ts, which is where server code looks for it.
export const SIMILARITY_FLOOR = 0.3;

// The bands a score is READ as. Calibrated to the range this model and this corpus actually
// produce, NOT to 0–1: real queries land between roughly 0.32 and 0.45, so a naive scale calling
// 0.4 "weak" would mislabel the best result a ward ever sees.
//
// Words rather than the raw number, decided by walking scenario 022. The number ordered the
// results correctly and meant nothing without a scale — 0.405 is only legible to someone who
// already knows the range, which is nobody reading this screen. Ordering is carried by the list
// itself. Do not reinstate the number without deciding what tells a bishop 0.405 is good.
const SIMILARITY_BANDS: readonly { floor: number; label: string }[] = [
  { floor: 0.5, label: "Strong match" },
  { floor: 0.4, label: "Close match" },
  { floor: SIMILARITY_FLOOR, label: "Loosely related" },
];

export function describeSimilarity(similarity: number): string {
  const band = SIMILARITY_BANDS.find((candidate) => similarity >= candidate.floor);

  // Below the floor is unreachable through search, but a caller holding such a number must still
  // render words rather than an empty span.
  return band?.label ?? "Weak match";
}

export const MAX_SPEAKER_NAME = 80;
export const MAX_FILTER_LABEL = 60;
export const MAX_FILTER_PHRASE = 200;
export const MAX_FILTER_SPEAKERS = 10;

// CONFERENCE METADATA IS REQUIRED FOR A CONFERENCE TALK AND FORBIDDEN FOR ANYTHING ELSE.
//
// Required in that branch because an unlabelled conference talk is a document no filter can
// reach — and per migration 033 that means it is silently ALWAYS INCLUDED, which is the one
// failure this whole feature exists to prevent. Refusing it at upload is far cheaper than
// discovering it in a suggestion six months later.
//
// Forbidden for the others because a speaker on a standard-works document is a field that would
// sort, display and filter as though it meant something. It does not.
export const uploadMetadataSchema = z
  .object({
    title: z
      .string()
      .trim()
      .min(1, "Give the document a title.")
      .max(MAX_DOCUMENT_TITLE, `Keep the title to ${MAX_DOCUMENT_TITLE} characters.`),
    typeTag: z.enum(KNOWLEDGE_TYPE_TAGS),
    speaker: z
      .string()
      .trim()
      .max(MAX_SPEAKER_NAME, `Keep the speaker's name to ${MAX_SPEAKER_NAME} characters.`)
      .nullable()
      .default(null),
    speakerRole: z.enum(SPEAKER_ROLES).nullable().default(null),
    // Accepts what a person would type — "April 2026", "2026-04" — and is normalised to the
    // first of the month by the same parser the ingest script uses.
    conferenceDate: z.string().trim().nullable().default(null),
  })
  .superRefine((value, context) => {
    if (value.typeTag !== "general_conference") {
      if (value.speaker || value.speakerRole || value.conferenceDate) {
        context.addIssue({
          code: "custom",
          path: ["typeTag"],
          message:
            "Speaker and conference date belong to general conference talks only. Change the kind of document, or clear those fields.",
        });
      }
      return;
    }

    if (!value.speaker || value.speaker.trim() === "") {
      context.addIssue({
        code: "custom",
        path: ["speaker"],
        message: "Name the speaker. Without it this talk cannot be reached by any filter.",
      });
    }

    if (value.speakerRole === null) {
      context.addIssue({
        code: "custom",
        path: ["speakerRole"],
        message: "Choose the calling the speaker held when they gave this talk.",
      });
    }

    if (!value.conferenceDate || parseConferenceDate(value.conferenceDate) === null) {
      context.addIssue({
        code: "custom",
        path: ["conferenceDate"],
        message: 'Give the conference as a month and year — for example "April 2026".',
      });
    }
  });
export type UploadMetadataInput = z.infer<typeof uploadMetadataSchema>;

// STATUS IS THE ONLY MUTABLE FIELD, deliberately. Re-titling would desynchronise every source
// label already embedded in a draft somebody is part-way through reading — the citation would
// name a document that no longer answers to that name. A document is retitled by deleting and
// re-uploading it, which re-embeds the labels too.
export const documentPatchSchema = z.object({
  status: z.enum(KNOWLEDGE_STATUSES),
});
export type DocumentPatchInput = z.infer<typeof documentPatchSchema>;

export const searchRequestSchema = z.object({
  query: z
    .string()
    .trim()
    .min(1, "Type something to search for.")
    .max(MAX_SEARCH_QUERY, `Keep the search to ${MAX_SEARCH_QUERY} characters.`),
  limit: z
    .number()
    .int("Ask for a whole number of passages.")
    .min(1, "Ask for at least one passage.")
    .max(MAX_SEARCH_RESULTS, `Ask for at most ${MAX_SEARCH_RESULTS} passages.`)
    .optional(),
  // DEFAULTS TO TRUE — the tester searches the ward's saved scope unless told otherwise.
  //
  // Scoped is the HONEST preview: it shows what topic suggestions will actually retrieve, and a
  // bishopric that tested retrieval against the whole corpus would have tested something the AI
  // never sees. The toggle exists because searching everything is genuinely more useful while
  // DECIDING what the scope should be, which is a different question asked on the same screen.
  useScope: z.boolean().default(true),
});
export type SearchRequestInput = z.infer<typeof searchRequestSchema>;

// ---------------------------------------------------------------------------------------------
// Saved filters
// ---------------------------------------------------------------------------------------------
//
// The ACCEPT half of propose-show-accept. /api/knowledge/filters/resolve returns a proposal and
// saves nothing; this is the body that turns one into a row, and it carries the resolved axes
// rather than the phrase so that what gets stored is exactly what the user read and agreed to
// (CLAUDE.md rule 3). `sourcePhrase` travels along only as the record of what produced it.
//
// EMPTY ARRAYS ARE REFUSED, NOT COERCED. `= any ('{}')` matches nothing, so a filter saved with
// an empty array would silently narrow the corpus to zero while reading like "no restriction".
// Migration 034's CHECK constraints refuse the same shape at the other end.
export const filterSaveSchema = z
  .object({
    label: z
      .string()
      .trim()
      .min(1, "Give the filter a name.")
      .max(MAX_FILTER_LABEL, `Keep the name to ${MAX_FILTER_LABEL} characters.`),
    sourcePhrase: z
      .string()
      .trim()
      .min(1, "The phrase this filter came from is missing.")
      .max(MAX_FILTER_PHRASE, `Keep the phrase to ${MAX_FILTER_PHRASE} characters.`),
    speakerRoles: z
      .array(z.enum(SPEAKER_ROLES))
      .min(1, "A filter on callings needs at least one calling.")
      .nullable()
      .default(null),
    speakers: z
      .array(
        z
          .string()
          .trim()
          .min(1, "A speaker's name cannot be blank.")
          .max(MAX_SPEAKER_NAME, `Keep a speaker's name to ${MAX_SPEAKER_NAME} characters.`),
      )
      .min(1, "A filter on speakers needs at least one speaker.")
      .max(MAX_FILTER_SPEAKERS, `List at most ${MAX_FILTER_SPEAKERS} speakers in one filter.`)
      .nullable()
      .default(null),
    since: z
      .string()
      .regex(/^\d{4}-\d{2}-\d{2}$/, "The date this filter starts from is not a valid date.")
      .nullable()
      .default(null),
  })
  .refine(
    (value) =>
      value.speakerRoles !== null || value.speakers !== null || value.since !== null,
    "This filter would not narrow anything. Name a speaker, a calling, or a date to start from.",
  );
export type FilterSaveInput = z.infer<typeof filterSaveSchema>;

export const filterResolveSchema = z.object({
  phrase: z
    .string()
    .trim()
    .min(1, "Describe the talks you want to reach for.")
    .max(MAX_FILTER_PHRASE, `Keep the description to ${MAX_FILTER_PHRASE} characters.`),
});
export type FilterResolveInput = z.infer<typeof filterResolveSchema>;

// Re-exported so a route importing the schemas gets the limit from the same module, rather than
// reaching past it into types/domain.ts and eventually disagreeing with the form.
export { MAX_UPLOAD_BYTES };
