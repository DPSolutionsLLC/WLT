# ITER-015: API Routes Redirect Instead of Answering 401

**Type:** Bug
**Status:** Backlogged
**Created:** 2026-08-24

## Summary

An unauthenticated call to any API route returns a **307 redirect to `/login`** instead of a
**401**. The middleware goes out of its way to prevent exactly this; the route handlers then do it
anyway, one layer down.

## Context

Found on 2026-08-24 probing the deployed app immediately after `ai-b` went to production — not by
a test, and not by using the app. A bare `curl -X POST` against `/api/knowledge/search` came back:

```
HTTP/1.1 307 Temporary Redirect
Location: /login
X-Matched-Path: /api/knowledge/search
```

`middleware.ts` is explicit that this must not happen:

> `// API routes answer with a status code; redirecting them would turn a 401 the caller can`
> `// handle into an HTML login page it cannot.`
> `if (pathname.startsWith("/api/")) return response;`

The middleware honours that. `requireSessionUser()` — which every route calls as its first line —
does not: it resolves a missing session with `redirect("/login")` from `next/navigation`, which
throws `NEXT_REDIRECT` and Next converts to a 307. The two Location headers give it away: the
middleware always appends `?redirectTo=`, and this redirect is a bare `/login`.

**This is not from `ai-b`.** `requireSessionUser` dates from `auth-a` and **41 route files** call
it the same way. The knowledge routes were simply the first ones anybody probed unauthenticated.

## Desired Outcome

An unauthenticated request to any `/api/*` route receives `401` with a JSON body the client can
read. Pages continue to redirect, because a redirect is the right answer for a page.

## Scope Notes

**The user-visible failure is a wrong error message, not a broken feature.** When a session expires
with the page open, a client `fetch` follows the 307, receives the login page as **200 HTML**, sees
`response.ok === true`, and then throws on `response.json()`. The reader gets "Could not reach the
server. Check your connection and try again." — which is false, and points them at their network
instead of at signing in. Every client component in the app has a version of that handler.

**No existing test could have caught this, and that is the more useful finding.** Route tests call
handlers directly with an authenticated mocked client (`tests/helpers/routeClient.ts`), so they
never traverse Next's redirect machinery and there is not a single `401` assertion in
`tests/routes/`. This is the same blind spot that hid the "all 1 of its passages" plural bug in a
different form: the fixture only ever exercises the path that works.

**The fix is a second guard, not a change to the existing one.** `requireSessionUser()` is correct
for Server Components and must keep redirecting. Routes want a sibling — `requireSessionUserOrThrow`
or similar — that raises an error `respondToRouteError()` already knows how to turn into a 401.
`lib/auth/routeErrors.ts` has the shape for it (`InvalidRequestBodyError` plus
`respondToRouteError`) but no unauthorized case yet.

**Do not solve it in the middleware.** Returning 401 there for `/api/*` would be fewer edits, but
it moves an authorisation decision out of the handler and into an edge function that CLAUDE.md §
Pitfalls already says must not resolve roles. The handler is where the decision belongs.

**41 files is the real cost.** The change per file is one import and one call, and the compiler
finds them all if the new function is the only one routes are allowed to use. Worth doing in one
pass rather than opportunistically, so the two guards do not coexist indefinitely with no rule
about which is which.

**Files this touches:** `lib/auth/session.ts`; `lib/auth/routeErrors.ts`; 41 files under
`app/api/`; a test per route family asserting 401, plus one that proves a page still redirects.

## Open Questions

- Should the 401 body carry a machine-readable code so clients can distinguish "session expired"
  from "not permitted", or is the sentence enough? Today `assertCan` failures return 403 and this
  would return 401, which may already be sufficient.
- Do the client components need a shared helper for "401 means sign in again", or does each
  existing error handler get one more branch?
- Is there any route that genuinely wants to redirect — an OAuth callback, or a link opened
  directly from an email?

## Related

- [auth-a-session-shell](../../plans/retros/auth-a-session-shell.md) — introduced
  `requireSessionUser` and the middleware split
- [route-tests-and-realtime](../../plans/retros/route-tests-and-realtime.md) — built the route test
  harness whose authenticated-only fixtures leave this path unexercised
- [ai-b-knowledge-and-retrieval](../../plans/retros/ai-b-knowledge-and-retrieval.md) — its routes
  were where the behaviour surfaced
