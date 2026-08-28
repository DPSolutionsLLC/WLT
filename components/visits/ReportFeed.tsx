"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ReportTile } from "@/components/visits/ReportTile";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { FormError } from "@/components/ui/FormError";
import type {
  ReportFeedContext,
  ReportFeedPage,
  ReportTile as ReportTileModel,
  ReportType,
} from "@/lib/reports/types";

// The return-and-report feed.
//
// ---------------------------------------------------------------------------
// GENERIC FROM THE FIRST LINE
// ---------------------------------------------------------------------------
// There is no prop, no state and no string in this file named `visit`, `household` or `org`.
// Phase 8 renders it with `reportType="youth_activity"` and its own `fetchPage`, and writes a
// mapper rather than a second component. 08-youth-activities.md names retrofitting genericity
// after a module-specific component ships as the pitfall this avoids.
//
// ONE STRING SURVIVED THAT CLAIM AND WAS FIXED IN youth-d: the filter's "no filter" option read
// "Every organization" hardcoded. It is now the `allContextsLabel` prop, defaulted to the string
// that was there — so the visits feed passes nothing and behaves identically, and the youth feed
// says "Every activity". Making the change here rather than forking the component is what §Step 6
// authorises; the visits feed was re-verified in the same session.
//
// The filter is generic too: it selects a `contextId`, which is an organization here and will be
// an activity in Phase 8. The component never learns what one is.
//
// ---------------------------------------------------------------------------
// READ STATE COMES FROM THE SERVER ON FIRST PAINT
// ---------------------------------------------------------------------------
// `initialPage` is rendered by the Server Component, so the feed never paints every tile as
// unread and corrects itself on hydration. plans/retros/talks-d measured that flash at 268 ms
// unthrottled and 3.8 s at 20x CPU throttling — long enough to read the wrong answer.
//
// `staleTime: Infinity` and no refetch on mount are what keep it that way. Switching the filter
// is a different query KEY rather than a refetch of this one, so the unfiltered first page stays
// cached and switching back to it is instant and flash-free.
//
// ---------------------------------------------------------------------------
// NO REALTIME SUBSCRIPTION, DELIBERATELY
// ---------------------------------------------------------------------------
// A feed of reports is not time-critical, and createBrowserClient() memoises — two components
// asking for the same channel topic get the same channel, and the second `.on()` throws
// (plans/retros/route-tests-and-realtime.md). If this is ever wanted, the topic must carry a
// useId().

export const REPORT_FEED_QUERY_KEY = "report-feed";

// How long a confirmation stays on screen before clearing itself.
const STATUS_MESSAGE_MS = 5000;

export type ReportFeedProps = {
  reportType: ReportType;
  initialPage: ReportFeedPage;
  fetchPage: (cursor: string | null, contextId: string | null) => Promise<ReportFeedPage>;
  emptyMessage: string;
  // The context the reader belongs to, when they belong to one. Drives the one-tap "only mine"
  // checkbox; null hides it, which is the right answer for somebody who oversees every context
  // rather than sitting in one.
  ownContextId?: string | null;
  // WHAT THE "no filter" OPTION IS CALLED. The one string in this component that could not be
  // generic without a prop: the dropdown's first option read "Every organization" hardcoded, which
  // is correct for visits and wrong for a feed whose contexts are ACTIVITIES.
  //
  // Changed IN PLACE rather than forked, which is what 08-youth-activities.md §Step 6 authorises
  // and §Pitfalls asks for by name ("Two nearly identical components drift. Parameterize the
  // one."). The default is the string that was there, so the visits feed passes nothing and its
  // behaviour is unchanged — which is how the change is shown to be safe rather than claimed to
  // be.
  allContextsLabel?: string;
  onOpen?: (tile: ReportTileModel) => void;
};

// Every cached filter variant and its page, as TanStack hands them back - the unit this
// component snapshots before an optimistic write and restores if the write fails.
type FeedSnapshot = [readonly unknown[], ReportFeedPage | undefined][];

