import { NextResponse } from "next/server";
import { z } from "zod";
import { writeAuditLog } from "@/lib/audit/writeAuditLog";
import { assertCan } from "@/lib/auth/permissions";
import { readJsonBody, respondToRouteError } from "@/lib/auth/routeErrors";
import { requireSessionUser } from "@/lib/auth/session";
import { getSunday, readConductorName, updateSunday } from "@/lib/calendar/queries";
import { notifyOtherBishopric } from "@/lib/notifications/notifyOtherBishopric";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { updateSundaySchema } from "@/lib/validation/calendar";

const sundayIdSchema = z.uuid("That Sunday id is not valid.");

const NOT_IN_WARD = "That Sunday is not on your ward's calendar.";

// `params` is a Promise in Next 16 and the props are typed explicitly rather than with the
// generated PageProps/RouteContext helper, which only exists after a build
// (plans/retros/foundation-a-scaffold.md).
export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const user = await requireSessionUser();

  try {
    // Before the body is parsed. Migration 019 grants UPDATE on `sundays` to every authenticated
    // member of the ward — including an org_secretary — so RLS stops a cross-WARD write and
    // nothing else. This check is the real boundary.
    assertCan(user, "calendar.manage");

    const { id } = await params;
    const sundayId = sundayIdSchema.parse(id);
    const changes = updateSundaySchema.parse(await readJsonBody(request));

    // A destructive re-resolution is applied only when the user has seen the warning and said
    // yes. The dialog that shows the warning lives in calendar-b.
    const confirm =
      new URL(request.url).searchParams.get("confirm") === "true";

    const supabase = await createServerSupabaseClient();

    const before = await getSunday(user.wardId, sundayId, supabase);
    if (!before) {
      return NextResponse.json({ error: NOT_IN_WARD }, { status: 404 });
    }

    const result = await updateSunday(
      user.wardId,
      sundayId,
      changes,
      { confirm },
      supabase,
    );

    if (!result) {
      return NextResponse.json({ error: NOT_IN_WARD }, { status: 404 });
    }

    if (result.status === "needs_confirmation") {
      // Both keys on purpose: `error` so the generic client error path shows something useful,
      // `warning` so calendar-b's dialog can render the specifics and word itself from `reason`.
      return NextResponse.json(
        { error: result.warning.message, warning: result.warning },
        { status: 409 },
      );
    }

    const { sunday, assignmentsReverted } = result;
    const changedFields = Object.keys(changes);

    await writeAuditLog(
      {
        wardId: user.wardId,
        userId: user.id,
        action: "sunday_updated",
        module: "calendar",
        detail: {
          sundayId,
          date: sunday.date,
          changedFields,
          // The VALUE of `notes` is deliberately absent: writeAuditLog's redactor matches the key
          // `note` and would store "[redacted]" anyway, which arrives as noise. Whether it
          // changed is the part an auditor can act on.
          notesChanged: changes.notes !== undefined,
          assignmentsReverted,
        },
      },
      supabase,
    );

    // Both conducting edits and rotation edits notify the other two bishopric members
    // (03-calendar.md Step 3). This is a product requirement, not a nicety.
    if (
      changes.conductingUserId !== undefined &&
      before.conductingUserId !== sunday.conductingUserId
    ) {
      const conductorName = sunday.conductingUserId
        ? await readConductorName(user.wardId, sunday.conductingUserId, supabase)
        : null;

      await notifyOtherBishopric({
        wardId: user.wardId,
        actingUserId: user.id,
        title: "Conducting assignment changed",
        description: sunday.conductingUserId
          ? `${conductorName ?? "Someone else"} now conducts on ${sunday.date}.`
          : `Nobody is assigned to conduct on ${sunday.date}.`,
      });
    }

    return NextResponse.json({ sunday, assignmentsReverted });
  } catch (error) {
    return respondToRouteError(error, {
      route: "PATCH /api/sundays/[id]",
      fallbackMessage: "Could not update that Sunday. Please try again.",
      detail: { wardId: user.wardId, userId: user.id },
    });
  }
}
