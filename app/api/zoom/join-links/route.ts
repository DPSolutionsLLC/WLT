import { NextResponse } from "next/server";
import { writeAuditLog } from "@/lib/audit/writeAuditLog";
import { ForbiddenError } from "@/lib/auth/errors";
import { resolveRoleAccess } from "@/lib/auth/permissions";
import { readJsonBody, respondToRouteError } from "@/lib/auth/routeErrors";
import { requireSessionUser } from "@/lib/auth/session";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { createServiceSupabaseClient } from "@/lib/supabase/service";
import { joinLinkPasteSchema } from "@/lib/validation/zoom";
import { canManageInvitees } from "@/lib/zoom/access";
import { parseJoinLinkPaste } from "@/lib/zoom/joinLinkPaste";
import { addJoinLinks, countWaitingInvitees, listPool } from "@/lib/zoom/joinLinkPool";

// THE ZOOM JOIN-LINK POOL (ITER-053).
//
// Neither pool table has a write policy (migration 095), so canManageInvitees() IS THE WRITE
// BOUNDARY and the writes are the service role. THE URL NEVER ENTERS A RESPONSE OR AN AUDIT ROW:
// the preview returns each line's number, name and email, and the add result carries counts.

async function requireManager() {
  const user = await requireSessionUser();
  const supabase = await createServerSupabaseClient();
  const roleAccess = await resolveRoleAccess(supabase, user.wardId, user.orgType);
  return { user, supabase, allowed: canManageInvitees(user, roleAccess) };
}

export async function GET() {
  const { user, supabase, allowed } = await requireManager();

  try {
    if (!allowed) throw new ForbiddenError("zoom.manage_invitees");
    return NextResponse.json({ pool: await listPool(supabase) });
  } catch (error) {
    return respondToRouteError(error, {
      route: "GET /api/zoom/join-links",
      fallbackMessage: "Could not read the Zoom link pool. Please try again.",
      detail: { wardId: user.wardId, userId: user.id },
    });
  }
}

export async function POST(request: Request) {
  const { user, supabase, allowed } = await requireManager();

  try {
    if (!allowed) throw new ForbiddenError("zoom.manage_invitees");

    const { text, apply } = joinLinkPasteSchema.parse(await readJsonBody(request));
    const { lines, problems } = parseJoinLinkPaste(text);

    if (!apply) {
      return NextResponse.json({
        lines: lines.map(({ lineNumber, placeholderName, placeholderEmail }) => ({
          lineNumber,
          placeholderName,
          placeholderEmail,
        })),
        problems,
      });
    }

    if (problems.length > 0) {
      return NextResponse.json(
        {
          error:
            problems.length === 1
              ? `Line ${problems[0].lineNumber} needs fixing before anything is added: ${problems[0].message}`
              : `${problems.length} lines need fixing before anything is added.`,
          problems,
        },
        { status: 400 },
      );
    }

    if (lines.length === 0) {
      return NextResponse.json({ error: "Paste at least one link." }, { status: 400 });
    }

    const service = createServiceSupabaseClient();
    const result = await addJoinLinks(
      { wardId: user.wardId, actorUserId: user.id, links: lines },
      service,
    );

    await writeAuditLog(
      {
        wardId: user.wardId,
        userId: user.id,
        action: "zoom_join_links_added",
        module: "zoom",
        detail: {
          addedCount: result.addedIds.length,
          alreadyInPoolCount: result.alreadyInPool.length,
        },
      },
      supabase,
    );

    return NextResponse.json({
      addedCount: result.addedIds.length,
      alreadyInPool: result.alreadyInPool,
      waitingCount: await countWaitingInvitees(user.wardId, service),
    });
  } catch (error) {
    return respondToRouteError(error, {
      route: "POST /api/zoom/join-links",
      fallbackMessage: "Could not add the Zoom links. Please try again.",
      detail: { wardId: user.wardId, userId: user.id },
    });
  }
}
