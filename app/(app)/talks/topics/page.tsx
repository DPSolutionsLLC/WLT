import { TopicHistoryList } from "@/app/(app)/talks/topics/TopicHistoryList";
import { NotPermitted } from "@/components/ui/NotPermitted";
import { can, resolveRoleAccess } from "@/lib/auth/permissions";
import { requireSessionUser } from "@/lib/auth/session";
import { formatDateOnly } from "@/lib/calendar/dates";
import { listTopicHistory } from "@/lib/topics/queries";
import { parseTopicHistoryView } from "@/lib/topics/topicHistory";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { readPageView } from "@/lib/users/userSettings";

// THE WARD'S TOPIC HISTORY — every topic given in sacrament meeting, and who gave it. It replaced
// the topic library on the user's decision, 2026-09-29: "a good usable history of topics that have
// been used", not "a library of preselected topics". A talk's topic is the words typed for it
// (migration 086), and this page reads them straight off the talks.
//
// `topics.view` is bishopric-only in lib/auth/permissions.ts, so anybody else gets "Not permitted"
// rather than an empty history — an empty history is a different claim.

export default async function TopicHistoryPage() {
  const user = await requireSessionUser();
  const supabase = await createServerSupabaseClient();
  const roleAccess = await resolveRoleAccess(supabase, user.wardId, user.orgType);

  // can() rather than assertCan(): a ForbiddenError escaping a Server Component becomes a 500
  // whose message Next.js strips in production (plans/retros/auth-b-invites-admin.md).
  if (!can(user, "topics.view", roleAccess)) {
    return <NotPermitted detail="The topic history is limited to the bishopric." />;
  }

  // Read ONCE here, so "coming up" means the same day everywhere on the page.
  const today = formatDateOnly(new Date());

  const [entries, savedView] = await Promise.all([
    listTopicHistory(user.wardId, { today }, supabase),
    readPageView(user.id, "topic_history", supabase),
  ]);

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="font-display text-xl font-semibold text-foreground">Topic history</h1>
        <p className="mt-1 text-sm text-muted">
          Every topic given in sacrament meeting, and who gave it.
        </p>
      </div>

      <TopicHistoryList entries={entries} initialView={parseTopicHistoryView(savedView)} />
    </div>
  );
}
