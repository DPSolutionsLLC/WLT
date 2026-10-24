import { NextResponse } from "next/server";
import { writeAuditLog } from "@/lib/audit/writeAuditLog";
import { InvalidInputError } from "@/lib/auth/errors";
import { resolveRoleAccess } from "@/lib/auth/permissions";
import { readJsonBody, respondToRouteError } from "@/lib/auth/routeErrors";
import { requireSessionUser } from "@/lib/auth/session";
import { assertPlannerAccess } from "@/lib/sacramentPlanner/access";
import {
  plannerDocumentRefSchema,
  plannerWriteSchema,
  validatePlannerDocument,
} from "@/lib/sacramentPlanner/documentSchemas";
import {
  deletePlannerDocument,
  upsertPlannerDocument,
} from "@/lib/sacramentPlanner/queries";
import { createServerSupabaseClient } from "@/lib/supabase/server";

// Every save the Sacrament Planner makes passes through here (ITER-045): validated, written
// through the caller's own client so RLS decides, and audited. Practice writes are audited too,
// with `layer: "practice"`.
//
// THE AUDIT DETAIL IS IDS ONLY. Never the document — it holds members' names and the bishopric's
// notes — and never a key `writeAuditLog` would redact (`key`, anything with "note" in it).

const REFUSED = "You can view the Sacrament Planner but not save changes.";

function refused(): NextResponse {
  return NextResponse.json({ error: REFUSED }, { status: 403 });
}

export async function PUT(request: Request) {
  const user = await requireSessionUser();

  try {
    const supabase = await createServerSupabaseClient();
    const roleAccess = await resolveRoleAccess(supabase, user.wardId, user.orgType);
    assertPlannerAccess(user, roleAccess);

    const input = plannerWriteSchema.parse(await readJsonBody(request));
    const check = validatePlannerDocument(
      input.layer,
      input.collection,
      input.documentId,
      input.data,
    );
    if (!check.ok) throw new InvalidInputError(check.problem);

    const saved = await upsertPlannerDocument(
      {
        wardId: user.wardId,
        layer: input.layer,
        collection: input.collection,
        documentId: input.documentId,
        data: input.data,
        userId: user.id,
      },
      supabase,
    );
    if (saved === null) return refused();

    await writeAuditLog(
      {
        wardId: user.wardId,
        userId: user.id,
        action: "planner.document_saved",
        module: "sacrament",
        detail: { collection: input.collection, documentId: input.documentId, layer: input.layer },
      },
      supabase,
    );

    return NextResponse.json({ ok: true });
  } catch (error) {
    return respondToRouteError(error, {
      route: "PUT /api/sacrament-planner/documents",
      fallbackMessage: "Could not save that change. Please try again.",
      detail: { wardId: user.wardId, userId: user.id },
    });
  }
}

// A refused DELETE is a zero-row success under RLS, so access is checked first; deleting a record
// that is not there succeeds, as it did in the Planner's old store.
export async function DELETE(request: Request) {
  const user = await requireSessionUser();

  try {
    const supabase = await createServerSupabaseClient();
    const roleAccess = await resolveRoleAccess(supabase, user.wardId, user.orgType);
    assertPlannerAccess(user, roleAccess);

    const input = plannerDocumentRefSchema.parse(await readJsonBody(request));

    await deletePlannerDocument(
      {
        wardId: user.wardId,
        layer: input.layer,
        collection: input.collection,
        documentId: input.documentId,
      },
      supabase,
    );

    await writeAuditLog(
      {
        wardId: user.wardId,
        userId: user.id,
        action: "planner.document_deleted",
        module: "sacrament",
        detail: { collection: input.collection, documentId: input.documentId, layer: input.layer },
      },
      supabase,
    );

    return NextResponse.json({ ok: true });
  } catch (error) {
    return respondToRouteError(error, {
      route: "DELETE /api/sacrament-planner/documents",
      fallbackMessage: "Could not delete that record. Please try again.",
      detail: { wardId: user.wardId, userId: user.id },
    });
  }
}
