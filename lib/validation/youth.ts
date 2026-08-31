import { z } from "zod";
import { ACTIVITY_TYPES, EVENT_STATUSES, EVENT_TYPES } from "@/types/domain";

// No wardId and no enteredBy on any schema here, ever. Both come from the session
// (conventions.md §Validation). `orgId` IS here, for the one reason it is on
// createVisitGoalSchema: a bishopric member entering an activity on another organization's
// behalf has to say which one, and the route refuses it from anybody else with a sentence
// rather than ignoring it.

export const MAX_ACTIVITY_NAME = 120;
export const MAX_SCHOOL_ORG = 160;
export const MAX_SEASON_SCHEDULE = 120;
export const MAX_ACTIVITY_NOTES = 2000;
export const MAX_EVENT_TITLE = 200;
export const MAX_EVENT_LOCATION = 240;

// ---------------------------------------------------------------------------
// WHICH MEMBER MAY AN ACTIVITY PROFILE NAME — ONE ANSWER, IN ONE PLACE
// ---------------------------------------------------------------------------
// Both the route's validation and ActivityProfileForm's MemberPicker filter read this constant.
// Two places deciding the same thing and disagreeing is worse than either being wrong
// (plans/retros/visits-b-*, visits-f-*), and a picker that offers a name the route then refuses
// is exactly that shape.
//
// It lives HERE rather than in the form, because a constant imported from a "use client" module
// reaches a Server Component as a function instead of a string — the bug that killed visits-d's
// entire "Log this visit" flow.
export const PROFILE_MEMBER_CATEGORIES = ["youth"] as const;

// ---------------------------------------------------------------------------
// AN EVENT'S INSTANT MUST CARRY ITS OFFSET
// ---------------------------------------------------------------------------
// `activity_events.event_date` is a timestamptz, and the whole of slice B (ICS import) turns on
// getting instants right — "A game showing at the wrong hour makes the whole feature useless"
// is 08-youth-activities.md's own sentence. So slice A must not set a sloppy precedent.
//
// A BARE `2026-09-04T16:00` IS REFUSED. It is a floating time: four o'clock in no particular
// place. `new Date()` would happily read it in the server's zone, store the resulting instant,
// and render it back an hour or eight out. A manual-entry form submits from a browser, which
// always has a zone available, so there is no caller that cannot send one — and accepting one
// here would mean slice B inherits a column whose EXISTING rows already carry the ambiguity it
// exists to prevent.
//
// Accepted: an explicit numeric offset (`+01:00`, `-0600`) or `Z`. Both are unambiguous
// instants, which is the only property this validator cares about.
const OFFSET_BEARING = /(?:[Zz]|[+-]\d{2}:?\d{2})$/;

const FLOATING_TIME_MESSAGE =
  "Give the date and time with its time zone, like 2026-09-04T19:30:00-06:00. A time with no " +
  "zone could be any of two dozen different moments.";

export const eventInstantSchema = z
  .string()
  .trim()
  .min(1, "Give the date and time of the event.")
  .refine((value) => OFFSET_BEARING.test(value), FLOATING_TIME_MESSAGE)
  .refine(
    (value) => Number.isFinite(new Date(value).getTime()),
    "That is not a date and time this app can read.",
  );

// ---------------------------------------------------------------------------
// Activity profiles
// ---------------------------------------------------------------------------

const activityNameSchema = z
  .string()
  .trim()
  .min(1, "Give the activity a name.")
  .max(MAX_ACTIVITY_NAME, `Keep the name to ${MAX_ACTIVITY_NAME} characters.`);

const schoolOrgSchema = z
  .string()
  .trim()
  .max(MAX_SCHOOL_ORG, `Keep the school or club to ${MAX_SCHOOL_ORG} characters.`);

const seasonScheduleSchema = z
  .string()
  .trim()
  .max(MAX_SEASON_SCHEDULE, `Keep the season to ${MAX_SEASON_SCHEDULE} characters.`);

const activityNotesSchema = z
  .string()
  .trim()
  .max(MAX_ACTIVITY_NOTES, `Keep the notes to ${MAX_ACTIVITY_NOTES} characters.`);