// Marks the named reports read on ONE page, decrementing that page by however many of them it was
// actually showing as unread. A page that does not carry a given report comes back with its count
// untouched, which is what keeps a filtered page badge honest when the reader marks something read
// from a different filter.
function markTilesRead(page: ReportFeedPage, reportIds: ReadonlySet<string>): ReportFeedPage {
  const newlyRead = page.tiles.filter(
    (tile) => !tile.isRead && reportIds.has(tile.reportId),
  ).length;

  if (newlyRead === 0) return page;

  return {
    ...page,
    unreadCount: Math.max(0, page.unreadCount - newlyRead),
    tiles: page.tiles.map((tile) =>
      reportIds.has(tile.reportId) ? { ...tile, isRead: true } : tile,
    ),
  };
}

type MarkReadVariables = { reportId: string };
type BookmarkVariables = { reportId: string; bookmarked: boolean; label: string };

async function postReadStatus(
  reportType: ReportType,
  body: Record<string, unknown>,
): Promise<void> {
  const response = await fetch("/api/reports/read-status", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ reportType, ...body }),
  });

  if (!response.ok) {
    const payload = (await response.json().catch(() => ({}))) as { error?: string };
    throw new Error(payload.error ?? "That did not save. Please try again.");
  }
}

const SELECT_CLASSES =
  "min-h-11 rounded-md border border-border bg-surface-raised px-3 text-base text-foreground focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary";

