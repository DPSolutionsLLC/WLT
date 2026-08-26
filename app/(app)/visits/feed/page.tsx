import Link from "next/link";
import { VisitReportFeed } from "@/app/(app)/visits/feed/VisitReportFeed";
import { NotPermitted } from "@/components/ui/NotPermitted";
import { can, resolveRoleAccess } from "@/lib/auth/permissions";
import { requireSessionUser } from "@/lib/auth/session";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { readCrossOrgVisibility } from "@/lib/ward/crossOrgVisibility";
import { readVisitReportFeed } from "@/lib/visits/reportFeed";
import { DEFAULT_FEED_PAGE_SIZE } from "@/lib/validation/report";
import { CROSS_ORG_VISIBILITY_STATE_LABELS } from "@/types/domain";

// The return-and-report feed, at /visits/feed.
//
// A SERVER COMPONENT, and the first page is fetched HERE rather than in the browser. That is the
// whole reason read state is correct on first paint instead of every tile flashing unread and
// correcting itself on hydration (plans/retros/talks-d measured that at 268 ms unthrottled, 3.8 s
// at 20x CPU throttling).
//
// THIS PAGE DOES NOT IMPORT lib/visits/privateNotes.ts, AND MUST NOT. A private note belongs to
// its author and appears in no list, ever (CLAUDE.md rule 5) — the import list above is where a
// reviewer sees that in one glance, without reading a query.
//
// can() rather than assertCan(): a ForbiddenError escaping a Server Component becomes a 500 whose
// message Next.js strips in production (plans/retros/auth-b-invites-admin.md).

export default async function VisitFeedPage() {
  const user = await requireSessionUser();
  const supabase = await createServerSupabaseClient();
  const roleAccess = await resolveRoleAccess(supabase, user.wardId);

  if (!can(user, "visits.view", roleAccess)) {
    return (
      <NotPermitted detail="The return-and-report feed is limited to ward and organization leadership." />
    );
  }

  const [page, crossOrgVisibility] = await Promise.all([
    readVisitReportFeed(user.wardId, { limit: DEFAULT_FEED_PAGE_SIZE }, null, supabase),
    readCrossOrgVisibility(user.wardId, supabase),
  ]);

  return (
    <div className="flex flex-col gap-6">
      <div>
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <h1 className="text-xl font-semibold text-foreground">Return and report</h1>
          <Link
            href="/visits"
            className="text-sm font-medium text-primary underline underline-offset-4"
          >
            Visit tracker
          </Link>
        </div>

        <p className="mt-1 text-sm text-muted">
          Every visit that has been reported, newest first. What you have read is yours alone —
          marking a report read here does not mark it read for anybody else.
        </p>

        {/* WHICH MODE THIS WARD IS IN, in words. "Why can I see the Relief Society's visits?" is a
            question the page should answer rather than leave a leader to ask a counselor — which
            is why GET /api/ward-settings/cross-org-visibility is gated on visits.view and not on
            admin. */}
        <p className="mt-2 text-sm text-muted">
          {crossOrgVisibility
            ? CROSS_ORG_VISIBILITY_STATE_LABELS.on
            : CROSS_ORG_VISIBILITY_STATE_LABELS.off}
        </p>
      </div>

      <VisitReportFeed initialPage={page} ownOrganizationId={user.orgId} />

      {/* Tiles carry ONE LINE of the shared note. The whole note is on the visit itself, which is
          the Recent visits panel on /visits — said here so a shortened preview reads as a
          deliberate summary rather than a note that got cut off. */}
      <p className="text-sm text-muted">
        Notes are shortened to one line here. The full shared note for every visit is on the{" "}
        <Link
          href="/visits"
          className="font-medium text-primary underline underline-offset-4"
        >
          visit tracker
        </Link>
        .
      </p>
    </div>
  );
}
