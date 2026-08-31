import { NextResponse } from "next/server";
import { z } from "zod";
import { writeAuditLog } from "@/lib/audit/writeAuditLog";
import { assertCan, resolveRoleAccess } from "@/lib/auth/permissions";
import { readJsonBody, respondToRouteError } from "@/lib/auth/routeErrors";
import { requireSessionUser } from "@/lib/auth/session";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { updateActivityEventSchema } from "@/lib/validation/youth";
import {
  deleteActivityEvent,
  getActivityEvent,
  updateActivityEvent,
} from "@/lib/youth/queries";

// CANCELLING IS AN UPDATE, NOT A DELETE. `status: "cancelled"` is what takes a called-off game
// off the list of things anybody needs to attend while KEEPING the record that it was scheduled
// — which is the whole reason migration 054c added the value. DELETE is for a row entered by
// mistake.
const WRITE_REFUSED = "That event could not be changed. Reload and try again.";

// A WARD-WIDE EVENT BELONGS TO NO YOUNG PERSON, so "are they taking part?" has no referent.
// Migration 061's CHECK is the guarantee; this is the sentence, because a constraint violation is
// not something anybody can act on (CLAUDE.md rule 7). VALIDATION, NOT A PERMISSION — the caller
// may edit this event in every other way, and rule 2's boundary is untouched.
const NO_YOUNG_PERSON =
  "That event is not on a young person's activity, so there is nobody to record as taking part.";

// ---------------------------------------------------------------------------
// WHY `youthAttended` RIDES ON THE ORDINARY PATCH RATHER THAN GETTING ITS OWN ROUTE
// ---------------------------------------------------------------------------
// A reader will weigh this against `close` and `occasion`, which both got one.
//
// `Cancel` is the exact sibling — same table, same gate, same effect on the support number — and it
// is an ordinary PATCH with its value in the audit detail. POST /api/youth/profiles/[id]/close
// exists because closing is a DIFFERENT VERB ON A DIFFERENT TABLE; the occasion routes exist
// because `occasionWithEventId` needs a SERVER-SIDE decision about which occasion a row joins,
// which no patch body can express. Neither reason applies here. `changed: Object.keys(input)`
// already names `youthAttended`, and the detail records what it became — so "why did Ethan's
// number move?" is answerable from the audit log without a second action name.

const eventIdSchema = z.uuid("That event id is not valid.");

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const user = await requireSessionUser();

  try {
    const supabase = await createServerSupabaseClient();
    const roleAccess = await resolveRoleAccess(supabase, user.wardId);

    assertCan(user, "youth_activities.manage", roleAccess);

    const { id } = await params;
    const eventId = eventIdSchema.parse(id);
    const input = updateActivityEventSchema.parse(await readJsonBody(request));

    const existing = await getActivityEvent(user.wardId, eventId, supabase);

    if (!existing) {
      return NextResponse.json({ error: "That event is not in your ward." }, { status: 404 });
    }

    // Clearing to `null` on such a row is a no-op and needs no refusal — it says nothing about a
    // young person who is not there, so there is nothing to object to.
    if (
      input.youthAttended !== undefined &&
      input.youthAttended !== null &&
      existing.profileId === null
    ) {
      return NextResponse.json({ error: NO_YOUNG_PERSON }, { status: 400 });
    }

    const event = await updateActivityEvent(user.wardId, eventId, input, supabase);

    if (!event) {
      return NextResponse.json({ error: WRITE_REFUSED }, { status: 404 });
    }

    await writeAuditLog(
      {
        wardId: user.wardId,
        userId: user.id,
        action: "youth_activity_event_updated",
        module: "youth_activities",
        detail: {
          eventId,
          profileId: event.profileId,
          changed: Object.keys(input),
          status: event.status,
          // WHAT IT BECAME, beside the status, so "why did Ethan's number move?" is answerable
          // from the log. `writeAuditLog()` runs redactSensitive() over this object; a boolean
          // carries no text and no name, so nothing here needs holding back.
          youthAttended: event.youthAttended,
        },
      },
      supabase,
    );

    return NextResponse.json({ event });
  } catch (error) {
    return respondToRouteError(error, {
      route: "PATCH /api/youth/events/[id]",
      fallbackMessage: "Could not save that event. Please try again.",
      detail: { wardId: user.wardId, userId: user.id },
    });
  }
}

export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const user = await requireSessionUser();

  try {
    const supabase = await createServerSupabaseClient();
    const roleAccess = await resolveRoleAccess(supabase, user.wardId);

    assertCan(user, "youth_activities.manage", roleAccess);

    const { id } = await params;
    const eventId = eventIdSchema.parse(id);

    const existing = await getActivityEvent(user.wardId, eventId, supabase);

    if (!existing) {
      return NextResponse.json({ error: "That event is not in your ward." }, { status: 404 });
    }

    const removed = await deleteActivityEvent(user.wardId, eventId, supabase);

    if (!removed) {
      return NextResponse.json({ error: WRITE_REFUSED }, { status: 404 });
    }

    await writeAuditLog(
      {
        wardId: user.wardId,
        userId: user.id,
        action: "youth_activity_event_deleted",
        module: "youth_activities",
        detail: {
          eventId,
          profileId: existing.profileId,
          eventDate: existing.eventDate,
        },
      },
      supabase,
    );

    return NextResponse.json({ deleted: true });
  } catch (error) {
    return respondToRouteError(error, {
      route: "DELETE /api/youth/events/[id]",
      fallbackMessage: "Could not remove that event. Please try again.",
      detail: { wardId: user.wardId, userId: user.id },
    });
  }
}
