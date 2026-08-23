import { z } from "zod";
import {
  TOPIC_CANDIDATE_STATUSES,
  TOPIC_CATEGORIES,
  TOPIC_STATUSES,
} from "@/types/domain";

// No wardId on any schema here, ever — it comes from the session (conventions.md §Validation).

export const MAX_TOPIC_TITLE = 160;
export const MAX_TOPIC_DESCRIPTION = 2000;
export const MAX_SUGGESTIONS = 12;

// `suggested_scriptures` and `suggested_talks` are jsonb, and NOTHING validates a jsonb blob on
// read. Phase 6 reads both directly to build the printed program, so a malformed entry stored
// today breaks a program PDF months from now, far from the boundary that accepted it — the same
// reasoning calendar-a gives for `slot_config`.
//
// A plain array of trimmed non-empty strings. References like "Mosiah 2:17" and talk titles are
// both text; giving either one a richer shape now would be guessing at what Phase 5 emits.
const suggestionListSchema = z
  .array(
    z
      .string()
      .trim()
      .min(1, "A suggestion cannot be blank.")
      .max(200, "Keep each suggestion to 200 characters."),
  )
  .max(MAX_SUGGESTIONS, `Keep it to ${MAX_SUGGESTIONS} suggestions.`)
  .nullable()
  .optional();

export const createTopicSchema = z.object({
  title: z
    .string()
    .trim()
    .min(1, "Give the topic a title.")
    .max(MAX_TOPIC_TITLE, `Keep the title to ${MAX_TOPIC_TITLE} characters.`),
  category: z.enum(TOPIC_CATEGORIES),
  description: z
    .string()
    .trim()
    .max(MAX_TOPIC_DESCRIPTION, `Keep the description to ${MAX_TOPIC_DESCRIPTION} characters.`)
    .nullable()
    .optional(),
  suggestedScriptures: suggestionListSchema,
  suggestedTalks: suggestionListSchema,
});
export type CreateTopicInput = z.infer<typeof createTopicSchema>;

// `status` is here so a topic can be ARCHIVED, and archiving is the only way a topic leaves the
// library. There is no delete route: a topic referenced by an assignment must not vanish from
// that assignment's history.
export const updateTopicSchema = z
  .object({
    title: z
      .string()
      .trim()
      .min(1, "Give the topic a title.")
      .max(MAX_TOPIC_TITLE, `Keep the title to ${MAX_TOPIC_TITLE} characters.`)
      .optional(),
    category: z.enum(TOPIC_CATEGORIES).optional(),
    description: z
      .string()
      .trim()
      .max(MAX_TOPIC_DESCRIPTION, `Keep the description to ${MAX_TOPIC_DESCRIPTION} characters.`)
      .nullable()
      .optional(),
    suggestedScriptures: suggestionListSchema,
    suggestedTalks: suggestionListSchema,
    status: z.enum(TOPIC_STATUSES).optional(),
  })
  .superRefine((value, context) => {
    if (Object.keys(value).length === 0) {
      context.addIssue({ code: "custom", message: "Nothing was changed." });
    }
  });
export type UpdateTopicInput = z.infer<typeof updateTopicSchema>;

// `status` defaults to active-only, so the library never shows archived topics unless somebody
// asks for them. `includeArchived` is a separate flag rather than a status list, because there
// are exactly two states and a list invites a caller to ask for archived alone by accident.
export const listTopicsQuerySchema = z.object({
  category: z.enum(TOPIC_CATEGORIES).optional(),
  status: z.enum(TOPIC_STATUSES).optional(),
});
export type ListTopicsQuery = z.infer<typeof listTopicsQuerySchema>;

// Accept or reject ONE candidate. There is no array here and no "accept all", deliberately: a
// bulk accept is an auto-add wearing a button, and CLAUDE.md rule 3 says every generated topic
// is a draft a human accepts individually.
//
// `pending` is excluded from the target: this schema expresses a REVIEW, and reviewing something
// back to pending is not a thing a person does.
export const reviewCandidateSchema = z.object({
  candidateId: z.uuid("That candidate id is not valid."),
  status: z.enum(
    TOPIC_CANDIDATE_STATUSES.filter((status) => status !== "pending") as [
      "accepted",
      "rejected",
    ],
  ),
});
export type ReviewCandidateInput = z.infer<typeof reviewCandidateSchema>;
