import { NextResponse } from "next/server";
import { assertCan, resolveRoleAccess } from "@/lib/auth/permissions";
import { respondToRouteError } from "@/lib/auth/routeErrors";
import { requireSessionUser } from "@/lib/auth/session";
import { listDocuments } from "@/lib/knowledge/queries";
import { createServerSupabaseClient } from "@/lib/supabase/server";

// The session is resolved OUTSIDE the try: requireSessionUser() redirects by throwing an internal
// Next.js error, and catching that would turn a redirect into a 500.

export async function GET() {
  const user = await requireSessionUser();

  try {
    const supabase = await createServerSupabaseClient();
    const roleAccess = await resolveRoleAccess(supabase, user.wardId);

    assertCan(user, "knowledge.view", roleAccess);

    // Newest first, each with BOTH counts. An empty array is a legitimate answer — a ward that
    // has not uploaded anything yet — and the page has an empty state for it rather than
    // treating it as a failure.
    const documents = await listDocuments(user.wardId, supabase);

    return NextResponse.json({ documents });
  } catch (error) {
    return respondToRouteError(error, {
      route: "GET /api/knowledge/documents",
      fallbackMessage: "Could not load the knowledge base. Please try again.",
      detail: { wardId: user.wardId, userId: user.id },
    });
  }
}
