import type { SupabaseClient } from "@supabase/supabase-js";
import { asRole } from "@/tests/helpers/asRole";
import type { Fixtures, FixtureHandle } from "@/tests/helpers/seed";
import type { Database } from "@/types/database";

// Route handlers, tested without a server.
//
// ---------------------------------------------------------------------------
// WHY THIS EXISTS
// ---------------------------------------------------------------------------
// Six retros in a row recorded that route handlers were untestable because "there is no local
// server". That was true of a browser-driven test and was never true of the handler itself: a
// Next.js route handler is an exported async function taking a Request and returning a Response.
// Calling it is an ordinary function call. The only thing standing in the way was
// createServerSupabaseClient(), which reads next/headers for the session cookie.
//
// So that one module is mocked, and NOTHING else. Every query the route runs still goes over the
// network to the hosted project as a genuinely authenticated user, which means a passing route
// test proves the RLS policy allowed the query — not that a stub returned a row. Mock the client
// itself and you get a suite that passes while the app leaks.
//
// ---------------------------------------------------------------------------
// HOW TO USE IT
// ---------------------------------------------------------------------------
// Four things, in this order, at the TOP of the suite:
//
//   // @vitest-environment node          <- routes are server code; jsdom is the wrong shape
//
//   import { actAs, jsonRequest, readResponse } from "@/tests/helpers/routeClient";
//
//   vi.mock("@/lib/supabase/server", async () => {
//     const { serverClientMock } = await import("@/tests/helpers/routeClient");
//     return serverClientMock();
//   });
//
// Then in the tests:
//
//   await actAs(fixtures, "bishop");
//   const { GET } = await import("@/app/api/assignments/route");
//   const { status, body } = await readResponse(await GET(jsonRequest(url)));
//
// ---------------------------------------------------------------------------
// THE HOISTING TRAP — read this before editing the mock above
// ---------------------------------------------------------------------------
// vi.mock is hoisted above every import in the file that calls it. Its factory therefore cannot
// close over anything declared later in that file:
//
//   const client = await asRole(...);                      // never runs first
//   vi.mock("@/lib/supabase/server", () => ({              // hoisted above it
//     createServerSupabaseClient: async () => client,      // ReferenceError, or a stale null
//   }));
//
// The escape is that the acting client lives HERE, in a module the factory imports at call time
// rather than captures at definition time. `actAs()` writes the holder below; the function the
// factory returns reads it on every call. The `await import()` inside the factory is deliberate
// and load-bearing — it defers resolution until after this module has finished evaluating.
//
// ---------------------------------------------------------------------------
// WHAT THIS DELIBERATELY DOES NOT DO
// ---------------------------------------------------------------------------
// It does not wrap seedFixtures. A route suite seeds exactly like an RLS suite — same
// seedFixtures(handles), same fixtures.cleanup() in afterAll — because they run against the same
// shared hosted project and carry the same obligations (CLAUDE.md §9).
//
// It does not mock @/lib/auth/session. It was going to: getSessionUser is wrapped in React's
// cache(), and a live cache would hand test two the user from test one. Measured, cache() is
// INERT outside a request scope — with no React dispatcher it does not memoize at all, so a
// cache()d function called twice runs twice. Mocking session resolution would therefore have
// bought nothing and cost the tests their proof that requireSessionUser() works. Leave it alone.
// If a future React version changes this, the symptom is a suite where every acting user behaves
// like the first one.

const holder: { client: SupabaseClient<Database> | null } = { client: null };

// Called by the mock factory on every createServerSupabaseClient() the route makes, which is why
// the failure message names the fix rather than throwing a bare null dereference three frames
// deep inside a query helper.
export function actingClient(): SupabaseClient<Database> {
  if (!holder.client) {
    throw new Error(
      "No acting client is installed. Call `await actAs(fixtures, \"bishop\")` before invoking " +
        "the route handler.",
    );
  }
  return holder.client;
}

export function serverClientMock(): {
  createServerSupabaseClient: () => Promise<SupabaseClient<Database>>;
} {
  return { createServerSupabaseClient: async () => actingClient() };
}

// Switches which seeded user the next route call runs as. asRole caches the sign-in per fixture
// set, so calling this twenty times in a suite is twenty function calls and at most one sign-in
// per handle — which matters against the hosted project's auth rate limit.
export async function actAs(
  fixtures: Fixtures,
  handle: FixtureHandle,
): Promise<void> {
  holder.client = await asRole(fixtures, handle);
}

// Leaves the holder empty so the next suite in the file cannot inherit an acting user. Vitest
// isolates modules per file, so this is belt-and-braces rather than required.
export function clearActingClient(): void {
  holder.client = null;
}

export function jsonRequest(
  url: string,
  init: { method?: string; body?: unknown } = {},
): Request {
  const method = init.method ?? (init.body === undefined ? "GET" : "POST");

  return new Request(url, {
    method,
    headers: init.body === undefined ? {} : { "content-type": "application/json" },
    body: init.body === undefined ? undefined : JSON.stringify(init.body),
  });
}

// Reads status and body together, because asserting on one without the other is how a suite ends
// up reporting "expected 200, got 500" with no idea what the 500 said.
export async function readResponse(
  response: Response,
): Promise<{ status: number; body: Record<string, unknown> }> {
  const text = await response.text();

  let body: Record<string, unknown>;
  try {
    body = text === "" ? {} : (JSON.parse(text) as Record<string, unknown>);
  } catch {
    // A route that returned non-JSON is a real failure worth seeing verbatim, not a parse
    // exception that hides what the handler actually sent.
    body = { nonJsonBody: text };
  }

  return { status: response.status, body };
}

// The message a route put in `{ error }`. Returns "" rather than undefined so a toContain()
// assertion reports the empty string instead of failing on a type error.
export function errorMessage(body: Record<string, unknown>): string {
  return typeof body.error === "string" ? body.error : "";
}
