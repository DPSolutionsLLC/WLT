import type { SupabaseClient } from "@supabase/supabase-js";
import type { ReportFeedContext, ReportFeedPage } from "@/lib/reports/types";
import { listReadStatus } from "@/lib/reports/readStatus";
import { encodeReportFeedCursor, type ReportFeedQuery } from "@/lib/validation/report";
import { readWardTimezone } from "@/lib/ward/wardTimezone";
import {
  listActivityLogSummaries,
  listActivityLogsForFeed,
  type ActivityLogCursor,
} from "@/lib/youth/activityLogs";
import { listActivityProfiles } from "@/lib/youth/queries";
import { toYouthReportTiles } from "@/lib/youth/reportTiles";
import type { Database } from "@/types/database";
import { ACTIVITY_TYPE_TONES, type ActivityType } from "@/types/domain";

// One page of the YOUTH return-and-report feed, assembled.
//
// BOTH THE PAGE AND THE ROUTE CALL THIS, for the reason lib/visits/reportFeed.ts states:
// app/(app)/youth/feed/page.tsx renders the first page on the server so read state is correct on
// first paint (plans/retros/talks-d measured that flash at 268 ms unthrottled and 3.8 s at 20×
// CPU throttling), and app/api/youth/feed/route.ts serves every page after it. Two copies of this
// assembly would drift, and the way it would show is a second page whose tiles disagree with the
// first.
//
// THIS MODULE DOES NOT IMPORT lib/youth/privateNotes.ts, AND MUST NOT. The tiles are built by
// lib/youth/reportTiles.ts from ActivityLogWithContext, which has no private-note field to read
// (CLAUDE.md rule 5). The import list above is where a reviewer sees that in one glance.
//
// RLS DECIDES THE SCOPE. There is no org filter here beyond the one the READER asked for:
// migration 057c's `activity_logs_select` narrows a follow-up to the bishopric, its own author,
// the owning organization, or everybody when the ward has cross-org visibility on. A filter
// restated here would either duplicate the policy or quietly disagree with it (CLAUDE.md rule 2).
//
// SERVER-ONLY — every import below reaches Supabase through the caller's session client.
//
// ---------------------------------------------------------------------------
// THE ORDERING IS A DELIBERATE DEPARTURE FROM VISITS, AND THE CURSOR IS THE TRAP
// ---------------------------------------------------------------------------
// The visits feed orders on `visit_date` — the day it happened — because that column is on the row
// being paged. A youth log's event date lives on a DIFFERENT TABLE, and PostgREST cannot order
// parent rows by an embedded column, so a keyset over it is not expressible.
//
// So this feed orders on `activity_logs.created_at`: NEWEST REPORT FIRST, while the tile displays
// the EVENT'S date. That is not a compromise to apologise for. A return-and-report feed ordered by
// when a report ARRIVED never reorders under a reader, and a follow-up filed late on a game three
// weeks ago appears at the top where somebody will actually see it — which is arguably what the
// visits feed should do too. That is a question for whoever next touches lib/visits/reportFeed.ts.

// Ordered by label so the dropdown is stable between renders, and built from a Map so an activity
// with forty follow-ups appears once.
//
// Derived from the SUMMARIES rather than from the ward's activity list, so the filter never offers
// a season nobody has written a follow-up about and then answers with an empty feed.
function contextsFrom(
  summaries: readonly { profileId: string | null }[],
  activitiesById: ReadonlyMap<string, { name: string; type: ActivityType }>,
): ReportFeedContext[] {
  const seen = new Set<string>();

  for (const summary of summaries) {
    if (summary.profileId !== null && activitiesById.has(summary.profileId)) {
      seen.add(summary.profileId);
    }
  }

  return [...seen]
    .map((id): ReportFeedContext => {
      const activity = activitiesById.get(id)!;
      return { id, label: activity.name, tone: ACTIVITY_TYPE_TONES[activity.type] };
    })
    .sort((left, right) => left.label.localeCompare(right.label));
}

export async function readYouthReportFeed(
  wardId: string,
  query: ReportFeedQuery,
  before: ActivityLogCursor | null,
  client: SupabaseClient<Database>,
): Promise<ReportFeedPage> {
  const profileId = query.context ?? undefined;

  // limit + 1, then trimmed. Asking for exactly `limit` cannot tell "the last page" from "a full
  // page that happens to end here", so the reader would be offered a Load More that returns
  // nothing.
  //
  // `summaries` is UNFILTERED and narrowed in memory below, because it answers two questions at
  // once: how many are unread under the current filter, and which activities the filter should
  // offer at all. Fetching it filtered would make the dropdown's options depend on the option
  // already chosen — a filter you could not undo.
  //
  // `listActivityProfiles` is ward-wide by design (migration 054 survives untouched here), so the
  // labels exist for every follow-up this caller can read, including ward-wide ones.
  const [logs, summaries, profiles, wardTimezone] = await Promise.all([
    listActivityLogsForFeed(wardId, { profileId, limit: query.limit + 1, before }, client),
    listActivityLogSummaries(wardId, client),
    listActivityProfiles(wardId, client),
    readWardTimezone(wardId, client),
  ]);

  const hasMore = logs.length > query.limit;
  const page = hasMore ? logs.slice(0, query.limit) : logs;

  // The unread badge has to describe what the reader is looking at. Filtered to one activity,
  // "8 unread" over four tiles is a number nobody can reconcile against the list beneath it.
  const filteredReportIds = (
    profileId === undefined
      ? summaries
      : summaries.filter((summary) => summary.profileId === profileId)
  ).map((summary) => summary.id);

  const activitiesById = new Map(
    profiles.map((profile) => [
      profile.id,
      { name: profile.activityName, type: profile.activityType },
    ]),
  );

  // The read status for everything under the current filter, not just this page. It is what the
  // unread count below is computed from, and the page's tiles read out of the same map rather than
  // a second query.
  const readStatus = await listReadStatus("youth_activity", filteredReportIds, client);

  const tiles = toYouthReportTiles(page, { wardTimezone, readStatus });

  // A report with no row at all is unread, which is why this counts ids rather than rows.
  const unreadCount = filteredReportIds.filter(
    (reportId) => readStatus.get(reportId)?.isRead !== true,
  ).length;

  const last = page[page.length - 1];

  return {
    tiles,
    unreadCount,
    nextCursor:
      hasMore && last !== undefined
        ? // ---------------------------------------------------------------
          // NEVER `tile.occurredOn` HERE. THIS IS THE ONE LINE THAT IS EASY TO GET WRONG.
          // ---------------------------------------------------------------
          // `ReportFeedCursor` carries two halves because the visits feed orders on two columns.
          // This feed orders on `created_at` ALONE (see the header), so the `occurredOn` half is
          // the LOG'S created_at reduced to a date — a shape the shared decoder accepts — and the
          // query below reads only `createdAt`.
          //
          // Taking `occurredOn` from the tile would put the EVENT'S date in a cursor used to page
          // by REPORT date. They are different dates, so the feed would page in an order the query
          // does not use, skipping and repeating rows.
          encodeReportFeedCursor({
            occurredOn: last.createdAt.slice(0, 10),
            createdAt: last.createdAt,
          })
        : null,
    contexts: contextsFrom(summaries, activitiesById),
  };
}
