import { redirect } from "next/navigation";
import type { SessionUser } from "@/types/domain";

// THE OLD SACRAMENT HUB IS HIDDEN, NOT REMOVED (ITER-045, D2).
//
// The Sacrament Planner replaced it behind the Sacrament tile. Its pages — /sacrament,
// /assignments, /assignments/[sunday_id] and /prayers — stay in the code as reference for
// re-pointing the pipelines later. A super admin is not redirected, and each page's own permission
// check still applies, so they see the hub only through a calling that could read it. Everyone else
// is sent to the Planner.
//
// HIDDEN, NOT DISABLED: the hub's API routes and tables are untouched and still answer the
// bishopric. Program, Music and Topic history keep reading those tables.
export function redirectUnlessSuperAdmin(user: Pick<SessionUser, "isSuperAdmin">): void {
  if (!user.isSuperAdmin) redirect("/sacrament-planner");
}
