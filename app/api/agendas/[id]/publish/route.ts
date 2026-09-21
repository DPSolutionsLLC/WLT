import { NextResponse } from "next/server";
import { writeAuditLog } from "@/lib/audit/writeAuditLog";
import { assertCan, resolveRoleAccess } from "@/lib/auth/permissions";
import { respondToRouteError } from "@/lib/auth/routeErrors";
import { requireSessionUser } from "@/lib/auth/session";
import { compareActionItems, describeCarriedFrom } from "@/lib/agendas/carryForward";
import { markFlagsSent } from "@/lib/agendas/flaggedItems";
import {
  getAgenda,
  listActionItems,
  markAgendaPublished,
} from "@/lib/agendas/queries";
import { carryForwardSection } from "@/lib/agendas/sections";
import { storeAgendaPdf } from "@/lib/agendas/storage";
import { formatMeetingDateLabel } from "@/lib/calendar/dates";
import { emitNotification } from "@/lib/notifications/emitNotification";
import { renderAgendaPdf } from "@/lib/pdf/renderAgenda";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { agendaIdSchema } from "@/lib/validation/agenda";
import { MEETING_TYPE_LABELS } from "@/types/domain";

// Render the PDF, mark the agenda published, resolve the flags it carried, and notify.
//
// ---------------------------------------------------------------------------------------------
// PUBLISHING DOES NOT SEND THE EMAIL, AND THAT IS A DEPARTURE FROM THE PHASE PLAN
// ---------------------------------------------------------------------------------------------
// §Step A4 specifies "a Supabase Edge Function on cron" that checks for published agendas whose
// send time has arrived. CLAUDE.md §9 is explicit that `supabase/functions/` does not exist,
// `pg_cron` is not enabled and `vercel.json` declares no crons, and that Phase 11 owns that
// decision for SIX already-queued clock-driven things (`youth_event_uncovered`, the Monday
// away-digest, `visit_overdue`, `refresh_goal_status()`, ICS re-sync and `youth_followup_prompt`).
//
// Building a seventh mechanism here would pre-empt that decision on behalf of a phase that has not
// been designed. So sending is its own route, pressed by a person — which is also the shape the
// programme already has (approve → distribute) and what rule 3's "no auto-send and no auto-save
// anywhere in this app" asks for. The scheduled variant is Phase 11's SEVENTH item.
//
// ---------------------------------------------------------------------------------------------
// RE-PUBLISHING IS ALLOWED, AND IS HOW A STALE PDF IS FIXED
// ---------------------------------------------------------------------------------------------
// The programme's `distribute` refuses a second run because an email cannot be recalled. Nothing
// here is irreversible: the PDF is replaced, the flags are already resolved and stamping them
// again is a no-op on the same rows. An agenda edited after publishing has a stale PDF until
// somebody presses this again, which is exactly the recovery the screen points at.
export async function POST(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const user = await requireSessionUser();

  try {
    const supabase = await createServerSupabaseClient();
    const roleAccess = await resolveRoleAccess(supabase, user.wardId);

    assertCan(user, "agendas.publish", roleAccess);

    const { id } = agendaIdSchema.parse(await params);

    const agenda = await getAgenda(user.wardId, id, supabase);
    if (agenda === null) {
      return NextResponse.json({ error: "That agenda could not be found." }, { status: 404 });
    }

    const actionItems = (await listActionItems(user.wardId, id, supabase)).sort(
      compareActionItems,
    );

    // "carried from Nov 12" per item, resolved HERE rather than in the PDF component, because the
    // label needs the ORIGIN AGENDA's date and the renderer must stay a pure function of its
    // props. One lookup for the whole set rather than one per item.
    const originIds = [
      ...new Set(
        actionItems
          .map((item) => item.carriedFromAgendaId)
          .filter((value): value is string => value !== null),
      ),
    ];

    const originDates = new Map<string, string>();
    if (originIds.length > 0) {
      const { data } = await supabase
        .from("agendas")
        .select("id, meeting_date")
        .eq("ward_id", user.wardId)
        .in("id", originIds);
      for (const row of data ?? []) {
        originDates.set(row.id, formatMeetingDateLabel(row.meeting_date));
      }
    }

    const carriedLabels: Record<string, string | null> = {};
    for (const item of actionItems) {
      carriedLabels[item.id] =
        item.carriedFromAgendaId === null
          ? null
          : describeCarriedFrom(originDates.get(item.carriedFromAgendaId) ?? null);
    }

    const { data: ward } = await supabase
      .from("wards")
      .select("name")
      .eq("id", user.wardId)
      .maybeSingle();

    const meetingDateLabel = formatMeetingDateLabel(agenda.meetingDate);
    const meetingTypeLabel = MEETING_TYPE_LABELS[agenda.meetingType];

    const pdf = await renderAgendaPdf({
      wardName: ward?.name ?? "Ward",
      meetingTypeLabel,
      meetingDateLabel,
      sections: agenda.sections,
      actionItems,
      actionSectionId: carryForwardSection(agenda.sections)?.id ?? null,
      carriedLabels,
      footerNote: `${meetingTypeLabel} · ${meetingDateLabel} · not for distribution outside ward leadership`,
    });

    const stored = await storeAgendaPdf(user.wardId, id, pdf, supabase);

    const published = await markAgendaPublished(
      user.wardId,
      id,
      user.id,
      stored.signedUrl,
      supabase,
    );

    if (published === null) {
      return NextResponse.json({ error: "That agenda could not be found." }, { status: 404 });
    }

    // The flags this agenda actually carried, resolved so they do not reappear on the next one.
    // Read from the SECTIONS rather than re-queried, so a one-liner the secretary deleted before
    // publishing does not get marked sent — they removed it, so the ward council never saw it.
    const carriedFlagIds = agenda.sections
      .flatMap((section) => section.items)
      .filter((item) => item.source === "flag" && item.sourceId !== null)
      .map((item) => item.sourceId as string);

    const flagResult = await markFlagsSent(user.wardId, carriedFlagIds, supabase);

    await emitNotification(
      {
        wardId: user.wardId,
        triggerKey: "agenda_published",
        title: `${meetingTypeLabel} agenda published`,
        // NO AGENDA CONTENT IN THE NOTIFICATION BODY. A notification is a POINTER, not a copy —
        // youth-d's rule for the flag notification, and the same privacy reasoning: the agenda
        // names families, and a notification body is read by everybody the trigger delivers to.
        body: `The agenda for ${meetingDateLabel} is ready to read.`,
      },
      supabase,
    );

    await writeAuditLog(
      {
        wardId: user.wardId,
        userId: user.id,
        action: "agenda_published",
        module: "agendas",
        detail: {
          agendaId: agenda.id,
          meetingType: agenda.meetingType,
          meetingDate: agenda.meetingDate,
          itemCount: agenda.itemCount,
          actionItemCount: actionItems.length,
          pdfBytes: stored.byteLength,
          flagsResolved: flagResult.resolved,
          // Surfaced rather than swallowed (rule 7): a flag that could not be stamped will
          // reappear on the next agenda, and this is where that becomes explicable.
          flagsFailed: flagResult.failed,
          republished: agenda.status === "published",
        },
      },
      supabase,
    );

    return NextResponse.json({ agenda: published, flagsResolved: flagResult.resolved });
  } catch (error) {
    return respondToRouteError(error, {
      route: "POST /api/agendas/[id]/publish",
      fallbackMessage: "Could not publish the agenda. Please try again.",
      detail: { wardId: user.wardId, userId: user.id },
    });
  }
}
