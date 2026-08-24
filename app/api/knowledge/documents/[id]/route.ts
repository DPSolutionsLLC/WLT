import { NextResponse } from "next/server";
import { writeAuditLog } from "@/lib/audit/writeAuditLog";
import { assertCan, resolveRoleAccess } from "@/lib/auth/permissions";
import { readJsonBody, respondToRouteError } from "@/lib/auth/routeErrors";
import { requireSessionUser } from "@/lib/auth/session";
import {
  deleteDocument,
  getDocument,
  setDocumentStatus,
} from "@/lib/knowledge/queries";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { documentPatchSchema } from "@/lib/validation/knowledge";

// `params` is a Promise in Next 16.
type RouteContext = { params: Promise<{ id: string }> };

const NOT_FOUND_MESSAGE = "That document could not be found.";

// The session is resolved OUTSIDE the try: requireSessionUser() redirects by throwing an internal
// Next.js error, and catching that would turn a redirect into a 500.

// 404 rather than 403 for another ward's id. Both queries are ward-scoped, so a miss means
// "not this ward's document" — and answering 403 would confirm that the id exists somewhere,
// which is itself a small leak.
export async function PATCH(request: Request, context: RouteContext) {
  const user = await requireSessionUser();
  const { id } = await context.params;

  try {
    const supabase = await createServerSupabaseClient();
    const roleAccess = await resolveRoleAccess(supabase, user.wardId);

    assertCan(user, "knowledge.manage", roleAccess);

    const input = documentPatchSchema.parse(await readJsonBody(request));

    // DEACTIVATION TAKES EFFECT ON THE NEXT RETRIEVAL WITH NO REBUILD. match_document_chunks
    // filters on `d.status = 'active'` (migration 031), so there is nothing to reindex and no
    // window during which a deactivated document is still being returned. That is the whole
    // reason status is a column rather than this being a delete.
    const document = await setDocumentStatus(user.wardId, id, input.status, supabase);

    if (!document) {
      return NextResponse.json({ error: NOT_FOUND_MESSAGE }, { status: 404 });
    }

    await writeAuditLog(
      {
        wardId: user.wardId,
        userId: user.id,
        action: "knowledge_document_status_changed",
        module: "knowledge",
        detail: { documentId: id, status: input.status },
      },
      supabase,
    );

    return NextResponse.json({ document });
  } catch (error) {
    return respondToRouteError(error, {
      route: "PATCH /api/knowledge/documents/[id]",
      fallbackMessage: "Could not change the document. Please try again.",
      detail: { wardId: user.wardId, userId: user.id, documentId: id },
    });
  }
}

export async function DELETE(_request: Request, context: RouteContext) {
  const user = await requireSessionUser();
  const { id } = await context.params;

  try {
    const supabase = await createServerSupabaseClient();
    const roleAccess = await resolveRoleAccess(supabase, user.wardId);

    assertCan(user, "knowledge.manage", roleAccess);

    // Read first, for two reasons: the storage key lives on the row and is gone after the
    // delete, and the audit entry records how many passages went with it. A delete that logs
    // only an id cannot answer "how much did we lose" afterwards.
    const document = await getDocument(user.wardId, id, supabase);

    if (!document) {
      return NextResponse.json({ error: NOT_FOUND_MESSAGE }, { status: 404 });
    }

    const deleted = await deleteDocument(user.wardId, id, document.fileUrl, supabase);

    // An RLS-denied DELETE is a zero-row success, not an error
    // (plans/retros/foundation-c-services.md) — deleteDocument returns false for it, and
    // reporting success here would tell the bishopric a document was removed when it was not.
    if (!deleted) {
      return NextResponse.json({ error: NOT_FOUND_MESSAGE }, { status: 404 });
    }

    await writeAuditLog(
      {
        wardId: user.wardId,
        userId: user.id,
        action: "knowledge_document_deleted",
        module: "knowledge",
        detail: {
          documentId: id,
          title: document.title,
          chunkCount: document.chunkCount,
        },
      },
      supabase,
    );

    return NextResponse.json({ deleted: true, chunkCount: document.chunkCount });
  } catch (error) {
    return respondToRouteError(error, {
      route: "DELETE /api/knowledge/documents/[id]",
      fallbackMessage: "Could not delete the document. Please try again.",
      detail: { wardId: user.wardId, userId: user.id, documentId: id },
    });
  }
}
