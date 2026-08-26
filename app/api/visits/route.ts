import { NextResponse } from "next/server";
import { writeAuditLog } from "@/lib/audit/writeAuditLog";
import { assertCan, BISHOPRIC_ROLES, resolveRoleAccess } from "@/lib/auth/permissions";
import { readJsonBody, respondToRouteError } from "@/lib/auth/routeErrors";
import { requireSessionUser } from "@/lib/auth/session";
import { getHousehold } from "@/lib/roster/queries";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { createVisitLog, listVisitLogs } from "@/lib/visits/queries";
import { createVisitLogSchema, listVisitsQuerySchema } from "@/lib/validation/visit";
import type { Role } from "@/types/domain";

// Visit logs.
//
// THIS FILE DOES NOT IMPORT lib/visits/privateNotes.ts, AND MUST NOT. A private note is
// readable by its author alone (CLAUDE.md rule 5), and the way that promise is kept structural
// rather than remembered is that the module holding private notes is absent from this import
// list and the domain type below has no field for one. The response is built from
// VisitLogWithContext, which makes a private note UNREPRESENTABLE here — not omitted, not
// nulled, but impossible to put in without a type error a reviewer would see.
//
// tests/routes/visits.test.ts asserts on the serialized JSON body, so a future widening is
// caught even if the types were changed to allow it.
//
// The session is resolved OUTSIDE the try block: requireSessionUser() redirects by throwing an
// internal Next.js error, and catching that would turn a redirect into a 500.

function isBishopric(role: Role): boolean {
  return (BISHOPRIC_ROLES as readonly string[]).includes(role);
}

export async function GET(request: Request) {
  const user = await requireSessionUser();

  try {
    const supabase = await createServerSupabaseClient();
    const roleAccess = await resolveRoleAccess(supabase, user.wardId);

    assertCan(user, "visits.view", roleAccess);

    const searchParams = new URL(request.url).searchParams;

    // Read here EXACTLY as the client sends it. A name this handler does not read gets no
    // error, just a silently ignored filter (plans/retros/roster-b-picker-and-orgs.md).
    const filter = listVisitsQuerySchema.parse({
      orgId: searchParams.get("orgId") ?? undefined,
      householdId: searchParams.get("householdId") ?? undefined,
      from: searchParams.get("from") ?? undefined,
      to: searchParams.get("to") ?? undefined,
    });

    // RLS narrows the rows: own-org for a leader, the whole ward for the bishopric, and other
    // organizations too when the ward has cross_org_visibility on (migration 019). The route
    // adds no org filter of its own — one would mask a policy regression by hiding rows the
    // policy had started letting through.
    const visits = await listVisitLogs(user.wardId, filter, supabase);

    return NextResponse.json({ visits });
  } catch (error) {
    return respondToRouteError(error, {
      route: "GET /api/visits",
      fallbackMessage: "Could not load the visits. Please try again.",
      detail: { wardId: user.wardId, userId: user.id },
    });
  }
}

export async function POST(request: Request) {
  const user = await requireSessionUser();

  try {
    const supabase = await createServerSupabaseClient();
    const roleAccess = await resolveRoleAccess(supabase, user.wardId);

    // An org secretary HOLDS visits.create — they log visits, they just cannot configure the
    // goals. Checked against lib/auth/permissions.ts rather than assumed; the matrix is not
    // always the intuitive answer.
    assertCan(user, "visits.create", roleAccess);

    const input = createVisitLogSchema.parse(await readJsonBody(request));

    // `visit_logs.household_id` carries a composite foreign key to (id, ward_id), so a household
    // from another ward would be refused by the database with a constraint violation — a 500
    // reporting the server's own fault for the caller's bad id. Checked here so the answer is a
    // sentence instead.
    const household = await getHousehold(user.wardId, input.householdId, supabase);

    if (!household) {
      return NextResponse.json({ error: "That household is not in your ward." }, { status: 404 });
    }

    // Both stamped from the SESSION, never from the body. A request that could name its own
    // `visited_by` could put a visit in somebody else's name, and one that could name its own
    // `org_id` could write into an organization whose logs it may not even read.
    //
    // A bishopric member logging a visit writes org_id = null, which migration 019 makes
    // bishopric-readable only. That is the honest record: the visit was not made on behalf of
    // an organization, and attributing it to one would inflate that organization's progress.
    const bishopricAuthor = isBishopric(user.role);

    if (!bishopricAuthor && user.orgId === null) {
      return NextResponse.json(
        {
          error:
            "Your account is not attached to an organization, so a visit logged under it would " +
            "be invisible to everyone. Ask a member of the bishopric to set your organization.",
        },
        { status: 409 },
      );
    }

    const visit = await createVisitLog(
      user.wardId,
      bishopricAuthor ? null : user.orgId,
      user.id,
      input,
      supabase,
    );

    // No note text in the audit detail — not the shared notes and certainly not the private
    // note, which this route cannot reach anyway. writeAuditLog runs redactSensitive() over
    // `detail`, but the rule here is simply never to pass it.
    await writeAuditLog(
      {
        wardId: user.wardId,
        userId: user.id,
        action: "visit_logged",
        module: "visits",
        detail: {
          visitLogId: visit.id,
          orgId: visit.orgId,
          householdId: visit.householdId,
          visitDate: visit.visitDate,
          visitType: visit.visitType,
        },
      },
      supabase,
    );

    return NextResponse.json({ visit }, { status: 201 });
  } catch (error) {
    return respondToRouteError(error, {
      route: "POST /api/visits",
      fallbackMessage: "Could not save that visit. Please try again.",
      detail: { wardId: user.wardId, userId: user.id },
    });
  }
}
