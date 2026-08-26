import { NextResponse } from "next/server";
import { z } from "zod";
import { writeAuditLog } from "@/lib/audit/writeAuditLog";
import { assertCan, resolveRoleAccess } from "@/lib/auth/permissions";
import { readJsonBody, respondToRouteError } from "@/lib/auth/routeErrors";
import { requireSessionUser } from "@/lib/auth/session";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { notifyWardCouncilFlag } from "@/lib/visits/flagNotification";
import { getVisitLog, updateVisitLog } from "@/lib/visits/queries";
import { updateVisitLogSchema } from "@/lib/validation/visit";
import type { Database } from "@/types/database";
import type { SupabaseClient } from "@supabase/supabase-js";

// Editing a visit: the shared notes, and the ward-council flag.
//
// THIS FILE DOES NOT IMPORT lib/visits/privateNotes.ts, AND MUST NOT — see the header of
// app/api/visits/route.ts. A private note is edited through its own endpoint, in its own
// request, so the wire format carries the boundary too.

const WRITE_REFUSED = "That visit could not be saved. Reload and try again.";

const visitLogIdSchema = z.uuid("That visit id is not valid.");

// Labels for the flag notification, and nothing else. The executive secretary who receives it
// holds no `visits.view` permission, so these two names plus "requested for ward council
// discussion" are the entire contents of what reaches them.
async function resolveFlagLabels(
  wardId: string,
  orgId: string | null,
  householdId: string | null,
  supabase: SupabaseClient<Database>,
): Promise<{ orgName: string; familyName: string }> {
  const [organization, household] = await Promise.all([
    orgId === null
      ? Promise.resolve(null)
      : supabase
          .from("organizations")
          .select("name")
          .eq("ward_id", wardId)
          .eq("id", orgId)
          .maybeSingle()
          .then((result) => result.data),
    householdId === null
      ? Promise.resolve(null)
      : supabase
          .from("households")
          .select("family_name")
          .eq("ward_id", wardId)
          .eq("id", householdId)
          .maybeSingle()
          .then((result) => result.data),
  ]);

  // A visit logged by the bishopric has no organization, and a household deleted since the
  // visit has no name. Neither is worth losing the notification over — the flag is still on the
  // visit, and a one-liner that says "Ward" beats silence for whoever builds the agenda.
  return {
    orgName: organization?.name ?? "Ward",
    familyName: household?.family_name ?? "A household",
  };
}

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const user = await requireSessionUser();

  try {
    const supabase = await createServerSupabaseClient();
    const roleAccess = await resolveRoleAccess(supabase, user.wardId);

    assertCan(user, "visits.create", roleAccess);

    const { id } = await params;
    const visitLogId = visitLogIdSchema.parse(id);
    const input = updateVisitLogSchema.parse(await readJsonBody(request));

    const existing = await getVisitLog(user.wardId, visitLogId, supabase);

    if (!existing) {
      return NextResponse.json({ error: "That visit is not in your ward." }, { status: 404 });
    }

    // ---------------------------------------------------------------------
    // THE FLAG TRANSITION — 07-visits.md §Step 3
    // ---------------------------------------------------------------------
    //   false -> true,  flag_sent_at IS NULL      set flag, stamp flag_sent_at, NOTIFY
    //   false -> true,  flag_sent_at IS NOT NULL  set flag, do not notify        (re-flag)
    //   true  -> false                            clear flag, CLEAR flag_sent_at
    //
    // Clearing flag_sent_at on unflag is what lets a genuine re-raise notify again. Leaving it
    // set would make the second raise silent, and an agenda item nobody was told about is the
    // same as no agenda item.
    //
    // flag_sent_at is never taken from the request body — lib/visits/queries.ts takes it as a
    // separate parameter for exactly that reason. A body that could stamp its own would be able
    // to silence the notification.
    const wasFlagged = existing.flaggedForWardCouncil;
    const nowFlagged = input.flaggedForWardCouncil ?? wasFlagged;

    const raising = !wasFlagged && nowFlagged;
    const clearing = wasFlagged && !nowFlagged;
    const shouldNotify = raising && existing.flagSentAt === null;

    let flagSentAt: string | null | undefined;
    if (shouldNotify) flagSentAt = new Date().toISOString();
    else if (clearing) flagSentAt = null;

    const visit = await updateVisitLog(
      user.wardId,
      visitLogId,
      input,
      flagSentAt,
      supabase,
    );

    if (!visit) {
      return NextResponse.json({ error: WRITE_REFUSED }, { status: 404 });
    }

    await writeAuditLog(
      {
        wardId: user.wardId,
        userId: user.id,
        action: clearing ? "visit_unflagged" : raising ? "visit_flagged" : "visit_updated",
        module: "visits",
        detail: {
          visitLogId,
          orgId: visit.orgId,
          // The KEYS that changed, never their values. `sharedNotes` in this list is a record
          // that the notes were edited; the notes themselves belong in the row, not in the log.
          changed: Object.keys(input),
          notified: shouldNotify,
        },
      },
      supabase,
    );

    // Fired AFTER the update commits, and its failure never fails the request —
    // notifyWardCouncilFlag never throws. The leader's edit is saved either way.
    if (shouldNotify) {
      const labels = await resolveFlagLabels(
        user.wardId,
        visit.orgId,
        visit.householdId,
        supabase,
      );

      await notifyWardCouncilFlag({ wardId: user.wardId, ...labels });
    }

    return NextResponse.json({ visit });
  } catch (error) {
    return respondToRouteError(error, {
      route: "PATCH /api/visits/[id]",
      fallbackMessage: "Could not save that visit. Please try again.",
      detail: { wardId: user.wardId, userId: user.id },
    });
  }
}
