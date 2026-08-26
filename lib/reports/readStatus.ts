import type { SupabaseClient } from "@supabase/supabase-js";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import type { Database } from "@/types/database";
import type { ReportType } from "@/types/domain";

// Per-user read and bookmark state for the return-and-report feed.
//
// MODULE-AGNOSTIC ON PURPOSE. Nothing here knows what a visit is. Phase 8 passes
// "youth_activity" to the same functions and adds nothing to this file.
//
// ---------------------------------------------------------------------------
// EVERY ROW BELONGS TO auth.uid(), AND ONLY TO auth.uid()
// ---------------------------------------------------------------------------
// One leader reading a report leaves it unread for everybody else. That is the whole feature,
// and it is held by migration 008's `unique (user_id, report_type, report_id)` plus migration
// 019's four own-rows-only policies — not by anything in this file.
//
// EVERY READ AND WRITE GOES THROUGH THE CALLER'S SESSION CLIENT. There is no
// createServiceSupabaseClient import here and its presence would be the smell: a service-role
// write would let one person's tap mark a report read for the whole ward, and the policy meant
// to stop that would never run.
//
// `userId` is a parameter on the WRITES and on none of the reads, exactly as
// lib/visits/privateNotes.ts has it: an INSERT has to put a value in the column, and the INSERT
// policy checks `user_id = auth.uid()`, so passing anybody else's is refused by the database
// rather than trusted. The reads take no userId at all, so "read somebody else's state" is not
// expressible.
//
// SERVER-ONLY. It imports createServerSupabaseClient, which imports next/headers.

export type ReportReadState = {
  reportId: string;
  // `read_at` is a TIMESTAMP, not a boolean. A row can exist with read_at null because it was
  // bookmarked before it was read, so `isRead` is a question about the timestamp rather than
  // about the row's existence.
  isRead: boolean;
  bookmarked: boolean;
};

type ReportReadStatusRow = {
  report_id: string;
  read_at: string | null;
  flagged: boolean;
};

// One string literal on ONE line, never a `+` concatenation — concatenation widens the type to
// `string` and defeats supabase-js's literal parsing of the select list
// (plans/retros/calendar-a-rules-and-api.md).
//
// No `user_id`. It is always the caller, so returning it would only invite a comparison
// somewhere that treats it as a value worth branching on.
const READ_STATUS_COLUMNS = "report_id, read_at, flagged";

// The database column is `flagged`; the app calls it `bookmarked` everywhere above this line.
// `visit_logs.flagged_for_ward_council` is a different thing entirely and the two names must not
// converge (lib/reports/types.ts).
function mapReadStatusRow(row: ReportReadStatusRow): ReportReadState {
  return {
    reportId: row.report_id,
    isRead: row.read_at !== null,
    bookmarked: row.flagged,
  };
}

async function resolveClient(
  client?: SupabaseClient<Database>,
): Promise<SupabaseClient<Database>> {
  return client ?? (await createServerSupabaseClient());
}

// The caller's OWN rows for the given reports, keyed by report id. A report with no row is
// simply absent from the map — unread and unbookmarked, which is the correct default and is
// what the mapper renders without needing a second query.
//
// An empty `reportIds` returns an empty Map without a round trip: `in()` with an empty array is
// a query that can only return nothing.
export async function listReadStatus(
  reportType: ReportType,
  reportIds: readonly string[],
  client?: SupabaseClient<Database>,
): Promise<Map<string, ReportReadState>> {
  const byReport = new Map<string, ReportReadState>();
  if (reportIds.length === 0) return byReport;

  const supabase = await resolveClient(client);

  // No `user_id` filter. RLS narrows this to the caller's own rows, and a redundant filter would
  // mask a policy regression by hiding rows the policy had started letting through — the same
  // reasoning lib/visits/queries.ts gives for leaving out its org filter.
  const { data, error } = await supabase
    .from("report_read_status")
    .select(READ_STATUS_COLUMNS)
    .eq("report_type", reportType)
    .in("report_id", reportIds as string[]);

  if (error) {
    console.error(`Could not read report read status — ${error.message}`, { reportType });
    throw new Error(`Could not load what you have already read: ${error.message}`);
  }

  for (const row of (data ?? []) as ReportReadStatusRow[]) {
    byReport.set(row.report_id, mapReadStatusRow(row));
  }

  return byReport;
}

