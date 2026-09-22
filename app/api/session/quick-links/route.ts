import { NextResponse } from "next/server";
import { writeAuditLog } from "@/lib/audit/writeAuditLog";
import { readJsonBody, respondToRouteError } from "@/lib/auth/routeErrors";
import { requireSessionUser } from "@/lib/auth/session";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { readQuickLinks, writeQuickLinks } from "@/lib/users/userSettings";
import { quickLinksSchema } from "@/lib/validation/quickLinks";

// A person's pinned modules. GET lists them, PUT replaces the list — replace rather than
// add/remove, because the list is REORDERABLE and its order is meaning, so a partial update would
// need a second vocabulary for "move this one up" that the whole-list write already expresses.
//
// The session is resolved OUTSIDE the try block, as every route in this app does:
// requireSessionUser() redirects by THROWING an internal Next.js error, and catching that would
// turn a redirect into a 500.
//
// ---------------------------------------------------------------------------
// NO assertCan(), AND NO USER ID IN THE BODY
// ---------------------------------------------------------------------------
// A pin is a fact about how one person likes their own dashboard; there is no permission that
// could sensibly gate it, and a ward that could take it away would be configuring somebody's
// personal screen. The row written is always `auth.uid()`'s — `users_update_self` is the
// boundary (CLAUDE.md rule 2) and the body cannot name a user.
//
// ---------------------------------------------------------------------------
// IT WRITES AN AUDIT ROW, AND THE COUNTER-ARGUMENT IS RECORDED RATHER THAN SILENTLY TAKEN
// ---------------------------------------------------------------------------
// Rule 6 is stated absolutely — every mutation on a core table — and `users` is as core as it
// gets. One row per SAVE, never one per pin.
//
// The case against: `theme_preference` writes no audit row, on the ground that a personal display
// preference is not a ward act, and this is the same kind of thing. That argument was heard and
// rule 6 was followed anyway, because the rule's value is that it has no exceptions to remember.
// If the audit log turns out to be noisy in practice, change it HERE and say so — the point of
// writing this down is that the next person finds the reasoning rather than an unexplained line.

export async function GET() {
  const user = await requireSessionUser();

  try {
    const supabase = await createServerSupabaseClient();
    const quickLinks = await readQuickLinks(user.id, supabase);

    return NextResponse.json({ quickLinks });
  } catch (error) {
    return respondToRouteError(error, {
      route: "GET /api/session/quick-links",
      fallbackMessage: "Could not load your pinned links. Please try again.",
      detail: { wardId: user.wardId, userId: user.id },
    });
  }
}

export async function PUT(request: Request) {
  const user = await requireSessionUser();

  try {
    const supabase = await createServerSupabaseClient();
    const input = quickLinksSchema.parse(await readJsonBody(request));

    const quickLinks = await writeQuickLinks(user.id, input.quickLinks, supabase);

    await writeAuditLog(
      {
        wardId: user.wardId,
        userId: user.id,
        action: "quick_links_updated",
        module: "admin",
        detail: { quickLinks },
      },
      supabase,
    );

    return NextResponse.json({ quickLinks });
  } catch (error) {
    return respondToRouteError(error, {
      route: "PUT /api/session/quick-links",
      fallbackMessage: "Could not save your pinned links. Please try again.",
      detail: { wardId: user.wardId, userId: user.id },
    });
  }
}
