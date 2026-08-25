import { NextResponse } from "next/server";
import { writeAuditLog } from "@/lib/audit/writeAuditLog";
import { assertCan, resolveRoleAccess } from "@/lib/auth/permissions";
import { readJsonBody, respondToRouteError } from "@/lib/auth/routeErrors";
import { requireSessionUser } from "@/lib/auth/session";
import {
  getProgram,
  recordProgramApproval,
  setProgramStatus,
} from "@/lib/program/queries";
import { emitNotification } from "@/lib/notifications/emitNotification";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { approveProgramSchema, programIdSchema } from "@/lib/validation/program";
import { PROGRAM_STATUS_LABELS } from "@/types/domain";

// One bishopric member signs off a sacrament program.
//
// ---------------------------------------------------------------------------------------------
// ONE APPROVAL, NOT THREE
// ---------------------------------------------------------------------------------------------
// Unlike a talk assignment, a program needs ONE bishopric approval. The 3-of-3 gate on an
// assignment exists because a speaking assignment is a shared decision about a PERSON — who is
// asked, and when. A program is a document, and a document is signed off by whoever is
// responsible for the meeting. Do not copy countApprovalsFor() here.
//
// There is also no assignment_approvals equivalent to write to: the decision IS the status move
// plus the approved_by / approved_at stamps, recorded atomically by recordProgramApproval().

const NOT_FOUND = "That program is not in your ward.";

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const user = await requireSessionUser();

  try {
    const { id } = await params;
    const programId = programIdSchema.parse(id);
    const input = approveProgramSchema.parse(await readJsonBody(request));

    const supabase = await createServerSupabaseClient();
    const roleAccess = await resolveRoleAccess(supabase, user.wardId);

    // Held only by bishop and counselor. A ward_secretary can build, refresh and view a program
    // alone, and is stopped exactly here.
    assertCan(user, "program.approve", roleAccess);

    const program = await getProgram(user.wardId, programId, supabase);
    if (!program) {
      return NextResponse.json({ error: NOT_FOUND }, { status: 404 });
    }

    // The sentence says where the program ACTUALLY is, not just that the request was refused —
    // somebody looking at a stale screen needs to know what happened, not that they were wrong.
    if (program.status !== "pending_approval") {
      return NextResponse.json(
        {
          error: `That program is ${PROGRAM_STATUS_LABELS[program.status].toLowerCase()}, not waiting for approval. Reload to see where it is now.`,
        },
        { status: 409 },
      );
    }

    const sundayDate = program.draft?.date ?? "an upcoming Sunday";

    // A change request: send it back to draft, carrying the comment that says what to change —
    // the same shape as the assignment change-request path.
    if (!input.approved) {
      const reverted = await setProgramStatus(
        user.wardId,
        programId,
        "pending_approval",
        "draft",
        supabase,
      );

      if (!reverted) {
        return NextResponse.json(
          {
            error:
              "Somebody else changed this program a moment ago. Reload to see where it is now.",
          },
          { status: 409 },
        );
      }

      await writeAuditLog(
        {
          wardId: user.wardId,
          userId: user.id,
          action: "program_changes_requested",
          module: "program",
          detail: {
            programId,
            sundayId: reverted.sundayId,
            revertedTo: "draft",
          },
        },
        supabase,
      );

      await emitNotification({
        wardId: user.wardId,
        triggerKey: "program_changes_requested",
        title: "A sacrament program needs changes",
        body: `The program for ${sundayDate} was sent back to draft. Open it to read what needs changing: ${input.comment}`,
      });

      return NextResponse.json({ program: reverted, approved: false });
    }

    const approved = await recordProgramApproval(user.wardId, programId, user.id, supabase);

    // Zero rows means somebody else approved it between the read and the write. The
    // expected-status filter in the UPDATE is what makes a double approval impossible without a
    // lock, and this is what that looks like from here.
    if (!approved) {
      return NextResponse.json(
        {
          error:
            "Somebody else has already approved this program. Reload to see where it is now.",
        },
        { status: 409 },
      );
    }

    await writeAuditLog(
      {
        wardId: user.wardId,
        userId: user.id,
        action: "program_approved",
        module: "program",
        detail: {
          programId,
          sundayId: approved.sundayId,
          missingCount: approved.draft?.missing.length ?? null,
        },
      },
      supabase,
    );

    await emitNotification({
      wardId: user.wardId,
      triggerKey: "program_approved",
      title: "A sacrament program was approved",
      body: `The program for ${sundayDate} has been approved and is ready to distribute.`,
    });

    return NextResponse.json({ program: approved, approved: true });
  } catch (error) {
    return respondToRouteError(error, {
      route: "POST /api/programs/[id]/approve",
      fallbackMessage: "Could not record that decision. Please try again.",
      detail: { wardId: user.wardId, userId: user.id },
    });
  }
}
