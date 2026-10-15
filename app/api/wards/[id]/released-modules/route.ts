import { NextResponse } from "next/server";
import { UnknownWardError, writeReleasedModules } from "@/lib/access/writeReleasedModules";
import { writeAuditLog } from "@/lib/audit/writeAuditLog";
import { ForbiddenError } from "@/lib/auth/errors";
import { readJsonBody, respondToRouteError } from "@/lib/auth/routeErrors";
import { requireSessionUser } from "@/lib/auth/session";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { isSuperAdmin } from "@/lib/units/queries";
import { releasedModulesSchema } from "@/lib/validation/releasedModules";

// SET A WARD'S RELEASED MODULES (ITER-041). `{ modules: null }` removes the list, which means
// everything is released.
//
// SUPER ADMIN ONLY, asked structurally — `super_admin` held in `unit_assignments`, the same
// question is_super_admin() asks in RLS — and never through an `admin.*` permission. The list
// narrows the ward's own bishopric, so nobody in the ward may hold the key to it, and a
// role_access override cannot widen what is not a permission at all.
//
// `ward_release_settings` has no write policy, so the write is service-role and THIS CHECK IS
// THE ONLY BOUNDARY IN FRONT OF IT.
//
// `params` IS A PROMISE IN NEXT 16 (CLAUDE.md §8).

type RouteContext = { params: Promise<{ id: string }> };

export async function PUT(request: Request, context: RouteContext) {
  const user = await requireSessionUser();

  try {
    const supabase = await createServerSupabaseClient();

    if (!(await isSuperAdmin(supabase))) {
      throw new ForbiddenError("released_modules.manage");
    }

    const { id: targetWardId } = await context.params;
    const input = releasedModulesSchema.parse(await readJsonBody(request));

    await writeReleasedModules({
      wardId: targetWardId,
      modules: input.modules,
      updatedBy: user.id,
    });

    // AUDITED (CLAUDE.md rule 6), under the ward the session is acting in — the same answer POST
    // /api/units gives for "where did this happen". Module KEYS only.
    await writeAuditLog(
      {
        wardId: user.wardId,
        userId: user.id,
        action: "released_modules_updated",
        module: "admin",
        detail: { targetWardId, modules: input.modules },
      },
      supabase,
    );

    return NextResponse.json({ wardId: targetWardId, modules: input.modules });
  } catch (error) {
    if (error instanceof UnknownWardError) {
      return NextResponse.json({ error: error.message }, { status: 404 });
    }

    return respondToRouteError(error, {
      route: "PUT /api/wards/[id]/released-modules",
      fallbackMessage: "Could not save the released modules. Please try again.",
      detail: { wardId: user.wardId, userId: user.id },
    });
  }
}
