# Deployment — Vercel, Environment, and Auth URLs

Getting the app onto a real HTTPS URL. Deliberately **not numbered**: it is not a phase that
follows phase 12, and treating it as "the last step" is the mistake this file exists to prevent.

**Depends on:** Phase 1 — there has to be something worth signing in to.
**Required by:** Phase 6. `/public/[slug]` program pages are a link a ward member opens on
their own phone; `localhost` cannot be that link. Phase 9 (Resend agenda email) and Phase 10
(public assignment link) have the same dependency.
**Reference:** [CLAUDE.md](../CLAUDE.md) §3 Tech Stack, §4 rules 4 and 8.

**Do it earlier than Phase 6.** Two reasons. Mobile Safari treats secure and insecure contexts
differently, and the session cookies `@supabase/ssr` sets behave differently under HTTPS — so
every "test it on a real phone" step in the harness is a better test against a deployed URL
than against `192.168.x.x:3000`. And environment and build problems are cheaper to find against
three thousand lines you remember writing than twenty thousand you do not.

---

## Step 1 — Push, then connect Vercel

The remote already exists (`origin` → `DPSolutionsLLC/WLT`) and `.env*.local` is gitignored, so
nothing secret goes up. Vercel deploys *from* the Git remote, so pushing is step one of hosting
rather than a separate decision.

- Import the repo into Vercel. Framework preset **Next.js**; root directory is the repo root.
- **Pin the Node version.** Local development is on Node 22 and `package.json` has no `engines`
  field, so Vercel picks its own default and the two can drift apart silently. Add
  `"engines": { "node": "22.x" }` and set the matching version in the Vercel project settings.
- Build command stays the default `next build`. Do **not** add `npm test` to it — see Pitfalls.

---

## Step 2 — Environment variables

Six variables, from `.env.local.example`. Set them in the Vercel project, not in a committed
file.

| Variable | Scope | Notes |
|---|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | all | Public by design |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | all | Public by design; RLS is what protects the data |
| `SUPABASE_SERVICE_ROLE_KEY` | server | **Bypasses RLS.** Never `NEXT_PUBLIC_` |
| `ANTHROPIC_API_KEY` | server | Never `NEXT_PUBLIC_` (CLAUDE.md rule 4) |
| `OPENAI_API_KEY` | server | Never `NEXT_PUBLIC_` |
| `RESEND_API_KEY` | server | Never `NEXT_PUBLIC_` |

`HARNESS_TEST_PASSWORD` is **not** a production variable. It exists so harness accounts can sign
in to the real app; setting it in Vercel serves no purpose and documents a working password in
the deployment config.

**Decide preview deployments deliberately.** There is one Supabase project (CLAUDE.md §9 —
hosted, no local stack), so a Vercel preview deploy of any branch points at the *same* database
as production. A preview build of a branch mid-migration can write to real ward data. Either
disable preview deployments, or accept it explicitly while the project is one developer and one
ward — but make it a decision rather than a default.

**DECIDED (2026-08-18): preview deployments are disabled.** Only `main` deploys. The exposure
being avoided is a branch build running a half-finished migration against the ward's live data,
which has no staging step to catch it and no second database to fall back on. The cost accepted
is that a branch cannot be click-tested on a real URL before merge — local `npm run dev` plus
the harness remains the pre-merge test. Revisit this when a second Supabase project exists;
that is the change that makes previews safe, not a change in how careful the branch is.

---

## Step 3 — Supabase Auth URL configuration

The step most likely to be missed, because nothing fails until someone tries to reset a
password.

In the Supabase dashboard, Authentication → URL Configuration:

- **Site URL** — the production Vercel domain.
- **Redirect URLs** — add the production domain *and* `http://localhost:3000/**` so local
  development keeps working. If preview deploys are enabled, add the preview wildcard too.

Supabase generates the password-reset link server-side, so it uses Site URL and ignores whatever
the app thinks its origin is. Leave it on `localhost:3000` and every reset email sent to a real
user links them to a machine that is not theirs.

**Invite links do not need this.** `app/api/auth/invite/route.ts` builds its URL from the request
headers precisely so it works on localhost and on Vercel without configuration
([auth-b retro](retros/auth-b-invites-admin.md)). Password reset is the one that needs the
dashboard setting.

---

## Step 4 — SMTP

Closes the gap [auth-a](retros/auth-a-session-shell.md) handed forward: the password-reset pages
are built and the no-session path is verified, but the emailed round trip has never run because
the project has no outbound SMTP.

Supabase's built-in email sender is rate-limited and explicitly not for production use. Configure
custom SMTP — Resend is already a dependency for agenda and program PDFs, so using it here keeps
the vendor count where it is.

