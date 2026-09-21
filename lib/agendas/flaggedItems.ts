import type { SupabaseClient } from "@supabase/supabase-js";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { newAgendaItem, type AgendaItem } from "@/lib/agendas/sections";
import type { Database } from "@/types/database";

// The flagged ward council items an agenda opens with.
//
// SERVER ONLY. lib/agendas/sections.ts is the client half; this file reaches for the database.

type Client = SupabaseClient<Database>;

// ---------------------------------------------------------------------------------------------
// ONE-LINERS ONLY. THIS IS A PRIVACY BOUNDARY, NOT A FORMATTING PREFERENCE.
// ---------------------------------------------------------------------------------------------
// 09-meetings-tithing.md §Step A2: "**One-liners only.** Never pull shared notes, let alone
// private ones, into the agenda. The agenda goes to a PDF that gets emailed — anything in it
// leaves the app."
//
// That is the whole reason this module exists rather than the route selecting the columns it
// fancies. The selects below name their columns explicitly and NEITHER of them names a note
// column: `visit_logs.shared_notes`, `activity_logs.shared_notes` and both private-note tables
// are absent, so putting one on an agenda would be a change to this file rather than an oversight
// somewhere else. It is the same mechanism lib/program/publicProjection.ts uses for the public
// programme — the fields that must not leave are ABSENT from the type, not nulled.
//
// What reaches the agenda is: the organization, the family or young person's name, and the fact
// that a discussion was requested. Enough for a bishopric to know what to talk about, and nothing
// they could not have said aloud in the meeting anyway.

export type FlagSource = "visit" | "youth_activity";

export type FlaggedItem = {
  // The `visit_logs` or `activity_logs` row this line represents. Carried onto the agenda item as
  // `sourceId` so publishing can resolve the flag WITHOUT matching on the text, which a secretary
  // is free to rewrite.
  sourceId: string;
  source: FlagSource;
  text: string;
};

// ---------------------------------------------------------------------------------------------
// UNRESOLVED MEANS `flag_sent_at IS NULL`, AND THAT IS AN EXISTING CONVENTION, NOT A NEW ONE
// ---------------------------------------------------------------------------------------------
// `visits-c` uses `flag_sent_at` to mean "the ward council has been told about this", and
// lib/visits/queries.ts is explicit that a route body cannot stamp it — only the flag route can.
// Publishing an agenda is the second thing that may stamp it, and for the same reason: the item
// has now reached the ward council, so it should not appear on the next agenda too.
//
// A flag whose `flag_sent_at` is already set is therefore invisible here. That is what stops last
// month's discussion reappearing every fortnight for ever.
async function visitFlags(wardId: string, client: Client): Promise<FlaggedItem[]> {
  const { data, error } = await client
    .from("visit_logs")
    .select("id, org_id, household_id, households (family_name), organizations (name)")
    .eq("ward_id", wardId)
    .eq("flagged_for_ward_council", true)
    .is("flag_sent_at", null)
    .order("created_at");

  if (error) throw new Error(`Could not load the flagged visits: ${error.message}`);

  return (data ?? []).map((row) => {
    const record = row as unknown as {
      id: string;
      households: { family_name: string } | null;
      organizations: { name: string } | null;
    };
    const org = record.organizations?.name ?? "Ward";
    const family = record.households?.family_name ?? "A household";
    return {
      sourceId: record.id,
      source: "visit" as const,
      text: `${org} — ${family} — requested for ward council discussion`,
    };
  });
}

// The youth half. `activity_logs` carries the same flag column (migration 009) and the same
// `flag_sent_at` convention (youth-d), so the shape is identical — but the SUBJECT is a young
// person and an activity rather than a household, so the line reads differently.
//
// The organization comes through the event's PROFILE, which is where youth-j left it: one answer,
// on the team, rather than a second copy on the event that could disagree with the first.
async function youthActivityFlags(wardId: string, client: Client): Promise<FlaggedItem[]> {
  const { data, error } = await client
    .from("activity_logs")
    .select(
      "id, activity_events (title, youth_activity_profiles (activity_name, organizations (name)))",
    )
    .eq("ward_id", wardId)
    .eq("flagged_for_ward_council", true)
    .is("flag_sent_at", null)
    .order("created_at");

  if (error) throw new Error(`Could not load the flagged follow-ups: ${error.message}`);

  return (data ?? []).map((row) => {
    const record = row as unknown as {
      id: string;
      activity_events: {
        title: string;
        youth_activity_profiles: {
          activity_name: string;
          organizations: { name: string } | null;
        } | null;
      } | null;
    };
    const profile = record.activity_events?.youth_activity_profiles ?? null;
    // NULL ORG MEANS WARD-WIDE (054a's absent-means-default idiom), so "Ward" is the right word
    // rather than a placeholder for missing data.
    const org = profile?.organizations?.name ?? "Ward";
    const activity = profile?.activity_name ?? "an activity";
    const event = record.activity_events?.title ?? "an event";
    return {
      sourceId: record.id,
      source: "youth_activity" as const,
      text: `${org} — ${activity}, ${event} — requested for ward council discussion`,
    };
  });
}