export const createActivityProfileSchema = z.object({
  memberId: z.uuid("Choose which youth this activity belongs to."),
  activityName: activityNameSchema,
  activityType: z.enum(ACTIVITY_TYPES),
  schoolOrg: schoolOrgSchema.nullable().optional(),
  seasonSchedule: seasonScheduleSchema.nullable().optional(),
  notes: activityNotesSchema.nullable().optional(),
  orgId: z.uuid("That organization is not valid.").optional(),
});
export type CreateActivityProfileInput = z.infer<typeof createActivityProfileSchema>;

// `memberId` is deliberately NOT patchable, on the precedent visit-goals set with `org_id`:
// moving a profile onto a different youth would silently reassign every event hanging off it,
// and the audit row would record it as an ordinary edit. Delete it and enter the right one.
//
// `orgId` is not patchable either, for the same reason and one more: policy 054d's WITH CHECK
// permits the move, so a partial patch could hand a profile to another organization without the
// audit trail saying that is what happened.
export const updateActivityProfileSchema = z
  .object({
    activityName: activityNameSchema.optional(),
    activityType: z.enum(ACTIVITY_TYPES).optional(),
    schoolOrg: schoolOrgSchema.nullable().optional(),
    seasonSchedule: seasonScheduleSchema.nullable().optional(),
    notes: activityNotesSchema.nullable().optional(),
  })
  .superRefine((value, context) => {
    if (Object.keys(value).length === 0) {
      context.addIssue({ code: "custom", message: "Nothing was changed." });
    }
  });
export type UpdateActivityProfileInput = z.infer<typeof updateActivityProfileSchema>;

// CLOSING A SEASON HAS ITS OWN SCHEMA AND ITS OWN ROUTE, and neither is a field on the patch
// above. Closing is a distinct decision that deserves its own audit action — the precedent
// `approve` sets on assignments and programs — and a partial patch would record it as an ordinary
// edit. That is the reasoning updateActivityProfileSchema already gives for keeping `memberId` and
// `orgId` unpatchable, applied to a third field.
//
// A BOOLEAN, NOT AN INSTANT. The caller says WHETHER the season is finished; the server decides
// WHEN, exactly as no request body in this app carries its own `recordedBy` or `createdAt`. A
// client-supplied timestamp would let a mistyped clock freeze a history page's final percentage
// at an instant nobody chose.
export const closeActivityProfileSchema = z.object({ closed: z.boolean() });
export type CloseActivityProfileInput = z.infer<typeof closeActivityProfileSchema>;

// ---------------------------------------------------------------------------
// Activity events
// ---------------------------------------------------------------------------

const eventTitleSchema = z
  .string()
  .trim()
  .min(1, "Give the event a name.")
  .max(MAX_EVENT_TITLE, `Keep the name to ${MAX_EVENT_TITLE} characters.`);

const eventLocationSchema = z
  .string()
  .trim()
  .max(MAX_EVENT_LOCATION, `Keep the location to ${MAX_EVENT_LOCATION} characters.`);

// No `calendarId`. A hand-entered event belongs to no calendar, and the route writes null — slice
// B's idempotent re-import must never match one of these against a feed's row.
//
// ---------------------------------------------------------------------------
// `eventType` IS OPTIONAL AND HAS NO DEFAULT. THE DEFAULT LOOKS SAFE TO RESTORE. IT IS NOT.
// ---------------------------------------------------------------------------
// It used to read `.default("tbd")`, and that one word made classification impossible. With a
// default, ABSENT AND "tbd" ARRIVE AT THE ROUTE AS THE SAME VALUE, so the route cannot tell "the
// leader left the field alone" from "the leader deliberately chose Not yet known" — and to
// classify anything at all it would have to override an explicit human choice.
//
// Absent means DECIDE FROM THE LOCATION (lib/youth/classifyLocation.ts). Present means A PERSON
// DECIDED, including when they decided "tbd", and nothing may overwrite that.
//
// The column keeps its own `default 'tbd'` in the database (migration 054c), so a row written by
// anything that skips this schema is still valid.
//
// ---------------------------------------------------------------------------
// `occasionWithEventId` NAMES AN EVENT, NOT AN OCCASION, AND THAT IS THE WHOLE POINT
// ---------------------------------------------------------------------------
// ABSENT MEANS THIS GAME IS ONLY THIS YOUNG PERSON'S — the ordinary case, and the same
// absent-means-default idiom `eventType` above uses. PRESENT means the caller is adding a young
// person to a game that already exists as somebody else's row.
//
// It names the OTHER EVENT rather than an occasion id because when a leader adds a missing young
// person to a game that is not yet an occasion, NO OCCASION ID EXISTS for the client to send. A
// client holding one would have to either make two calls that can half-succeed — an occasion
// created, the second row never written — or invent an id. Naming the other event keeps WHICH
// OCCASION a server decision and removes an impossible client state entirely.
//
// It is the same reasoning joinOccasionSchema rests on: a body that could name its own occasion
// is a body that can put a row somewhere nobody looked at.
export const createActivityEventSchema = z.object({
  profileId: z.uuid("Choose which activity this event belongs to."),
  title: eventTitleSchema,
  eventDate: eventInstantSchema,
  location: eventLocationSchema.nullable().optional(),
  eventType: z.enum(EVENT_TYPES).optional(),
  occasionWithEventId: z.uuid("That event is not valid.").optional(),
});
export type CreateActivityEventInput = z.infer<typeof createActivityEventSchema>;

