import { NextResponse } from "next/server";
import { writeAuditLog } from "@/lib/audit/writeAuditLog";
import { ForbiddenError } from "@/lib/auth/errors";
import { readJsonBody, respondToRouteError } from "@/lib/auth/routeErrors";
import { requireSessionUser } from "@/lib/auth/session";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { isSuperAdmin, listUnits } from "@/lib/units/queries";
import { UnitConflictError, createUnit } from "@/lib/units/writeUnit";
import { createUnitSchema } from "@/lib/validation/unit";

// STAKES AND WARDS. GET lists the units this session may see; POST creates one.
//
// The session is resolved OUTSIDE the try block, as every route in this app does:
// requireSessionUser() redirects by THROWING an internal Next.js error, and catching that would
// turn a redirect into a 500.
//
// ---------------------------------------------------------------------------
// THE GUARD IS `super_admin`, NOT AN `admin.*` PERMISSION, AND THAT IS THE WHOLE POINT
// ---------------------------------------------------------------------------
// A WARD HAS NO STANDING TO CREATE THE STAKE ABOVE ITSELF. Every `admin.*` permission is a
// statement about a ward, and `wards.settings.role_access` can widen most of what a ward holds;
// putting unit creation behind one would let a ward grant itself authority over the structure it
// sits inside. So the question asked here is the structural one — do you hold a `super_admin`
// row in `unit_assignments` — which is the same question the SQL `is_super_admin()` asks, and
// which no ward can reconfigure.
//
// `units` has SELECT-only policies by design (migration 065f), so the WRITE runs through the
// service-role client and THIS CHECK IS THE ONLY BOUNDARY IN FRONT OF IT. It can never be
// skipped. The READ below is governed by `units_select` and nothing here filters for security.

const NOT_SUPER_ADMIN = "units.manage";

export async function GET() {
  const user = await requireSessionUser();

  try {
    const supabase = await createServerSupabaseClient();

    // No guard. `units_select` already answers this: a super admin sees every unit, everybody
    // else sees their own ward's unit and any unit they are assigned over. An ordinary leader
    // gets a short list or an empty one, which is the honest answer rather than a refusal.
    const units = await listUnits(supabase);

    return NextResponse.json({ units });
  } catch (error) {
    return respondToRouteError(error, {
      route: "GET /api/units",
      fallbackMessage: "Could not load the units. Please try again.",
      detail: { wardId: user.wardId, userId: user.id },
    });
  }
}

export async function POST(request: Request) {
  const user = await requireSessionUser();

  try {
    const supabase = await createServerSupabaseClient();

    if (!(await isSuperAdmin(supabase))) {
      throw new ForbiddenError(NOT_SUPER_ADMIN);
    }

    const input = createUnitSchema.parse(await readJsonBody(request));

    const unit = await createUnit({
      type: input.type,
      name: input.name,
      parentId: input.parentId ?? null,
      unitNumber: input.unitNumber ?? null,
    });

    // AUDITED (CLAUDE.md rule 6). Filed under the ward the session is acting in, because
    // `audit_log.ward_id` is NOT NULL (rule 1) and a unit has no ward of its own — the honest
    // answer to "where did this happen" is "from this ward's session", and `detail` names the
    // unit so the row is legible without it.
    await writeAuditLog(
      {
        wardId: user.wardId,
        userId: user.id,
        action: "unit_created",
        module: "units",
        detail: {
          unitId: unit.id,
          unitType: unit.type,
          unitName: unit.name,
          parentId: unit.parentId,
        },
      },
      supabase,
    );

    return NextResponse.json({ unit }, { status: 201 });
  } catch (error) {
    // 409, with the sentence the write layer wrote. A unit number already recorded against
    // another unit is the caller's to fix, not a server fault, and a raw 23505 surfaces as a 500
    // reading "Please try again", which is untrue (CLAUDE.md rule 7).
    if (error instanceof UnitConflictError) {
      return NextResponse.json({ error: error.message }, { status: 409 });
    }

    return respondToRouteError(error, {
      route: "POST /api/units",
      fallbackMessage: "Could not create the unit. Please try again.",
      detail: { wardId: user.wardId, userId: user.id },
    });
  }
}