// ---------------------------------------------------------------------------------------------
// PHASES 7 AND 8 DEGRADE TO AN EMPTY SECTION, NEVER TO AN ERROR
// ---------------------------------------------------------------------------------------------
// §Step A2: "If Phases 7–8 are not built yet, the section renders empty. Do not block on them."
// Both are built, so this is not hypothetical caution — it is what keeps a ward that has never
// flagged anything from seeing a failure where it should see nothing. `Promise.allSettled` rather
// than `all`: one side failing must not take the other's items down with it, because an agenda
// with half its flags is worth more than an agenda that would not open.
export async function gatherFlaggedItems(
  wardId: string,
  client?: Client,
): Promise<FlaggedItem[]> {
  const supabase = client ?? (await createServerSupabaseClient());

  const results = await Promise.allSettled([
    visitFlags(wardId, supabase),
    youthActivityFlags(wardId, supabase),
  ]);

  const items: FlaggedItem[] = [];
  for (const result of results) {
    if (result.status === "fulfilled") items.push(...result.value);
    // A rejected half is deliberately swallowed HERE and nowhere else in this module. Rule 7 says
    // no silent failures, and this is the one place the alternative is worse: the agenda still
    // opens, the section is simply short. It is logged so it is not invisible.
    else console.error("Could not gather flagged items:", result.reason);
  }

  return items;
}

export function flaggedItemsToAgendaItems(items: readonly FlaggedItem[]): AgendaItem[] {
  return items.map((item) => newAgendaItem(item.text, "flag", item.sourceId));
}

// Mark every flag an agenda carried as sent, so it does not reappear on the next one.
//
// CALLED FROM PUBLISH AND NOWHERE ELSE. §Step A2: "Mark the source flag resolved when the agenda
// is published so it does not reappear next time." Doing it at CREATE would resolve flags for a
// meeting that has not happened, and a draft that was abandoned would have silently swallowed
// them — the same reason previousPublishedAgenda() will not carry from a draft.
//
// ---------------------------------------------------------------------------------------------
// TAKES IDS AND TRIES BOTH TABLES, RATHER THAN BEING TOLD WHICH ONE
// ---------------------------------------------------------------------------------------------
// An agenda item records that it came from a flag (`source: "flag"`) and which row
// (`sourceId`) — but not which of the two TABLES that row is in, and adding a fourth field to the
// stored jsonb whose only job is to remember that would be a second copy of a fact the id already
// determines.
//
// Both ids are UUIDs from different tables, so an id from `visit_logs` cannot match a row in
// `activity_logs`: each UPDATE stamps its own rows and matches nothing in the other. Two
// statements, no ambiguity, and no schema change.
//
// Failures are collected rather than thrown: the agenda IS published by the time this runs, and
// refusing to record that because a flag could not be stamped would leave the worse of the two
// states.
export async function markFlagsSent(
  wardId: string,
  sourceIds: readonly string[],
  client?: Client,
): Promise<{ resolved: number; failed: number }> {
  const ids = [...new Set(sourceIds)];
  if (ids.length === 0) return { resolved: 0, failed: 0 };

  const supabase = client ?? (await createServerSupabaseClient());
  const sentAt = new Date().toISOString();

  let resolved = 0;
  let failed = 0;

  for (const table of ["visit_logs", "activity_logs"] as const) {
    const { data, error } = await supabase
      .from(table)
      .update({ flag_sent_at: sentAt })
      .eq("ward_id", wardId)
      .in("id", ids)
      .select("id");

    if (error) {
      console.error(`Could not resolve flags on ${table}:`, error.message);
      failed += 1;
    } else {
      resolved += (data ?? []).length;
    }
  }

  return { resolved, failed };
}
