import { z } from "zod";
import { MAX_SEARCH_QUERY } from "@/lib/validation/knowledge";
import {
  MANUAL_REFERENCE_KINDS,
  REFERENCE_KINDS,
  REFERENCE_SOURCES,
} from "@/types/domain";

// CLIENT-SAFE. ReferencesEditor imports MAX_CITATION for its `maxLength`, so the form and the
// schema are one number. No wardId on any schema — it comes from the session.

// Migration 079's CHECK on `talk_references.citation`.
export const MAX_CITATION = 300;

export const addReferenceSchema = z
  .object({
    assignmentId: z.uuid("That talk id is not valid."),
    kind: z.enum(REFERENCE_KINDS, "Choose whether this is a scripture or a talk."),
    citation: z
      .string()
      .trim()
      .min(1, "Type the reference first.")
      .max(MAX_CITATION, `Keep a reference to ${MAX_CITATION} characters.`),
    source: z.enum(REFERENCE_SOURCES),
    documentId: z.uuid("That document id is not valid.").optional(),
  })
  // A MANUAL REFERENCE CLAIMS NO DOCUMENT, and offers only what the prototype's own `<select>`
  // offers. `other` only ever arrives from search. The database's CHECK refuses the first half
  // too; this says so in a sentence rather than as a constraint violation.
  .refine(
    (input) =>
      input.source !== "manual" ||
      (input.documentId === undefined &&
        (MANUAL_REFERENCE_KINDS as readonly string[]).includes(input.kind)),
    { message: "A reference typed by hand is a scripture or a talk, with no document." },
  );
export type AddReferenceInput = z.infer<typeof addReferenceSchema>;

export const referencesDecisionSchema = z.object({
  decision: z.enum(["finalized", "skipped"]).nullable(),
});
export type ReferencesDecisionInput = z.infer<typeof referencesDecisionSchema>;

// `assignmentId` is validated so the search is provably about one of THIS Sunday's talks, even
// though the retrieval itself needs only the query.
export const referenceSearchSchema = z.object({
  assignmentId: z.uuid("That talk id is not valid."),
  query: z
    .string()
    .trim()
    .min(1, "Type something to search for.")
    .max(MAX_SEARCH_QUERY, `Keep the search to ${MAX_SEARCH_QUERY} characters.`),
});
export type ReferenceSearchInput = z.infer<typeof referenceSearchSchema>;
