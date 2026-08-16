import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { loadEnvironment, requireEnv } from "./envLoader.ts";

// There is no local emulator and no local Docker stack (CLAUDE.md §9), so the harness has
// exactly one target: the linked hosted project. Everything it writes lives inside the single
// test ward defined in seedUtils.ts, and cleanUp.ts will delete nothing else.
//
// Deliberately untyped against Database. The seed factories name tables as runtime strings,
// and a generic table union over 51 tables exhausts the TypeScript compiler on this machine
// (see plans/retros/foundation-c-services.md). Factory signatures below carry the real types.
let client: SupabaseClient | null = null;

export function getAdminClient(): SupabaseClient {
  if (client) return client;

  loadEnvironment();

  const url = requireEnv(
    "NEXT_PUBLIC_SUPABASE_URL",
    "Copy .env.local.example to .env.local and fill in the linked project's values.",
  );
  const serviceRoleKey = requireEnv(
    "SUPABASE_SERVICE_ROLE_KEY",
    "The harness seeds with the service-role key so it can create auth users. Never expose this key to the browser.",
  );

  client = createClient(url, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  return client;
}

export function describeTarget(): string {
  loadEnvironment();

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "(unset)";
  const projectRef = url.replace(/^https?:\/\//, "").split(".")[0];

  return `hosted Supabase project "${projectRef}"`;
}
