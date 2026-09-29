import type { SupabaseClient } from "@supabase/supabase-js";
import { listAssignments } from "@/lib/assignments/queries";
import type { Database } from "@/types/database";

// What a Sunday's talks are ABOUT, and nothing else about them.
//
// ---------------------------------------------------------------------------------------------
// THE RETURN TYPE IS THE PRIVACY BOUNDARY
// ---------------------------------------------------------------------------------------------
// A music coordinator holds `talks.view` — migration 038 grants it at the database too — but the
// phase plan is explicit that the role does not get pipeline access: no speakers, no stages, no
// contact state. Their screen shows what the meeting is about so they can choose hymns for it.
//
// This function therefore returns TITLES, not assignments. A caller cannot leak a speaker's name
// or a pipeline stage onto the music screen by accident, because it never receives one — the same
// omit-rather-than-null instinct as program-c's PublicProgram (lib/program/publicProjection.ts).
// If a future screen needs the assignments, it calls lib/assignments/queries.ts directly and
// makes that decision on purpose.
//
// SERVER-ONLY. It reads through modules that import next/headers.
//
// EVERY READ GOES THROUGH AN EXISTING QUERY MODULE — no `.from("assignments")` here. talks-c asked for exactly that: a second reader of a table is a second
// place for the ward scope and the stage rules to drift.

export type SundayTopics = Map<string, string[]>;

// Takes the Sundays with their DATES rather than a list of ids, because `AssignmentFilter` offers
// one Sunday or a date range and nothing in between (lib/assignments/queries.ts). Widening that
// union to please this caller would change a type four other modules depend on; deriving the range
// from the Sundays already loaded costs nothing and leaves it alone.
//
// Every Sunday asked about is a key in the result, including the ones with no topics. A caller
// that had to distinguish "no topics" from "not in the map" would get it wrong eventually, and an
// absence renders as an absence (talks-c).
export async function listSundayTopicTitles(
  wardId: string,
  sundays: readonly { id: string; date: string }[],
  client?: SupabaseClient<Database>,
): Promise<SundayTopics> {
  const bySunday: SundayTopics = new Map(sundays.map((sunday) => [sunday.id, []]));

  if (sundays.length === 0) return bySunday;

  const dates = sundays.map((sunday) => sunday.date).sort();

  const assignments = await listAssignments(
    wardId,
    { from: dates[0], to: dates[dates.length - 1] },
    client,
  );

  for (const assignment of assignments) {
    // Migration 086: the talk carries its own topic words, so there is nothing to resolve.
    const title = assignment.topicTitle;
    if (assignment.sundayId === null || title === null) continue;

    const existing = bySunday.get(assignment.sundayId);
    if (existing === undefined) continue;
    // A ward that assigns the same topic to two speakers gets it once. Two identical lines on the
    // card, and the same word twice in the AI prompt, are both noise.
    if (!existing.includes(title)) existing.push(title);
  }

  return bySunday;
}
