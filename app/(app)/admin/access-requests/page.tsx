import { AccessRequests } from "@/app/(app)/admin/access-requests/AccessRequests";
import { NotPermitted } from "@/components/ui/NotPermitted";
import { listAccessRequests } from "@/lib/access/requests";
import {
  NON_OVERRIDABLE_PERMISSIONS,
  NON_OVERRIDABLE_ROLES,
  PERMISSIONS,
  can,
  resolveRoleAccess,
} from "@/lib/auth/permissions";
import { requireSessionUser } from "@/lib/auth/session";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { isSuperAdmin } from "@/lib/units/queries";
import { ROLES } from "@/types/domain";

// THE QUEUE, AND THE REQUESTER'S OWN VIEW. One page, two audiences — `access_requests_select`
// decides which rows each one sees, so nothing here filters for security (CLAUDE.md rule 2).
//
// The layout above already gated the section on `admin.view`. The two things resolved HERE are
// narrower and different from each other:
//
//   * `admin.manage_roles` — may this person ASK. Asking to change what a role holds is the same
//     authority as configuring one, which is what that permission already names.
//   * `super_admin` — may this person DECIDE. A structural question, held in `unit_assignments`,
//     which no ward can reconfigure.
//
// A ward admin sees their ward's requests and the form; a super admin sees every ward's and the
// decision controls. Somebody who is both sees both, which is correct rather than a special case.
//
// can() rather than assertCan(): a ForbiddenError escaping a Server Component becomes a 500 whose
// message Next.js strips in production (plans/retros/auth-b-invites-admin.md).

// The SAME derivation lib/validation/accessRequest.ts uses, so the picker cannot offer something
// the route would refuse with a 400. `admin.*` and `sacrament.*` are non-overridable in both
// directions, so a request for one would be approved, written, and silently have no effect — and
// a granted permission that does not arrive is worse than a refusal, because nobody goes looking
// for it.
const REQUESTABLE_PERMISSIONS = PERMISSIONS.filter(
  (permission) => !NON_OVERRIDABLE_PERMISSIONS.includes(permission),
);

const REQUESTABLE_ROLES = ROLES.filter((role) => !NON_OVERRIDABLE_ROLES.includes(role));

export default async function AccessRequestsPage() {
  const user = await requireSessionUser();
  const supabase = await createServerSupabaseClient();
  const roleAccess = await resolveRoleAccess(supabase, user.wardId, user.orgType);

  const canAsk = can(user, "admin.manage_roles", roleAccess);
  const canDecide = await isSuperAdmin(supabase);

  if (!canAsk && !canDecide) {
    return (
      <NotPermitted detail="Asking for access is limited to the bishopric." />
    );
  }

  const requests = await listAccessRequests(supabase);

  return (
    <div className="flex flex-col gap-4">
      <div>
        <h1 className="text-xl font-semibold text-foreground">Access requests</h1>
        <p className="mt-1 text-sm text-muted">
          {canDecide
            ? "Requests from every ward. Approving for one ward turns it on there; approving for every ward tells them all and turns nothing on until each one decides."
            : "Ask for something a calling in your ward needs, and read the answer here."}
        </p>
      </div>

      <AccessRequests
        initialRequests={requests}
        requestablePermissions={[...REQUESTABLE_PERMISSIONS]}
        requestableRoles={[...REQUESTABLE_ROLES]}
        canAsk={canAsk}
        canDecide={canDecide}
      />
    </div>
  );
}
