import { AiSettingsForm } from "@/app/(app)/ai-settings/AiSettingsForm";
import { VersionHistory } from "@/app/(app)/ai-settings/VersionHistory";
import { NotPermitted } from "@/components/ui/NotPermitted";
import { getActiveAiSettings, listAiSettingsVersions } from "@/lib/ai/queries";
import { can, resolveRoleAccess } from "@/lib/auth/permissions";
import { requireSessionUser } from "@/lib/auth/session";
import { createServerSupabaseClient } from "@/lib/supabase/server";

// NAVIGATION_ITEMS has always carried an "AI Settings" link at this path. Until now it 404ed;
// this page is what makes it resolve.
//
// `ai_settings.view` and `ai_settings.manage` are bishopric-only in lib/auth/permissions.ts, and
// migration 019 puts `ai_settings` in the bishopric-only RLS loop. Both agree, so a non-bishopric
// role gets "Not permitted" rather than an empty form — an empty form is a different claim.

export default async function AiSettingsPage() {
  const user = await requireSessionUser();
  const supabase = await createServerSupabaseClient();
  const roleAccess = await resolveRoleAccess(supabase, user.wardId);

  // can(), not assertCan(): a ForbiddenError escaping a Server Component becomes a 500 whose
  // message Next.js strips in production (plans/retros/auth-b-invites-admin.md).
  if (!can(user, "ai_settings.view", roleAccess)) {
    return <NotPermitted detail="AI settings are limited to the bishopric." />;
  }

  const canManage = can(user, "ai_settings.manage", roleAccess);

  const [settings, versions] = await Promise.all([
    getActiveAiSettings(user.wardId, supabase),
    listAiSettingsVersions(user.wardId, supabase),
  ]);

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-xl font-semibold text-foreground">AI settings</h1>
        <p className="mt-1 text-sm text-muted">
          These settings shape every draft the app generates. Nothing here is sent to anyone —
          every draft is still yours to read and approve.
        </p>
      </div>

      {/* The form owns the draft state and renders PreviewPanel itself, because the preview runs
          against what is ON SCREEN rather than what is in the database. Splitting them under this
          page would mean lifting the state here for no other reader. */}
      <AiSettingsForm initialSettings={settings} canManage={canManage} />

      <VersionHistory
        initialVersions={versions}
        activeVersionId={settings?.id ?? null}
        canManage={canManage}
      />
    </div>
  );
}