Verify by requesting a reset for a real account and completing it end to end. Note the behaviour
`auth-a` recorded: a recovery session **is** a real session, so the reset form signs it out
before leaving, and the next sign-in is what proves the new password works.

---

**Current state (2026-08-18): sender is `onboarding@resend.dev`, deliberately.** Resend requires
a verified *domain* and offers no single-address verification, and buying a domain was declined
for now. That test sender delivers **only to the Resend account owner's own address**, so the
emailed reset round trip is proven but **no real ward member can receive one yet**.

This is safe only while password reset is the app's sole email flow and the only real-inbox
account is the developer's. It stops being safe the moment a ward leader is invited, because an
adult account has **no** admin-initiated password reset — `app/api/admin/users/[id]/reset-pin`
exists for youth accounts only. See [retros/deployment.md](retros/deployment.md) for the options
and the trigger for revisiting.

---

## Step 5 — Verify the first deploy

Beyond "the page loads":

- [x] An adult signs in over HTTPS, and the session survives a page reload — cookie `Secure` and
      `SameSite` behaviour differs from `localhost`
- [x] A youth signs in at `/pin` **on a real phone over HTTPS**, which is the test
      `scenario-005` actually wants
- [x] `/dashboard` from a youth session still redirects to `/sacrament` — the shell isolation is
      a server redirect and must survive the edge runtime
- [x] Middleware runs. Next 16 reports it as `ƒ Proxy (Middleware)` in the build output; confirm
      an unauthenticated request to `/dashboard` redirects rather than rendering
- [x] **No server-only key is in the client bundle.** Download a page's JS and search it for the
      service-role key, the Anthropic key, and the OpenAI key. `lib/supabase/service.ts` throws
      if it finds a `window`, but that is a runtime guard, not a build-time one
- [x] `audit_log` has `login` rows written from the deployed instance, not just from localhost
- [ ] A deliberate 500 shows the app's error page, not a stack trace — **deferred.** No
      honest way to trigger one was found; manufacturing a fake error proves nothing about
      how a real failure renders. Check this the first time a genuine 500 appears.

---

## Step 6 — Add `next build` to the validation loop

`npm run build` is in no phase's validation command list. Lint, typecheck, and test can all pass
while a production build fails — the Turbopack dev server is more forgiving than the build, and
static generation runs code that `next dev` never does.

Add `npm run build` to the validation block of every future plan, after `npm test`.

---

## Definition of Done

- [x] Repo pushed; Vercel project connected and building from `main`
- [x] Node version pinned in both `package.json` and Vercel
- [x] All six environment variables set, none of the four secret ones prefixed `NEXT_PUBLIC_`
- [x] `HARNESS_TEST_PASSWORD` absent from the Vercel project
- [x] Preview deployments either disabled or explicitly accepted, with the shared-database
      consequence written down
- [x] Supabase Site URL and Redirect URLs cover production and localhost
- [x] Custom SMTP configured; a password reset completed end to end against the deployed app
- [x] Six of the seven boxes in Step 5 checked; the deliberate-500 check is deferred above
- [x] `npm run build` added to the validation block of the plan template

---

## Outcome — deployed 2026-08-18

Live at **https://wlt-iota.vercel.app**, Production tracking `main`, Node 22.x, previews
disabled by `vercel.json`. Two commits: `0a4c33a` (Node pin, decisions recorded) and `1febf89`
(`git.deploymentEnabled`).

Verified rather than assumed:

| Check | Method |
|---|---|
| Middleware guard | `curl /dashboard` → `307 → /login?redirectTo=%2Fdashboard` |
| No server key in the bundle | Downloaded all 10 JS chunks (1.1 MB) from `/login` and grepped for each secret |
| Audit trail | `audit_log` row `action=login, module=auth, role=bishop` written by the deployed instance |
| Adult sign-in, youth PIN on a phone, youth shell isolation | Walked by hand over HTTPS |
| Password reset | Requested, received, completed, and re-signed-in end to end |

The bundle scan used a **positive control**: it confirms the two `NEXT_PUBLIC_` values *are*
present. A scan that finds nothing may simply be broken; one that finds exactly what should be
public proves it would have caught a leak.

---

## Pitfalls

- **Never wire `npm test` into CI or the Vercel build.** The RLS suites run against the linked
  *hosted* project: they create wards and auth users, and [foundation-c](retros/foundation-c-services.md)
  records that concurrent sign-ins burst the project's auth rate limit — which is why
  `fileParallelism` is off. A GitHub Action running the suite on every push would write to the
  production database and rate-limit real sign-ins. Tests stay a local, deliberate act until
  there is a separate Supabase project to point them at.
