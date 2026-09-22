import { NextResponse } from "next/server";
import { describeAccessRequest, permissionsForModule } from "@/lib/access/accessModules";
import { withholdAppWideGrantFromExistingWards } from "@/lib/access/appWideGrant";
import { decideAccessRequest, readAccessRequest } from "@/lib/access/requests";
import { writeAuditLog } from "@/lib/audit/writeAuditLog";
import { ForbiddenError } from "@/lib/auth/errors";
import { readJsonBody, respondToRouteError } from "@/lib/auth/routeErrors";
import { requireSessionUser } from "@/lib/auth/session";
import { emitNotification } from "@/lib/notifications/emitNotification";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { isSuperAdmin } from "@/lib/units/queries";
import { decideAccessRequestSchema } from "@/lib/validation/accessRequest";
import { ROLE_LABELS } from "@/types/domain";

// DECIDING A REQUEST. A super admin, and nobody else.
//
// `params` IS A PROMISE IN NEXT 16 (CLAUDE.md §8).
//
// ---------------------------------------------------------------------------
// A WARD ADMIN CANNOT APPROVE THEIR OWN REQUEST
// ---------------------------------------------------------------------------
// That is the whole point of a request: if the asker could approve it, the ward would simply be
// granting itself the permission. It is enforced twice, and the second one is the real boundary:
//
//   * HERE, by asking `unit_assignments` whether this session is a super admin — a question no
//     ward can reconfigure through `wards.settings.role_access`.
//   * AND IN THE DATABASE, by `access_requests` having NO WRITE POLICIES AT ALL (migration 073b),
//     so a route that forgot this check would still be refused.
//
// tests/rls/access-requests.test.ts asserts the second, because that is the one that holds when
// somebody forgets the first.

const NOT_SUPER_ADMIN = "access_requests.decide";

type RouteContext = { params: Promise<{ id: string }> };

export async function PATCH(request: Request, context: RouteContext) {
  const user = await requireSessionUser();

  try {
    const supabase = await createServerSupabaseClient();

    if (!(await isSuperAdmin(supabase))) {
      throw new ForbiddenError(NOT_SUPER_ADMIN);
    }

    const { id } = await context.params;
    const input = decideAccessRequestSchema.parse(await readJsonBody(request));

    const decided = await decideAccessRequest({
      requestId: id,
      decidedBy: user.id,
      status: input.status,
      decisionNote: input.decisionNote ?? null,
    });

    // A zero-row UPDATE means the request was not pending. Re-deciding would move `decided_by`
    // onto whoever pressed last and, on an approval, re-run the grant under a new name — so it is
    // refused with a sentence rather than silently re-stamped.
    if (!decided) {
      const existing = await readAccessRequest(id, supabase);

      return NextResponse.json(
        {
          error: existing
            ? "That request has already been answered."
            : "That request is not there.",
        },
        { status: existing ? 409 : 404 },
      );
    }

    // THE FAN-OUT. An app-wide approval writes an explicit OFF-override into every existing ward
    // so that no ward's effective access moves on the day the new default ships. See
    // lib/access/appWideGrant.ts — it is idempotent, it does not stop at a failure, and it does
    // not swallow one.
    //
    // It runs AFTER the decision is recorded: if it fails, the decision stands and the fan-out
    // can be re-run, which is recoverable. The other order would risk overriding every ward in
    // the app for a decision that then failed to record.
    let fanOutFailures = 0;
    if (decided.status === "approved_app_wide") {
      // EVERY permission the module expands to, not one. An app-wide grant that wrote an
      // off-override for only part of a module would let the rest of it through on deploy day,
      // which is precisely what the fan-out exists to prevent.
      for (const permission of permissionsForModule(decided.module, decided.level)) {
        const result = await withholdAppWideGrantFromExistingWards(decided.role, permission);
        fanOutFailures += result.failedCount;
      }
    }

    await writeAuditLog(
      {
        // Filed under the ward that ASKED, because that is whose access changed and whose trail a
        // later reader will search. `detail` names the decider's own ward.
        wardId: decided.wardId,
        userId: user.id,
        action: "access_request_decided",
        module: "admin",
        detail: {
          requestId: decided.id,
          status: decided.status,
          role: decided.role,
          module: decided.module,
          level: decided.level,
          decidingWardId: user.wardId,
          ...(decided.status === "approved_app_wide" ? { fanOutFailures } : {}),
        },
      },
      supabase,
    );

    // THE REQUESTER MUST BE ABLE TO SEE THE OUTCOME. The prototype shipped this flow without it
    // and caught the gap itself; a decision nobody is told about teaches leaders that asking does
    // nothing. The read path already admits them — `access_requests_select` is ward-scoped — and
    // this is what makes them go and look.
    await emitNotification(
      {
        wardId: decided.wardId,
        // ONE KEY FOR BOTH OUTCOMES. The title distinguishes them; a separate key per outcome
        // would let somebody opt out of hearing that they were declined while still hearing
        // that they were approved, which is not a preference worth offering.
        triggerKey: "access_request_decided",
        title:
          decided.status === "denied"
            ? "Your access request was declined"
            : "Your access request was approved",
        body: `${ROLE_LABELS[decided.role]} · ${describeAccessRequest(decided.module, decided.level)}`,
      },
      supabase,
    );

    // A PARTIAL FAN-OUT IS REPORTED, NOT SWALLOWED (CLAUDE.md rule 7). A ward that missed its
    // off-override will receive the new default the moment it deploys, which is the one outcome
    // the whole mechanism exists to prevent — so the caller is told, with the recovery named.
    if (fanOutFailures > 0) {
      return NextResponse.json({
        request: decided,
        warning:
          `${fanOutFailures} ward(s) did not receive the off-override and will get this ` +
          "permission as soon as the new default deploys. Decide again to re-run it — it is " +
          "safe to repeat.",
      });
    }

    return NextResponse.json({ request: decided });
  } catch (error) {
    return respondToRouteError(error, {
      route: "PATCH /api/access-requests/[id]",
      fallbackMessage: "Could not record the decision. Please try again.",
      detail: { wardId: user.wardId, userId: user.id },
    });
  }
}
