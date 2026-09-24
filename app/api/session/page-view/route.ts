import { NextResponse } from "next/server";
import { writeAuditLog } from "@/lib/audit/writeAuditLog";
import { readJsonBody, respondToRouteError } from "@/lib/auth/routeErrors";
import { requireSessionUser } from "@/lib/auth/session";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { writePageView } from "@/lib/users/userSettings";
import { pageViewSchema } from "@/lib/validation/pageView";

// Remember how a person left a page (the user's standing rule, 2026-09-24). PUT only: the page
// reads its saved view on the server, as it renders, so it opens right on first paint.
//
// NO assertCan() AND NO USER ID IN THE BODY — the quick-links route's reasoning, unchanged. A view
// is a fact about one person's own screen, and `users_update_self` is the boundary (rule 2).
//
// ONE AUDIT ROW PER SAVE, following rule 6 and the quick-links precedent. The page waits for a
// pause before saving, so a run of clicks is one save and one row, not one per click. If the log
// proves noisy anyway, change it HERE and say so, as the quick-links route asks.

export async function PUT(request: Request) {
  const user = await requireSessionUser();

  try {
    const supabase = await createServerSupabaseClient();
    const input = pageViewSchema.parse(await readJsonBody(request));

    await writePageView(user.id, input.page, input.view, supabase);

    await writeAuditLog(
      {
        wardId: user.wardId,
        userId: user.id,
        action: "page_view_saved",
        module: "admin",
        detail: { page: input.page },
      },
      supabase,
    );

    return NextResponse.json({ ok: true });
  } catch (error) {
    return respondToRouteError(error, {
      route: "PUT /api/session/page-view",
      fallbackMessage: "Could not remember how you left this page. Please try again.",
      detail: { wardId: user.wardId, userId: user.id },
    });
  }
}
