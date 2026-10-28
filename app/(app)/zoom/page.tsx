import { PoolLowBanner } from "@/app/(app)/zoom/PoolLowBanner";
import { ZoomTabs } from "@/app/(app)/zoom/ZoomTabs";
import { ContextualBackLink } from "@/components/layout/ContextualBackLink";
import { NotPermitted } from "@/components/ui/NotPermitted";
import { can, resolveRoleAccess } from "@/lib/auth/permissions";
import { requireSessionUser } from "@/lib/auth/session";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { createServiceSupabaseClient } from "@/lib/supabase/service";
import { readPageView } from "@/lib/users/userSettings";
import { canManageInvitees, canManageRemoteLinks } from "@/lib/zoom/access";
import { describePoolLevel, listPool } from "@/lib/zoom/joinLinkPool";
import { describeRemoteLinkRow } from "@/lib/zoom/remoteLinkRow";
import { listRemoteLinkAdminEntries, readOwnRemoteLinkState } from "@/lib/zoom/remoteLinks";
import { initialZoomTab, parseZoomView, visibleZoomTabs } from "@/lib/zoom/zoomView";

// Zoom — each leader's stream remote control (ITER-051, plans/zoom-remote-links.md).
//
// The reader's own state is read through THEIR client, so migration 094's holder-only policy
// decides it. The bishopric's tab is read through the service role AFTER canManageRemoteLinks(),
// and selects no link: status only (D3). The join-link pool (ITER-053) is read through the
// reader's own client, whose column grant leaves out `join_url` — so no URL can reach this page.
//
// can() rather than assertCan(): a ForbiddenError escaping a Server Component is a 500 whose
// message Next.js strips in production.

type ZoomPageProps = {
  // A Promise in Next 16.
  searchParams: Promise<{ from?: string; remote?: string }>;
};

export default async function ZoomPage({ searchParams }: ZoomPageProps) {
  const user = await requireSessionUser();
  const supabase = await createServerSupabaseClient();
  const roleAccess = await resolveRoleAccess(supabase, user.wardId, user.orgType);

  if (!can(user, "zoom.view", roleAccess)) {
    return <NotPermitted detail="Zoom is available to the bishopric, the ward clerk and the executive secretary." />;
  }

  const params = await searchParams;
  const ownState = await readOwnRemoteLinkState(supabase, user);

  const managesRemoteLinks = canManageRemoteLinks(user, roleAccess);
  const managesInvitees = canManageInvitees(user, roleAccess);

  const linkRows = managesRemoteLinks
    ? (await listRemoteLinkAdminEntries(user.wardId, createServiceSupabaseClient())).map(
        describeRemoteLinkRow,
      )
    : null;

  const pool = managesInvitees ? await listPool(supabase) : null;

  const visibleTabs = visibleZoomTabs({
    canManageInvitees: managesInvitees,
    canManageRemoteLinks: managesRemoteLinks,
  });
  const initialView = parseZoomView(await readPageView(user.id, "zoom", supabase));

  return (
    <div className="flex flex-col gap-6">
      <ContextualBackLink from={params.from} />

      <div className="min-w-0">
        <h1 className="text-xl font-semibold text-foreground">Zoom</h1>
        <p className="mt-1 max-w-2xl text-sm text-muted">
          Your remote control for the sacrament meeting stream.
        </p>
      </div>

      {pool ? <PoolLowBanner level={describePoolLevel(pool.freeCount)} /> : null}

      <ZoomTabs
        ownState={ownState}
        linkWentAway={params.remote === "none"}
        linkRows={linkRows}
        pool={pool}
        visibleTabs={visibleTabs}
        initialTab={initialZoomTab(initialView.tab, visibleTabs)}
      />
    </div>
  );
}
