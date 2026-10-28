import { NextResponse } from "next/server";
import { assertCan, resolveRoleAccess } from "@/lib/auth/permissions";
import { respondToRouteError } from "@/lib/auth/routeErrors";
import { requireSessionUser } from "@/lib/auth/session";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { readOwnRemoteLinkUrl } from "@/lib/zoom/remoteLinks";

// OPENING THE READER'S OWN STREAM REMOTE (ITER-051). The Remote control button links here rather
// than to the URL itself, so the link never appears in the page's HTML. The read runs through the
// CALLER's client: migration 094's policy is what decides whether this person sees a link at all.
//
// No audit row: opening is a read, not a mutation.

const NO_STORE_HEADERS = {
  "Cache-Control": "no-store",
  "Referrer-Policy": "no-referrer",
};

export async function GET(request: Request) {
  const user = await requireSessionUser();

  try {
    const supabase = await createServerSupabaseClient();
    const roleAccess = await resolveRoleAccess(supabase, user.wardId, user.orgType);
    assertCan(user, "zoom.view", roleAccess);

    const url = await readOwnRemoteLinkUrl(supabase, user);
    const target = url ?? new URL("/zoom?remote=none", request.url).toString();

    const response = NextResponse.redirect(target, 303);
    for (const [name, value] of Object.entries(NO_STORE_HEADERS)) {
      response.headers.set(name, value);
    }
    return response;
  } catch (error) {
    return respondToRouteError(error, {
      route: "GET /api/zoom/remote-control",
      fallbackMessage: "Could not open your remote control. Please try again.",
      detail: { wardId: user.wardId, userId: user.id },
    });
  }
}
