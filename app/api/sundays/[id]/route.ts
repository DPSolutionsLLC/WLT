import { NextResponse } from "next/server";
import { z } from "zod";
import { writeAuditLog } from "@/lib/audit/writeAuditLog";
import { assertCan, resolveRoleAccess } from "@/lib/auth/permissions";
import { readJsonBody, respondToRouteError } from "@/lib/auth/routeErrors";
import { requireSessionUser } from "@/lib/auth/session";
import { getSunday, readConductorName, updateSunday } from "@/lib/calendar/queries";
import { notifyOtherBishopric } from "@/lib/notifications/notifyOtherBishopric";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { unfinalizeTopicsIfNeeded } from "@/lib/topics/finalize";
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
    const supabase = await createServerSupabaseClient();
    const roleAccess = await resolveRoleAccess(supabase, user.wardId, user.orgType);

    assertCan(user, "calendar.manage", roleAccess);

    const { id } = await params;
    const sundayId = sundayIdSchema.parse(id);
    const changes = updateSundaySchema.parse(await readJsonBody(request));

    // A destructive re-resolution is applied only when the user has seen the warning and said
    // yes. The dialog that shows the warning lives in calendar-b.
    const confirm =
      new URL(request.url).searchParams.get("confirm") === "true";


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

    const { assignmentsReverted } = result;
    const { conductingReshiftCount, orgConductingReshiftCount } = result;
    const changedFields = Object.keys(changes);

    // THE DAY'S SHAPE CHANGED, so "the topics are decided" is no longer a true statement about it
    // (lib/topics/finalize.ts). Only `speakingSlots` — this route also carries the type, the
    // conductor, the notes and the presiding override, and none of those is a claim about what
    // the talks are ABOUT.
    //
    // ⚠️ `changes.speakingSlots` RATHER THAN `sunday.speakingSlots !== before.speakingSlots`, and
    // the difference is not cosmetic: updateSunday() may change the count WITHOUT it being in the
    // patch (a type change to a conference zeroes it, a change away from fast_sunday restores the
    // ward default), and it may also be sent unchanged by SundayEditor, which submits the whole
    // form on every save. Keying on the SUBMITTED FIELD matches topicShapeChanged()'s rule on the
    // other route — a patch that names the field is somebody deciding about it.
    //
    // The cleared row REPLACES the one in the response. `result.sunday` was read before this ran,
    // so answering with it would hand the client a row still claiming to be finalized a moment
    // after the server cleared it. `?? result.sunday` is the honest fallback: the helper never
    // throws, so null means "nothing was observed" rather than "it is cleared".
    const sunday =
      changes.speakingSlots === undefined
        ? result.sunday
        : ((await unfinalizeTopicsIfNeeded(user.wardId, sundayId, supabase)) ??
          result.sunday);

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
          // How many LATER Sundays this edit moved. A re-shift can overwrite a conducting
          // override a human typed (there is no is_override flag — migration 024), so the audit
          // row is the only durable record of how far one edit reached.
          conductingReshiftCount,
          orgConductingReshiftCount,
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

    return NextResponse.json({
      sunday,
      assignmentsReverted,
      conductingReshiftCount,
      orgConductingReshiftCount,
    });
  } catch (error) {
    return respondToRouteError(error, {
      route: "PATCH /api/sundays/[id]",
      fallbackMessage: "Could not update that Sunday. Please try again.",
      detail: { wardId: user.wardId, userId: user.id },
    });
  }
}
