import type { SupabaseClient } from "@supabase/supabase-js";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import type {
  CreateTopicInput,
  ListTopicsQuery,
  UpdateTopicInput,
} from "@/lib/validation/topic";
import type { Database } from "@/types/database";
import {
  TOPIC_CANDIDATE_STATUSES,
  TOPIC_CATEGORIES,
  TOPIC_SOURCES,
  TOPIC_STATUSES,
  type TopicCandidateStatus,
  type TopicCategory,
  type TopicSource,
  type TopicStatus,
} from "@/types/domain";

// Every topic read and write goes through this module, including the ones Phase 6's program
// builder will need. Route handlers and pages never touch Supabase directly
// (conventions.md §Data Access).
//
// SERVER-ONLY. It imports createServerSupabaseClient, which imports next/headers. The pure rules
// live in topicRotation.ts precisely so TopicList can render them without touching this file
// (plans/retros/roster-b-picker-and-orgs.md).
//
// THERE IS NO DELETE. A topic leaves the library by being archived and no other way — a topic
// referenced by an assignment must not vanish from that assignment's history.

export type Topic = {
  id: string;
  title: string;
  category: TopicCategory | null;
  description: string | null;
  suggestedScriptures: string[] | null;
  suggestedTalks: string[] | null;
  source: TopicSource | null;
  status: TopicStatus;
  lastAssignedAt: string | null;
  createdAt: string;
};

export type TopicCandidate = {
  id: string;
  title: string;
  category: TopicCategory | null;
  description: string | null;
  suggestedScriptures: string[] | null;
  suggestedTalks: string[] | null;
  status: TopicCandidateStatus;
  acceptedTopicId: string | null;
  reviewedBy: string | null;
  reviewedAt: string | null;
  createdAt: string;
};

type TopicRow = {
  id: string;
  title: string;
  category: string | null;
  description: string | null;
  suggested_scriptures: unknown;
  suggested_talks: unknown;
  source: string | null;
  status: string;
  last_assigned_at: string | null;
  created_at: string;
};

type TopicCandidateRow = {
  id: string;
  title: string;
  category: string | null;
  description: string | null;
  suggested_scriptures: unknown;
  suggested_talks: unknown;
  status: string;
  accepted_topic_id: string | null;
  reviewed_by: string | null;
  reviewed_at: string | null;
  created_at: string;
};

type TopicUpdate = Database["public"]["Tables"]["topics"]["Update"];
type CandidateUpdate = Database["public"]["Tables"]["topic_candidates"]["Update"];

// One string literal on ONE line per table, and never a `+` concatenation between them
// (plans/retros/calendar-a-rules-and-api.md).
const TOPIC_COLUMNS =
  "id, title, category, description, suggested_scriptures, suggested_talks, source, status, last_assigned_at, created_at";

const CANDIDATE_COLUMNS =
  "id, title, category, description, suggested_scriptures, suggested_talks, status, accepted_topic_id, reviewed_by, reviewed_at, created_at";

function toEnumValue<Value extends string>(
  value: string,
  allowed: readonly Value[],
  column: string,
  migration: string,
): Value {
  if (!(allowed as readonly string[]).includes(value)) {
    throw new Error(
      `${column} holds "${value}", which is not a known value. The CHECK constraint ` +
        `in migration ${migration} and types/domain.ts have drifted.`,
    );
  }
  return value as Value;
}

function toOptionalEnum<Value extends string>(
  value: string | null,
  allowed: readonly Value[],
  column: string,
  migration: string,
): Value | null {
  return value === null ? null : toEnumValue(value, allowed, column, migration);
}

// NOTHING validates a jsonb blob on read, so this is the one place a malformed suggestion list
// is caught. It DROPS bad entries rather than throwing: a single mistyped row written before the
// Zod schema existed must not take down the whole topic library, and Phase 6's program PDF is
// better off missing one scripture reference than failing to render.
//
// The write side is where the real guard lives — lib/validation/topic.ts refuses a bad shape at
// the boundary, which is why this only has to survive rows that predate it.
function toSuggestionList(value: unknown): string[] | null {
  if (value === null || value === undefined) return null;
  if (!Array.isArray(value)) return null;

  const entries = value.filter(
    (entry): entry is string => typeof entry === "string" && entry.trim() !== "",
  );

  return entries.length > 0 ? entries : null;
}

