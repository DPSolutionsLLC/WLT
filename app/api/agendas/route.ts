import { NextResponse } from "next/server";
import { writeAuditLog } from "@/lib/audit/writeAuditLog";
import { assertCan, resolveRoleAccess } from "@/lib/auth/permissions";
import { readJsonBody, respondToRouteError } from "@/lib/auth/routeErrors";
import { requireSessionUser } from "@/lib/auth/session";
import { itemsToCarryForward } from "@/lib/agendas/carryForward";
import {
  flaggedItemsToAgendaItems,
  gatherFlaggedItems,
} from "@/lib/agendas/flaggedItems";
import {
  createActionItems,
  createAgenda,
  listActionItemsForAgendas,
  listAgendas,
  previousPublishedAgenda,
} from "@/lib/agendas/queries";
import {
  agendaTemplate,
  findSectionByTitle,
  FLAGGED_SECTION_TITLE,
} from "@/lib/agendas/sections";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { createAgendaSchema, listAgendasQuerySchema } from "@/lib/validation/agenda";

export async function GET(request: Request) {
  const user = await requireSessionUser();

  try {
    const supabase = await createServerSupabaseClient();
    const roleAccess = await resolveRoleAccess(supabase, user.wardId, user.orgType);

    assertCan(user, "agendas.view", roleAccess);

    const url = new URL(request.url);
    const query = listAgendasQuerySchema.parse({
      meetingType: url.searchParams.get("meetingType") ?? undefined,
      includePast: url.searchParams.get("includePast") ?? undefined,
    });

    // The clock enters ONCE and is handed down, so a list and its action items describe the same
    // window rather than two (lib/youth/coverage.ts's rule, and the reason `asOf` is a parameter).
    const agendas = await listAgendas(
      user.wardId,
      { ...query, asOf: new Date() },
      supabase,
    );

    const actionItems = await listActionItemsForAgendas(
      user.wardId,
      agendas.map((agenda) => agenda.id),
      supabase,
    );

    return NextResponse.json({
      agendas,
      actionItems: Object.fromEntries(actionItems),
    });
  } catch (error) {
    return respondToRouteError(error, {
      route: "GET /api/agendas",
      fallbackMessage: "Could not load the agendas. Please try again.",
      detail: { wardId: user.wardId, userId: user.id },
    });
  }
}

// ---------------------------------------------------------------------------------------------
// CREATING AN AGENDA IS THREE WRITES, AND THE ORDER MATTERS
// ---------------------------------------------------------------------------------------------
// §Step A3: "Carry forward happens on agenda **creation**, copying open items from the most recent
// published agenda of that type." §Step A2: flagged items are gathered at creation too.
//
// So: build the sections from the template, drop the flagged one-liners into their section, insert
// the agenda, then copy the open action items across as rows. The agenda has to exist before the
// action items can point at it, which is why this is not one insert.
//
// A FAILURE AFTER THE AGENDA INSERT LEAVES AN AGENDA WITH NO CARRIED ITEMS, and that is the
// better of the two failures available without a transaction: the secretary sees an agenda that
// is missing its carried items and can add them, rather than an error and a row that may or may
// not exist. `apply_roster_import` shows the shape a real transaction takes here — a database
// function — and this is not complex enough to earn one.
export async function POST(request: Request) {
  const user = await requireSessionUser();

  try {
    const supabase = await createServerSupabaseClient();
    const roleAccess = await resolveRoleAccess(supabase, user.wardId, user.orgType);

    // `agendas.manage`, which bishop, counselor, ward_secretary and executive_secretary all hold.
    // §Step A4: "Bishopric can build and publish without the secretary — never gate on the
    // secretary role."
    assertCan(user, "agendas.manage", roleAccess);

    const input = createAgendaSchema.parse(await readJsonBody(request));

    const sections = input.sections ?? agendaTemplate();

    // The flagged one-liners, dropped into their section if the template still has it. A ward that
    // renamed or deleted that heading gets an agenda without them rather than a surprise section —
    // findSectionByTitle returning null is a real answer, not a failure.
    const flagged = await gatherFlaggedItems(user.wardId, supabase);
    const flaggedSection = findSectionByTitle(sections, FLAGGED_SECTION_TITLE);
    if (flaggedSection !== null && flagged.length > 0) {
      flaggedSection.items = [...flaggedSection.items, ...flaggedItemsToAgendaItems(flagged)];
    }

    const agenda = await createAgenda(
      user.wardId,
      { meetingType: input.meetingType, meetingDate: input.meetingDate, sections },
      supabase,
    );

    // The carry-forward, from the most recent PUBLISHED agenda of this type. A draft is a meeting
    // that has not happened — see previousPublishedAgenda()'s header for why carrying from one
    // would duplicate items nobody has discussed.
    const previous = await previousPublishedAgenda(
      user.wardId,
      input.meetingType,
      input.meetingDate,
      supabase,
    );

    let carriedCount = 0;
    if (previous !== null) {
      const previousItems = await listActionItemsForAgendas(
        user.wardId,
        [previous.id],
        supabase,
      );
      const toCarry = itemsToCarryForward(previousItems.get(previous.id) ?? [], previous.id);
      if (toCarry.length > 0) {
        await createActionItems(user.wardId, agenda.id, toCarry, supabase);
        carriedCount = toCarry.length;
      }
    }

    await writeAuditLog(
      {
        wardId: user.wardId,
        userId: user.id,
        action: "agenda_created",
        module: "agendas",
        detail: {
          agendaId: agenda.id,
          meetingType: agenda.meetingType,
          meetingDate: agenda.meetingDate,
          // WHAT THE APP PUT THERE, so "why does this agenda already have six lines?" is
          // answerable from the log rather than by re-deriving it (youth-h's rule: three bare ids
          // was half of that defect).
          flaggedItems: flaggedSection === null ? 0 : flagged.length,
          carriedActionItems: carriedCount,
          carriedFrom: previous?.id ?? null,
        },
      },
      supabase,
    );

    return NextResponse.json({ agenda, carriedActionItems: carriedCount }, { status: 201 });
  } catch (error) {
    return respondToRouteError(error, {
      route: "POST /api/agendas",
      fallbackMessage: "Could not create the agenda. Please try again.",
      detail: { wardId: user.wardId, userId: user.id },
    });
  }
}
