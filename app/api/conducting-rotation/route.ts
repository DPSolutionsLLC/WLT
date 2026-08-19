import { NextResponse } from "next/server";
import { writeAuditLog } from "@/lib/audit/writeAuditLog";
import { assertCan } from "@/lib/auth/permissions";
import { readJsonBody, respondToRouteError } from "@/lib/auth/routeErrors";
import { requireSessionUser } from "@/lib/auth/session";
import { formatDateOnly } from "@/lib/calendar/dates";
import {
  ConductingRotationConflictError,
  listConductingRotation,
  replaceConductingRotation,
} from "@/lib/calendar/queries";
import { activeRotation } from "@/lib/calendar/resolveConductingUser";
import { notifyOtherBishopric } from "@/lib/notifications/notifyOtherBishopric";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { conductingRotationSchema } from "@/lib/validation/calendar";

// calendar-b renders this sentence verbatim next to the rotation editor. 03-calendar.md Step 3
// requires the UI to say it: a bishopric reordering the rotation must be able to see that last
// month's programs are not about to be rewritten underneath them.
const FORWARD_ONLY_NOTE =
  "This rotation applies from its effective date forward. Sundays already assigned keep who they have.";

// calendar.view, not calendar.manage: the music coordinator and both secretaries need to read
// who conducts to plan against the upcoming Sunday list.
export async function GET() {
  const user = await requireSessionUser();

  try {
    assertCan(user, "calendar.view");

    const supabase = await createServerSupabaseClient();
    const rotation = await listConductingRotation(user.wardId, supabase);

    // Today in UTC, matching how every date in this module is read. `sundays.date` is a date with
    // no zone, so a local-time "today" would put a ward west of UTC on yesterday's rotation for
    // part of every day.
    const today = formatDateOnly(new Date());
    const active = activeRotation(
      rotation.map((entry) => ({
        position: entry.position,
        userId: entry.userId,
        effectiveFrom: entry.effectiveFrom,
      })),
      today,
    );

    return NextResponse.json({
      rotation,
      activeFrom: active[0]?.effectiveFrom ?? null,
      note: FORWARD_ONLY_NOTE,
    });
  } catch (error) {
    return respondToRouteError(error, {
      route: "GET /api/conducting-rotation",
      fallbackMessage: "Could not load the conducting rotation. Please try again.",
      detail: { wardId: user.wardId, userId: user.id },
    });
  }
}

// admin.manage_ward, not calendar.manage (calendar-a Decision 5). Reordering the rotation is a
// bishopric composition decision that notifies the other two as an admin change, so it is held to
// the permission only bishop and counselor carry — even though a ward_secretary may edit any
// individual Sunday.
export async function PATCH(request: Request) {
  const user = await requireSessionUser();

  try {
    assertCan(user, "admin.manage_ward");

    const input = conductingRotationSchema.parse(await readJsonBody(request));
    const supabase = await createServerSupabaseClient();

    const rotation = await replaceConductingRotation(user.wardId, input, supabase);

    await writeAuditLog(
      {
        wardId: user.wardId,
        userId: user.id,
        action: "conducting_rotation_updated",
        module: "calendar",
        detail: { effectiveFrom: input.effectiveFrom, positions: input.positions },
      },
      supabase,
    );

    await notifyOtherBishopric({
      wardId: user.wardId,
      actingUserId: user.id,
      title: "Conducting rotation changed",
      description: `The conducting rotation was reordered, effective ${input.effectiveFrom}.`,
    });

    return NextResponse.json(
      { rotation, activeFrom: input.effectiveFrom, note: FORWARD_ONLY_NOTE },
      { status: 201 },
    );
  } catch (error) {
    // A date that already carries a rotation is the user picking again, not a server fault. The
    // unique constraint from migration 023 is what catches it.
    if (error instanceof ConductingRotationConflictError) {
      return NextResponse.json({ error: error.message }, { status: 409 });
    }

    return respondToRouteError(error, {
      route: "PATCH /api/conducting-rotation",
      fallbackMessage: "Could not save the conducting rotation. Please try again.",
      detail: { wardId: user.wardId, userId: user.id },
    });
  }
}