export function mapTopicRow(row: TopicRow): Topic {
  return {
    id: row.id,
    title: row.title,
    category: toOptionalEnum(row.category, TOPIC_CATEGORIES, "topics.category", "005"),
    description: row.description,
    suggestedScriptures: toSuggestionList(row.suggested_scriptures),
    suggestedTalks: toSuggestionList(row.suggested_talks),
    source: toOptionalEnum(row.source, TOPIC_SOURCES, "topics.source", "005"),
    status: toEnumValue(row.status, TOPIC_STATUSES, "topics.status", "005"),
    lastAssignedAt: row.last_assigned_at,
    createdAt: row.created_at,
  };
}

export function mapCandidateRow(row: TopicCandidateRow): TopicCandidate {
  return {
    id: row.id,
    title: row.title,
    category: toOptionalEnum(
      row.category,
      TOPIC_CATEGORIES,
      "topic_candidates.category",
      "028",
    ),
    description: row.description,
    suggestedScriptures: toSuggestionList(row.suggested_scriptures),
    suggestedTalks: toSuggestionList(row.suggested_talks),
    status: toEnumValue(
      row.status,
      TOPIC_CANDIDATE_STATUSES,
      "topic_candidates.status",
      "028",
    ),
    acceptedTopicId: row.accepted_topic_id,
    reviewedBy: row.reviewed_by,
    reviewedAt: row.reviewed_at,
    createdAt: row.created_at,
  };
}

async function resolveClient(
  client?: SupabaseClient<Database>,
): Promise<SupabaseClient<Database>> {
  return client ?? (await createServerSupabaseClient());
}

// Ordered by `last_assigned_at` NULLS FIRST, so topics nobody has used surface at the top. That
// is the order the library is actually browsed in — a bishopric opens it looking for something
// they have not done lately.
//
// `status` defaults to ACTIVE. An archived topic is out of the library until somebody asks for
// it by name.
export async function listTopics(
  wardId: string,
  filter: ListTopicsQuery = {},
  client?: SupabaseClient<Database>,
): Promise<Topic[]> {
  const supabase = await resolveClient(client);

  let query = supabase
    .from("topics")
    .select(TOPIC_COLUMNS)
    .eq("ward_id", wardId)
    .eq("status", filter.status ?? "active");

  if (filter.category !== undefined) {
    query = query.eq("category", filter.category);
  }

  const { data, error } = await query
    .order("last_assigned_at", { nullsFirst: true })
    .order("title");

  if (error) {
    console.error(`Could not read the ward's topics — ${error.message}`, { wardId, filter });
    throw new Error(`Could not read the topic library: ${error.message}`);
  }

  return (data ?? []).map(mapTopicRow);
}

export async function getTopic(
  wardId: string,
  topicId: string,
  client?: SupabaseClient<Database>,
): Promise<Topic | null> {
  const supabase = await resolveClient(client);

  const { data, error } = await supabase
    .from("topics")
    .select(TOPIC_COLUMNS)
    .eq("ward_id", wardId)
    .eq("id", topicId)
    .maybeSingle();

  if (error) {
    console.error(`Could not read a topic — ${error.message}`, { wardId, topicId });
    throw new Error(`Could not read that topic: ${error.message}`);
  }

  return data ? mapTopicRow(data) : null;
}

// `source` is a PARAMETER rather than hard-coded, because there are exactly two ways a topic is
// born and both go through here: a person typing one (`manual`) and a person accepting an AI
// candidate (`ai_generated`). Nothing else may call this, and there is no path that writes a
// topic without a person having pressed something (CLAUDE.md rule 3).
export async function createTopic(
  wardId: string,
  input: CreateTopicInput,
  source: TopicSource,
  client?: SupabaseClient<Database>,
): Promise<Topic> {
  const supabase = await resolveClient(client);

  const { data, error } = await supabase
    .from("topics")
    .insert({
      ward_id: wardId,
      title: input.title,
      category: input.category,
      description: input.description ?? null,
      suggested_scriptures: input.suggestedScriptures ?? null,
      suggested_talks: input.suggestedTalks ?? null,
      source,
      status: "active",
    })
    .select(TOPIC_COLUMNS)
    .single();

  if (error) {
    if (error.code === UNIQUE_VIOLATION) {
      throw new DuplicateTopicTitleError(input.title);
    }

    console.error(`Could not create a topic — ${error.message}`, { wardId });
    throw new Error(`Could not create that topic: ${error.message}`);
  }

  return mapTopicRow(data);
}

