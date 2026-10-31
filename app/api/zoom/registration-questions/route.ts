import { NextResponse } from "next/server";
import { writeAuditLog } from "@/lib/audit/writeAuditLog";
import { ForbiddenError } from "@/lib/auth/errors";
import { resolveRoleAccess } from "@/lib/auth/permissions";
import { readJsonBody, respondToRouteError } from "@/lib/auth/routeErrors";
import { requireSessionUser } from "@/lib/auth/session";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { createServiceSupabaseClient } from "@/lib/supabase/service";
import { createQuestionSchema } from "@/lib/validation/zoomRegistration";
import { canManageRegistrationQuestions } from "@/lib/zoom/access";
import { addQuestion } from "@/lib/zoom/registrationQuestions";
import { readRegistrationSettings, revalidateSignUpPage } from "@/lib/zoom/registrationSettings";

// ADDING A QUESTION TO THE ZOOM SIGN-UP PAGE (ITER-052). The bishopric, the ward clerk and the
// executive secretary (canManageRegistrationQuestions(), the write boundary — the table has no
// write policy). The audit row carries the question's id, never its wording.

export async function POST(request: Request) {
  const user = await requireSessionUser();

  try {
    const supabase = await createServerSupabaseClient();
    const roleAccess = await resolveRoleAccess(supabase, user.wardId, user.orgType);
    if (!canManageRegistrationQuestions(user, roleAccess)) {
      throw new ForbiddenError("zoom.manage_registration_questions");
    }

    const input = createQuestionSchema.parse(await readJsonBody(request));
    const service = createServiceSupabaseClient();

    const question = await addQuestion({ wardId: user.wardId, actorUserId: user.id, input }, service);

    await writeAuditLog(
      {
        wardId: user.wardId,
        userId: user.id,
        action: "zoom_registration_question_added",
        module: "zoom",
        detail: { questionId: question.id, kind: question.kind, audience: question.audience },
      },
      supabase,
    );

    const settings = await readRegistrationSettings(user.wardId, service);
    if (settings) revalidateSignUpPage(settings.slug, { wardId: user.wardId });

    return NextResponse.json({ question }, { status: 201 });
  } catch (error) {
    return respondToRouteError(error, {
      route: "POST /api/zoom/registration-questions",
      fallbackMessage: "Could not add the question. Please try again.",
      detail: { wardId: user.wardId, userId: user.id },
    });
  }
}
