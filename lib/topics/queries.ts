import type { SupabaseClient } from "@supabase/supabase-js";
import type { DateOnly } from "@/lib/calendar/dates";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import type { TopicHistoryEntry } from "@/lib/topics/topicHistory";
import type { Database } from "@/types/database";

// THE WARD'S TOPIC HISTORY, read straight off the talks (migration 086).
//
// There is no topic library any more (the user's decision, 2026-09-29): a talk's topic is the
// words typed for it, and "what has been used" is every talk that carried some. The `topics` and
// `topic_candidates` tables are kept for their data and are read by nothing.
//
// SERVER-ONLY. It imports createServerSupabaseClient, which imports next/headers. The pure rules
// — similarity, the time-ago label, search and sort — live in topicHistory.ts so a client
// component can use them without touching this file (plans/retros/roster-b-picker-and-orgs.md).
//
// ---------------------------------------------------------------------------
// IT READS `assignments` DIRECTLY, WHICH lib/music/sundayTopics.ts DELIBERATELY REFUSES TO DO
// ---------------------------------------------------------------------------
// That module refuses because a MUSIC COORDINATOR must never see a speaker or a pipeline stage,
// and its return type is the boundary. This is read on `topics.view`, which is bishopric-only, and
// its return type carries no stage, no contact state and no approval — a date, the words, and who
// spoke. The ward scope is still applied explicitly.
//
// ---------------------------------------------------------------------------
// ALL TIME, AND IT LOOKS FORWARD AS WELL AS BACK, MARKED
// ---------------------------------------------------------------------------
// A history is only useful if it is whole. Topics already on the calendar for a future Sunday are
// included and marked `isUpcoming`: somebody planning next month needs to avoid repeating what is
// coming up at least as much as what has gone.

// ONE STRING LITERAL ON ONE LINE, never a `+` concatenation — that widens the type to `string` and
// defeats supabase-js's literal parsing of the select list (plans/retros/calendar-a-rules-and-api.md).
//
// EVERY EMBED IS NAMED BY ITS FOREIGN KEY: these are COMPOSITE keys from migration 005, and an
// inferred embed on a composite key is ambiguous. The Sunday's date is embedded rather than read
// through listSundays(), which takes a range — and a history has none.
//
// ONLY THE NAME COMES BACK FROM `members`. Not a phone, not an address, not a birth date.
const TOPIC_HISTORY_COLUMNS =
  "id, sunday_id, slot_number, topic_title, external_speaker_name, external_speaker_title, sunday:sundays!assignments_sunday_id_ward_id_fkey (date), speaker:members!assignments_member_id_ward_id_fkey (first_name, last_name)";

export type TopicHistoryRow = {
  id: string;
  sunday_id: string | null;
  slot_number: number | null;
  topic_title: string | null;
  external_speaker_name: string | null;
  external_speaker_title: string | null;
  sunday: { date: string } | null;
  speaker: { first_name: string | null; last_name: string | null } | null;
};

async function resolveClient(
  client?: SupabaseClient<Database>,
): Promise<SupabaseClient<Database>> {
  return client ?? (await createServerSupabaseClient());
}

// NO CLOCK IN HERE. The caller passes the day, as lib/sacrament/sundayStatus.ts does.
export async function listTopicHistory(
  wardId: string,
  options: { today: DateOnly },
  client?: SupabaseClient<Database>,
): Promise<TopicHistoryEntry[]> {
  const supabase = await resolveClient(client);

  const { data, error } = await supabase
    .from("assignments")
    .select(TOPIC_HISTORY_COLUMNS)
    .eq("ward_id", wardId)
    // A talk with no topic is not a use of one. This is the filter the whole list is about.
    .not("topic_title", "is", null)
    // Nor is a cancelled talk: the topic was never given (Sacrament slice f2c).
    .is("cancelled_at", null);

  if (error) {
    console.error(`Could not read the topic history — ${error.message}`, { wardId });
    throw new Error(`Could not read which topics have been used: ${error.message}`);
  }

  return mapTopicHistoryRows((data ?? []) as unknown as TopicHistoryRow[], options.today);
}

// THE HALF WORTH TESTING, split out so it can be — tests/lib/recentTopicUsage.test.ts hands it
// rows. Newest first, and an upcoming Sunday sorts above a past one for free. The slot number is a
// stable tie-break, so three talks on one Sunday never reshuffle between renders.
export function mapTopicHistoryRows(
  rows: readonly TopicHistoryRow[],
  today: DateOnly,
): TopicHistoryEntry[] {
  return rows
    .flatMap((row) => {
      const topicTitle = row.topic_title?.trim() ?? "";
      if (topicTitle === "" || row.sunday_id === null || row.sunday === null) return [];

      return [
        {
          assignmentId: row.id,
          sundayId: row.sunday_id,
          date: row.sunday.date,
          topicTitle,
          speakerName: speakerNameOf(row),
          isUpcoming: row.sunday.date > today,
          slotNumber: row.slot_number ?? 0,
        },
      ];
    })
    .sort((left, right) =>
      left.date === right.date
        ? left.slotNumber - right.slotNumber
        : left.date < right.date
          ? 1
          : -1,
    )
    .map(({ slotNumber: _slotNumber, ...entry }) => entry);
}

// A VISITING SPEAKER IS A REAL SPEAKER (ITER-004): an external name fills the slot exactly as a
// roster member does — lib/sacrament/sundayStatus.ts's `hasSpeaker()` rule, in a second place.
function speakerNameOf(row: TopicHistoryRow): string | null {
  const memberName = `${row.speaker?.first_name ?? ""} ${row.speaker?.last_name ?? ""}`.trim();
  if (memberName !== "") return memberName;

  // With the title the planner typed, as the program prints it: "President Hale", never "Hale"
  // (walking scenario 084).
  const external = row.external_speaker_name?.trim();
  if (external === undefined || external === "") return null;
  const title = row.external_speaker_title?.trim();
  return title ? `${title} ${external}` : external;
}
