"use client";

import { ReportFeed } from "@/components/visits/ReportFeed";
import type { ReportFeedPage } from "@/lib/reports/types";

// The visits half of the feed: which endpoint a page comes from, and nothing else.
//
// THIS FILE EXISTS BECAUSE A FUNCTION CANNOT CROSS THE SERVER/CLIENT BOUNDARY AS A PROP. The page
// above is a Server Component — which is what makes read state correct on first paint — and
// ReportFeed's `fetchPage` is an ordinary callback, not a Server Action. So the binding to
// /api/visits/feed happens here, in the browser, and the generic component stays free of any
// knowledge of which route it is reading.
//
// Phase 8 writes the same twelve lines against its own endpoint. That is the intended shape: a
// module supplies a mapper and a fetcher, never a second feed.

export type VisitReportFeedProps = {
  initialPage: ReportFeedPage;
  // The reader's own organization, so the feed can offer a one-tap "only mine". Null for the
  // bishopric, who belong to no organization and get the dropdown alone.
  ownOrganizationId: string | null;
};

// The parameter names are the names app/api/visits/feed/route.ts reads, checked against that file
// rather than assumed — a name the handler does not read gets no error, just a silently ignored
// parameter (plans/retros/roster-b-picker-and-orgs.md).
async function fetchVisitFeedPage(
  cursor: string | null,
  contextId: string | null,
): Promise<ReportFeedPage> {
  const url = new URL("/api/visits/feed", window.location.origin);
  if (cursor !== null) url.searchParams.set("before", cursor);
  if (contextId !== null) url.searchParams.set("context", contextId);

  const response = await fetch(url, { cache: "no-store" });

  if (!response.ok) {
    const payload = (await response.json().catch(() => ({}))) as { error?: string };
    throw new Error(payload.error ?? "Could not load more reports. Please try again.");
  }

  return (await response.json()) as ReportFeedPage;
}

export function VisitReportFeed({ initialPage, ownOrganizationId }: VisitReportFeedProps) {
  return (
    <ReportFeed
      reportType="visit_log"
      initialPage={initialPage}
      ownContextId={ownOrganizationId}
      fetchPage={fetchVisitFeedPage}
      emptyMessage="No visits have been reported yet. They appear here as leaders log them."
    />
  );
}
