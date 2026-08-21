import { NextResponse } from "next/server";
import {
  countApprovalsFor,
  createAssignment,
  listAssignments,
} from "@/lib/assignments/queries";
import { writeAuditLog } from "@/lib/audit/writeAuditLog";
import { assertCan, resolveRoleAccess } from "@/lib/auth/permissions";
import { readJsonBody, respondToRouteError } from "@/lib/auth/routeErrors";
import { requireSessionUser } from "@/lib/auth/session";
import { getSunday } from "@/lib/calendar/queries";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import {
  createAssignmentSchema,
  listAssignmentsQuerySchema,
} from "@/lib/validation/assignment";

// The session is resolved OUTSIDE the try block: requireSessionUser() redirects by throwing an
// internal Next.js error, and catching that would turn a redirect into a 500
// (lib/auth/routeErrors.ts says so at the call site).

const NOT_IN_WARD = "That Sunday is not on your ward's calendar.";

// The parameter names are `sundayId`, or `from` and `to` together. They are read here EXACTLY as
// talks-b will send them — a client sending a name this handler does not read gets no error, just
// a silently ignored filter (plans/retros/roster-b-picker-and-orgs.md, where the members route
// reads `status` and a client sent `statuses`).
export async function GET(request: Request) {
  const user = await requireSessionUser();

  try {
    const supabase = await createServerSupabaseClient();
    const roleAccess = await resolveRoleAccess(supabase, user.wardId);

    assertCan(user, "talks.view", roleAccess);

    const searchParams = new URL(request.url).searchParams;
    const sundayId = searchParams.get("sundayId");

    const filter = listAssignmentsQuerySchema.parse(
      sundayId !== null
        ? { sundayId }
        : {
            from: searchParams.get("from") ?? undefined,
            to: searchParams.get("to") ?? undefined,
          },
    );

    const assignments = await listAssignments(user.wardId, filter, supabase);

    // The approval COUNT, never the approvals themselves — one query for the whole month, not
    // one per card.
    const counts = await countApprovalsFor(
      user.wardId,
      assignments.map((assignment) => assignment.id),
      supabase,
    );

    const approvalCounts = assignments.map((assignment) => ({
      assignmentId: assignment.id,
      approvedCount: counts.get(assignment.id) ?? 0,
    }));

    return NextResponse.json({ assignments, approvalCounts });
  } catch (error) {
    return respondToRouteError(error, {
      route: "GET /api/assignments",
      fallbackMessage: "Could not load the speaking assignments. Please try again.",
      detail: { wardId: user.wardId, userId: user.id },
    });
  }
}

// assertCan runs BEFORE the body is parsed, so an unauthorized caller is refused rather than
// handed a validation message that describes the route's shape.
//
// Every refusal below is a 409 rather than a 400: the request was well formed, the calendar
// simply does not have room for it.
export async function POST(request: Request) {
  const user = await requireSessionUser();

  try {
    const supabase = await createServerSupabaseClient();
    const roleAccess = await resolveRoleAccess(supabase, user.wardId);

    assertCan(user, "talks.plan", roleAccess);

    const input = createAssignmentSchema.parse(await readJsonBody(request));

    const sunday = await getSunday(user.wardId, input.sundayId, supabase);
    if (!sunday) {
      return NextResponse.json({ error: NOT_IN_WARD }, { status: 404 });
    }

    // Keyed off speakingSlots, NOT off SundayType. A Sunday with no meeting already carries
    // speaking_slots = 0 from generateSundays.ts, so this one check covers stake conference,
    // general conference, a holiday, and a standard Sunday somebody deliberately set to zero —
    // without this route having to know what any of those mean.
    if (sunday.speakingSlots === 0) {
      return NextResponse.json(
        {
          error:
            "That Sunday has no speaking slots. Set its speaking slots on the calendar first.",
        },
        { status: 409 },
      );
    }

    if (input.slotNumber > sunday.speakingSlots) {
      return NextResponse.json(
        {
          error: `${sunday.date} has ${sunday.speakingSlots} speaking ${
            sunday.speakingSlots === 1 ? "slot" : "slots"
          }, so there is no slot ${input.slotNumber}.`,
        },
        { status: 409 },
      );
    }

    const existing = await listAssignments(
      user.wardId,
      { sundayId: input.sundayId },
      supabase,
    );

    if (existing.some((assignment) => assignment.slotNumber === input.slotNumber)) {
      return NextResponse.json(
        {
          error: `Slot ${input.slotNumber} on ${sunday.date} is already taken. Edit that assignment or choose another slot.`,
        },
        { status: 409 },
      );
    }

    const assignment = await createAssignment(user.wardId, input, user.id, supabase);

    await writeAuditLog(
      {
        wardId: user.wardId,
        userId: user.id,
        action: "assignment_created",
        module: "talks",
        detail: {
          assignmentId: assignment.id,
          sundayId: assignment.sundayId,
          date: sunday.date,
          slotNumber: assignment.slotNumber,
          assignmentType: assignment.assignmentType,
          speakerKind: assignment.memberId
            ? "member"
            : assignment.externalSpeakerName
              ? "external"
              : "empty",
        },
      },
      supabase,
    );

    return NextResponse.json({ assignment }, { status: 201 });
  } catch (error) {
    return respondToRouteError(error, {
      route: "POST /api/assignments",
      fallbackMessage: "Could not create that assignment. Please try again.",
      detail: { wardId: user.wardId, userId: user.id },
    });
  }
}
