import { headers } from "next/headers";
import { redirect } from "next/navigation";
import {
  PATHNAME_HEADER,
  isModuleReleased,
  moduleForPath,
} from "@/lib/access/releasedModules";
import type { SessionUser } from "@/types/domain";

// THE BOUNCE (ITER-041). A page whose module this ward has not released sends the person to the
// dashboard rather than rendering a refusal: an unreleased module is meant to be absent, not
// locked. Called by the (app) and (tithing) layouts straight after requireSessionUser().
//
// NOT CALLED BY THE (youth) LAYOUT, on purpose: a youth account bounced to /dashboard is sent
// straight back to /ordinances by the (app) layout, which would loop. The ordinance screen's
// permissions and tables are still refused by can() and migration 091 when unreleased.
//
// A LAYOUT DOES NOT RE-RENDER ON A CLIENT-SIDE NAVIGATION within itself, so this catches a typed
// URL and a full load; a link followed inside the app relies on the page's own can() check, which
// is narrowed by the same list, and on the database refusal behind it. This is not the boundary —
// it is the courtesy in front of two that are.
//
// NEVER THROWS when the header is missing (a request that did not pass through middleware): it
// does nothing, and the narrowed can() and RLS still apply.
export async function requireReleasedRoute(user: SessionUser): Promise<void> {
  const pathname = (await headers()).get(PATHNAME_HEADER);
  if (!pathname) return;

  const owningModule = moduleForPath(pathname);
  if (owningModule !== null && !isModuleReleased(user, owningModule)) {
    redirect("/dashboard");
  }
}
