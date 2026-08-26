import type { SupabaseClient } from "@supabase/supabase-js";
import { listWardOrganizations } from "@/lib/auth/adminUsers";
import { listReadStatus } from "@/lib/reports/readStatus";
import type { ReportFeedContext, ReportFeedPage } from "@/lib/reports/types";
import { toReportTiles, type VisitOrganization } from "@/lib/visits/reportTiles";
import { listVisitLogSummaries, listVisitLogs } from "@/lib/visits/queries";
import {
  encodeReportFeedCursor,
  type ReportFeedQuery,
} from "@/lib/validation/report";
import type { Database } from "@/types/database";
import { ORGANIZATION_TYPE_TONES } from "@/types/domain";

// One page of the visits return-and-report feed, assembled.
//
// BOTH THE PAGE AND THE ROUTE CALL THIS. app/(app)/visits/feed/page.tsx renders the first page on
// the server so read state is correct on first paint (plans/retros/talks-d — client-only state the
// server renders around is a measured 268 ms flash), and app/api/visits/feed/route.ts serves every
// page after it. Two copies of this assembly would drift, and the way it would show is a second
// page whose tiles disagree with the first.
//
// THIS MODULE DOES NOT IMPORT lib/visits/privateNotes.ts, AND MUST NOT. The tiles are built by
// lib/visits/reportTiles.ts from VisitLogWithContext, which has no private-note field to read
// (CLAUDE.md rule 5).
//
// RLS DECIDES THE SCOPE. There is no org filter here beyond the one the READER asked for: cross-org
// visibility takes effect for free through visit_logs_select (migration 019), and a filter restated
// here would either duplicate the policy or quietly disagree with it. The `contextId` below is a
// display preference, never a permission — a caller who names an organization they cannot read
// gets an empty page from the policy rather than a refusal from this module.
//
// SERVER-ONLY — every import below reaches Supabase through the caller's session client.

// Ordered by label so the dropdown is stable between renders, and built from a Set so an
// organization with forty reports appears once.
function contextsFrom(
  summaries: readonly { orgId: string | null }[],
  organizationsById: ReadonlyMap<string, VisitOrganization>,
): ReportFeedContext[] {
  const seen = new Set<string>();

  for (const summary of summaries) {
    if (summary.orgId !== null && organizationsById.has(summary.orgId)) {
      seen.add(summary.orgId);
    }
  }

  return [...seen]
    .map((id): ReportFeedContext => {
      const organization = organizationsById.get(id)!;
      return {
        id,
        label: organization.name,
        tone: ORGANIZATION_TYPE_TONES[organization.type],
      };
    })
    .sort((left, right) => left.label.localeCompare(right.label));
}

export async function readVisitReportFeed(
  wardId: string,
  query: ReportFeedQuery,
  before: { occurredOn: string; createdAt: string } | null,
  client: SupabaseClient<Database>,
): Promise<ReportFeedPage> {
  const contextId = query.context ?? undefined;

  // limit + 1, then trimmed. Asking for exactly `limit` cannot tell "the last page" from "a full
  // page that happens to end here", so the reader would be offered a Load More that returns
  // nothing.
  //
  // `summaries` is UNFILTERED and narrowed in memory below, because it answers two questions at
  // once: how many are unread under the current filter, and which organizations the filter should
  // offer at all. Fetching it filtered would make the dropdown's options depend on the option
  // already chosen — a filter you could not undo.
  const [visits, summaries, organizations] = await Promise.all([
    listVisitLogs(
      wardId,
      {
        orgId: contextId,
        limit: query.limit + 1,
        before:
          before === null
            ? null
            : { visitDate: before.occurredOn, createdAt: before.createdAt },
      },
      client,
    ),
    listVisitLogSummaries(wardId, client),
    listWardOrganizations(wardId, client),
  ]);

  const hasMore = visits.length > query.limit;
  const page = hasMore ? visits.slice(0, query.limit) : visits;

  // The unread badge has to describe what the reader is looking at. Filtered to one organization,
  // "8 unread" over four tiles is a number nobody can reconcile against the list beneath it.
  const filteredReportIds = (
    contextId === undefined
      ? summaries
      : summaries.filter((summary) => summary.orgId === contextId)
  ).map((summary) => summary.id);

  const organizationsById = new Map<string, VisitOrganization>(
    organizations.map((organization) => [
      organization.id,
      { name: organization.name, type: organization.type },
    ]),
  );

  // The read status for everything under the current filter, not just this page. It is what the
  // unread count below is computed from, and the page's tiles read out of the same map rather than
  // a second query.
  const readStatus = await listReadStatus("visit_log", filteredReportIds, client);

  const tiles = toReportTiles(page, { organizations: organizationsById, readStatus });

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
        ? encodeReportFeedCursor({ occurredOn: last.visitDate, createdAt: last.createdAt })
        : null,
    // Every organization that HAS a report this caller can read — not every organization in the
    // ward, which would offer a Primary that has never logged a visit and answer with an empty
    // feed. Derived from the unfiltered summaries, so it neither shrinks as the reader pages past
    // an organization's last report nor changes when a filter is applied.
    //
    // A visit with no organization contributes nothing here: there is no organization to filter
    // to, and only the bishopric can see one at all.
    contexts: contextsFrom(summaries, organizationsById),
  };
}
