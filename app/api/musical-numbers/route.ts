import { NextResponse } from "next/server";
import { writeAuditLog } from "@/lib/audit/writeAuditLog";
import { assertCan, resolveRoleAccess } from "@/lib/auth/permissions";
import { readJsonBody, respondToRouteError } from "@/lib/auth/routeErrors";
import { requireSessionUser } from "@/lib/auth/session";
import { getSunday } from "@/lib/calendar/queries";
import { deleteMusicalNumber, upsertMusicalNumber } from "@/lib/music/queries";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { clearMusicalNumberSchema, logMusicalNumberSchema } from "@/lib/validation/music";
import { holdsSacramentMeeting } from "@/types/domain";

// Logging who is performing and what.
//
// THE PERFORMER IS FREE TEXT AND roster-b's MemberPicker IS NOT REACHED FOR. A visiting quartet
// has no member record, "the Primary children" is not a person, and a returned missionary singing
// on their last Sunday may well have moved out of the roster already. Every one of those is a
// normal answer, and a member id could hold none of them.
//
// The session is resolved OUTSIDE the try block: requireSessionUser() redirects by throwing an
// internal Next.js error, and catching that would turn a redirect into a 500.

export async function POST(request: Request) {
  const user = await requireSessionUser();

  try {
    const supabase = await createServerSupabaseClient();
    const roleAccess = await resolveRoleAccess(supabase, user.wardId);

    assertCan(user, "music.manage", roleAccess);

    const input = logMusicalNumberSchema.parse(await readJsonBody(request));

    const sunday = await getSunday(user.wardId, input.sundayId, supabase);

    if (sunday === null) {
      return NextResponse.json(
        { error: "That Sunday is not on this ward's calendar." },
        { status: 404 },
      );
    }

    if (!holdsSacramentMeeting(sunday.type)) {
      return NextResponse.json(
        {
          error:
            "That Sunday holds no sacrament meeting, so there is nowhere for a musical number.",
        },
        { status: 422 },
      );
    }

    const musicalNumber = await upsertMusicalNumber(
      user.wardId,
      {
        sundayId: input.sundayId,
        performer: input.performer,
        pieceTitle: input.pieceTitle,
        notes: input.notes,
      },
      supabase,
    );

    // An RLS-denied UPDATE is a zero-row success rather than an error
    // (plans/retros/foundation-c-services.md), so a null row is a refusal, not a fault.
    if (musicalNumber === null) {
      return NextResponse.json(
        { error: "You do not have permission to change this Sunday's music." },
        { status: 403 },
      );
    }

    await writeAuditLog(
      {
        wardId: user.wardId,
        userId: user.id,
        action: "musical_number_logged",
        module: "music",
        detail: {
          sundayId: input.sundayId,
          // WHETHER the fields were filled, never what they say. A performer's name is a person,
          // and the audit log is not the place to accumulate one (CLAUDE.md rule 8's instinct).
          hasPerformer: input.performer !== null,
          hasPieceTitle: input.pieceTitle !== null,
          hasNotes: input.notes !== null,
        },
      },
      supabase,
    );

    // The snapshot rule again: this does not reach into an existing program draft. It appears in
    // that program's refresh diff (program-a).
    return NextResponse.json({ musicalNumber });
  } catch (error) {
    return respondToRouteError(error, {
      route: "POST /api/musical-numbers",
      fallbackMessage: "Could not save the musical number. Please try again.",
      detail: { wardId: user.wardId, userId: user.id },
    });
  }
}

export async function DELETE(request: Request) {
  const user = await requireSessionUser();

  try {
    const supabase = await createServerSupabaseClient();
    const roleAccess = await resolveRoleAccess(supabase, user.wardId);

    assertCan(user, "music.manage", roleAccess);

    const input = clearMusicalNumberSchema.parse(await readJsonBody(request));

    const sunday = await getSunday(user.wardId, input.sundayId, supabase);

    if (sunday === null) {
      return NextResponse.json(
        { error: "That Sunday is not on this ward's calendar." },
        { status: 404 },
      );
    }

    const cleared = await deleteMusicalNumber(user.wardId, input.sundayId, supabase);

    await writeAuditLog(
      {
        wardId: user.wardId,
        userId: user.id,
        action: "musical_number_cleared",
        module: "music",
        detail: { sundayId: input.sundayId, removedRow: cleared },
      },
      supabase,
    );

    return NextResponse.json({ cleared });
  } catch (error) {
    return respondToRouteError(error, {
      route: "DELETE /api/musical-numbers",
      fallbackMessage: "Could not clear the musical number. Please try again.",
      detail: { wardId: user.wardId, userId: user.id },
    });
  }
}
