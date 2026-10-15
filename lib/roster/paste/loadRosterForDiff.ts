import type { SupabaseClient } from "@supabase/supabase-js";
import type { RosterSnapshot } from "@/lib/roster/paste/buildRosterDiff";
import {
  HOUSEHOLD_COLUMNS,
  MEMBER_COLUMNS,
  mapHouseholdRow,
  mapMemberRow,
} from "@/lib/roster/queries";
import type { Database } from "@/types/database";

// EVERY STATUS, deliberately: a moved-out member must MATCH their row in the paste and come back,
// not be created a second time beside the record their visit history hangs off.
//
// Read in pages. PostgREST stops at `max_rows` (1000, supabase/config.toml) without an error, and
// a snapshot cut short would show every member past the cut as a new person.
const PAGE_SIZE = 1000;

async function readAllPages<Row>(
  readPage: (from: number, to: number) => PromiseLike<{ data: Row[] | null; error: { message: string } | null }>,
  description: string,
  wardId: string,
): Promise<Row[]> {
  const rows: Row[] = [];

  for (let from = 0; ; from += PAGE_SIZE) {
    const { data, error } = await readPage(from, from + PAGE_SIZE - 1);

    if (error) {
      console.error(`Could not read the ward's ${description} for the roster paste — ${error.message}`, {
        wardId,
      });
      throw new Error(`Could not read the ward's ${description}: ${error.message}`);
    }

    rows.push(...(data ?? []));
    if ((data ?? []).length < PAGE_SIZE) return rows;
  }
}

export async function loadRosterForDiff(
  wardId: string,
  client: SupabaseClient<Database>,
): Promise<RosterSnapshot> {
  const [memberRows, householdRows] = await Promise.all([
    readAllPages(
      (from, to) =>
        client
          .from("members")
          .select(MEMBER_COLUMNS)
          .eq("ward_id", wardId)
          .order("id")
          .range(from, to),
      "members",
      wardId,
    ),
    readAllPages(
      (from, to) =>
        client
          .from("households")
          .select(HOUSEHOLD_COLUMNS)
          .eq("ward_id", wardId)
          .order("id")
          .range(from, to),
      "households",
      wardId,
    ),
  ]);

  return {
    members: memberRows.map(mapMemberRow),
    households: householdRows.map(mapHouseholdRow),
  };
}
