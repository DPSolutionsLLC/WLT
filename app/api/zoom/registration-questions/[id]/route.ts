import { NextResponse } from "next/server";
import { writeAuditLog } from "@/lib/audit/writeAuditLog";
import { ForbiddenError } from "@/lib/auth/errors";
import { resolveRoleAccess } from "@/lib/auth/permissions";
import { readJsonBody, respondToRouteError } from "@/lib/auth/routeErrors";
import { requireSessionUser } from "@/lib/auth/session";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { createServiceSupabaseClient } from "@/lib/supabase/service";
import { questionIdSchema, updateQuestionSchema } from "@/lib/validation/zoomRegistration";
import { canManageRegistrationQuestions } from "@/lib/zoom/access";
import { updateQuestion } from "@/lib/zoom/registrationQuestions";
import { readRegistrationSettings, revalidateSignUpPage } from "@/lib/zoom/registrationSettings";

// EDITING, TURNING OFF/ON OR MOVING A SIGN-UP QUESTION (ITER-052). There is no DELETE anywhere: a
// question is turned off, never destroyed (P8). Its kind cannot change. The audit row names the
// changed FIELDS only, never the wording.

type RouteContext = { params: Promise<{ id: string }> };

export async function PATCH(request: Request, { params }: RouteContext) {
  const user = await requireSessionUser();

  try {
    const supabase = await createServerSupabaseClient();
    const roleAccess = await resolveRoleAccess(supabase, user.wardId, user.orgType);
    if (!canManageRegistrationQuestions(user, roleAccess)) {
      throw new ForbiddenError("zoom.manage_registration_questions");
    }

    const questionId = questionIdSchema.parse((await params).id);
    const input = updateQuestionSchema.parse(await readJsonBody(request));
    const service = createServiceSupabaseClient();

    const result = await updateQuestion({ wardId: user.wardId, questionId, input }, service);
    if (!result) {
      return NextResponse.json({ error: "That question is not one this page knows about." }, { status: 404 });
    }

    if (result.changedFields.length > 0) {
      await writeAuditLog(
        {
          wardId: user.wardId,
          userId: user.id,
          action: "zoom_registration_question_changed",
          module: "zoom",
          detail: { questionId, changedFields: result.changedFields },
        },
        supabase,
      );

      const settings = await readRegistrationSettings(user.wardId, service);
      if (settings) revalidateSignUpPage(settings.slug, { wardId: user.wardId });
    }

    return NextResponse.json({ question: result.question });
  } catch (error) {
    return respondToRouteError(error, {
      route: "PATCH /api/zoom/registration-questions/[id]",
      fallbackMessage: "Could not save the question. Please try again.",
      detail: { wardId: user.wardId, userId: user.id },
    });
  }
}