// Cannot write `last_assigned_at` and cannot write `source`. Neither is a thing a person edits:
// the stamp is a consequence of an assignment reaching `approve`, and the source records how the
// topic came to exist. There is no parameter here that could carry either.
export async function updateTopic(
  wardId: string,
  topicId: string,
  input: UpdateTopicInput,
  client?: SupabaseClient<Database>,
): Promise<Topic | null> {
  const supabase = await resolveClient(client);

  const patch: TopicUpdate = {};

  if (input.title !== undefined) patch.title = input.title;
  if (input.category !== undefined) patch.category = input.category;
  if (input.description !== undefined) patch.description = input.description;
  if (input.suggestedScriptures !== undefined) {
    patch.suggested_scriptures = input.suggestedScriptures;
  }
  if (input.suggestedTalks !== undefined) patch.suggested_talks = input.suggestedTalks;
  if (input.status !== undefined) patch.status = input.status;

  const { data, error } = await supabase
    .from("topics")
    .update(patch)
    .eq("ward_id", wardId)
    .eq("id", topicId)
    .select(TOPIC_COLUMNS)
    .maybeSingle();

  if (error) {
    if (error.code === UNIQUE_VIOLATION && input.title !== undefined) {
      throw new DuplicateTopicTitleError(input.title);
    }

    console.error(`Could not update a topic — ${error.message}`, { wardId, topicId });
    throw new Error(`Could not save that topic: ${error.message}`);
  }

  return data ? mapTopicRow(data) : null;
}

// Stamps `last_assigned_at` with now(). Called from ONE place — the `review` → `approve`
// transition — and never from `plan` or `complete` (lib/assignments/queries.ts explains why).
//
// Returns false rather than throwing. A stamp failure must not fail the transition that earned
// it: the assignment genuinely was approved, and refusing the approval because a rotation hint
// could not be written would be the tail wagging the dog. Same contract as writeAuditLog.
export async function stampTopicAssigned(
  wardId: string,
  topicId: string,
  client?: SupabaseClient<Database>,
): Promise<boolean> {
  try {
    const supabase = await resolveClient(client);

    const patch: TopicUpdate = { last_assigned_at: new Date().toISOString() };

    const { data, error } = await supabase
      .from("topics")
      .update(patch)
      .eq("ward_id", wardId)
      .eq("id", topicId)
      .select("id")
      .maybeSingle();

    if (error) {
      console.error(`Could not stamp a topic as assigned — ${error.message}`, {
        wardId,
        topicId,
      });
      return false;
    }

    // A denied UPDATE is a zero-row success, not an error
    // (plans/retros/foundation-c-services.md), so the absence of a row is the real signal here.
    return data !== null;
  } catch (error) {
    console.error("Could not stamp a topic as assigned", { wardId, topicId, error });
    return false;
  }
}

// The active topics a planner may attach to an assignment, narrowed to what the planner's client
// components actually render. It lives HERE now: talks-b put a stopgap copy in
// lib/assignments/queries.ts because this module did not exist yet, and its own header said to
// delete it and repoint the callers when talks-c landed. This is that repointing.
//
// `suggestedScriptures` is the field talks-b recorded as missing: buildConfirmationMessage()
// takes it and ContactStagePanel was passing `[]`, so the confirmation message silently dropped
// its scripture sentence. The stopgap read only id and title, which is why. Nothing about the
// signature of buildConfirmationMessage changes — it just gets real data now.
export type TopicOption = {
  id: string;
  title: string;
  suggestedScriptures: string[] | null;
};

export async function listTopicOptions(
  wardId: string,
  client?: SupabaseClient<Database>,
): Promise<TopicOption[]> {
  const topics = await listTopics(wardId, { status: "active" }, client);

  // Sorted by TITLE rather than by staleness. This feeds a picker where somebody is looking for
  // a topic they have in mind, not browsing for an unused one — the library page is where
  // staleness order belongs (lib/topics/topicRotation.ts).
  return topics
    .map((topic) => ({
      id: topic.id,
      title: topic.title,
      suggestedScriptures: topic.suggestedScriptures,
    }))
    .sort((left, right) => left.title.localeCompare(right.title));
}

// ---------------------------------------------------------------------------
// The AI candidate queue
// ---------------------------------------------------------------------------
// Phase 5 writes `pending` rows here and NEVER inserts into `topics`. This queue is the only
// door, and acceptCandidate below is the only thing that opens it (CLAUDE.md rule 3).

export async function listCandidates(
  wardId: string,
  status: TopicCandidateStatus = "pending",
  client?: SupabaseClient<Database>,
): Promise<TopicCandidate[]> {
  const supabase = await resolveClient(client);

  const { data, error } = await supabase
    .from("topic_candidates")
    .select(CANDIDATE_COLUMNS)
    .eq("ward_id", wardId)
    .eq("status", status)
    .order("created_at");

  if (error) {
    console.error(`Could not read topic candidates — ${error.message}`, { wardId, status });
    throw new Error(`Could not read the suggested topics: ${error.message}`);
  }

  return (data ?? []).map(mapCandidateRow);
}

