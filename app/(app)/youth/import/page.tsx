import Link from "next/link";
import { IcsImportWizard } from "@/app/(app)/youth/import/IcsImportWizard";
import { NotPermitted } from "@/components/ui/NotPermitted";
import { can, resolveRoleAccess } from "@/lib/auth/permissions";
import { requireSessionUser } from "@/lib/auth/session";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { listActivityProfiles } from "@/lib/youth/queries";

// Import a school or league schedule against one activity profile.
//
// EVERY PROFILE IN THE WARD IS OFFERED, not only ones this user could edit. `activity_calendars`
// and `activity_events` both keep migration 019's ward-wide write policies (migration 055c says
// why), so the API genuinely allows an import against any of them — an event inherits its
// organization through its profile. Gating the select on canManageActivityProfile() would hide a
// control the API allows, which is the mirror of defect youth-a-D1 and just as wrong. If this
// should ever be narrowed, the migration comes first and this page follows it.
//
// can() rather than assertCan(): a ForbiddenError escaping a Server Component becomes a 500 whose
// message Next.js strips in production (plans/retros/auth-b-invites-admin.md), which is what
// app/(app)/youth/page.tsx already does.
//
// NOT LINKED FROM lib/auth/navigation.ts. This page is reached from /youth, and adding a sidebar
// item for it would put a second entry point in front of people who have no schedule feed.

export default async function YouthCalendarImportPage() {
  const user = await requireSessionUser();
  const supabase = await createServerSupabaseClient();
  const roleAccess = await resolveRoleAccess(supabase, user.wardId);

  if (!can(user, "youth_activities.manage", roleAccess)) {
    return (
      <NotPermitted detail="Importing a schedule is done by an organization presidency or the bishopric." />
    );
  }

  const profiles = await listActivityProfiles(user.wardId, supabase);

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-xl font-semibold text-foreground">Import a schedule</h1>
        <p className="mt-1 text-sm text-muted">
          Two steps — choose the activity and the file, then check the preview and confirm.
        </p>
        {/* /youth/profiles, NOT /youth. This link means "back to where the schedule is", and the
            schedule moved there in youth-e — /youth is now the young people themselves, which is
            not where somebody who has just imported a file wants to land. */}
        <Link
          href="/youth/profiles"
          className="mt-2 inline-block text-sm text-primary underline underline-offset-4"
        >
          Back to the activities and schedule
        </Link>
      </div>

      <IcsImportWizard initialProfiles={profiles} />
    </div>
  );
}