- **A build with no environment variables set still succeeds.** Verified on 2026-08-18: moving
  `.env.local` aside and running `npm run build` exits 0 and generates all 26 pages. The three
  client factories in `lib/supabase/` read `process.env` *inside* the function with `!`
  assertions, so nothing is evaluated at build time, and every route that touches Supabase is
  dynamic (`ƒ`) rather than prerendered. The consequence: a green Vercel deploy proves nothing
  about the environment. A missing or misspelled variable surfaces as a runtime error on first
  use, not as a failed build. **Set all six variables before trusting any deploy**, and treat
  the Step 5 checks — not the build status — as the evidence the environment is right.
- **`NEXT_PUBLIC_` is a one-way door.** Anything with that prefix is inlined into the client
  bundle at build time and is public forever, including in any deploy already shipped. Rotating
  the key is the only remedy.
- **One database behind every environment.** Until there is a second Supabase project, preview
  and production are the same data. `npm run db:push` from a laptop changes what the deployed app
  is running against, with no staging step in between.
- **`npm run db:reset` wipes the hosted database** (CLAUDE.md §9). Once the app is deployed it
  wipes what the ward is using. It should never appear in a script, a CI job, or a README
  quick-start.
- **The Supabase CLI login expires independently of the project link.** `db push` and `gen types`
  fail with a 401 while `supabase/.temp/project-ref` is still correct, and the fix
  (`supabase login`) is interactive — so it cannot be done from a CI job or an agent session.
  Both [auth-a](retros/auth-a-session-shell.md) and
  [auth-c](retros/auth-c-youth-pin.md) hit this.
- **Harness accounts are real accounts.** If the harness is ever seeded against the deployed app,
  `npm run seed:clean` is what removes those logins — and it only removes what its domain list
  matches ([auth-c](retros/auth-c-youth-pin.md)).
- **A `.invalid` address can never receive mail.** Youth accounts have no inbox by construction,
  so no email-based recovery will ever work for them. A forgotten PIN is always a bishopric
  reset. That is the design, not a gap — but it is worth knowing before someone tries to "fix" it.
- **Only three of the six environment variables are load-bearing today.**
  `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY` and `SUPABASE_SERVICE_ROLE_KEY` are
  read by `lib/supabase/*`. `ANTHROPIC_API_KEY`, `OPENAI_API_KEY` and `RESEND_API_KEY` have **no
  references anywhere in the codebase** until Phases 5, 6 and 9. Set all six anyway, but when the
  deployed app misbehaves, the cause is one of the first three — the others cannot break anything
  because nothing reads them.
- **`NEXT_PUBLIC_` decides *where a value is available*, not whether it is secret.** Removing the
  prefix to "be safer" makes the browser read `undefined` and breaks sign-in, with no useful
  error because the clients use `!` assertions. Vercel will also warn that the prefix "exposes
  this value to the browser" — that warning is correct and expected here, and the fix is to turn
  **off** the Sensitive flag on those two variables, not to rename them.
- **Resend refuses any sender on a domain it has not verified, and Supabase reports that as a
  generic 500.** The whole diagnosis is `Error sending recovery email` with no cause attached.
  Setting the Supabase sender to `onboarding@resend.dev` — Resend's built-in test sender, which
  only delivers to the account owner's own address — was what made it work. The real reason is
  written down in **Resend → Logs** and **Supabase → Logs → Auth**; if nothing appears in the
  former, Supabase never reached Resend at all and the fault is host/port/credentials instead.
- **`ForgotPasswordForm` hides every failure by design**, showing "a reset link is on its way"
  whether or not anything was sent, so it cannot be used to enumerate accounts. That makes it
  useless for debugging. Call `supabase.auth.resetPasswordForEmail()` directly against the anon
  key to see the actual error.
- **A real-email account registered while signed in as a harness user lands in the Harness Test
  Ward, and the next seed deletes it.** `seedRunner` calls `cleanUpTestData()` *before* every
  seed, the ward cascade removes the `public.users` row, and the `auth.users` row survives
  because the address is not on a harness domain. The result is an orphan that can still reset
  its password but is refused at sign-in with the deactivated message — correct behaviour, and
  baffling without this note. Put any durable real-inbox account in the **Development Ward**
  (`00000000-0000-4000-8000-000000000001`), which cleanup never touches.
- **`HARNESS_TEST_PASSWORD` must be at least 12 characters *after* `dotenv` parses it.** A CRLF
  line ending and any `#` or quote are stripped or truncated first, so a line that looks long
  enough in the editor can parse shorter. `testPassword()` throws loudly, but the throw happens
  before anything is seeded — so a "seed" that appeared to run may have done nothing at all, and
  the accounts keep their previous password.
