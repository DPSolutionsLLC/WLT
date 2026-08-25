import { NextResponse } from "next/server";
import { writeAuditLog } from "@/lib/audit/writeAuditLog";
import { assertCan, resolveRoleAccess } from "@/lib/auth/permissions";
import { readJsonBody, respondToRouteError } from "@/lib/auth/routeErrors";
import { requireSessionUser } from "@/lib/auth/session";
import { getSunday } from "@/lib/calendar/queries";
import { deleteSelection, upsertSelection } from "@/lib/music/queries";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { clearHymnSchema, selectHymnSchema } from "@/lib/validation/music";
import { holdsSacramentMeeting } from "@/types/domain";

// Saving a hymn for one slot on one Sunday.
//
// NO NOTIFICATION IS EMITTED. Nothing in 06-program-music.md asks for one, and an unfired
// notification key is worse than no key at all — it looks like a feature that exists until
// somebody discovers it has never sent anything (talks-c). If a ward later wants the secretary
// told when hymns are chosen, that is a trigger added on purpose with a test behind it.
//
// The session is resolved OUTSIDE the try block: requireSessionUser() redirects by throwing an
// internal Next.js error, and catching that would turn a redirect into a 500.

export async function POST(request: Request) {
  const user = await requireSessionUser();

  try {
    const supabase = await createServerSupabaseClient();
    const roleAccess = await resolveRoleAccess(supabase, user.wardId);

    // Held by music_coordinator AND the bishopric. Bishopric admin authority is shared and a
    // counselor must never be able to do less than the bishop (CLAUDE.md §7). Migration 043
    // narrows the same set at the database, so a route that forgot this check would still be
    // refused by the policy (CLAUDE.md rule 2).
    assertCan(user, "music.manage", roleAccess);

    const input = selectHymnSchema.parse(await readJsonBody(request));

    const sunday = await getSunday(user.wardId, input.sundayId, supabase);

    if (sunday === null) {
      return NextResponse.json(
        { error: "That Sunday is not on this ward's calendar." },
        { status: 404 },
      );
    }

    // 422. A Sunday that holds no sacrament meeting has no hymns to sing, and storing one would
    // put a hymn on a program that will never be built — the same refusal POST /api/programs
    // makes for the same reason.
    if (!holdsSacramentMeeting(sunday.type)) {
      return NextResponse.json(
        { error: "That Sunday holds no sacrament meeting, so it has no hymns." },
        { status: 422 },
      );
    }

    const selection = await upsertSelection(
      user.wardId,
      {
        sundayId: input.sundayId,
        hymnType: input.hymnType,
        hymnNumber: input.hymnNumber,
        // Stored beside the number on purpose: the program draft is a snapshot and must survive
        // the hymns table being replaced under it (lib/music/queries.ts).
        hymnTitle: input.hymnTitle,
        // THE ONLY PLACE THIS FLAG IS SET. It records whether the choice began as a suggestion,
        // which is what makes "how often is the AI actually right" answerable later.
        aiSuggested: input.aiSuggested,
      },
      user.id,
      supabase,
    );

    // Null means the write was refused — an RLS-denied UPDATE is a zero-row success rather than
    // an error (plans/retros/foundation-c-services.md). 403 rather than 500: the request was
    // well-formed and the policy said no.
    if (selection === null) {
      return NextResponse.json(
        { error: "You do not have permission to change this Sunday's hymns." },
        { status: 403 },
      );
    }

    await writeAuditLog(
      {
        wardId: user.wardId,
        userId: user.id,
        action: "hymn_selected",
        module: "music",
        detail: {
          sundayId: input.sundayId,
          hymnType: input.hymnType,
          hymnNumber: input.hymnNumber,
          aiSuggested: input.aiSuggested,
        },
      },
      supabase,
    );

    // THE SNAPSHOT RULE IS UNCHANGED. Choosing a hymn does not reach into an existing program
    // draft — it shows up in that program's refresh diff, where somebody accepts it. There is
    // deliberately no write-through here (program-a).
    return NextResponse.json({ selection });
  } catch (error) {
    return respondToRouteError(error, {
      route: "POST /api/hymns/select",
      fallbackMessage: "Could not save that hymn. Please try again.",
      detail: { wardId: user.wardId, userId: user.id },
    });
  }
}

// Clearing a slot. Its own verb rather than a save of nulls, so "no hymn chosen yet" and "the
// hymn was removed" cannot be represented by the same request.
export async function DELETE(request: Request) {
  const user = await requireSessionUser();

  try {
    const supabase = await createServerSupabaseClient();
    const roleAccess = await resolveRoleAccess(supabase, user.wardId);

    assertCan(user, "music.manage", roleAccess);

    const input = clearHymnSchema.parse(await readJsonBody(request));

    const sunday = await getSunday(user.wardId, input.sundayId, supabase);

    if (sunday === null) {
      return NextResponse.json(
        { error: "That Sunday is not on this ward's calendar." },
        { status: 404 },
      );
    }

    const cleared = await deleteSelection(
      user.wardId,
      input.sundayId,
      input.hymnType,
      supabase,
    );

    // `cleared` is false when there was nothing to delete OR when the policy refused it — a
    // denied DELETE is a zero-row success. Both leave the slot empty, which is what the caller
    // asked for, so both report the same thing. The audit row records which it was.
    await writeAuditLog(
      {
        wardId: user.wardId,
        userId: user.id,
        action: "hymn_cleared",
        module: "music",
        detail: { sundayId: input.sundayId, hymnType: input.hymnType, removedRow: cleared },
      },
      supabase,
    );

    return NextResponse.json({ cleared });
  } catch (error) {
    return respondToRouteError(error, {
      route: "DELETE /api/hymns/select",
      fallbackMessage: "Could not clear that hymn. Please try again.",
      detail: { wardId: user.wardId, userId: user.id },
    });
  }
}