// `profileId` is not patchable, for the reason `memberId` is not: an event that moved between
// activities is a different event.
//
// NEITHER IS THE OCCASION, on the same precedent. Joining and unjoining a game is its own action
// with its own route and its own audit row (`youth_activity_occasion_joined` /
// `_left`), and a partial patch that silently moved a row between occasions would be recorded as
// an ordinary edit — which is exactly the thing somebody asks about when the link turns out to be
// wrong.
export const updateActivityEventSchema = z
  .object({
    title: eventTitleSchema.optional(),
    eventDate: eventInstantSchema.optional(),
    location: eventLocationSchema.nullable().optional(),
    eventType: z.enum(EVENT_TYPES).optional(),
    status: z.enum(EVENT_STATUSES).optional(),
  })
  .superRefine((value, context) => {
    if (Object.keys(value).length === 0) {
      context.addIssue({ code: "custom", message: "Nothing was changed." });
    }
  });
export type UpdateActivityEventInput = z.infer<typeof updateActivityEventSchema>;

// The parameter NAMES here are what GET /api/youth/events reads, and what EventList sends. A
// parameter this schema does not carry gets no error, just a filter that is silently ignored
// (plans/retros/roster-b-picker-and-orgs.md).
//
// `from` and `to` are instants for the same reason `eventDate` is: a page filtering "this week"
// from a browser knows its own zone, and a bare date would mean a different eight hours
// depending on where the server happens to run.
export const listActivityEventsQuerySchema = z.object({
  profileId: z.uuid("That activity is not valid.").optional(),
  // A READ, so it takes the occasion id itself — which certainly exists by the time anybody is
  // reading it. The asymmetry with createActivityEventSchema's `occasionWithEventId` is
  // deliberate and is explained there: on a WRITE the occasion may not exist yet.
  occasionId: z.uuid("That occasion is not valid.").optional(),
  from: eventInstantSchema.optional(),
  to: eventInstantSchema.optional(),
  // A query string carries no booleans. "true" widens the list to past events; anything else,
  // including absent, leaves it on upcoming only.
  includePast: z
    .string()
    .optional()
    .transform((value) => value === "true"),
});
export type ListActivityEventsQuery = z.infer<typeof listActivityEventsQuerySchema>;

// ---------------------------------------------------------------------------
// Who is going
// ---------------------------------------------------------------------------
// NO `eventId` — it is the route parameter. NO `assignedBy` — it comes from the session, which is
// the rule this file's header already states for `wardId` and `enteredBy`. A body that could name
// its own assigner is a body that can forge one.
//
// THE SELF-ADD ROUTE NEEDS NO SCHEMA AT ALL, and deliberately has none: the only two facts are
// the event (a route parameter) and the person (the session). A schema for an empty body would be
// a schema for nothing.
export const assignAttendeeSchema = z.object({
  userId: z.uuid("Choose who is going."),
});
export type AssignAttendeeInput = z.infer<typeof assignAttendeeSchema>;

