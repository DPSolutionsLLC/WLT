import { NextResponse } from "next/server";
import { writeAuditLog } from "@/lib/audit/writeAuditLog";
import { ForbiddenError } from "@/lib/auth/errors";
import { resolveRoleAccess } from "@/lib/auth/permissions";
import { readJsonBody, respondToRouteError } from "@/lib/auth/routeErrors";
import { requireSessionUser } from "@/lib/auth/session";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { createServiceSupabaseClient } from "@/lib/supabase/service";
import { remoteLinkPositionSchema, setRemoteLinkSchema } from "@/lib/validation/zoom";
import { canManageRemoteLinks } from "@/lib/zoom/access";
import { describeRemoteLinkRow } from "@/lib/zoom/remoteLinkRow";
import {
  isRemoteLinkRefusalError,
  listRemoteLinkAdminEntries,
  setRemoteLink,
  turnOffRemoteLink,
} from "@/lib/zoom/remoteLinks";
import type { RemoteLinkPosition } from "@/types/domain";

// PASTING, REPLACING AND TURNING OFF A STREAM REMOTE LINK (ITER-051).
//
// `zoom_remote_links` has a SELECT policy and NO write policy (migration 094), so every write here
// is the service role and canManageRemoteLinks() IS THE WRITE BOUNDARY. It can never be skipped.
//
// THE URL NEVER ENTERS AN AUDIT ROW OR A RESPONSE. The response row is the tab's status row, built
// by describeRemoteLinkRow(), which has no URL to give.

type RouteContext = { params: Promise<{ position: string }> };

async function readRow(wardId: string, position: RemoteLinkPosition) {
  const entries = await listRemoteLinkAdminEntries(wardId, createServiceSupabaseClient());
  const entry = entries.find((candidate) => candidate.position === position);
  if (!entry) throw new Error(`No entry was built for the ${position} position.`);
  return describeRemoteLinkRow(entry);
}

export async function PUT(request: Request, { params }: RouteContext) {
  const user = await requireSessionUser();

  try {
    const supabase = await createServerSupabaseClient();
    const roleAccess = await resolveRoleAccess(supabase, user.wardId, user.orgType);
    if (!canManageRemoteLinks(user, roleAccess)) {
      throw new ForbiddenError("zoom.manage_remote_links");
    }

    const position = remoteLinkPositionSchema.parse((await params).position);
    const { url } = setRemoteLinkSchema.parse(await readJsonBody(request));

    const result = await setRemoteLink(
      { wardId: user.wardId, position, url, actorUserId: user.id },
      createServiceSupabaseClient(),
    );

    await writeAuditLog(
      {
        wardId: user.wardId,
        userId: user.id,
        action: result.replaced ? "zoom_remote_link_replaced" : "zoom_remote_link_set",
        module: "zoom",
        detail: {
          position,
          holderUserId: result.holderUserId,
          previousHolderUserId: result.previousHolderUserId,
        },
      },
      supabase,
    );

    return NextResponse.json({ row: await readRow(user.wardId, position) });
  } catch (error) {
    if (isRemoteLinkRefusalError(error)) {
      return NextResponse.json({ error: error.message }, { status: 409 });
    }
    return respondToRouteError(error, {
      route: "PUT /api/zoom/remote-links/[position]",
      fallbackMessage: "Could not save the remote link. Please try again.",
      detail: { wardId: user.wardId, userId: user.id },
    });
  }
}

export async function DELETE(_request: Request, { params }: RouteContext) {
  const user = await requireSessionUser();

  try {
    const supabase = await createServerSupabaseClient();
    const roleAccess = await resolveRoleAccess(supabase, user.wardId, user.orgType);
    if (!canManageRemoteLinks(user, roleAccess)) {
      throw new ForbiddenError("zoom.manage_remote_links");
    }

    const position = remoteLinkPositionSchema.parse((await params).position);

    const result = await turnOffRemoteLink(
      { wardId: user.wardId, position, actorUserId: user.id },
      createServiceSupabaseClient(),
    );

    if (!result) {
      return NextResponse.json(
        { error: "There is no live link for that position." },
        { status: 404 },
      );
    }

    await writeAuditLog(
      {
        wardId: user.wardId,
        userId: user.id,
        action: "zoom_remote_link_turned_off",
        module: "zoom",
        detail: {
          position,
          reason: "turned_off",
          previousHolderUserId: result.previousHolderUserId,
        },
      },
      supabase,
    );

    return NextResponse.json({ row: await readRow(user.wardId, position) });
  } catch (error) {
    return respondToRouteError(error, {
      route: "DELETE /api/zoom/remote-links/[position]",
      fallbackMessage: "Could not turn off the remote link. Please try again.",
      detail: { wardId: user.wardId, userId: user.id },
    });
  }
}
