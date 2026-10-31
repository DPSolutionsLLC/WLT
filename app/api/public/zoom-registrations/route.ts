import { NextResponse } from "next/server";
import { writeAuditLog } from "@/lib/audit/writeAuditLog";
import { readJsonBody, respondToRouteError } from "@/lib/auth/routeErrors";
import { resolveSiteUrl } from "@/lib/program/queries";
import { createServiceSupabaseClient } from "@/lib/supabase/service";
import { publicRegistrationSchema } from "@/lib/validation/zoomRegistration";
import {
  RegistrationBusyError,
  RegistrationClosedError,
  RegistrationFollowUpError,
  submitRegistration,
} from "@/lib/zoom/registrations";
import { statusPagePath, statusPageUrl } from "@/lib/zoom/registrationTokens";

// THE PUBLIC ZOOM SIGN-UP (ITER-052, plan P5) — the only write a member of the public can make.
//
// There is no session. `zoom_registrations` has no write policy, so this route IS the boundary: it
// validates, applies the honeypot and the caps (P7), resolves the slug to its ward itself, and
// writes with the service role. It is a route handler rather than an RPC granted to anon, because
// an anon RPC could be called directly with the public anon key and skip every limit here.
//
// NEVER LOG THE BODY. The audit row carries ids and booleans only — no name, phone, email, answer,
// token or referral code — and `user_id` is null: a member of the public did this.

export const dynamic = "force-dynamic";

const THANKS = "Thanks — your request has been sent.";

export async function POST(request: Request) {
  const service = createServiceSupabaseClient();

  try {
    const input = publicRegistrationSchema.parse(await readJsonBody(request));

    let result;
    try {
      result = await submitRegistration(input, service);
    } catch (error) {
      if (error instanceof RegistrationFollowUpError) {
        // Logged in full (rule 7) and audited, because the insert happened. The person still gets
        // their status page: it says truthfully "waiting" or "your link is on its way", and the
        // request is on the bishopric's Sign-ups tab either way.
        console.error("A Zoom sign-up was saved but finishing it failed", {
          wardId: error.wardId,
          registrationId: error.registrationId,
          approved: error.approved,
          cause: error.cause instanceof Error ? error.cause.message : String(error.cause),
        });
        await writeAuditLog(
          {
            wardId: error.wardId,
            userId: null,
            action: "zoom_registration_submitted",
            module: "zoom",
            detail: {
              registrationId: error.registrationId,
              saysMember: input.saysMember,
              autoApproved: error.approved,
              finishFailed: true,
              referred: input.ref !== null,
            },
          },
          service,
        );
        return NextResponse.json(
          { statusUrl: statusUrlFor(error.slug, error.token), message: THANKS },
          { status: 201 },
        );
      }
      throw error;
    }

    if (result.kind === "ignored") {
      return NextResponse.json({ statusUrl: null, message: THANKS }, { status: 201 });
    }

    await writeAuditLog(
      {
        wardId: result.wardId,
        userId: null,
        action: "zoom_registration_submitted",
        module: "zoom",
        detail: {
          registrationId: result.registrationId,
          saysMember: input.saysMember,
          autoApproved: result.status === "approved",
          heldReason: result.heldReason,
          linkGiven: result.linkGiven,
          waitingTodoIds: result.waitingTodoIds,
          matchTodoIds: result.matchTodoIds,
          referred: result.referred,
        },
      },
      service,
    );

    return NextResponse.json(
      { statusUrl: statusUrlFor(result.slug, result.token), message: THANKS },
      { status: 201 },
    );
  } catch (error) {
    if (error instanceof RegistrationClosedError) {
      return NextResponse.json({ error: error.message }, { status: 404 });
    }
    if (error instanceof RegistrationBusyError) {
      return NextResponse.json({ error: error.message }, { status: 429 });
    }
    return respondToRouteError(error, {
      route: "POST /api/public/zoom-registrations",
      fallbackMessage: "Your request couldn't be sent. Please try again.",
    });
  }
}

// A relative path when no site URL is configured: the status page is same-origin, so the browser
// navigates to it just the same.
function statusUrlFor(slug: string, token: string): string {
  return statusPageUrl(resolveSiteUrl(), slug, token) ?? statusPagePath(slug, token);
}
