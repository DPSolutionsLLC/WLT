import { NextResponse } from "next/server";
import { z } from "zod";
import { writeAuditLog } from "@/lib/audit/writeAuditLog";
import { assertCan, resolveRoleAccess } from "@/lib/auth/permissions";
import { readJsonBody, respondToRouteError } from "@/lib/auth/routeErrors";
import { requireSessionUser } from "@/lib/auth/session";
import { getSunday, readConductorName, updateSunday } from "@/lib/calendar/queries";
import { notifyOtherBishopric } from "@/lib/notifications/notifyOtherBishopric";
import { describeAskConsequences } from "@/lib/sacrament/askWarnings";
import {
  reconcileSundayAsks,
  type ReconcileResult,
} from "@/lib/sacrament/conductorHandover";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { AskLinkWriteError } from "@/lib/todos/askLinks";
import { unfinalizeTopicsIfNeeded } from "@/lib/topics/finalize";
import { updateSundaySchema } from "@/lib/validation/calendar";

const sundayIdSchema = z.uuid("That Sunday id is not valid.");

const NOT_IN_WARD = "That Sunday is not on your ward's calendar.";
const ASKS_NOT_UPDATED =
  "The Sunday was saved, but its talk asks were not all brought up to date. Please try again.";

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
      // The calendar's warning, plus what the change will do to TALK ASKS (Sacrament slice f2b):
      // who was asked to speak on a talk this switches off and who will be told to let them know,
      // and which open asks move to a new conductor. Appended to the server's own sentence, which
      // the dialog renders verbatim.
      const asksSentence = await describeAskConsequences({
        wardId: user.wardId,
        atRiskAssignmentIds: result.warning.atRiskAssignmentIds,
        conductorReshifts: result.warning.conductorReshifts,
        actingUserId: user.id,
        client: supabase,
      });
      const warning =
        asksSentence === ""
          ? result.warning
          : { ...result.warning, message: `${result.warning.message} ${asksSentence}` };

      // Both keys on purpose: `error` so the generic client error path shows something useful,
      // `warning` so calendar-b's dialog can render the specifics and word itself from `reason`.
      return NextResponse.json({ error: warning.message, warning }, { status: 409 });
    }

    const { assignmentsReverted } = result;
    const { conductingReshiftCount, orgConductingReshiftCount } = result;
    const { reshiftedSundayIds, resolvedMonthSundayIds } = result;
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

    // THE TALK ASKS FOLLOW THE CALENDAR (Sacrament slices f2 and f2b). This Sunday, every Sunday of
    // its month when the save re-resolved it (a Fast Sunday can move ONTO another Sunday), and every
    // later Sunday the edit re-shifted: an ask on a talk now off is marked for its owner to tell the
    // speaker, one on a talk back on is closed to ask afresh, and the rest follow whoever conducts
    // now. It is a reconcile, run on every save rather than only when something visibly changed,
    // so a retry after a half-finished run repairs it (lib/sacrament/conductorHandover.ts). On a
    // Sunday with no open ask and no accepted speaker it is two reads.
    let reconciled: ReconcileResult | null = null;
    // Set only when the move stopped part-way: the to-dos written before it stopped, new copies
    // and closed old ones together, which is how the error carries them.
    let writtenBeforeFailure: readonly string[] | null = null;
    try {
      reconciled = await reconcileSundayAsks({
        wardId: user.wardId,
        sundayIds: [sundayId, ...resolvedMonthSundayIds, ...reshiftedSundayIds],
        actingUserId: user.id,
        client: supabase,
      });
    } catch (error) {
      if (!(error instanceof AskLinkWriteError)) throw error;
      console.error("PATCH /api/sundays/[id] brought only some talk asks up to date", {
        wardId: user.wardId,
        sundayId,
        cause: error.cause,
      });
      writtenBeforeFailure = error.completedIds;
    }

    // Written when the move failed too: the Sunday WAS changed, and any to-do already moved exists
    // (rule 6).
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
          // Each present only when something was written, so an ordinary edit's row is unchanged.
          // A run that stopped part-way reports the to-dos it did write under `asksHandedOver`.
          ...(writtenBeforeFailure !== null
            ? { asksHandedOver: { complete: false, todoIdsWritten: writtenBeforeFailure } }
            : {}),
          ...(reconciled !== null && reconciled.createdIds.length + reconciled.closedIds.length > 0
            ? {
                asksHandedOver: {
                  complete: true,
                  sundayIds: reconciled.handedOverSundayIds,
                  createdTodoIds: reconciled.createdIds,
                  closedTodoIds: reconciled.closedIds,
                },
              }
            : {}),
          ...(reconciled !== null &&
          reconciled.talkOffTodoIds.length +
            reconciled.tellTodoIds.length +
            reconciled.backOnTodoIds.length >
            0
            ? {
                talkAsks: {
                  markedOffTodoIds: reconciled.talkOffTodoIds,
                  tellTodoIds: reconciled.tellTodoIds,
                  backOnTodoIds: reconciled.backOnTodoIds,
                  answersClearedAssignmentIds: reconciled.answersClearedAssignmentIds,
                },
              }
            : {}),
        },
      },
      supabase,
    );

    if (writtenBeforeFailure !== null) {
      return NextResponse.json({ error: ASKS_NOT_UPDATED }, { status: 500 });
    }

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
