import { NextResponse } from "next/server";
import { z } from "zod";
import { writeAuditLog } from "@/lib/audit/writeAuditLog";
import { assertCan } from "@/lib/auth/permissions";
import { readJsonBody, respondToRouteError } from "@/lib/auth/routeErrors";
import { requireSessionUser } from "@/lib/auth/session";
import { createMemberNote, listMemberNotes } from "@/lib/roster/memberNotes";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { createMemberNoteSchema } from "@/lib/validation/roster";

// Gated on roster.manage, which only the bishopric holds. RLS refuses anyone else regardless
// (member_notes is in the bishopric-only policy loop in migration 019), so this check is
// belt-and-braces in the right direction: a non-bishopric caller gets a readable 403 instead
// of an empty list that looks like "this member has no notes".
const memberIdSchema = z.uuid("That member id is not valid.");

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const user = await requireSessionUser();

  try {
    assertCan(user, "roster.manage");

    const { id } = await params;
    const memberId = memberIdSchema.parse(id);

    const supabase = await createServerSupabaseClient();
    const notes = await listMemberNotes(user.wardId, memberId, supabase);

    return NextResponse.json({ notes });
  } catch (error) {
    return respondToRouteError(error, {
      route: "GET /api/members/[id]/notes",
      fallbackMessage: "Could not load the notes for that member. Please try again.",
      detail: { wardId: user.wardId, userId: user.id },
    });
  }
}

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const user = await requireSessionUser();

  try {
    assertCan(user, "roster.manage");

    const { id } = await params;
    const memberId = memberIdSchema.parse(id);
    const input = createMemberNoteSchema.parse(await readJsonBody(request));

    const supabase = await createServerSupabaseClient();
    const note = await createMemberNote(
      user.wardId,
      memberId,
      user.id,
      input.body,
      supabase,
    );

    // The member id and nothing else. writeAuditLog redacts any key matching /note/ and an
    // audit row is bishopric-readable, but neither is a reason to hand it the text.
    await writeAuditLog(
      {
        wardId: user.wardId,
        userId: user.id,
        action: "member_note_created",
        module: "roster",
        detail: { memberId },
      },
      supabase,
    );

    return NextResponse.json({ note }, { status: 201 });
  } catch (error) {
    return respondToRouteError(error, {
      route: "POST /api/members/[id]/notes",
      fallbackMessage: "Could not save the note. Please try again.",
      detail: { wardId: user.wardId, userId: user.id },
    });
  }
}
