import { NextResponse } from "next/server";
import { z } from "zod";
import { writeAuditLog } from "@/lib/audit/writeAuditLog";
import { assertCan, resolveRoleAccess } from "@/lib/auth/permissions";
import { readJsonBody, respondToRouteError } from "@/lib/auth/routeErrors";
import { requireSessionUser } from "@/lib/auth/session";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { createServiceSupabaseClient } from "@/lib/supabase/service";
import { addLineToVisitTodos } from "@/lib/todos/visitLinks";
import { answerInvite, readOwnInvite } from "@/lib/visits/companions";
import { respondToInviteSchema } from "@/lib/validation/visit";

// Accepting or declining a visit invite (ITER-055 bv6).
//
// ONLY THE INVITED PERSON ANSWERS. The invite is read through the caller's OWN client filtered to
// `user_id = auth.uid()`, so somebody else's invite is a 404 — never a 403, which would confirm it
// exists. Only then does the service role write the answer (the table has no write policy).
//
// ONCE, WHILE PENDING (decided at bv6 start). A second answer is a 409 with a sentence.
//
// `personal_tools.use`, not a visits permission: an invite is answered on My Appointments, and any
// leader in the ward may be invited.
//
// A DECLINE on a visit booked from a "Visit the ___ family" to-do puts "{name} can't come" on that
// to-do. If that line fails the answer still stands, and the response says so (rule 7).
//
// `params` is a Promise in Next 16.

const inviteIdSchema = z.uuid("That invite id is not valid.");

const NOT_YOURS = "That invite is not yours, or it no longer exists.";
const ALREADY_ANSWERED = "You have already answered this invite.";

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const user = await requireSessionUser();

  try {
    const supabase = await createServerSupabaseClient();
    const roleAccess = await resolveRoleAccess(supabase, user.wardId, user.orgType);

    assertCan(user, "personal_tools.use", roleAccess);

    const { id } = await params;
    const companionId = inviteIdSchema.parse(id);
    const input = respondToInviteSchema.parse(await readJsonBody(request));

    const invite = await readOwnInvite(user.wardId, companionId, user.id, supabase);

    if (invite === null) return NextResponse.json({ error: NOT_YOURS }, { status: 404 });
    if (invite.status !== "pending") {
      return NextResponse.json({ error: ALREADY_ANSWERED }, { status: 409 });
    }

    const service = createServiceSupabaseClient();
    const status = await answerInvite(
      { wardId: user.wardId, companionId, userId: user.id, accept: input.accept },
      service,
    );

    if (status === null) return NextResponse.json({ error: ALREADY_ANSWERED }, { status: 409 });

    await writeAuditLog(
      {
        wardId: user.wardId,
        userId: user.id,
        action: "visit_invite_answered",
        module: "visits",
        detail: { companionId, appointmentId: invite.appointmentId, accepted: input.accept },
      },
      supabase,
    );

    let warning: string | null = null;

    if (!input.accept) {
      try {
        const { data, error } = await service
          .from("visit_appointments")
          .select("assignment_id")
          .eq("ward_id", user.wardId)
          .eq("id", invite.appointmentId)
          .maybeSingle();
        if (error) throw error;

        if (data?.assignment_id) {
          const name = `${user.firstName ?? ""} ${user.lastName ?? ""}`.trim();
          await addLineToVisitTodos(
            {
              wardId: user.wardId,
              assignmentIds: [data.assignment_id],
              line: { kind: "visit_companion_declined", body: name === "" ? null : name },
            },
            service,
          );
        }
      } catch (lineError) {
        console.error("A declined visit invite's to-do line was not written", {
          wardId: user.wardId,
          companionId,
          lineError,
        });
        warning =
          "Your answer is saved, but the person who booked the visit has not been told on their " +
          "To Do. Let them know you can't come.";
      }
    }

    return NextResponse.json({ status, warning });
  } catch (error) {
    return respondToRouteError(error, {
      route: "POST /api/visit-invites/[id]",
      fallbackMessage: "Could not save your answer. Please try again.",
      detail: { wardId: user.wardId, userId: user.id },
    });
  }
}
