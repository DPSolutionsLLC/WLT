import { NextResponse } from "next/server";
import { writeAuditLog } from "@/lib/audit/writeAuditLog";
import { readJsonBody, respondToRouteError } from "@/lib/auth/routeErrors";
import { requireSessionUser } from "@/lib/auth/session";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { listSwitchableWards } from "@/lib/units/queries";
import { clearActiveWard, switchActiveWard } from "@/lib/units/wardSwitch";
import { wardSwitchSchema } from "@/lib/validation/wardSwitch";

// THE WARD SWITCH. GET lists the wards this session may act in; PATCH performs the switch.
//
// The session is resolved OUTSIDE the try block, as every route in this app does:
// requireSessionUser() redirects by THROWING an internal Next.js error, and catching that would
// turn a redirect into a 500.
//
// ---------------------------------------------------------------------------
// THERE IS NO assertCan() HERE, AND THAT IS DELIBERATE
// ---------------------------------------------------------------------------
// There is no `units.*` permission and THERE MUST NOT BE ONE. The authority to switch is A REAL
// CALLING IN THE OTHER WARD — a row in `ward_role_assignments` (migration 068) — not a
// ward-configurable permission. Putting it in PERMISSIONS would let `wards.settings.role_access`
// widen it, which means A WARD COULD GRANT ITSELF THE RIGHT TO ACT IN ANOTHER WARD.
// (lib/auth/permissions.ts locks the `super_admin` ROLE out of overrides for the same reason, one
// level up.)
//
// So RLS is the only boundary (CLAUDE.md rule 2): `users_update_self`'s WITH CHECK arm decides,
// and this route's job is to turn its refusal into a sentence. A refused switch RAISES rather
// than returning zero rows, which lib/units/wardSwitch.ts maps — see its header.
//
// No wording constant lives in this file. The switcher control is a P3 chrome component and a
// "use client" component importing a constant out of here would pull next/headers into the
// browser bundle, which only `npm run build` catches (youth-b, youth-c). Its labels belong in
// types/domain.ts.

// It says WHY in the terms the model actually uses. "You are not assigned over that ward" was
// the visiting-officer's sentence and describes a rule that no longer exists; a person reaches a
// second ward by HOLDING A CALLING THERE, and the fix for a wrong answer is a calling rather than
// a stake assignment.
const REFUSED_MESSAGE =
  "You do not hold a calling in that ward, so you cannot act in it. Choose one from the list.";

export async function GET() {
  const user = await requireSessionUser();

  try {
    const supabase = await createServerSupabaseClient();
    const wards = await listSwitchableWards(supabase);

    return NextResponse.json({
      wards,
      activeWardId: user.activeWardId,
      homeWardId: user.homeWardId,
    });
  } catch (error) {
    return respondToRouteError(error, {
      route: "GET /api/session/active-ward",
      fallbackMessage: "Could not load the wards you may act in. Please try again.",
      detail: { wardId: user.wardId, userId: user.id },
    });
  }
}

export async function PATCH(request: Request) {
  const user = await requireSessionUser();

  try {
    const supabase = await createServerSupabaseClient();
    const input = wardSwitchSchema.parse(await readJsonBody(request));

    const result =
      input.activeWardId === null
        ? await clearActiveWard(supabase)
        : await switchActiveWard(input.activeWardId, supabase);

    if (!result) {
      return NextResponse.json({ error: REFUSED_MESSAGE }, { status: 403 });
    }

    // AUDITED IN BOTH DIRECTIONS (CLAUDE.md rule 6), and filed under the ward the session is NOW
    // acting in — which is read back from current_ward_id() rather than assumed to be the ward
    // that was asked for, because a switch authorized at write time can still fall back on the
    // next read. `detail` names both ends so the row is legible from either side.
    await writeAuditLog(
      {
        wardId: result.wardId,
        userId: user.id,
        action: input.activeWardId ? "active_ward_switched" : "active_ward_cleared",
        module: "units",
        detail: { fromWardId: user.wardId, toWardId: result.wardId },
      },
      supabase,
    );

    return NextResponse.json(result);
  } catch (error) {
    return respondToRouteError(error, {
      route: "PATCH /api/session/active-ward",
      fallbackMessage: "Could not switch wards. Please try again.",
      detail: { wardId: user.wardId, userId: user.id },
    });
  }
}