// THE UPSERT IS SAFE UNDER A DOUBLE TAP BECAUSE OF migration 008's
// `unique (user_id, report_type, report_id)`. Without that index there is nothing to conflict
// on: the second tap writes a second row, and after that "have I read this?" has two answers.
//
// `flagged` is deliberately absent from the payload. On conflict PostgREST updates only the
// columns present, so marking a report read leaves an existing bookmark alone rather than
// resetting it to the column default.
export async function markRead(
  reportType: ReportType,
  reportId: string,
  wardId: string,
  userId: string,
  client?: SupabaseClient<Database>,
): Promise<ReportReadState> {
  const supabase = await resolveClient(client);

  const { data, error } = await supabase
    .from("report_read_status")
    .upsert(
      {
        ward_id: wardId,
        user_id: userId,
        report_type: reportType,
        report_id: reportId,
        read_at: new Date().toISOString(),
      },
      { onConflict: "user_id,report_type,report_id" },
    )
    .select(READ_STATUS_COLUMNS)
    .single();

  if (error) {
    console.error(`Could not mark a report read — ${error.message}`, { reportType, reportId });
    throw new Error(`Could not mark that report as read: ${error.message}`);
  }

  return mapReadStatusRow(data as ReportReadStatusRow);
}

// `read_at` is absent from the payload for the mirror-image reason: bookmarking a report the
// reader has not opened yet must not claim they have read it.
export async function setBookmarked(
  reportType: ReportType,
  reportId: string,
  bookmarked: boolean,
  wardId: string,
  userId: string,
  client?: SupabaseClient<Database>,
): Promise<ReportReadState> {
  const supabase = await resolveClient(client);

  const { data, error } = await supabase
    .from("report_read_status")
    .upsert(
      {
        ward_id: wardId,
        user_id: userId,
        report_type: reportType,
        report_id: reportId,
        flagged: bookmarked,
      },
      { onConflict: "user_id,report_type,report_id" },
    )
    .select(READ_STATUS_COLUMNS)
    .single();

  if (error) {
    console.error(`Could not bookmark a report — ${error.message}`, { reportType, reportId });
    throw new Error(`Could not save that bookmark: ${error.message}`);
  }

  return mapReadStatusRow(data as ReportReadStatusRow);
}

// ONE upsert of many rows, not one call per report. Mark All as Read on a ward with three years
// of logs is otherwise several hundred round trips from a single tap.
//
// Every row carries the SAME `read_at`, so "the moment they marked the feed read" is one instant
// rather than a smear across however long the request took.
export async function markAllRead(
  reportType: ReportType,
  reportIds: readonly string[],
  wardId: string,
  userId: string,
  client?: SupabaseClient<Database>,
): Promise<number> {
  if (reportIds.length === 0) return 0;

  const supabase = await resolveClient(client);
  const readAt = new Date().toISOString();

  const { data, error } = await supabase
    .from("report_read_status")
    .upsert(
      reportIds.map((reportId) => ({
        ward_id: wardId,
        user_id: userId,
        report_type: reportType,
        report_id: reportId,
        read_at: readAt,
      })),
      { onConflict: "user_id,report_type,report_id" },
    )
    .select("id");

  if (error) {
    console.error(`Could not mark reports read — ${error.message}`, {
      reportType,
      count: reportIds.length,
    });
    throw new Error(`Could not mark those reports as read: ${error.message}`);
  }

  return (data ?? []).length;
}
