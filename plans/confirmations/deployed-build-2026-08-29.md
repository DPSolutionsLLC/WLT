---
id: deployed-build-first-look
status: failed
commit: b941089
date: 2026-08-29
area: deployed-build
related_retros: [youth-b-ics-import, youth-a-profiles-and-events, visits-b-goals-and-progress]
supersedes: null
---

## What was tested

**The deployed build at `https://wlt-iota.vercel.app`, opened for the first time**, driven by an
AGENT (Claude, via Playwright) with the user reading the findings. Signed in with the `bishop`
harness account, which is scoped by RLS to the Harness Test Ward.

**No writes were made to production.** Every check was a read, a route sweep, or a comparison of
server-rendered HTML against the hydrated DOM. Signed out at the end; the session was confirmed
gone by a subsequent API call redirecting to `/login`.

**This closes the "deployed build unopened" item that appears in all four earlier PENDING rows**
(`talks-planner`, `visits`, `visits-report-feed`, `youth-occasions`). It has been open since
2026-08-21. It is closed by having been opened — and what was found is why it should not have
stayed open.

**NOT verified:**

- **A real device.** Everything was a desktop browser at `America/Denver`.
- **Any account other than `bishop`.** The org-president, ward-council and `sacrament_manager`
  (PIN) paths on production are unwalked.
- **Any write path on production**, deliberately.
- **The visits module's exposure to the defect below.** The seeded harness ward has no visit
  appointments, so those pages had no times to render. `lib/visits/visitDates.ts:57` uses the
  identical pattern, so it is *likely* affected and *unproven*.
- **Real ward data.** Only the harness ward was read.

## Result

### FAILED — event times are wrong in the server-rendered HTML

Same event, same page load, on `/youth/profiles`:

| Rendered by | Value |
|---|---|
| Server (Vercel, UTC) | **Sat, Jan 16, 2027, 2:30 AM** |
| Browser (`America/Denver`) | **Fri, Jan 15, 2027, 7:30 PM** |

Wrong day, seven hours out. Three observed instances, all consistent:

```
server                          client
Sat, Jan 16, 2027, 2:30 AM  ->  Fri, Jan 15, 2027, 7:30 PM
Sun, Feb  7, 2027, 1:00 AM  ->  Sat, Feb  6, 2027, 6:00 PM
Sat, Mar 20, 2027, 9:00 PM  ->  Sat, Mar 20, 2027, 3:00 PM
```

It surfaces in the production console as **`Minified React error #418`** — a hydration text
mismatch — and to a reader as a flash of the wrong date before hydration corrects it. On a slow
connection, or with JS failing, the wrong day is what stands.

**Cause.** `toLocaleString(undefined, {…})` with no `timeZone`, in
`app/(app)/youth/EventList.tsx:118` and `app/(app)/youth/calendar/ActivityCalendar.tsx:139`. The
*intent* is deliberate and documented in both files — render in **the reader's own zone**, because
"a game is a time somebody has to turn up at", the rule `lib/visits/visitDates.ts` already states.
The flaw is that **on a server there is no reader**, so it resolves against the process zone, which
is `America/Denver` on the dev machine and **UTC on Vercel**.

**This is invisible on localhost**, because there the server and the browser are the same zone and
agree. It is precisely the class CLAUDE.md §9 names in the ICS notes: *"a bug that passes every
test on the dev machine and ships wrong."* 2304, 2421 and 3262 tests never touched it, and four
walks deferred the deployed build. It was found on the first look.

**Confirmed affected:** `/youth/profiles`, `/youth/calendar`.
**Likely, unproven:** `/youth/events/[id]` — `EventDetail.tsx` formats the same way and never
receives a zone, though `events/[id]/page.tsx` does read `readWardTimezone` for the occasion-day
grouping. And the whole visits module, per `visitDates.ts:57`.

**Not a one-line fix; it is a design decision.** Three directions, none free:

1. **Render the time client-only.** Keeps the reader's-zone intent, removes the mismatch. Costs a
   placeholder and a layout shift on first paint.
2. **`suppressHydrationWarning`.** Silences React and leaves the *wrong day* in the server HTML.
   Rejected on sight for a no-JS reader.
3. **Render in the ward's zone.** Server and client agree and are both correct for the ward.
   Contradicts the reader's-zone rule — but note `ActivityCalendar.tsx:71` objects to the ward's
   zone specifically because the grid and the card would disagree, and that objection dissolves if
   both use it. `lib/ward/wardTimezone.ts` already exists and is already read by four call sites.

### FAILED — two sidebar links 404 for a bishop

`/agendas` (Phase 9, not started) and `/admin/audit-log` (Phase 11, not started) are in
`lib/auth/navigation.ts` and are not built. Both return a real 404 page, and both are prefetched on
every dashboard load, so they also appear as console errors on a page that is otherwise fine.

This is the same shape as the note in scenario 049: *"The navigation item for Youth Activities has
existed since `auth-a` and pointed at a page that did not exist."* That one was fixed by building
the page. These two want a nav gate until their phases land.

### Confirmed working

- **22 authenticated routes render their real heading**: `/dashboard` ("Hello, Mark"), `/youth`,
  `/youth/profiles`, `/youth/calendar`, `/youth/feed`, `/youth/import`, `/visits`, `/visits/feed`,
  `/visits/all-organizations`, `/roster`, `/calendar` ("August 2026"), `/assignments`, `/prayers`,
  `/talks/topics`, `/program`, `/music`, `/goals`, `/tithing`, `/knowledge`, `/ai-settings`,
  `/admin`, `/admin/users`. No error boundaries, no 500s.
- **Auth guards hold.** `/` and `/dashboard` unauthenticated → `307` to `/login?redirectTo=…`.
  Sign-in as `bishop` lands on `/dashboard`. Sign-out invalidates the session.
- **`/sacrament` correctly redirects an adult account to `/dashboard`** — it is the PIN-only youth
  shell, and an adult reaching it is not an error.
- **Public pages carry `<meta name="robots" content="noindex">`**, so the CLAUDE.md §9 privacy
  promise — full names reachable by link but never gathered into a search index — holds in
  production.
- **Phase 8 renders correctly on production.** `/youth` showed "3 young people shown" with the
  support pills intact: *Varsity basketball · 0%*, *Chamber choir · 0%*, *Debate team · —*,
  *Community orchestra · —*. The em-dash-not-0% rule from `youth-f` survives the production build.

### Confirmed on production: ITER-015

`GET /api/youth/profiles` unauthenticated returns **`307` → `/login`**, not `401`. ITER-015 recorded
this from a `curl` at `/api/knowledge/search` on 2026-08-24; it is systemic across 41 route files
and is now proven on a second route on the deployed build.

## Re-test when fixed

The timezone defect has a cheap, decisive regression check that does **not** need a browser: fetch
any page listing an event and compare the server-rendered time string against the same event
formatted in a non-UTC zone. It only reproduces where the server's zone differs from the reader's,
so **it must be checked on the deployed build, or with `TZ=UTC` set locally** — a plain `npm run
dev` on this machine cannot show it.
