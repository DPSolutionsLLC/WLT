import { resolveSinceDate } from "@/lib/knowledge/conferenceMetadata";
import { SPEAKER_ROLE_LABELS } from "@/types/domain";
import type {
  ConferenceScope,
  ConferenceScopeSettings,
  KnowledgeDocument,
  ResolvedFilter,
  SavedFilter,
  SpeakerRole,
} from "@/types/domain";

// PURE, and CLIENT-SAFE. The scope panel renders its count and its sentences from this module in
// the browser; lib/ai/retrieve.ts builds the database filter from the same functions on the
// server. That is the point: one implementation, so the number a bishopric reads and the rows
// Postgres returns cannot disagree.

export type ApplicableFilter = Extract<ResolvedFilter, { kind: "filter" }>;

export function isApplicable(filter: ResolvedFilter): filter is ApplicableFilter {
  return filter.kind === "filter";
}

// ---------------------------------------------------------------------------------------------
// How the three controls combine
// ---------------------------------------------------------------------------------------------
//
// WITHIN AN AXIS, VALUES UNION. ACROSS AXES, THEY INTERSECT.
//
// That is what a checkbox group has always meant and what `= any (...)` does in migration 033:
// ticking Apostle and Seventy asks for talks by either, not for the impossible talk that is
// both. Roles union with roles, speakers union with speakers.
//
// Between axes it is a genuine AND — "last 2 years" AND "apostles" AND "President Nelson" narrows
// three times. Recency takes the MOST RESTRICTIVE date among the panel's select and every ticked
// filter, because that is what AND means on a date.
//
// The alternative — intersecting roles across saved filters — makes ticking two filters return
// nothing, which is arithmetically defensible and useless. ScopePanel states this rule in words,
// because a combination rule nobody can see is a combination rule nobody can predict.
//
// EMPTY NEVER REACHES THE DATABASE AS AN EMPTY ARRAY. `= any ('{}')` matches nothing, so an
// unfiltered axis must be null. Every return path here goes through nullIfEmpty for that reason.
function nullIfEmpty<Value>(values: readonly Value[]): readonly Value[] | null {
  return values.length === 0 ? null : values;
}

function mostRestrictiveDate(dates: readonly (string | null)[]): string | null {
  const present = dates.filter((date): date is string => date !== null);
  if (present.length === 0) return null;
  // YYYY-MM-DD strings sort lexically the same way the dates sort. The LATEST one is the
  // narrowest `>=` bound.
  return present.reduce((latest, date) => (date > latest ? date : latest));
}

export function mergeConferenceScope(
  settings: ConferenceScopeSettings | null,
  savedFilters: readonly SavedFilter[],
  today: string,
): ConferenceScope {
  if (!settings) {
    return { since: null, speakerRoles: null, speakers: null };
  }

  // Only the filters this ward actually ticked. An id in the settings that no longer names a
  // filter is IGNORED rather than throwing: `retrieval_filters` rows are deletable and
  // `ai_settings` is append-only, so a saved scope naming a since-deleted filter is a normal,
  // reachable state — not corruption. Ignoring it narrows the corpus less than intended, which
  // is the safe direction to be wrong in.
  const ticked = savedFilters.filter((filter) => settings.savedFilterIds.includes(filter.id));

  const roles = new Set<SpeakerRole>(settings.speakerRoles);
  const speakers = new Set<string>();

  for (const filter of ticked) {
    for (const role of filter.speakerRoles ?? []) roles.add(role);
    for (const speaker of filter.speakers ?? []) speakers.add(speaker);
  }

  return {
    since: mostRestrictiveDate([
      resolveSinceDate(settings.sinceYears, today),
      ...ticked.map((filter) => filter.since),
    ]),
    speakerRoles: nullIfEmpty([...roles]),
    speakers: nullIfEmpty([...speakers]),
  };
}

