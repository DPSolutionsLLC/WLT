---
id: deployment
type: feature
iter: null
commits: ["0a4c33a", "1febf89"]
date: 2026-08-18
files:
  - package.json
  - vercel.json
  - plans/deployment.md
related: [auth-a-session-shell, auth-b-invites-admin, auth-c-youth-pin, foundation-c-services]
---

## What was done

The app is live at **https://wlt-iota.vercel.app**, deployed from `main` on Node 22.x with
preview deployments disabled. Supabase Site URL and Redirect URLs point at the production domain
and at `localhost:3000`; custom SMTP runs through Resend; a password reset was requested,
received, completed and re-signed-in end to end.

Done out of numerical order deliberately. Deployment depends only on Phase 1 and is required by
Phase 6, and doing it now turns every "test on a real phone" step in future harness scenarios
into a real test rather than an approximation — which paid off immediately: scenario-005's youth
PIN sign-in was walked over HTTPS on an actual phone for the first time.

Six of Step 5's seven verification boxes are checked. The seventh is deferred, not quietly
skipped: see Known gaps.

## Key decisions

- **Preview deployments are disabled, in `vercel.json` rather than the dashboard.** There is one
  Supabase project, so a preview build of any branch writes to the ward's live data with no
  staging step. The config lives in the repo so the decision is version controlled and survives a
  UI redesign — and the dashboard control turned out to be genuinely hard to find, which is the
  weaker reason but the one felt first. The pattern is `**` not `*`: minimatch's `*` does not
  cross a `/`, so `feature/foo` would have fallen through to the default of `true`.
- **A production build was run *before* touching Vercel, and again with the environment
  removed.** The first proved the code compiles; the second produced the finding below. Both took
  under a minute and replaced guesswork with evidence.
- **The client-bundle scan uses a positive control.** All ten JS chunks from `/login` (1.1 MB)
  were downloaded and grepped for each secret. Asserting only that the service-role key is absent
  proves nothing if the scan is broken — so it also asserts the two `NEXT_PUBLIC_` values *are*
  present. Finding exactly what should be public is what makes the absence meaningful.
- **The deferred check was left visibly unticked.** Manufacturing a fake 500 to tick a box would
  have recorded a verification that never happened.

## The finding that changes how to read a green deploy

**A production build with no environment variables set exits 0 and generates all 26 pages.**
Verified by moving `.env.local` aside. The Supabase client factories read `process.env` *inside*
the function with `!` assertions, and every route touching Supabase is dynamic rather than
prerendered, so nothing is evaluated at build time.

The consequence is that **a green Vercel deploy proves the code compiles and nothing more.** A
missing or misspelled variable surfaces as a runtime error on first use. Step 5's checks, run
against a running app, are the only real evidence the environment is right — which is exactly
why that step exists and why skipping it would have been invisible.

## Pitfalls for next time

- **`NEXT_PUBLIC_` decides where a value is available, not whether it is secret.** Removing the
  prefix to be safer breaks sign-in silently. Vercel's own warning that the prefix "exposes this
  value to the browser" is correct and expected here; the fix is turning off the Sensitive flag,
  not renaming the variable.
- **Errors deliberately hidden from users are also hidden from you.** `ForgotPasswordForm` shows
  the same message whether or not the send succeeded — right for account enumeration, useless for
  debugging. Calling `resetPasswordForEmail()` directly against the anon key produced
  `Error sending recovery email` in seconds, after the UI had produced nothing for far longer.
- **Vendor errors arrive stripped of their cause.** Resend refusing an unverified sender reached
  us as a bare Supabase 500. The cause was only ever visible in Resend's own logs. When an
  integration fails, the vendor's dashboard beats the calling application's error message.
- **A "seed" that threw is indistinguishable from one that worked, later.** `HARNESS_TEST_PASSWORD`
  parsed to 9 characters — CRLF plus a stripped character — so `testPassword()` threw before
  anything was written and the accounts kept their old password. The error was loud at the time
  and invisible ten minutes later. Sign-in failing after a seed is worth checking against the
  seed's own output before assuming the deployment is at fault.
- **Registering a real-email account from a harness session puts it in the ward the next seed
  deletes.** It survives in `auth.users`, loses its `public.users` row, and is then refused at
  sign-in with the deactivated message. Durable accounts belong in the Development Ward.

## Known gaps handed to later phases

- **The deliberate-500 check is unverified.** No honest way to trigger one was found. Check it the
  first time a genuine 500 appears rather than manufacturing one.
- **Resend sends from `onboarding@resend.dev`, and this is a deliberate deferral rather than an
  oversight.** That test sender only delivers to the Resend account owner's own address, so **no
  real ward member can receive a password reset today.** Resend requires a verified *domain* — it
  has no single-address verification — so closing this needs a domain, and buying one was
  explicitly declined for now (2026-08-18).

  The reasoning, so the next person does not re-open it blindly: password reset is currently the
  **only** email flow in the app. Invites are copy-a-link, not email
  (`app/api/auth/invite/route.ts` returns `{ invite, url }`), and the only account with a real
  inbox is the developer's. So the blast radius today is one person who already knows the
  workaround.

  **What makes this urgent:** the first time a real ward leader is invited and later forgets
  their password. At that point there is no recovery path — an adult account has no admin PIN
  reset the way a youth account does.

  **Options when that day comes**, in preference order: verify a domain already owned and send
  from a subdomain (`noreply@wlt.<domain>`), which is free and the only option with proper
  SPF/DKIM alignment; or point Supabase SMTP at Gmail with an App Password, free but sending from
  a personal address. A single-sender provider such as SMTP2GO was considered and rejected —
  it cannot align SPF/DKIM, so it trades deliverability *and* adds a vendor.

  Revisit if the stake adopts the app, which is the scenario that would justify a dedicated
  domain anyway.
- **`RESEND_API_KEY` in Vercel is still unread by application code.** Supabase uses its own copy
  for auth email. The Vercel one waits for Phases 6 and 9.
- **One database still sits behind everything.** `npm run db:push` from a laptop changes what the
  deployed app runs against, with no staging step. Disabling previews narrowed the exposure; it
  did not remove it.
- **No custom domain.** The app answers on three `vercel.app` hostnames, and because the reset
  link is built from `window.location.origin`, only the primary one is allowlisted in Supabase.
