import Link from "next/link";
import { YouthReportFeed } from "@/app/(app)/youth/feed/YouthReportFeed";
import { NotPermitted } from "@/components/ui/NotPermitted";
import { can, resolveRoleAccess } from "@/lib/auth/permissions";
import { requireSessionUser } from "@/lib/auth/session";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { DEFAULT_FEED_PAGE_SIZE } from "@/lib/validation/report";
import { readCrossOrgVisibility } from "@/lib/ward/crossOrgVisibility";
import { readYouthReportFeed } from "@/lib/youth/reportFeed";
import { YOUTH_CROSS_ORG_VISIBILITY_STATE_LABELS } from "@/types/domain";

// The youth activity return-and-report feed, at /youth/feed.
//
// A SERVER COMPONENT, and the first page is fetched HERE rather than in the browser. That is the
// whole reason read state is correct on first paint instead of every tile flashing unread and
// correcting itself on hydration (plans/retros/talks-d measured that at 268 ms unthrottled, 3.8 s
// at 20× CPU throttling).
//
// THIS PAGE DOES NOT IMPORT lib/youth/privateNotes.ts, AND MUST NOT. A private note belongs to its
// author and appears in no list, ever (CLAUDE.md rule 5) — the import list above is where a
// reviewer sees that in one glance, without reading a query.
//
// can() rather than assertCan(): a ForbiddenError escaping a Server Component becomes a 500 whose
// message Next.js strips in production (plans/retros/auth-b-invites-admin.md).

export default async function YouthFeedPage() {
  const user = await requireSessionUser();
  const supabase = await createServerSupabaseClient();
  const roleAccess = await resolveRoleAccess(supabase, user.wardId);

  if (!can(user, "youth_activities.view", roleAccess)) {
    return (
      <NotPermitted detail="Youth activity support is limited to ward and organization leadership." />
    );
  }

  const [page, crossOrgVisibility] = await Promise.all([
    readYouthReportFeed(user.wardId, { limit: DEFAULT_FEED_PAGE_SIZE }, null, supabase),
    readCrossOrgVisibility(user.wardId, supabase),
  ]);

  return (
    <div className="flex flex-col gap-6">
      <div>
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <h1 className="text-xl font-semibold text-foreground">
            Youth activity follow-ups
          </h1>
          <Link
            href="/youth"
            className="text-sm font-medium text-primary underline underline-offset-4"
          >
            Youth activities
          </Link>
        </div>

        {/* NEWEST REPORT FIRST, not newest event — and it says so, because the tile beneath it
            shows the EVENT'S date and the two can be weeks apart. A reader who saw a January game
            above a March one with no explanation would reasonably think the sort was broken.
            lib/youth/reportFeed.ts argues why the ordering is what it is. */}
        <p className="mt-1 text-sm text-muted">
          Every follow-up that has been written, newest report first — so a late one appears at the
          top rather than buried under the game it is about. What you have read is yours alone;
          marking a report read here does not mark it read for anybody else.
        </p>

        {/* ---------------------------------------------------------------
            WHICH MODE THIS WARD IS IN, IN WORDS. THIS IS NOT OPTIONAL.
            ---------------------------------------------------------------
            Migration 057 narrowed follow-ups to their own organization while the activity CALENDAR
            stayed ward-wide, and `ward_council_member` — the role most likely to have no
            organization at all, and one of the two this module was built for — feels that
            narrowing most. "Why can I see the Young Women's games but not their follow-ups?" is a
            question this page answers rather than one a leader takes to a counselor.

            The youth wording rather than CROSS_ORG_VISIBILITY_STATE_LABELS, whose two sentences
            both say "visit reports" — and whose "off" branch has nothing to say about a calendar
            that stayed open. */}
        <p className="mt-2 text-sm text-muted">
          {crossOrgVisibility
            ? YOUTH_CROSS_ORG_VISIBILITY_STATE_LABELS.on
            : YOUTH_CROSS_ORG_VISIBILITY_STATE_LABELS.off}
        </p>
      </div>

      <YouthReportFeed initialPage={page} />

      {/* Tiles carry ONE LINE of the shared note, and this says where the rest is — honestly.
          There is no per-follow-up detail view in this slice, so this does NOT link to a page that
          would not show the note. Your own follow-ups open in full from the schedule; somebody
          else's whole note has no screen yet, and saying so is better than a link that disappoints.

          The ward-council agenda that a flagged follow-up is meant to land on is Phase 9's. */}
      <p className="text-sm text-muted">
        Notes are shortened to one line here. You can open and change your own follow-ups from the
        schedule on the{" "}
        <Link href="/youth" className="font-medium text-primary underline underline-offset-4">
          youth activities page
        </Link>
        . There is no screen yet that shows somebody else&rsquo;s whole note.
      </p>
    </div>
  );
}
