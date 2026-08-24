import { NextResponse } from "next/server";
import { writeAuditLog } from "@/lib/audit/writeAuditLog";
import { assertCan, resolveRoleAccess } from "@/lib/auth/permissions";
import { respondToRouteError } from "@/lib/auth/routeErrors";
import { requireSessionUser } from "@/lib/auth/session";
import { deleteSavedFilter } from "@/lib/knowledge/filterQueries";
import { createServerSupabaseClient } from "@/lib/supabase/server";

// `params` is a Promise in Next 16.
type RouteContext = { params: Promise<{ id: string }> };

// There is no PATCH here, and lib/knowledge/filterQueries.ts has no update function on purpose.
// A filter is created and deleted, never edited: editing one silently changes what every past
// retrieval meant, and `source_phrase` would then describe something the filter no longer does.
//
// DELETING A FILTER DOES NOT TOUCH THE DOCUMENTS. It also does not rewrite any saved scope —
// `ai_settings` is append-only, so a stored scope naming this filter keeps naming it, and
// mergeConferenceScope ignores an id that no longer resolves. That WIDENS the corpus rather than
// narrowing it, which is the safe direction to be wrong in.
//
// The session is resolved OUTSIDE the try: requireSessionUser() redirects by throwing an internal
// Next.js error, and catching that would turn a redirect into a 500.

const NOT_FOUND_MESSAGE = "That filter could not be found.";

export async function DELETE(_request: Request, context: RouteContext) {
  const user = await requireSessionUser();
  const { id } = await context.params;

  try {
    const supabase = await createServerSupabaseClient();
    const roleAccess = await resolveRoleAccess(supabase, user.wardId);

    assertCan(user, "knowledge.manage", roleAccess);

    const deleted = await deleteSavedFilter(user.wardId, id, supabase);

    // 404 rather than 403 for another ward's id. The query is ward-scoped, so a miss means "not
    // this ward's filter" — and answering 403 would confirm that the id exists somewhere, which
    // is itself a small leak.
    //
    // An RLS-denied DELETE is a ZERO-ROW SUCCESS, not an error
    // (plans/retros/foundation-c-services.md). deleteSavedFilter returns false for it, and
    // reporting success here would tell the bishopric a filter was removed when it was not.
    if (!deleted) {
      return NextResponse.json({ error: NOT_FOUND_MESSAGE }, { status: 404 });
    }

    await writeAuditLog(
      {
        wardId: user.wardId,
        userId: user.id,
        action: "retrieval_filter_deleted",
        module: "knowledge",
        detail: { filterId: id },
      },
      supabase,
    );

    return NextResponse.json({ deleted: true });
  } catch (error) {
    return respondToRouteError(error, {
      route: "DELETE /api/knowledge/filters/[id]",
      fallbackMessage: "Could not delete the filter. Please try again.",
      detail: { wardId: user.wardId, userId: user.id, filterId: id },
    });
  }
}
