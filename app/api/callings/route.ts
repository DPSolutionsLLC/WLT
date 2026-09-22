import { NextResponse } from "next/server";
import { countActiveBishops } from "@/lib/auth/adminUsers";
import { writeAuditLog } from "@/lib/audit/writeAuditLog";
import { ForbiddenError } from "@/lib/auth/errors";
import { assertCan, resolveRoleAccess } from "@/lib/auth/permissions";
import { readJsonBody, respondToRouteError } from "@/lib/auth/routeErrors";
import { requireSessionUser } from "@/lib/auth/session";
import { createCalling, endCalling, updateCalling } from "@/lib/callings/writeCalling";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { createServiceSupabaseClient } from "@/lib/supabase/service";
import { isSuperAdmin } from "@/lib/units/queries";
import {
  createCallingSchema,
  updateCallingStatusSchema,
} from "@/lib/validation/calling";

// GIVING SOMEBODY A CALLING IN A WARD — and releasing one.
//
// THIS IS WHAT MAKES MULTI-WARD REACHABLE BY HAND. Migrations 068–071 built the model and
// scenario 066 could only reach a second calling by SEEDING one; this route is the first thing
// in the app that can create one.
//
// ---------------------------------------------------------------------------
// TWO GUARDS, AND WHICH ONE APPLIES DEPENDS ON WHICH WARD IS NAMED
// ---------------------------------------------------------------------------
// The body NAMES a ward, which no other schema in this app permits (conventions.md §Validation
// says the ward comes from the session). It is correct here and only here, because the entire
// purpose is to write a calling in a ward that is not the one the caller is acting in — and the
// body may name a ward without authorizing one:
//
//   * THE WARD THIS SESSION IS ACTING IN  → `admin.manage_users`, the ordinary ward admin right.
//   * ANY OTHER WARD                      → `super_admin`, held in `unit_assignments`.
//
// A bishop may staff their own ward and nobody else's. Reaching into a second ward is a
// structural act, so it asks the structural question — the same one POST /api/units asks, and
// the same one no ward can reconfigure through `wards.settings.role_access`.
//
// `ward_role_assignments` has a SELECT policy and NO WRITE POLICIES (migration 068c), so these
// checks are THE boundary for the write (CLAUDE.md rule 2's documented exception, carried by
// lib/callings/writeCalling.ts's header).

// Postgres unique violation — `ward_role_assignments_one_per_ward`, the partial unique index that
// keeps current_user_role() single-valued. It is a refusal, not a fault.
const UNIQUE_VIOLATION = "23505";

function isUniqueViolation(error: unknown): boolean {
  const codeOf = (value: unknown): string | undefined =>
    typeof value === "object" && value !== null && "code" in value
      ? (value as { code?: string }).code
      : undefined;

  if (codeOf(error) === UNIQUE_VIOLATION) return true;

  return (
    error instanceof Error && codeOf((error as { cause?: unknown }).cause) === UNIQUE_VIOLATION
  );
}

const ALREADY_SERVING =
  "That person already holds a calling in that ward. Release the one they hold before " +
  "giving them another, or change the calling they already have.";

// Reused verbatim in meaning from lib/auth/adminUsers.ts's demotion guard. Ending a bishop's
// calling is the same lockout risk as demoting them — the ward must never be able to leave
// itself with no bishop and therefore no admin surface.
const LAST_BISHOP =
  "This is the ward's only active bishop. Give somebody else the bishop calling first, " +
  "otherwise nobody will be able to administer the ward.";

// Resolves which of the two guards applies, and throws if it is not satisfied. Returns nothing:
// the only outcomes are "permitted" and "threw".
async function assertMayStaffWard(
  targetWardId: string,
  sessionWardId: string,
  supabase: Awaited<ReturnType<typeof createServerSupabaseClient>>,
  user: Awaited<ReturnType<typeof requireSessionUser>>,
): Promise<void> {
  if (targetWardId === sessionWardId) {
    const roleAccess = await resolveRoleAccess(supabase, user.wardId, user.orgType);
    assertCan(user, "admin.manage_users", roleAccess);
    return;
  }

  if (!(await isSuperAdmin(supabase))) {
    throw new ForbiddenError("callings.manage_other_ward");
  }
}

