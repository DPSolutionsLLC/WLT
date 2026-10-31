import { NextResponse } from "next/server";
import { writeAuditLog } from "@/lib/audit/writeAuditLog";
import { ForbiddenError } from "@/lib/auth/errors";
import { resolveRoleAccess } from "@/lib/auth/permissions";
import { readJsonBody, respondToRouteError } from "@/lib/auth/routeErrors";
import { requireSessionUser } from "@/lib/auth/session";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { createServiceSupabaseClient } from "@/lib/supabase/service";
import { ZoomLinkWriteError } from "@/lib/todos/zoomLinks";
import { registrationActionSchema, registrationIdSchema } from "@/lib/validation/zoomRegistration";
import { canManageInvitees } from "@/lib/zoom/access";
import { declineRegistration, respondToRegistration } from "@/lib/zoom/registrationApprovals";
import { createWaitingLinkTodosForBishopric, readRegistration } from "@/lib/zoom/registrations";

// THE BISHOPRIC'S ANSWER TO ONE PUBLIC SIGN-UP (ITER-052 z3b).
//
//   PATCH { action: "approve" | "talk_first" | "finish" }   — respond_to_zoom_registration()
//   PATCH { action: "decline", note? }                       — any one member declines (P2)
//
// `zoom_registrations` has no write policy, so canManageInvitees() here is the write boundary and
// every write is the service role. The note is private to the bishopric (migration 098): it is
// never returned and never audited — the audit row says only whether there was one.

type RouteContext = { params: Promise<{ id: string }> };

const NOT_FOUND = "That sign-up isn't on this ward's list.";
const ALREADY_DECIDED = "This sign-up was already decided.";

export async function PATCH(request: Request, { params }: RouteContext) {
  const user = await requireSessionUser();
  const supabase = await createServerSupabaseClient();

  try {
    const roleAccess = await resolveRoleAccess(supabase, user.wardId, user.orgType);
    if (!canManageInvitees(user, roleAccess)) throw new ForbiddenError("zoom.manage_invitees");

    const registrationId = registrationIdSchema.parse((await params).id);
    const input = registrationActionSchema.parse(await readJsonBody(request));
    const service = createServiceSupabaseClient();
    const ids = { wardId: user.wardId, registrationId };

    const current = await readRegistration(ids, service);
    if (!current) return NextResponse.json({ error: NOT_FOUND }, { status: 404 });
    if (current.status !== "pending") {
      return NextResponse.json({ error: ALREADY_DECIDED }, { status: 409 });
    }

    const audit = (action: string, detail: Record<string, unknown>) =>
      writeAuditLog(
        { wardId: user.wardId, userId: user.id, action, module: "zoom", detail },
        supabase,
      );

    if (input.action === "decline") {
      const note = input.note ?? null;
      const result = await declineRegistration({ ...ids, userId: user.id, note }, service);
      if (result.status === "not_pending") {
        return NextResponse.json({ error: ALREADY_DECIDED }, { status: 409 });
      }
      await audit("zoom_registration_declined", {
        registrationId,
        declinedWithMessage: note !== null,
        closedTodoIds: result.closedTodoIds,
      });
      return NextResponse.json({ registration: await readRegistration(ids, service) });
    }

    const result = await respondToRegistration(
      { ...ids, userId: user.id, response: input.action },
      service,
    );
    if (result.status === "not_pending") {
      return NextResponse.json({ error: ALREADY_DECIDED }, { status: 409 });
    }

    if (input.action !== "finish") {
      await audit("zoom_registration_responded", { registrationId, response: input.action });
    }

    if (result.status === "approved") {
      const auditApproved = (waitingTodoIds: string[]) =>
        audit("zoom_registration_approved", {
          registrationId,
          inviteeId: result.inviteeId,
          linkGiven: result.joinLinkId !== null,
          waitingTodoIds,
        });

      // The pool was empty: they are approved and wait for a link, and every serving bishopric
      // member gets "Give ___ a Zoom link" (ITER-053's mechanism). The approval is audited whether
      // or not that second write succeeds, because it happened (rule 6).
      let waitingTodoIds: string[] = [];
      if (result.joinLinkId === null) {
        try {
          waitingTodoIds = await createWaitingLinkTodosForBishopric(
            { wardId: user.wardId, inviteeId: result.inviteeId, displayName: current.displayName },
            service,
          );
        } catch (error) {
          if (error instanceof ZoomLinkWriteError) {
            await auditApproved([]);
            return NextResponse.json(
              {
                error:
                  "They were approved, but the to-dos to give them a link could not be created. Give them a link on the Invitees tab.",
              },
              { status: 500 },
            );
          }
          throw error;
        }
      }
      await auditApproved(waitingTodoIds);
    }

    return NextResponse.json({ registration: await readRegistration(ids, service) });
  } catch (error) {
    return respondToRouteError(error, {
      route: "PATCH /api/zoom/registrations/[id]",
      fallbackMessage: "Could not save your answer. Please try again.",
      detail: { wardId: user.wardId, userId: user.id },
    });
  }
}
