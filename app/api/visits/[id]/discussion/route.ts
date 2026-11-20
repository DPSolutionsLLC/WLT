import { NextResponse } from "next/server";
import { z } from "zod";
import { writeAuditLog } from "@/lib/audit/writeAuditLog";
import { ForbiddenError } from "@/lib/auth/errors";
import { resolveRoleAccess } from "@/lib/auth/permissions";
import { readJsonBody, respondToRouteError } from "@/lib/auth/routeErrors";
import { requireSessionUser } from "@/lib/auth/session";
import { visitDiscussionLine } from "@/lib/agendas/sections";
import {
  placeVisitDiscussion,
  withdrawVisitDiscussion,
} from "@/lib/agendas/visitDiscussions";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { visitDiscussionSchema } from "@/lib/validation/visit";
import { getVisitLog, setVisitDiscussion } from "@/lib/visits/queries";
import { canAssignVisits } from "@/lib/visits/visitOwnership";
import { wardDateOnly } from "@/lib/ward/wardDate";
import { readWardTimezone } from "@/lib/ward/wardTimezone";
import type { Database } from "@/types/database";
import type { SupabaseClient } from "@supabase/supabase-js";

// "Discuss in bishopric meeting" on a visit (ITER-055 bv7, P15, P-B). `{ discuss: true }` asks for
// it — again, if it was already discussed — and `{ discuss: false }` withdraws it.
//
// A separate route from PATCH /api/visits/[id] on purpose: that one is gated on `visits.create`,
// which every organization leader holds, and this is the bishopric's own act — `visits.assign`
// AND a bishopric calling (canAssignVisits), the same as dividing the households.
//
// NO AGENDA IS CREATED. Asking puts the line on the soonest draft bishopric agenda dated today or
// later (in the ward's zone), if there is one; otherwise it waits for the next agenda somebody
// creates. Withdrawing takes it off every draft; a published agenda is history and is never edited.
//
// The audit row carries ids and whether a draft was changed — never the family name.

const visitLogIdSchema = z.uuid("That visit id is not valid.");

// A household deleted since the visit has no name; the line then reads "A household".
async function readFamilyName(
  wardId: string,
  householdId: string | null,
  supabase: SupabaseClient<Database>,
): Promise<string | null> {
  if (householdId === null) return null;
  const { data, error } = await supabase
    .from("households")
    .select("family_name")
    .eq("ward_id", wardId)
    .eq("id", householdId)
    .maybeSingle();
  if (error) throw new Error(`Could not read the household: ${error.message}`);
  return data?.family_name ?? null;
}

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const user = await requireSessionUser();

  try {
    const supabase = await createServerSupabaseClient();
    const roleAccess = await resolveRoleAccess(supabase, user.wardId, user.orgType);
    if (!canAssignVisits(user, roleAccess)) throw new ForbiddenError("visits.assign");

    const visitLogId = visitLogIdSchema.parse((await params).id);
    const { discuss } = visitDiscussionSchema.parse(await readJsonBody(request));

    const existing = await getVisitLog(user.wardId, visitLogId, supabase);
    if (existing === null) {
      return NextResponse.json({ error: "That visit is not in your ward." }, { status: 404 });
    }

    const visit = await setVisitDiscussion(user.wardId, visitLogId, discuss, supabase);
    if (visit === null) {
      return NextResponse.json(
        { error: "That visit could not be saved. Reload and try again." },
        { status: 404 },
      );
    }

    const asOf = new Date();
    let placedOn: string | null = null;
    let draftsChanged = 0;
    if (discuss) {
      const [timeZone, familyName] = await Promise.all([
        readWardTimezone(user.wardId, supabase),
        readFamilyName(user.wardId, visit.householdId, supabase),
      ]);
      placedOn = await placeVisitDiscussion(
        {
          wardId: user.wardId,
          visitLogId,
          text: visitDiscussionLine(familyName),
          today: wardDateOnly(asOf, timeZone),
          asOf,
        },
        supabase,
      );
      draftsChanged = placedOn === null ? 0 : 1;
    } else {
      draftsChanged = await withdrawVisitDiscussion(
        { wardId: user.wardId, visitLogId, asOf },
        supabase,
      );
    }

    await writeAuditLog(
      {
        wardId: user.wardId,
        userId: user.id,
        action: discuss ? "visit_discussion_requested" : "visit_discussion_withdrawn",
        module: "visits",
        detail: {
          visitLogId,
          orgId: visit.orgId,
          wasDiscussed: existing.bishopricDiscussedAt !== null,
          placedOn,
          draftsChanged,
        },
      },
      supabase,
    );

    return NextResponse.json({ visit, placedOn });
  } catch (error) {
    return respondToRouteError(error, {
      route: "POST /api/visits/[id]/discussion",
      fallbackMessage: "Could not change that. Please try again.",
      detail: { wardId: user.wardId, userId: user.id },
    });
  }
}