export async function getCandidate(
  wardId: string,
  candidateId: string,
  client?: SupabaseClient<Database>,
): Promise<TopicCandidate | null> {
  const supabase = await resolveClient(client);

  const { data, error } = await supabase
    .from("topic_candidates")
    .select(CANDIDATE_COLUMNS)
    .eq("ward_id", wardId)
    .eq("id", candidateId)
    .maybeSingle();

  if (error) {
    console.error(`Could not read a topic candidate — ${error.message}`, {
      wardId,
      candidateId,
    });
    throw new Error(`Could not read that suggestion: ${error.message}`);
  }

  return data ? mapCandidateRow(data) : null;
}

// Migration 018 puts a UNIQUE index on (ward_id, lower(title)), so a ward cannot hold two topics
// with the same title in any casing. That is the right rule — a duplicate topic splits its own
// `last_assigned_at` history in two — but the raw failure is a 500 carrying a constraint name for
// something no amount of retrying will fix.
//
// Postgres reports a unique violation as 23505. Both write paths check it, so the caller can turn
// it into a sentence naming the actual problem.
const UNIQUE_VIOLATION = "23505";

export class DuplicateTopicTitleError extends Error {
  constructor(public readonly title: string) {
    super(`A topic called "${title}" is already in this ward's library.`);
    this.name = "DuplicateTopicTitleError";
  }
}

export function isDuplicateTopicTitleError(
  error: unknown,
): error is DuplicateTopicTitleError {
  return error instanceof DuplicateTopicTitleError;
}

export type AcceptedCandidate = { candidate: TopicCandidate; topic: Topic };

// The ONE path from a suggestion to a topic. It creates the topic FIRST and links the candidate
// to it second, so a failure between the two leaves a candidate still `pending` — a suggestion
// that can be accepted again — rather than a candidate marked accepted with nothing behind it.
//
// `source` is `ai_generated` because that is what the row is, and Phase 6 and the audit log both
// deserve to know a topic came from a model that a person then chose to keep.
export async function acceptCandidate(
  wardId: string,
  candidate: TopicCandidate,
  reviewedBy: string,
  client?: SupabaseClient<Database>,
): Promise<AcceptedCandidate | null> {
  const supabase = await resolveClient(client);

  const topic = await createTopic(
    wardId,
    {
      title: candidate.title,
      // A candidate's category is nullable in the schema; a topic in the library reads better
      // with one, and `custom` is the honest answer for a suggestion that arrived without.
      category: candidate.category ?? "custom",
      description: candidate.description,
      suggestedScriptures: candidate.suggestedScriptures,
      suggestedTalks: candidate.suggestedTalks,
    },
    "ai_generated",
    supabase,
  );

  const patch: CandidateUpdate = {
    status: "accepted",
    accepted_topic_id: topic.id,
    reviewed_by: reviewedBy,
    reviewed_at: new Date().toISOString(),
  };

  const { data, error } = await supabase
    .from("topic_candidates")
    .update(patch)
    .eq("ward_id", wardId)
    .eq("id", candidate.id)
    .select(CANDIDATE_COLUMNS)
    .maybeSingle();

  if (error) {
    console.error(`Could not accept a topic candidate — ${error.message}`, {
      wardId,
      candidateId: candidate.id,
      topicId: topic.id,
    });
    throw new Error(`Could not accept that suggestion: ${error.message}`);
  }

  return data ? { candidate: mapCandidateRow(data), topic } : null;
}

// A rejection writes NOTHING to `topics`. The candidate keeps its title and its suggestions so
// the same idea is not proposed again as if it were new, and the row records who declined it.
export async function rejectCandidate(
  wardId: string,
  candidateId: string,
  reviewedBy: string,
  client?: SupabaseClient<Database>,
): Promise<TopicCandidate | null> {
  const supabase = await resolveClient(client);

  const patch: CandidateUpdate = {
    status: "rejected",
    reviewed_by: reviewedBy,
    reviewed_at: new Date().toISOString(),
  };

  const { data, error } = await supabase
    .from("topic_candidates")
    .update(patch)
    .eq("ward_id", wardId)
    .eq("id", candidateId)
    .select(CANDIDATE_COLUMNS)
    .maybeSingle();

  if (error) {
    console.error(`Could not reject a topic candidate — ${error.message}`, {
      wardId,
      candidateId,
    });
    throw new Error(`Could not reject that suggestion: ${error.message}`);
  }

  return data ? mapCandidateRow(data) : null;
}