export function ReportFeed({
  reportType,
  initialPage,
  fetchPage,
  emptyMessage,
  ownContextId = null,
  allContextsLabel = "Every organization",
  onOpen,
}: ReportFeedProps) {
  const queryClient = useQueryClient();

  const [activeContextId, setActiveContextId] = useState<string | null>(null);
  const [errorMessage, setErrorMessage] = useState<string>();
  const [statusMessage, setStatusMessage] = useState<string>();
  const [focusedReportId, setFocusedReportId] = useState<string | null>(null);
  const [isLoadingMore, setIsLoadingMore] = useState(false);

  const queryKey = [REPORT_FEED_QUERY_KEY, reportType, activeContextId];

  // Keyed by report id rather than by index, so Next unread still scrolls to the right tile after
  // a page is appended or the filter changes what is on screen.
  const tileRefs = useRef(new Map<string, HTMLLIElement>());

  // Clears itself so a confirmation about something the reader did a minute ago is not still
  // sitting there claiming to describe what they just did.
  useEffect(() => {
    if (statusMessage === undefined) return;
    const timer = setTimeout(() => setStatusMessage(undefined), STATUS_MESSAGE_MS);
    return () => clearTimeout(timer);
  }, [statusMessage]);

  const { data } = useQuery<ReportFeedPage>({
    queryKey,
    queryFn: () => fetchPage(null, activeContextId),
    // Only the UNFILTERED feed was rendered on the server. Every other filter is a genuine fetch,
    // which is why `page` below can be undefined for a moment and the list says so.
    initialData: activeContextId === null ? initialPage : undefined,
    staleTime: Infinity,
    refetchOnMount: false,
    refetchOnWindowFocus: false,
  });

  const page = data;

  // ---------------------------------------------------------------------------
  // A MUTATION PATCHES EVERY CACHED FILTER, NOT ONLY THE ONE ON SCREEN
  // ---------------------------------------------------------------------------
  // Each filter is its own query key, so bookmarking a report while filtered to one context used
  // to leave the "everything" page holding the state it was server-rendered with. Switching the
  // filter back showed the bookmark gone until a reload - the same class of lie as the unread
  // flash, arriving from the other direction. Found testing the filter on 2026-08-26.
  //
  // These write through the whole family instead. A page that does not carry a given report is
  // left untouched by the updaters below, so a filtered page never gains a count it cannot show.
  const feedKeyPrefix = [REPORT_FEED_QUERY_KEY, reportType];

  const patchAllPages = useCallback(
    (update: (page: ReportFeedPage) => ReportFeedPage) => {
      queryClient.setQueriesData<ReportFeedPage>({ queryKey: feedKeyPrefix }, (page) =>
        page === undefined ? page : update(page),
      );
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps -- feedKeyPrefix is derived from these
    [queryClient, reportType],
  );

  const snapshotPages = (): FeedSnapshot =>
    queryClient.getQueriesData<ReportFeedPage>({ queryKey: feedKeyPrefix });

  const restorePages = (snapshot: FeedSnapshot): void => {
    for (const [key, cached] of snapshot) queryClient.setQueryData(key, cached);
  };

  const writePage = useCallback(
    (next: ReportFeedPage) => {
      queryClient.setQueryData<ReportFeedPage>(queryKey, next);
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps -- queryKey is derived from these two
    [queryClient, reportType, activeContextId],
  );

  // The context list comes from the server and covers the WHOLE feed, so it does not shrink as the
  // reader filters. Falls back to the first page's list while a filtered page is in flight.
  const contexts: ReportFeedContext[] = page?.contexts ?? initialPage.contexts;
  const ownContext = contexts.find((context) => context.id === ownContextId) ?? null;
  const activeContext = contexts.find((context) => context.id === activeContextId) ?? null;

  const changeContext = (next: string | null): void => {
    setActiveContextId(next);
    setFocusedReportId(null);
    setErrorMessage(undefined);
    setStatusMessage(undefined);
  };

  // ---------------------------------------------------------------------------
  // Optimistic, and it ROLLS BACK VISIBLY
  // ---------------------------------------------------------------------------
  // A tap that silently reverted would look like a tile that refused to be read for no reason.
  // The snapshot goes back AND the reason is put on screen (CLAUDE.md rule 7).
  const markRead = useMutation<void, Error, MarkReadVariables, { previous: FeedSnapshot }>({
    mutationFn: ({ reportId }) => postReadStatus(reportType, { reportId, read: true }),
    onMutate: async ({ reportId }) => {
      setErrorMessage(undefined);
      await queryClient.cancelQueries({ queryKey: feedKeyPrefix });

      const previous = snapshotPages();
      patchAllPages((cached) => markTilesRead(cached, new Set([reportId])));

      return { previous };
    },
    onError: (error, _variables, context) => {
      if (context) restorePages(context.previous);
      setErrorMessage(error.message);
    },
  });

  // ---------------------------------------------------------------------------
  // A BOOKMARK SAYS WHAT IT DID
  // ---------------------------------------------------------------------------
  // The star sits beside a report that also has a ward-council flag elsewhere in the app, and a
  // silent star invites the reader to wonder whether they have just summoned the executive
  // secretary. So the confirmation names the report AND says who can see it — which is nobody.
  // Raised reviewing scenario 041 on 2026-08-26.
  const toggleBookmark = useMutation<
    void,
    Error,
    BookmarkVariables,
    { previous: FeedSnapshot }
  >({
    mutationFn: ({ reportId, bookmarked }) =>
      postReadStatus(reportType, { reportId, bookmarked }),
    onMutate: async ({ reportId, bookmarked }) => {
      setErrorMessage(undefined);
      await queryClient.cancelQueries({ queryKey: feedKeyPrefix });

      const previous = snapshotPages();

      patchAllPages((cached) => ({
        ...cached,
        tiles: cached.tiles.map((tile) =>
          tile.reportId === reportId ? { ...tile, bookmarked } : tile,
        ),
      }));

      return { previous };
    },
    onSuccess: (_result, { bookmarked, label }) => {
      setStatusMessage(
        bookmarked
          ? `Bookmarked ${label} for yourself. Nobody else can see this, and nobody has been notified.`
          : `Removed your bookmark on ${label}.`,
      );
    },
    onError: (error, _variables, context) => {
      if (context) restorePages(context.previous);
      setErrorMessage(error.message);
    },
  });

  const tiles = page?.tiles ?? [];
  const unreadTiles = tiles.filter((tile) => !tile.isRead);

  const markAllRead = useMutation<
    void,
    Error,
    void,
    { previous: FeedSnapshot; markedCount: number }
  >({
    mutationFn: async () => {
      const reportIds = unreadTiles.map((tile) => tile.reportId);
      if (reportIds.length === 0) return;

      const response = await fetch("/api/reports/read-status", {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ reportType, reportIds }),
      });

      if (!response.ok) {
        const payload = (await response.json().catch(() => ({}))) as { error?: string };
        throw new Error(payload.error ?? "Those did not save. Please try again.");
      }
    },
    onMutate: async () => {
      setErrorMessage(undefined);
      await queryClient.cancelQueries({ queryKey: feedKeyPrefix });

      const previous = snapshotPages();
      // Exactly the reports the reader can see RIGHT NOW, which under a filter is a subset of the
      // feed. Patching every tile in every cached page would mark the whole feed read from a
      // button that promised only what was on screen.
      const markedIds = new Set(unreadTiles.map((tile) => tile.reportId));

      patchAllPages((cached) => markTilesRead(cached, markedIds));

      return { previous, markedCount: markedIds.size };
    },
    onSuccess: (_result, _variables, context) => {
      const markedCount = context?.markedCount ?? 0;
      setStatusMessage(
        `Marked ${markedCount} ${markedCount === 1 ? "report" : "reports"} as read for yourself. ` +
          "Everybody else's unread list is unchanged.",
      );
    },
    onError: (error, _variables, context) => {
      if (context) restorePages(context.previous);
      setErrorMessage(error.message);
    },
  });

  const isBusy = markRead.isPending || toggleBookmark.isPending || markAllRead.isPending;

  const handleOpen = (tile: ReportTileModel): void => {
    setFocusedReportId(tile.reportId);
    if (!tile.isRead) markRead.mutate({ reportId: tile.reportId });
    onOpen?.(tile);
  };

  // ---------------------------------------------------------------------------
  // Next Unread walks the queue IN FEED ORDER
  // ---------------------------------------------------------------------------
  // From the tile after the one currently focused, wrapping to the top — so a reader who has
  // jumped around does not have to work out where the walk resumes. Read tiles are skipped
  // because they are not what the button promises.
  const goToNextUnread = (): void => {
    if (unreadTiles.length === 0) return;

    const focusedIndex = tiles.findIndex((tile) => tile.reportId === focusedReportId);
    const next = tiles.slice(focusedIndex + 1).find((tile) => !tile.isRead) ?? unreadTiles[0];

    if (next === undefined) return;

    setFocusedReportId(next.reportId);
    tileRefs.current.get(next.reportId)?.scrollIntoView({ block: "center" });
    // Marks read too: Next Unread IS opening it. Leaving it unread would make the button walk
    // the same tile forever.
    markRead.mutate({ reportId: next.reportId });
  };

  const handleMarkAllRead = (): void => {
    // Confirmed first, because it is not individually undoable — there is no un-read, by design
    // (lib/validation/report.ts). The count is named, and so is the FILTER: "mark all as read"
    // while looking at one organization must not read as a promise about the whole feed.
    const scope = activeContext === null ? "" : ` from ${activeContext.label}`;

    const confirmed = window.confirm(
      page?.nextCursor === null
        ? `Mark all ${unreadTiles.length} unread reports${scope} as read? This only changes what ` +
            "YOU see, and it cannot be undone one by one."
        : `Mark the ${unreadTiles.length} unread reports${scope} loaded so far as read? Older ` +
            "reports further down the feed stay unread. This only changes what YOU see, and it " +
            "cannot be undone one by one.",
    );

    if (confirmed) markAllRead.mutate();
  };

  const loadMore = async (): Promise<void> => {
    if (!page || page.nextCursor === null) return;

    setIsLoadingMore(true);
    setErrorMessage(undefined);

    try {
      const next = await fetchPage(page.nextCursor, activeContextId);

      writePage({
        // The newer page's counts are the authoritative ones: they were computed a moment ago,
        // and the optimistic decrements above may have raced them.
        unreadCount: next.unreadCount,
        nextCursor: next.nextCursor,
        contexts: next.contexts,
        tiles: [...page.tiles, ...next.tiles],
      });
    } catch (error) {
      setErrorMessage(
        error instanceof Error ? error.message : "Could not load more reports. Please try again.",
      );
    } finally {
      setIsLoadingMore(false);
    }
  };

  // A filter with one option is a control that cannot do anything.
  const showFilter = contexts.length > 1;
  const isOwnContextActive = ownContext !== null && activeContextId === ownContext.id;

  return (
    <Card>
      <div className="flex flex-col gap-4">
        {showFilter ? (
          <div className="flex flex-col gap-3 border-b border-border pb-4">
            {ownContext === null ? null : (
              <label className="flex min-h-11 items-center gap-2 text-sm text-foreground">
                <input
                  type="checkbox"
                  className="size-5 accent-primary"
                  checked={isOwnContextActive}
                  onChange={(event) =>
                    changeContext(event.target.checked ? ownContext.id : null)
                  }
                />
                Only {ownContext.label}
              </label>
            )}

            <label className="flex flex-col gap-1 text-sm text-muted">
              Showing
              {/* The same state as the checkbox above, not a second one. Picking a context here
                  clears the checkbox unless it happens to be the reader's own. */}
              <select
                className={SELECT_CLASSES}
                value={activeContextId ?? ""}
                onChange={(event) => changeContext(event.target.value || null)}
              >
                <option value="">{allContextsLabel}</option>
                {contexts.map((context) => (
                  <option key={context.id} value={context.id}>
                    {context.label}
                  </option>
                ))}
              </select>
            </label>
          </div>
        ) : null}

        <div className="flex flex-wrap items-center justify-between gap-2">
          <p className="text-sm text-muted" aria-live="polite">
            {page === undefined
              ? "Loading…"
              : page.unreadCount === 0
                ? "Nothing unread."
                : `${page.unreadCount} unread ${page.unreadCount === 1 ? "report" : "reports"}.`}
          </p>

          <div className="flex flex-wrap gap-2">
            <Button
              variant="secondary"
              onClick={goToNextUnread}
              disabled={isBusy || unreadTiles.length === 0}
            >
              Next unread
            </Button>
            <Button
              variant="secondary"
              onClick={handleMarkAllRead}
              disabled={isBusy || unreadTiles.length === 0}
            >
              Mark all as read
            </Button>
          </div>
        </div>

        {/* Says what happened, for actions whose only other evidence is a small icon changing
            shape. role="status" rather than role="alert": this is a confirmation, and a screen
            reader should hear it without having the current sentence interrupted. */}
        {statusMessage === undefined ? null : (
          <p role="status" className="text-sm text-success">
            {statusMessage}
          </p>
        )}

        <FormError message={errorMessage} />

        {page === undefined ? (
          <p className="text-sm text-muted">Loading reports…</p>
        ) : tiles.length === 0 ? (
          <p className="text-sm text-muted">
            {activeContext === null
              ? emptyMessage
              : `Nothing from ${activeContext.label} yet.`}
          </p>
        ) : (
          <ul className="flex flex-col gap-3">
            {tiles.map((tile) => (
              <ReportTile
                key={tile.reportId}
                ref={(element) => {
                  if (element) tileRefs.current.set(tile.reportId, element);
                  else tileRefs.current.delete(tile.reportId);
                }}
                tile={tile}
                isFocused={tile.reportId === focusedReportId}
                isBusy={isBusy}
                onOpen={handleOpen}
                onToggleBookmark={(target) =>
                  toggleBookmark.mutate({
                    reportId: target.reportId,
                    bookmarked: !target.bookmarked,
                    label: target.subjectLabel,
                  })
                }
              />
            ))}
          </ul>
        )}

        {page?.nextCursor == null ? null : (
          <Button variant="secondary" onClick={loadMore} disabled={isLoadingMore}>
            {isLoadingMore ? "Loading…" : "Load older reports"}
          </Button>
        )}
      </div>
    </Card>
  );
}