// ---------------------------------------------------------------------------------------------
// The same predicate migration 033 applies, in TypeScript
// ---------------------------------------------------------------------------------------------
//
// THIS FUNCTION AND THE SQL IN MIGRATION 033 MUST AGREE, and the count sentence on the scope
// panel is what makes a disagreement visible. Read them side by side before changing either.
//
// The first branch is the STANDARD-WORKS EXEMPTION and it is the one somebody tidying up would
// delete. A document that is not a conference talk passes whatever the filters say — otherwise a
// ward setting "last two years" to narrow its conference talks silently loses the Book of Mormon
// from every suggestion, with nothing on screen to suggest it happened.
//
// A conference document with NULL metadata fails every active filter, exactly as SQL's
// `null >= date` and `null = any (...)` both evaluate to NULL rather than true. So it is excluded
// the moment any filter is set and included when none is — which is why DocumentList badges such
// a document "Not filterable" rather than letting the asymmetry go unnoticed.
export function matchesConferenceScope(
  document: Pick<
    KnowledgeDocument,
    "typeTag" | "speaker" | "speakerRole" | "conferenceDate"
  >,
  scope: ConferenceScope,
): boolean {
  if (document.typeTag !== "general_conference") return true;

  if (scope.since !== null) {
    if (document.conferenceDate === null) return false;
    if (document.conferenceDate < scope.since) return false;
  }

  if (scope.speakerRoles !== null) {
    if (document.speakerRole === null) return false;
    if (!scope.speakerRoles.includes(document.speakerRole)) return false;
  }

  if (scope.speakers !== null) {
    if (document.speaker === null) return false;
    if (!scope.speakers.includes(document.speaker)) return false;
  }

  return true;
}

export function isUnfilteredScope(scope: ConferenceScope): boolean {
  return scope.since === null && scope.speakerRoles === null && scope.speakers === null;
}

// ---------------------------------------------------------------------------------------------
// Rendering a filter as something a person can agree to
// ---------------------------------------------------------------------------------------------
//
// The sentence shown BEFORE a proposal is accepted. CLAUDE.md rule 3 says no AI output reaches a
// database row without explicit approval, and approval means nothing if what is being approved is
// three columns of enum values. This is the readable form of the same thing.

function joinWithAnd(parts: readonly string[]): string {
  if (parts.length === 0) return "";
  if (parts.length === 1) return parts[0];
  return `${parts.slice(0, -1).join(", ")} and ${parts[parts.length - 1]}`;
}

const SINCE_FORMAT = new Intl.DateTimeFormat("en-US", {
  timeZone: "UTC",
  month: "long",
  year: "numeric",
});

export function describeFilter(filter: ApplicableFilter): string {
  const clauses: string[] = [];

  if (filter.speakerRoles !== null && filter.speakerRoles.length > 0) {
    clauses.push(
      `given by ${joinWithAnd(filter.speakerRoles.map((role) => SPEAKER_ROLE_LABELS[role]))}`,
    );
  }

  if (filter.speakers !== null && filter.speakers.length > 0) {
    clauses.push(`given by ${joinWithAnd([...filter.speakers])}`);
  }

  if (filter.since !== null) {
    clauses.push(`from ${SINCE_FORMAT.format(new Date(`${filter.since}T00:00:00Z`))} onwards`);
  }

  // Unreachable through the routes — migration 034's CHECK refuses a filter that narrows
  // nothing, and the resolver schema requires at least one axis. Still rendered rather than
  // returning an empty string, because a caller holding one must show words.
  if (clauses.length === 0) return "Conference talks, with nothing narrowed.";

  // NAMES THE ROLE-AT-TIME-OF-TALK RULE WHERE IT MATTERS. "Talks by President of the Church"
  // means talks given WHILE serving in that office — a 2015 talk by someone who presides today
  // is an apostle's talk. That is the only reading migration 033's column can answer, and the
  // place to say so is the sentence somebody is about to agree to.
  const roleNote =
    filter.speakerRoles !== null && filter.speakerRoles.length > 0
      ? " Roles are the calling held when the talk was given."
      : "";

  return `Conference talks ${joinWithAnd(clauses)}.${roleNote}`;
}
