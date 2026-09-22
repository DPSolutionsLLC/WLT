import { NextResponse } from "next/server";
import { writeAuditLog } from "@/lib/audit/writeAuditLog";
import { ForbiddenError } from "@/lib/auth/errors";
import { readJsonBody, respondToRouteError } from "@/lib/auth/routeErrors";
import { requireSessionUser } from "@/lib/auth/session";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { isSuperAdmin } from "@/lib/units/queries";
import { UnitConflictError, deleteUnit, updateUnit } from "@/lib/units/writeUnit";
import { updateUnitSchema } from "@/lib/validation/unit";

// Renaming a unit, correcting its number, re-parenting it, and removing one.
//
// `params` IS A PROMISE IN NEXT 16 (CLAUDE.md §8). Awaiting it is not optional.
//
// The same `super_admin` guard as POST /api/units, for the same reason: a ward has no standing
// to edit the structure above itself, and `units` has SELECT-only policies so this check is the
// ONLY boundary in front of a service-role write.

const NOT_SUPER_ADMIN = "units.manage";

type RouteContext = { params: Promise<{ id: string }> };

export async function PATCH(request: Request, context: RouteContext) {
  const user = await requireSessionUser();

  try {
    const supabase = await createServerSupabaseClient();

    if (!(await isSuperAdmin(supabase))) {
      throw new ForbiddenError(NOT_SUPER_ADMIN);
    }

    const { id } = await context.params;
    const input = updateUnitSchema.parse(await readJsonBody(request));

    const unit = await updateUnit(id, {
      ...(input.name !== undefined ? { name: input.name } : {}),
      ...(input.parentId !== undefined ? { parentId: input.parentId ?? null } : {}),
      ...(input.unitNumber !== undefined ? { unitNumber: input.unitNumber ?? null } : {}),
    });

    // A zero-row UPDATE, not a fault. `units` is reachable by id from a super admin's client, so
    // the only way here is an id that does not exist.
    if (!unit) {
      return NextResponse.json({ error: "That unit is not there." }, { status: 404 });
    }

    await writeAuditLog(
      {
        wardId: user.wardId,
        userId: user.id,
        action: "unit_updated",
        module: "units",
        detail: {
          unitId: unit.id,
          unitName: unit.name,
          unitNumber: unit.unitNumber,
          parentId: unit.parentId,
        },
      },
      supabase,
    );

    return NextResponse.json({ unit });
  } catch (error) {
    if (error instanceof UnitConflictError) {
      return NextResponse.json({ error: error.message }, { status: 409 });
    }

    return respondToRouteError(error, {
      route: "PATCH /api/units/[id]",
      fallbackMessage: "Could not update the unit. Please try again.",
      detail: { wardId: user.wardId, userId: user.id },
    });
  }
}

// DELETING A STAKE WITH WARDS UNDER IT FAILS LOUDLY — migration 065a's `on delete restrict`,
// stated there as being "rather than silently orphaning or destroying them". The constraint is
// what enforces it; this turns the refusal into a 409 with a sentence naming the way forward.
//
// The audit row is written BEFORE the delete is reported and only on the path that succeeded. A
// refused write is not a mutation, which scenario 049's walk established and youth-h applied.
export async function DELETE(_request: Request, context: RouteContext) {
  const user = await requireSessionUser();

  try {
    const supabase = await createServerSupabaseClient();

    if (!(await isSuperAdmin(supabase))) {
      throw new ForbiddenError(NOT_SUPER_ADMIN);
    }

    const { id } = await context.params;

    await deleteUnit(id);

    await writeAuditLog(
      {
        wardId: user.wardId,
        userId: user.id,
        action: "unit_deleted",
        module: "units",
        detail: { unitId: id },
      },
      supabase,
    );

    return NextResponse.json({ ok: true });
  } catch (error) {
    if (error instanceof UnitConflictError) {
      return NextResponse.json({ error: error.message }, { status: 409 });
    }

    return respondToRouteError(error, {
      route: "DELETE /api/units/[id]",
      fallbackMessage: "Could not remove the unit. Please try again.",
      detail: { wardId: user.wardId, userId: user.id },
    });
  }
}