// ---------------------------------------------------------------------------
// Two young people, one game
// ---------------------------------------------------------------------------
// NO `occasionId` IN THE BODY. The caller names the OTHER EVENT — "this is the same game as that
// one" — and the route decides whether that means creating an occasion or joining an existing
// one. A body that could name its own occasion is a body that can put a row somewhere nobody
// looked at, which is the rule this file's header already states for `wardId` and `enteredBy`
// wearing a different hat.
//
// NO `eventId` either: it is the route parameter.
export const joinOccasionSchema = z.object({
  otherEventId: z.uuid("Choose which event is the same game."),
});
export type JoinOccasionInput = z.infer<typeof joinOccasionSchema>;

// ---------------------------------------------------------------------------
// The follow-up: what happened after the game
// ---------------------------------------------------------------------------
// NO `wardId`, NO `loggedBy`, NO `flagSentAt` on any schema here, ever. The first two come from
// the session — the rule this file's header already states for `wardId` and `enteredBy`, extended
// to `loggedBy` because migration 057c's INSERT policy checks `logged_by = auth.uid()` with no
// bishopric exemption, and a body that could name its own author is a body that can forge one.
//
// `flagSentAt` is the third, and it is the one worth spelling out: it is a separate parameter on
// lib/youth/activityLogs.ts's update, because a body that could stamp its own would be able to
// SILENCE the ward-council notification.
//
// The PRIVATE NOTE HAS ITS OWN SCHEMA AND ITS OWN ROUTE, and is never a field on a log body.
// That is what keeps CLAUDE.md rule 5's "separate table, separate module, separate route" true at
// every layer, including the wire format.

// Shorter than a visit's 4000. A follow-up is an account of one evening — "they played well, Ethan
// had a rough time in the second half, his mum was there" — where a visit note may carry a
// family's circumstances. A limit that is generous everywhere teaches nobody anything about what
// the field is for.
export const MAX_ACTIVITY_SHARED_NOTES = 2000;
export const MAX_ACTIVITY_PRIVATE_NOTES = 2000;

const activitySharedNotesSchema = z
  .string()
  .trim()
  .max(
    MAX_ACTIVITY_SHARED_NOTES,
    `Keep the shared notes to ${MAX_ACTIVITY_SHARED_NOTES} characters.`,
  )
  .nullable()
  .optional();

// ---------------------------------------------------------------------------
// `attended` IS OPTIONAL AND ITS ABSENCE IS MEANINGFUL
// ---------------------------------------------------------------------------
// The same load-bearing distinction `createVisitLogSchema.participants` draws between `undefined`
// and `[]`. ABSENT means the caller said nothing about attendance and the attendee row is left
// exactly as it is; only `true` or `false` writes `confirmed_attendance`.
//
// It has to be that way because the form only ASKS the question when the reader has an attendee
// row. A default would make "the control was never shown" and "they answered no" the same value,
// and the second is a fact somebody stated.
export const createActivityLogSchema = z.object({
  eventId: z.uuid("That event is not valid."),
  sharedNotes: activitySharedNotesSchema,
  attended: z.boolean().optional(),
});
export type CreateActivityLogInput = z.infer<typeof createActivityLogSchema>;

export const updateActivityLogSchema = z
  .object({
    sharedNotes: activitySharedNotesSchema,
    flaggedForWardCouncil: z.boolean().optional(),
    attended: z.boolean().optional(),
  })
  .superRefine((value, context) => {
    if (Object.keys(value).length === 0) {
      context.addIssue({ code: "custom", message: "Nothing was changed." });
    }
  });
export type UpdateActivityLogInput = z.infer<typeof updateActivityLogSchema>;

// No `userId`. The author of a private note is always auth.uid(), so "write someone else's note"
// is not expressible in this schema, in lib/youth/privateNotes.ts, or in the route.
export const upsertActivityPrivateNoteSchema = z.object({
  notes: z
    .string()
    .trim()
    .min(1, "Write something, or delete the note instead.")
    .max(
      MAX_ACTIVITY_PRIVATE_NOTES,
      `Keep the note to ${MAX_ACTIVITY_PRIVATE_NOTES} characters.`,
    ),
});
export type UpsertActivityPrivateNoteInput = z.infer<typeof upsertActivityPrivateNoteSchema>;
