import { NextResponse } from "next/server";
import { z } from "zod";
import { writeAuditLog } from "@/lib/audit/writeAuditLog";
import { BISHOPRIC_ROLES, assertCan, resolveRoleAccess } from "@/lib/auth/permissions";
import { readJsonBody, respondToRouteError } from "@/lib/auth/routeErrors";
import { requireSessionUser } from "@/lib/auth/session";
import { canTransitionPrayer } from "@/lib/prayers/prayerPipeline";
import { getPrayer, setPrayerMember, transitionPrayer } from "@/lib/prayers/queries";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { updatePrayerSchema } from "@/lib/validation/prayer";
import { PRAYER_STAGE_LABELS, type Role } from "@/types/domain";

// `params` is a Promise in Next 16, and the props are typed explicitly rather than with the
// generated RouteContext helper, which only exists after a build
// (plans/retros/foundation-a-scaffold.md).

const prayerIdSchema = z.uuid("That prayer id is not valid.");

const NOT_FOUND = "That prayer is not in your ward.";

const WRITE_REFUSED = "That prayer could not be saved. Reload and try again.";

function isBishopric(role: Role): boolean {
  return (BISHOPRIC_ROLES as readonly string[]).includes(role);
}

// One permission for every prayer write, unlike the talk pipeline's five. There is no approval
// gate and no separate confirm authority here — asking somebody to pray and hearing back is one
// person's job from start to finish.
export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const user = await requireSessionUser();

  try {
    const { id } = await params;
    const prayerId = prayerIdSchema.parse(id);
    const input = updatePrayerSchema.parse(await readJsonBody(request));

    const supabase = await createServerSupabaseClient();
    const roleAccess = await resolveRoleAccess(supabase, user.wardId);

    assertCan(user, "talks.plan", roleAccess);

    const existing = await getPrayer(user.wardId, prayerId, supabase);
    if (!existing) {
      return NextResponse.json({ error: NOT_FOUND }, { status: 404 });
    }

    if (input.action === "assign") {
      const prayer = await setPrayerMember(
        user.wardId,
        prayerId,
        input.memberId,
        supabase,
      );

      if (!prayer) {
        return NextResponse.json({ error: WRITE_REFUSED }, { status: 404 });
      }

      await writeAuditLog(
        {
          wardId: user.wardId,
          userId: user.id,
          action: "prayer_assigned",
          module: "talks",
          detail: {
            prayerId,
            sundayId: prayer.sundayId,
            prayerType: prayer.prayerType,
            stage: prayer.stage,
            assigned: prayer.memberId !== null,
          },
        },
        supabase,
      );

      return NextResponse.json({ prayer });
    }

    const from = existing.stage;
    const to = input.to;

    const verdict = canTransitionPrayer(from, to, {
      memberId: existing.memberId,
      askedAt: existing.askedAt,
      confirmedAt: existing.confirmedAt,
      actorIsBishopric: isBishopric(user.role),
      reason: input.reason,
    });

    // 409, not 400. The request was perfectly well formed; the prayer simply is not ready, and a
    // 400 would tell the caller they made a syntax mistake they did not make.
    if (!verdict.ok) {
      return NextResponse.json({ error: verdict.message }, { status: 409 });
    }

    const prayer = await transitionPrayer(
      user.wardId,
      prayerId,
      to,
      { actorUserId: user.id },
      supabase,
    );

    if (!prayer) {
      return NextResponse.json({ error: WRITE_REFUSED }, { status: 404 });
    }

    await writeAuditLog(
      {
        wardId: user.wardId,
        userId: user.id,
        action: "prayer_stage_changed",
        module: "talks",
        detail: {
          prayerId,
          sundayId: prayer.sundayId,
          prayerType: prayer.prayerType,
          from,
          to,
          // A backward move with no reason was already refused by canTransitionPrayer, so this
          // is never empty when it matters.
          reason: input.reason ?? null,
        },
      },
      supabase,
    );

    return NextResponse.json({
      prayer,
      from,
      to,
      stageLabel: PRAYER_STAGE_LABELS[to],
    });
  } catch (error) {
    return respondToRouteError(error, {
      route: "PATCH /api/prayers/[id]",
      fallbackMessage: "Could not update that prayer. Please try again.",
      detail: { wardId: user.wardId, userId: user.id },
    });
  }
}
