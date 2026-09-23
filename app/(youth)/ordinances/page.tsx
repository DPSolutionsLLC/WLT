import { Card } from "@/components/ui/Card";
import { assertCan, resolveRoleAccess } from "@/lib/auth/permissions";
import { requireSessionUser } from "@/lib/auth/session";
import { createServerSupabaseClient } from "@/lib/supabase/server";

// Deliberately thin, not unfinished. The real assignment grid, the rotation view, and the
// send-message flow are P11 (plans/P11-sacrament-admin.md). This exists so a youth sign-in has
// somewhere to land and so the shell isolation can be walked through.
//
// ---------------------------------------------------------------------------
// THIS IS `/ordinances`, NOT `/sacrament`, AND THAT IS DELIBERATE — p4-sacrament-a
// ---------------------------------------------------------------------------
// Route groups contribute nothing to the URL, so app/(app)/… and app/(youth)/… share one URL
// space and a path belongs to exactly one of them. This file held `/sacrament` until P4, whose
// Sacrament MEETING hub — topics, talks, prayers, music, programme — is the prototype's own
// name for that word and the label on the dashboard tile. The two meanings are different
// features for different accounts:
//
//   /sacrament             the meeting being planned          (P4, app shell, talks.view)
//   /ordinances            who passes, blesses and prepares   (this page, youth shell)
//   /sacrament/ordinances  the ADULT view of the same thing   (P11, app shell, not built)
//
// Do not move this back. The redirects in app/(app)/layout.tsx, app/(auth)/pin/PinSignInForm.tsx
// and app/api/auth/pin-login/route.ts all name `/ordinances` and carry the same note.
export default async function YouthOrdinancesPage() {
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
  const roleAccess = await resolveRoleAccess(supabase, user.wardId, user.orgType);

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
