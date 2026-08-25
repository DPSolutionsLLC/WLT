import { NextResponse } from "next/server";
import { respondToRouteError } from "@/lib/auth/routeErrors";
import { requireSessionUser } from "@/lib/auth/session";
import { searchHymns } from "@/lib/music/queries";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { searchHymnsQuerySchema } from "@/lib/validation/music";

// Hymn search.
//
// AUTHENTICATED, BUT BEHIND NO SPECIFIC PERMISSION. The hymnbook is a reference table with no
// ward_id (migration 006) and no ward's data in it — the same 341 numbers are printed in every
// chapel. Gating it behind music.view would stop a ward secretary filling in a hymn on the
// program builder, which is a thing they are explicitly allowed to do.
//
// What IS gated is writing a selection, which is POST /api/hymns/select and asserts music.manage.
//
// The session is resolved OUTSIDE the try block: requireSessionUser() redirects by throwing an
// internal Next.js error, and catching that would turn a redirect into a 500.

export async function GET(request: Request) {
  const user = await requireSessionUser();

  try {
    const supabase = await createServerSupabaseClient();
    const searchParams = new URL(request.url).searchParams;

    // Read here EXACTLY as HymnSearchModal sends them. A client sending a name this handler does
    // not read gets no error, just a silently ignored filter
    // (plans/retros/roster-b-picker-and-orgs.md).
    const query = searchHymnsQuerySchema.parse({
      query: searchParams.get("query") ?? undefined,
      limit: searchParams.get("limit") ?? undefined,
    });

    const hymns = await searchHymns(query.query, { limit: query.limit }, supabase);

    return NextResponse.json({ hymns });
  } catch (error) {
    return respondToRouteError(error, {
      route: "GET /api/hymns",
      fallbackMessage: "Could not search the hymnbook. Please try again.",
      detail: { wardId: user.wardId, userId: user.id },
    });
  }
}
