import { TopicList } from "@/app/(app)/talks/topics/TopicList";
import { NotPermitted } from "@/components/ui/NotPermitted";
import { can, resolveRoleAccess } from "@/lib/auth/permissions";
import { requireSessionUser } from "@/lib/auth/session";
import { listCandidates, listTopics } from "@/lib/topics/queries";
import { createServerSupabaseClient } from "@/lib/supabase/server";

// The topic library, at /talks/topics rather than the plan's /topics — that is what SPEC.md
// §Component Structure specifies and what NAVIGATION_ITEMS has always linked to. Building it
// anywhere else would have left the one Topics link in the sidebar pointing at a 404.
//
// `topics.view` and `topics.manage` are bishopric-only in lib/auth/permissions.ts, and migration
// 019 puts `topics` in the bishopric-only RLS loop. Both agree, so a non-bishopric role gets a
// "Not permitted" page rather than an empty library — an empty library is a different claim.

export default async function TopicsPage() {
  const user = await requireSessionUser();
  const supabase = await createServerSupabaseClient();
  const roleAccess = await resolveRoleAccess(supabase, user.wardId);

  // can() rather than assertCan(): a ForbiddenError escaping a Server Component becomes a 500
  // whose message Next.js strips in production (plans/retros/auth-b-invites-admin.md).
  if (!can(user, "topics.view", roleAccess)) {
    return <NotPermitted detail="The topic library is limited to the bishopric." />;
  }

  const canManage = can(user, "topics.manage", roleAccess);

  const [topics, candidates] = await Promise.all([
    // The DEFAULT filter — active topics, every category. TopicList seeds its cache from this
    // and refetches for any other combination.
    listTopics(user.wardId, { status: "active" }, supabase),
    listCandidates(user.wardId, "pending", supabase),
  ]);

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-xl font-semibold text-foreground">Topics</h1>
        <p className="mt-1 text-sm text-muted">
          Topics nobody has used yet appear first, so the ones worth considering are at the top.
        </p>
      </div>

      <TopicList
        initialTopics={topics}
        initialCandidates={candidates}
        canManage={canManage}
      />
    </div>
  );
}
