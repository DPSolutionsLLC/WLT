import { cache } from "react";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import type { Database } from "@/types/database";
import { describeCalling, type SessionUser } from "@/types/domain";

// WHAT THE CHROME CALLS THE CALLING THIS SESSION IS ACTING UNDER.
//
// The walk of scenario 066 found the header saying "Organization President" and the user
// confirmed on 2026-09-21 that it must name the organization: "Relief Society President". The
// pure half of that is describeCalling() in types/domain.ts; this is the read that feeds it.
//
// It exists as its own module rather than inline in the layout because TWO places render this
// label — the persistent header and the dashboard's own sentence — and they must never disagree
// about what the same session's calling is called.
//
// cache() DEDUPES IT ACROSS ONE REQUEST, the same reason getSessionUser is wrapped: the layout and
// the page it wraps both render on the same request, so this costs one query per page rather than
// two. It only wraps the no-argument path; a test passing its own client calls through uncached.
//
// Read through the CALLER's client. `organizations_select` already scopes the row to the ward
// being acted in, so a calling's organization is readable exactly when the session is genuinely
// in that ward (CLAUDE.md rule 2).

async function resolveCallingLabel(
  user: SessionUser,
  client?: SupabaseClient<Database>,
): Promise<string> {
  if (!user.orgId) return describeCalling(user.role, null);

  const supabase = client ?? (await createServerSupabaseClient());

  const { data, error } = await supabase
    .from("organizations")
    .select("name")
    .eq("id", user.orgId)
    .maybeSingle();

  // DEGRADES RATHER THAN THROWS, and this is the one place in the calling code that does.
  // Everything else about a session's calling is load-bearing for access and fails loudly; this is
  // a LABEL. Failing the whole page because a name could not be read would take the app down over
  // chrome, so it falls back to the generic "Organization President" and says so in the log —
  // which is degraded, legible, and still true.
  if (error) {
    console.error("Could not read the organization name for the session's calling", {
      userId: user.id,
      wardId: user.wardId,
      orgId: user.orgId,
      error: error.message,
    });
    return describeCalling(user.role, null);
  }

  return describeCalling(user.role, data?.name ?? null);
}

export const readCallingLabel = cache(
  async (user: SessionUser, client?: SupabaseClient<Database>): Promise<string> =>
    resolveCallingLabel(user, client),
);