export async function POST(request: Request) {
  const user = await requireSessionUser();

  try {
    const supabase = await createServerSupabaseClient();
    const input = createCallingSchema.parse(await readJsonBody(request));

    await assertMayStaffWard(input.wardId, user.wardId, supabase, user);

    const calling = await createCalling({
      userId: input.userId,
      wardId: input.wardId,
      role: input.role,
      orgId: input.orgId ?? null,
      counselorPosition: input.counselorPosition ?? null,
      startedOn: input.startedOn ?? null,
      createdBy: user.id,
    });

    // Filed under the ward the CALLING is in, not the ward the session is in. That is where the
    // change happened and where a later reader of that ward's trail will look for it; `detail`
    // names the acting ward so the row is legible from the other side too.
    await writeAuditLog(
      {
        wardId: input.wardId,
        userId: user.id,
        action: "calling_created",
        module: "units",
        detail: {
          callingId: calling.id,
          targetUserId: calling.userId,
          role: calling.role,
          orgId: calling.orgId,
          actingWardId: user.wardId,
        },
      },
      supabase,
    );

    return NextResponse.json({ calling }, { status: 201 });
  } catch (error) {
    // The one-active-calling-per-ward index firing. A sentence naming the alternative, rather
    // than a 500 for something the caller can fix (visits-f, CLAUDE.md rule 7).
    //
    // The code is read off `cause` because createCalling() WRAPS the PostgREST error — its header
    // says the caller maps 23505, and `cause` is how the SQLSTATE survives the wrapping. The
    // top-level check stays for a client that throws the raw error directly.
    if (isUniqueViolation(error)) {
      return NextResponse.json({ error: ALREADY_SERVING }, { status: 409 });
    }

    return respondToRouteError(error, {
      route: "POST /api/callings",
      fallbackMessage: "Could not record the calling. Please try again.",
      detail: { wardId: user.wardId, userId: user.id },
    });
  }
}

// RELEASING A CALLING, AND PUTTING ONE BACK. Never a delete — a calling somebody held is a record
// of what happened, and the partial unique index is on `where is_active` precisely so the
// released row can stay (migration 068).
export async function PATCH(request: Request) {
  const user = await requireSessionUser();

  try {
    const supabase = await createServerSupabaseClient();
    const input = updateCallingStatusSchema.parse(await readJsonBody(request));

    await assertMayStaffWard(input.wardId, user.wardId, supabase, user);

    // THE LAST-BISHOP GUARD, on the release path where it belongs. Plan 1 re-pointed
    // countActiveBishops() at `ward_role_assignments`, so it already counts callings rather than
    // `users` rows — and releasing the last bishop is exactly the lockout
    // lib/auth/adminUsers.ts's demotion guard refuses.
    //
    // It reads through the SERVICE-ROLE client because the ward being staffed may not be the ward
    // this session is acting in: `ward_role_assignments_select` would return nothing for another
    // ward, the count would come back zero, and the guard would never fire — which is precisely
    // how a guard comes to be worse than none.
    //
    // Check-then-act, with the same trade-off accepted for the same reason as the guard it
    // mirrors: the recovery is a one-row fix, and a database constraint on the bishop count would
    // block every legitimate bishopric transition.
    if (!input.isActive) {
      const service = createServiceSupabaseClient();
      const bishops = await countActiveBishops(input.wardId, service);
      const releasing = await supabase
        .from("ward_role_assignments")
        .select("role")
        .eq("user_id", input.userId)
        .eq("ward_id", input.wardId)
        .eq("is_active", true)
        .maybeSingle();

      if (releasing.data?.role === "bishop" && bishops <= 1) {
        return NextResponse.json({ error: LAST_BISHOP }, { status: 409 });
      }
    }

    const calling = input.isActive
      ? await updateCalling({
          userId: input.userId,
          wardId: input.wardId,
          changes: { isActive: true },
        })
      : await endCalling({
          userId: input.userId,
          wardId: input.wardId,
          endedOn: input.endedOn ?? null,
        });

    if (!calling) {
      return NextResponse.json(
        { error: "That person holds no active calling in that ward." },
        { status: 404 },
      );
    }

    await writeAuditLog(
      {
        wardId: input.wardId,
        userId: user.id,
        action: input.isActive ? "calling_reinstated" : "calling_released",
        module: "units",
        detail: {
          callingId: calling.id,
          targetUserId: calling.userId,
          role: calling.role,
          actingWardId: user.wardId,
        },
      },
      supabase,
    );

    return NextResponse.json({ calling });
  } catch (error) {
    return respondToRouteError(error, {
      route: "PATCH /api/callings",
      fallbackMessage: "Could not update the calling. Please try again.",
      detail: { wardId: user.wardId, userId: user.id },
    });
  }
}
