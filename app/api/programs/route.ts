import { NextResponse } from "next/server";
import { writeAuditLog } from "@/lib/audit/writeAuditLog";
import { assertCan, resolveRoleAccess } from "@/lib/auth/permissions";
import { readJsonBody, respondToRouteError } from "@/lib/auth/routeErrors";
import { requireSessionUser } from "@/lib/auth/session";
import { assembleDraft } from "@/lib/program/assembleDraft";
import type { ProgramDraft } from "@/lib/program/draft";
import { gatherProgramSources } from "@/lib/program/gather";
import {
  getProgram,
  getProgramBySunday,
  isLegalProgramTransition,
  setProgramStatus,
  upsertProgramDraft,
  type Program,
} from "@/lib/program/queries";
import { emitNotification } from "@/lib/notifications/emitNotification";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { programRequestSchema } from "@/lib/validation/program";
import {
  PROGRAM_STATUS_LABELS,
  holdsSacramentMeeting,
  type ProgramStatus,
} from "@/types/domain";

// Build a program draft, save an edited one, or move it between the two statuses a builder owns.
//
// THREE ACTIONS, MUTUALLY EXCLUSIVE BY SHAPE (see programRequestSchema). Saving an edit cannot
// submit it for approval and submitting cannot rewrite what is being submitted — the same
// separation updateAssignmentSchema enforces, for the same reason.
//
// Approving is NOT here. It is a bishopric decision behind program.approve on its own route.

const SUNDAY_NOT_FOUND = "That Sunday is not in your ward.";
const PROGRAM_NOT_FOUND = "That program is not in your ward.";

// An approved or distributed program is not edited by saving over it. Reopening it is a decision
// — once a PDF has been emailed the paper in somebody's inbox stops matching the app — so the
// sentence names the action rather than only refusing.
function lockedResponse(status: ProgramStatus): NextResponse {
  return NextResponse.json(
    {
      error: `This program is ${PROGRAM_STATUS_LABELS[status].toLowerCase()}. Reopen it as a draft before changing it.`,
    },
    { status: 409 },
  );
}

function isLocked(status: ProgramStatus): boolean {
  return status === "approved" || status === "distributed";
}

export async function POST(request: Request) {
  const user = await requireSessionUser();

  try {
    const input = programRequestSchema.parse(await readJsonBody(request));

    const supabase = await createServerSupabaseClient();
    const roleAccess = await resolveRoleAccess(supabase, user.wardId);

    assertCan(user, "program.build", roleAccess);

    if (input.action === "status") {
      const program = await getProgram(user.wardId, input.programId, supabase);
      if (!program) {
        return NextResponse.json({ error: PROGRAM_NOT_FOUND }, { status: 404 });
      }

      if (program.status === input.to) {
        return NextResponse.json({ program });
      }

      // Checked BEFORE the write, so an illegal pair is a 409 the caller can read rather than the
      // exception setProgramStatus throws for a caller bug.
      if (!isLegalProgramTransition(program.status, input.to)) {
        return NextResponse.json(
          {
            error: `A program that is ${PROGRAM_STATUS_LABELS[program.status].toLowerCase()} cannot be moved to ${PROGRAM_STATUS_LABELS[input.to].toLowerCase()}. Reload to see where it is now.`,
          },
          { status: 409 },
        );
      }

      const moved = await setProgramStatus(
        user.wardId,
        program.id,
        program.status,
        input.to,
        supabase,
      );

      // Zero rows means somebody else moved it between the read and the write.
      if (!moved) {
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
          action: "program_status_changed",
          module: "program",
          detail: {
            programId: moved.id,
            sundayId: moved.sundayId,
            from: program.status,
            to: moved.status,
          },
        },
        supabase,
      );

      if (moved.status === "pending_approval") {
        await emitNotification({
          wardId: user.wardId,
          triggerKey: "program_pending_approval",
          title: "A sacrament program needs approval",
          body: `The program for ${moved.draft?.date ?? "an upcoming Sunday"} is waiting for a member of the bishopric to approve it.`,
        });
      }

      return NextResponse.json({ program: moved });
    }

    if (input.action === "save") {
      const existing = await getProgram(user.wardId, input.programId, supabase);
      if (!existing) {
        return NextResponse.json({ error: PROGRAM_NOT_FOUND }, { status: 404 });
      }

      if (isLocked(existing.status)) {
        return lockedResponse(existing.status);
      }

      // A program row whose sunday_id is null cannot be re-keyed by this route: upsert is keyed
      // by Sunday, and inventing one here would attach a program to a meeting nobody chose.
      if (existing.sundayId === null) {
        return NextResponse.json(
          { error: "That program is not attached to a Sunday and cannot be saved." },
          { status: 409 },
        );
      }

      const saved = await upsertProgramDraft(
        user.wardId,
        existing.sundayId,
        input.draft,
        user.id,
        supabase,
      );

      if (!saved) {
        return NextResponse.json({ error: PROGRAM_NOT_FOUND }, { status: 404 });
      }

      await auditDraftWrite(user, saved, input.draft, "program_draft_updated", supabase);

      return NextResponse.json({ program: saved });
    }

    const existing = await getProgramBySunday(user.wardId, input.sundayId, supabase);

    if (existing && isLocked(existing.status)) {
      return lockedResponse(existing.status);
    }

    const sources = await gatherProgramSources(user.wardId, input.sundayId, supabase);
    if (!sources) {
      return NextResponse.json({ error: SUNDAY_NOT_FOUND }, { status: 404 });
    }

    // 422 rather than a draft with everything missing. There is no program for a meeting that is
    // not held — migration 027's CHECK already makes a conductor on such a Sunday unrepresentable,
    // and this is the same rule one layer up.
    if (!holdsSacramentMeeting(sources.sunday.type)) {
      return NextResponse.json(
        {
          error: `There is no sacrament meeting on ${sources.sunday.date}, so there is no program to build.`,
        },
        { status: 422 },
      );
    }

    // A draft in the body is stored AS GIVEN; without one, it is assembled from current data.
    const draft = input.draft ?? assembleDraft(sources);

    const saved = await upsertProgramDraft(
      user.wardId,
      input.sundayId,
      draft,
      user.id,
      supabase,
    );

    if (!saved) {
      return NextResponse.json({ error: SUNDAY_NOT_FOUND }, { status: 404 });
    }

    await auditDraftWrite(
      user,
      saved,
      draft,
      existing ? "program_draft_updated" : "program_draft_created",
      supabase,
    );

    return NextResponse.json({ program: saved }, { status: existing ? 200 : 201 });
  } catch (error) {
    return respondToRouteError(error, {
      route: "POST /api/programs",
      fallbackMessage: "Could not build that program. Please try again.",
      detail: { wardId: user.wardId, userId: user.id },
    });
  }
}

// `missingCount` rather than the list itself: the audit log records who did what, and a bishop
// reading it wants to know a program was built with three gaps, not to re-read the gaps.
async function auditDraftWrite(
  user: { id: string; wardId: string },
  program: Program,
  draft: ProgramDraft,
  action: string,
  supabase: Awaited<ReturnType<typeof createServerSupabaseClient>>,
): Promise<void> {
  await writeAuditLog(
    {
      wardId: user.wardId,
      userId: user.id,
      action,
      module: "program",
      detail: {
        programId: program.id,
        sundayId: program.sundayId,
        missingCount: draft.missing.length,
      },
    },
    supabase,
  );
}
