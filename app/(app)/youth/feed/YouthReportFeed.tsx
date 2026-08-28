"use client";

import { ReportFeed } from "@/components/visits/ReportFeed";
import type { ReportFeedPage } from "@/lib/reports/types";

// The youth half of the feed: which endpoint a page comes from, and nothing else.
//
// THIS IS THE TWELVE LINES VisitReportFeed's HEADER PROMISED. "Phase 8 writes the same twelve
// lines against its own endpoint. That is the intended shape: a module supplies a mapper and a
// fetcher, never a second feed." This file, lib/youth/reportTiles.ts and lib/youth/reportFeed.ts
// are the whole of Phase 8's half; components/visits/ReportFeed.tsx and ReportTile.tsx are
// rendered UNCHANGED.
//
// It exists because A FUNCTION CANNOT CROSS THE SERVER/CLIENT BOUNDARY AS A PROP. The page above
// is a Server Component — which is what makes read state correct on first paint — and
// ReportFeed's `fetchPage` is an ordinary callback, not a Server Action. So the binding to
// /api/youth/feed happens here, in the browser.

export type YouthReportFeedProps = {
  initialPage: ReportFeedPage;
};

// The parameter names are the names app/api/youth/feed/route.ts reads, checked against that file
// rather than assumed — a name the handler does not read gets no error, just a silently ignored
// parameter (plans/retros/roster-b-picker-and-orgs.md).
async function fetchYouthFeedPage(
  cursor: string | null,
  contextId: string | null,
): Promise<ReportFeedPage> {
  const url = new URL("/api/youth/feed", window.location.origin);
  if (cursor !== null) url.searchParams.set("before", cursor);
  if (contextId !== null) url.searchParams.set("context", contextId);

  const response = await fetch(url, { cache: "no-store" });

  if (!response.ok) {
    const payload = (await response.json().catch(() => ({}))) as { error?: string };
    throw new Error(payload.error ?? "Could not load more follow-ups. Please try again.");
  }

  return (await response.json()) as ReportFeedPage;
}

export function YouthReportFeed({ initialPage }: YouthReportFeedProps) {
  return (
    <ReportFeed
      reportType="youth_activity"
      initialPage={initialPage}
      // ---------------------------------------------------------------------
      // NO `ownContextId`, AND THAT IS NOT AN OMISSION
      // ---------------------------------------------------------------------
      // The "only mine" checkbox selects the READER'S OWN context. For visits that is their
      // organization. THERE IS NO SUCH THING AS THE READER'S OWN ACTIVITY — a context here is a
      // youth's basketball season, which belongs to a young person and not to a leader — so
      // passing anything would be a checkbox that means nothing. ReportFeed hides it on null.
      ownContextId={null}
      allContextsLabel="Every activity"
      fetchPage={fetchYouthFeedPage}
      emptyMessage="No follow-ups have been recorded yet. They appear here as leaders write them."
    />
  );
}
