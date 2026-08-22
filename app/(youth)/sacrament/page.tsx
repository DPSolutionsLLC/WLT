import { Card } from "@/components/ui/Card";
import { assertCan, resolveRoleAccess } from "@/lib/auth/permissions";
import { requireSessionUser } from "@/lib/auth/session";
import { createServerSupabaseClient } from "@/lib/supabase/server";

// Deliberately thin, not unfinished. The real assignment grid, the rotation view, and the
// send-message flow are Phase 10 (plans/10-sacrament-admin.md). This exists so a youth
// sign-in has somewhere to land and so the shell isolation can be walked through.
//
// Route-group note for Phase 10: `/sacrament` resolves from app/(youth)/ because (app) and
// (youth) are both groups and contribute nothing to the URL. SPEC.md §Component Structure puts
// the bishopric's `/sacrament/admin` page under the authenticated shell, which cannot coexist
// with this file — a URL belongs to exactly one route group. Phase 10 has to resolve that,
// most likely by addressing the bishopric view as `/admin/sacrament`, which is also how every
// other bishopric-only screen in this app is addressed.
export default async function YouthSacramentPage() {
  const user = await requireSessionUser();

  // assertCan, not can() + NotPermitted. Every page under app/(app)/ uses can() because a
  // ForbiddenError escaping a Server Component becomes a 500 — but app/(youth)/layout.tsx already
  // redirects any non-sacrament_manager to /dashboard, so this is unreachable defence in depth.
  //
  // sacrament.view_assignments is in NON_OVERRIDABLE_PERMISSIONS, so resolving here cannot change
  // the answer. It is here so the rule "every permission check resolves the ward's role access"
  // has no exceptions: passing ROLE_PERMISSIONS literally would be a line someone copies into a
  // route where it WOULD matter, which is the trap ITER-005 exists to close.
  //
  // A sacrament_manager can read its own wards row — wards_select grants SELECT to any
  // authenticated user whose current_ward_id() matches, with no role predicate, which is what the
  // youth layout already relies on for the ward name.
  const supabase = await createServerSupabaseClient();
  const roleAccess = await resolveRoleAccess(supabase, user.wardId);

  assertCan(user, "sacrament.view_assignments", roleAccess);

  return (
    <div className="flex flex-col gap-4">
      <div>
        <h1 className="text-xl font-semibold text-foreground">Sacrament assignments</h1>
        <p className="mt-1 text-sm text-muted">
          This is the only part of the app your account can reach.
        </p>
      </div>

      <Card>
        <p className="text-sm text-foreground">
          The monthly assignment list is not built yet. When it is, this is where you will set
          who blesses and passes the sacrament each Sunday, and send the month&rsquo;s
          assignments out.
        </p>
      </Card>
    </div>
  );
}
