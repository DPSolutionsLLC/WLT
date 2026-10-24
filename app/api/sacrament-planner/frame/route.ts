import { readFile } from "node:fs/promises";
import path from "node:path";
import { resolveRoleAccess } from "@/lib/auth/permissions";
import { respondToRouteError } from "@/lib/auth/routeErrors";
import { requireSessionUser } from "@/lib/auth/session";
import { readWardRoster } from "@/lib/roster/wardRoster";
import { canUsePlanner } from "@/lib/sacramentPlanner/access";
import { assemblePlannerHtml } from "@/lib/sacramentPlanner/assemblePlannerHtml";
import { readPlannerHistory } from "@/lib/sacramentPlanner/queries";
import { toPlannerWardList } from "@/lib/sacramentPlanner/wardList";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { wardDateOnly } from "@/lib/ward/wardDate";
import { readWardTimezone } from "@/lib/ward/wardTimezone";

// The Sacrament Planner's page, assembled per request (ITER-045). It carries the ward's member
// list and agenda history — names, phones, ages — so it is never a static file, never cached, and
// only ever framed by this app.
//
// canUsePlanner() covers the released-module check too: `planner.use` belongs to the sacrament
// module, so can() refuses it in a ward where Sacrament is not released.

const ASSETS_DIRECTORY = path.join(process.cwd(), "lib", "sacramentPlanner", "assets");

const PRIVATE_HEADERS = {
  "Content-Type": "text/html; charset=utf-8",
  "Cache-Control": "private, no-store",
  "X-Frame-Options": "SAMEORIGIN",
  "Content-Security-Policy": "frame-ancestors 'self'",
};

// The PostgREST read cap. The ward has about 350 people; a list that hit the cap would silently
// drop everyone past it, so it is refused instead.
const ROSTER_READ_CAP = 1000;

function refusal(): Response {
  return new Response(
    "<!doctype html><meta charset=\"utf-8\"><p>The Sacrament Planner is only open to the bishopric.</p>",
    { status: 403, headers: PRIVATE_HEADERS },
  );
}

async function readAsset(name: string): Promise<string> {
  return readFile(path.join(ASSETS_DIRECTORY, name), "utf8");
}

export async function GET() {
  const user = await requireSessionUser();

  try {
    const supabase = await createServerSupabaseClient();
    const roleAccess = await resolveRoleAccess(supabase, user.wardId, user.orgType);

    if (!canUsePlanner(user, roleAccess)) return refusal();

    const [head, css, body, timeZone, roster, history] = await Promise.all([
      readAsset("head.html"),
      readAsset("extra.css"),
      readAsset("body.html"),
      readWardTimezone(user.wardId, supabase),
      readWardRoster(user.wardId, { statuses: ["active", "do_not_contact"] }, supabase),
      readPlannerHistory(user.wardId, supabase),
    ]);

    if (roster.members.length >= ROSTER_READ_CAP) {
      throw new Error(
        `The ward's member list reached the ${ROSTER_READ_CAP}-row read limit, so the Planner would miss people.`,
      );
    }

    const ward = toPlannerWardList(roster.members, wardDateOnly(new Date(), timeZone));
    const html = assemblePlannerHtml({
      head,
      css,
      body,
      data: {
        rows: history.rows,
        meetings: history.meetings,
        ward,
        conduct: history.conduct,
      },
    });

    return new Response(html, { status: 200, headers: PRIVATE_HEADERS });
  } catch (error) {
    return respondToRouteError(error, {
      route: "GET /api/sacrament-planner/frame",
      fallbackMessage: "Could not open the Sacrament Planner. Please try again.",
      detail: { wardId: user.wardId, userId: user.id },
    });
  }
}
