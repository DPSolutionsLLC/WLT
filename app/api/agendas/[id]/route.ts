import { NextResponse } from "next/server";
import { writeAuditLog } from "@/lib/audit/writeAuditLog";
import { assertCan, resolveRoleAccess } from "@/lib/auth/permissions";
import { readJsonBody, respondToRouteError } from "@/lib/auth/routeErrors";
import { requireSessionUser } from "@/lib/auth/session";
import { getAgenda, listActionItems, updateAgenda } from "@/lib/agendas/queries";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { agendaIdSchema, updateAgendaSchema } from "@/lib/validation/agenda";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const user = await requireSessionUser();

  try {
    const supabase = await createServerSupabaseClient();
    const roleAccess = await resolveRoleAccess(supabase, user.wardId);

    assertCan(user, "agendas.view", roleAccess);

    const { id } = agendaIdSchema.parse(await params);

    const agenda = await getAgenda(user.wardId, id, supabase);
    if (agenda === null) {
      return NextResponse.json({ error: "That agenda could not be found." }, { status: 404 });
    }

    const actionItems = await listActionItems(user.wardId, id, supabase);

    return NextResponse.json({ agenda, actionItems });
  } catch (error) {
    return respondToRouteError(error, {
      route: "GET /api/agendas/[id]",
      fallbackMessage: "Could not load the agenda. Please try again.",
      detail: { wardId: user.wardId, userId: user.id },
    });
  }
}

// ---------------------------------------------------------------------------------------------
// A PUBLISHED AGENDA IS STILL EDITABLE, AND THAT IS A DECISION
// ---------------------------------------------------------------------------------------------
// The programme refuses edits after approval, because it is a printed artefact handed to a
// congregation and a change after the fact would make the paper and the screen disagree.
//
// An agenda is the opposite: it is the working document OF the meeting, and the most common edit
// in the world is somebody adding "and we also discussed…" during or just after it. Locking it at
// publish would send every ward to a second tool for the thing the meeting actually produced.
//
// What publishing DOES fix is the PDF and the flags: the stored PDF is the document as it was
// published, and re-publishing re-renders it. So an edited-after-publish agenda has a stale PDF
// until somebody publishes again, which the screen says out loud rather than hiding.
export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const user = await requireSessionUser();

  try {
    const supabase = await createServerSupabaseClient();
    const roleAccess = await resolveRoleAccess(supabase, user.wardId);

    assertCan(user, "agendas.manage", roleAccess);

    const { id } = agendaIdSchema.parse(await params);
    const input = updateAgendaSchema.parse(await readJsonBody(request));

    const agenda = await updateAgenda(user.wardId, id, input, supabase);

    // A zero-row UPDATE is an RLS refusal, not an error — CLAUDE.md §8. 404 rather than 403: the
    // reader is not entitled to learn that the row exists in another ward.
    if (agenda === null) {
      return NextResponse.json({ error: "That agenda could not be found." }, { status: 404 });
    }

    await writeAuditLog(
      {
        wardId: user.wardId,
        userId: user.id,
        action: "agenda_updated",
        module: "agendas",
        detail: {
          agendaId: agenda.id,
          meetingDate: agenda.meetingDate,
          // The COUNT, never the text. An agenda names families raised for discussion, and an
          // audit row is read by anybody with audit access — §Step A2's one-liner rule applies to
          // what is logged about the agenda as much as to what is printed on it.
          itemCount: agenda.itemCount,
          sectionCount: agenda.sections.length,
          // Publishing renders the PDF; editing afterwards leaves it stale until the next publish.
          // Recorded so the gap between the stored PDF and the row is visible in the log.
          wasPublished: agenda.status === "published",
        },
      },
      supabase,
    );

    return NextResponse.json({ agenda });
  } catch (error) {
    return respondToRouteError(error, {
      route: "PATCH /api/agendas/[id]",
      fallbackMessage: "Could not update the agenda. Please try again.",
      detail: { wardId: user.wardId, userId: user.id },
    });
  }
}
