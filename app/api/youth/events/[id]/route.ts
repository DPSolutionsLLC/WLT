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

// ---------------------------------------------------------------------------
// `youthAttended` IS NO LONGER HANDLED HERE — SEE .../participation/route.ts
// ---------------------------------------------------------------------------
// youth-i put it on this patch and argued the case: `Cancel` is the exact sibling — same table,
// same gate, same effect on the support number — so a separate action name would have earned
// nothing. THAT ARGUMENT DEPENDED ON THE FACT LIVING ON THE EVENT ROW, AND IT NO LONGER DOES.
//
// Migration 062d moved it to `activity_event_participation`, one row per (young person, event),
// because a profile is a TEAM now: an event serves a whole roster, so a field on this schema
// could only ever mark everybody at the same game. The write takes a `memberId` that no event
// patch can carry, so it is a different verb on a different table about a different subject —
// which is the same reason `close` and `occasion` have their own routes.
//
// MIGRATION 061'S CHECK WENT WITH IT (dropped by 063), and its refusal sentence with that. The
// referent problem it solved — a ward-wide event with no young person to ask about — is answered
// on the new route, alongside the one it could not express: a young person who is not on this
// team's roster at all.

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
