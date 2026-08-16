import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/types/database";
import type { Fixtures, FixtureHandle, SeededUser } from "@/tests/helpers/seed";

// Returns a client authenticated as a seeded user — anon key plus a real session, so RLS
// actually applies. Every RLS assertion in tests/rls/ must go through one of these.

const sessionCache = new WeakMap<
  Fixtures,
  Map<FixtureHandle, SupabaseClient<Database>>
>();

function createAnonClient(): SupabaseClient<Database> {
  return createClient<Database>(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    { auth: { persistSession: false, autoRefreshToken: false } },
  );
}

export function anonClient(): SupabaseClient<Database> {
  return createAnonClient();
}

async function signIn(user: SeededUser): Promise<SupabaseClient<Database>> {
  const supabase = createAnonClient();

  const { error } = await supabase.auth.signInWithPassword({
    email: user.email,
    password: user.password,
  });

  if (error) {
    throw new Error(
      `Could not sign in fixture "${user.handle}": ${error.message}. ` +
        "Repeated full runs in quick succession can hit the hosted project's auth rate limit; wait a few minutes and retry.",
    );
  }

  return supabase;
}

// Cached per fixture set: a sign-in is a network round trip and counts against the hosted
// project's auth rate limit, so a suite that calls asRole() in twenty assertions should still
// sign in once.
export async function asRole(
  fixtures: Fixtures,
  handle: FixtureHandle,
): Promise<SupabaseClient<Database>> {
  let clients = sessionCache.get(fixtures);
  if (!clients) {
    clients = new Map();
    sessionCache.set(fixtures, clients);
  }

  const cached = clients.get(handle);
  if (cached) return cached;

  const client = await signIn(fixtures.user(handle));
  clients.set(handle, client);
  return client;
}
