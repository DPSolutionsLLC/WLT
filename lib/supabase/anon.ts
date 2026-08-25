import { createClient } from "@supabase/supabase-js";
import type { Database } from "@/types/database";

// The client for /public/[slug], and the ONLY client that surface may use.
//
// ---------------------------------------------------------------------------------------------
// WHY NOT ONE OF THE THREE THAT ALREADY EXIST
// ---------------------------------------------------------------------------------------------
// service.ts  — bypasses RLS entirely. The service-role client must NEVER appear anywhere under
//               app/public/; a public page holding it is one forgotten filter away from serving
//               the whole roster to the open internet.
// server.ts   — reads next/headers for the session cookie. A public page has no session, and
//               touching cookies opts the route out of static rendering, so `revalidate = 300`
//               would quietly stop meaning anything.
// browser.ts  — a browser client, and this page renders on the server with no client JS at all.
//
// So: the anon key, no cookies, no session. What it can read is exactly what migration 019 and
// migration 039 granted anon — the two public views and nothing else. The projection is the
// boundary (lib/program/publicProjection.ts); this factory is just the way through to it.
//
// persistSession is off because there is no session to persist and nothing to persist it into.

export function createAnonSupabaseClient() {
  return createClient<Database>(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    { auth: { persistSession: false, autoRefreshToken: false } },
  );
}
