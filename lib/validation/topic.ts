import { z } from "zod";

// No wardId on any schema here, ever — it comes from the session (conventions.md §Validation).
//
// The topic LIBRARY's schemas (create, update, list, review a candidate) went with the library
// (migration 086, 2026-09-29). A talk's topic is its words, validated in lib/validation/assignment.ts.

// ---------------------------------------------------------------------------
// "The topics for this Sunday are decided" — p4-sacrament-b2
// ---------------------------------------------------------------------------
// A BOOLEAN, NOT AN INSTANT. The caller says WHETHER the day is settled; the server decides WHEN,
// exactly as closeActivityProfileSchema does and as no request body in this app carries its own
// `recordedBy` or `createdAt`. A client-supplied timestamp would record a moment nobody chose,
// and `sundays.topics_finalized_at` is the only durable record of when the decision was taken —
// migration 078 deliberately stores no `_by` column beside it.
//
// It lives in the TOPIC schemas rather than the calendar ones because the permission behind it is
// `topics.manage`. The column is on `sundays`; the decision is about topics.
export const setTopicsFinalizedSchema = z.object({ finalized: z.boolean() });
export type SetTopicsFinalizedInput = z.infer<typeof setTopicsFinalizedSchema>;
