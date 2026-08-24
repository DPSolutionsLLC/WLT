import { z } from "zod";
import {
  KNOWLEDGE_STATUSES,
  KNOWLEDGE_TYPE_TAGS,
  MAX_UPLOAD_BYTES,
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

export const uploadMetadataSchema = z.object({
  title: z
    .string()
    .trim()
    .min(1, "Give the document a title.")
    .max(MAX_DOCUMENT_TITLE, `Keep the title to ${MAX_DOCUMENT_TITLE} characters.`),
  typeTag: z.enum(KNOWLEDGE_TYPE_TAGS),
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
});
export type SearchRequestInput = z.infer<typeof searchRequestSchema>;

// Re-exported so a route importing the schemas gets the limit from the same module, rather than
// reaching past it into types/domain.ts and eventually disagreeing with the form.
export { MAX_UPLOAD_BYTES };
