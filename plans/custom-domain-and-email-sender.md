# Plan: Custom domain and email sender

**Created:** 2026-10-10
**Type:** feature
**Scope refs:** ITER-039

## Overview

Move the live app from `https://wlt-iota.vercel.app` to **`https://wardleadershiptools.com`**, and
send every email from **`noreply@wardleadershiptools.com`** instead of Resend's test sender.

This is almost entirely a **dashboard walkthrough**. The user (a beginner) does each step in the
GoDaddy, Vercel, Supabase and Resend dashboards; the executing agent explains one step at a time in
plain language, waits for the user to say it is done, and checks the result from the terminal
wherever a check exists. **No application code changes.** Three documentation files change at the end.

### What is already true (verified 2026-10-10)

- The domain was bought at **GoDaddy** and is **already verified in Resend** (user's statement).
- No source file names the old address. `tests/lib/qrCode.test.ts` uses it as a fixture for a URL
  containing a hyphen; **leave that test alone**.
- **Invite links** are built from the request's own host (`app/api/auth/invite/route.ts`). They
  follow the new domain with no change.
- **Password reset** sends `redirectTo: window.location.origin + "/reset-password"`
  (`ForgotPasswordForm.tsx`). Supabase honours it only if that origin is on its **Redirect URLs**
  list; otherwise it silently falls back to **Site URL**. Nothing errors either way.
- **`resolveSiteUrl()`** (`lib/program/queries.ts`) reads `NEXT_PUBLIC_SITE_URL` first, then
  Vercel's `VERCEL_PROJECT_PRODUCTION_URL`. It feeds four things: the programme's QR code, the
  programme's public link in the distribution email, and the links in both music emails
  ("Choose the music", "Sent back").
- **`emailConfiguration()`** (`lib/email/resend.ts`) keeps the app's own email switched OFF until
  `RESEND_FROM_ADDRESS` is set to something other than `onboarding@resend.dev`. Setting it is the
  only thing needed to turn email on.
- **Supabase Auth sends its own mail** through SMTP settings held in the Supabase dashboard, with
  its own copy of the Resend key. That sender is a separate setting from `RESEND_FROM_ADDRESS`.
- No code sets a reply-to address anywhere, so `noreply@` is consistent with every email today.

### Decisions (from discovery, settled with the user)

| # | Decision |
|---|---|
| D1 | `wardleadershiptools.com` (no `www`) is the main address |
| D2 | `www.wardleadershiptools.com` redirects to it |
| D3 | `wlt-iota.vercel.app` keeps working and forwards to the new domain |
| D4 | Sender is `noreply@wardleadershiptools.com` for both Supabase mail and the app's own mail |

### Assumptions made for the scope's open questions

- **Is `NEXT_PUBLIC_SITE_URL` set in Vercel today?** Unknown from the repo. Task 1 reads it; Task 5
  sets it either way.
- **Is `noreply@` enough?** Yes for now: nothing sets a reply-to, and no mailbox exists at the
  domain. A reply to any app email will bounce. Say this to the user once, in Task 5; do not build
  a mailbox.
- **Does a Supabase email template mention the old address?** Checked by eye in Task 4. The default
  templates use placeholders, so the expected answer is no.

### Success criteria

- [ ] `https://wardleadershiptools.com` serves the app over HTTPS with a valid certificate
- [ ] `https://www.wardleadershiptools.com` redirects to it
- [ ] An adult signs in on the new domain and the session survives a reload
- [ ] A youth signs in at `/pin` on the new domain
- [ ] A password reset for an address that is **not** the Resend account owner's arrives from
      `noreply@wardleadershiptools.com`, its link opens the new domain, and the reset completes
- [ ] A freshly generated programme's QR code and public link point at the new domain
- [ ] The Distribute control on a programme offers email rather than "Publish to the public page"
- [ ] `https://wlt-iota.vercel.app/login` forwards to the new domain
- [ ] `plans/deployment.md` records all of it

## Relevant Files

- `plans/deployment.md` — modify — new "Custom domain" section, close the test-sender note, update
  the Outcome address and the environment variable table
- `.env.local.example` — modify — the example address in the `NEXT_PUBLIC_SITE_URL` comment
- `testing/scenarios/program/scenario-034-print-it-and-fold-it/scenario.md` — modify — the one line
  naming the old address
- `testing/scenarios/manifest.json` — regenerate with `npm run manifest` only if the scenario edit
  changes it (the edited line is in the body, so it probably will not)

**Not touched, on purpose:** any file under `app/`, `lib/`, `components/`, `tests/`, `supabase/`;
`vercel.json`; `CLAUDE.md` (it names no address); old plan files, confirmations and retros that
mention `wlt-iota.vercel.app` — they are historical records of what was true then.

## Dependencies

- No new libraries.
- Dashboard access the user must have: GoDaddy (DNS for the domain), Vercel (project **WLT**),
  Supabase (project `WLT`, ref `dtlvpeqirajfbqaydcgr`), Resend.
- The agent has **no** access to those dashboards and must not ask for passwords, API keys or
  tokens. The user reads values aloud or pastes non-secret ones (domain names, record names).

## Known Pitfalls (from retro context)

- **deployment** — *"Vendor errors arrive stripped of their cause."* A refused sender reaches the
  app as a bare Supabase 500 reading `Error sending recovery email`. The real reason is in
  **Resend → Logs** and **Supabase → Logs → Auth**. Look there first, not at the app.
- **deployment** — *`ForgotPasswordForm` shows the same message whether or not anything was sent.*
  "A reset link is on its way" proves nothing. The evidence is the email arriving, or Resend's log.
- **deployment** — *a changed environment variable reaches only a NEW deployment*, and
  `NEXT_PUBLIC_` values are fixed into the build. Task 5 ends with a redeploy for that reason.
- **deployment** — *"only the primary hostname is allowlisted in Supabase."* The same trap in a new
  place: add the new domain to Redirect URLs **before** anybody uses it (Task 4 comes before the
  verification in Task 7).
- **deployment** — *the test sender delivers only to the Resend account owner.* So the reset test in
  Task 7 **must** use a different inbox, or it proves nothing about the change.
- **program-d-pdf-and-distribution** — *a QR is printed on paper.* A programme PDF generated before
  the move still carries the old address. D3's forward is what keeps it working, so **Task 8 is not
  optional** and must come last.
- **deployment** — *one database behind everything.* Nothing here touches the database, and nothing
  here should: no `db:push`, no `db:reset`, no seed.

## Tasks

**How to run these.** One task at a time, in this order. For each: say what it does and why in a
sentence or two, give the exact clicks, wait for the user, then run the check. The order is chosen
so the **old address keeps working until Task 8**, which means every step before it can be undone
without anybody being locked out.

### Task 1: Write down the starting state
**File:** none (dashboards, read-only)
**Action:** Ask the user to look up and report five things. Change nothing.
**Details:**
- **Vercel → project → Settings → Domains:** the list of domains shown today.
- **Vercel → Settings → Environment Variables:** whether `NEXT_PUBLIC_SITE_URL` and
  `RESEND_FROM_ADDRESS` exist, and the value of each (neither is secret). **Do not ask for any
  other variable's value.**
- **Supabase → Authentication → URL Configuration:** the Site URL and the Redirect URLs list.
- **Supabase → Authentication → Emails → SMTP Settings:** the sender email and sender name only.
- **Resend → Domains:** that `wardleadershiptools.com` shows **Verified**, and which region.
- **GoDaddy → My Products → the domain → DNS:** the list of records. The Resend records will be
  there already (an `MX` and a `TXT` on a `send` name, a `TXT` on `resend._domainkey`). Note them:
  **these must survive Task 3 untouched.**
- Record these in the conversation; they are the rollback values and go into `plans/deployment.md`
  in Task 9.

### Task 2: Add the domain to the Vercel project
**File:** none (Vercel dashboard)
**Action:** Add both hostnames, with `www` redirecting to the main one (D1, D2).
**Details:**
- Settings → Domains → **Add**. Enter `wardleadershiptools.com`. When Vercel offers to add
  `www.wardleadershiptools.com` as well and redirect one to the other, accept, choosing
  **`www` redirects to `wardleadershiptools.com`** (Vercel may suggest the opposite by default).
- Both rows will read **Invalid Configuration**. That is expected until Task 3.
- Vercel now shows the exact DNS records it wants: an **A** record for `@` and a **CNAME** for
  `www`. **Use the values Vercel displays**, not values from memory or from this plan — Vercel has
  changed its recommended addresses more than once. Have the user read both out.
- Leave `wlt-iota.vercel.app` exactly as it is.

### Task 3: Point the domain at Vercel in GoDaddy
**File:** none (GoDaddy dashboard)
**Action:** Enter the two records from Task 2.
**Details:**
- GoDaddy → the domain → **DNS** → DNS Records.
- **A record, name `@`:** GoDaddy ships a default one pointing at a parking page (value reads
  `Parked` or a GoDaddy address). **Edit** it to the address Vercel gave. If there are several A
  records on `@`, there must end up being only Vercel's.
- **CNAME, name `www`:** GoDaddy ships a default one pointing at `@` or the domain itself. **Edit**
  it to the target Vercel gave.
- TTL: leave the default (1 hour) or choose the shortest offered.
- **Forwarding** (a separate section on the same page): must be **off**. GoDaddy forwarding and
  these records fight each other.
- **Do not touch:** the `NS` and `SOA` rows, and every record noted in Task 1 as Resend's.
  Deleting one of those breaks email, and nothing will say so until a send fails.
- **Check (agent, from the terminal):**
  ```bash
  nslookup wardleadershiptools.com
  nslookup www.wardleadershiptools.com
  ```
  Then the user refreshes Vercel's Domains page until both rows read **Valid Configuration** and a
  certificate is issued. Usually minutes; GoDaddy can take up to an hour. Waiting is normal — do
  not change records again while waiting.
- **Check (agent):**
  ```bash
  curl -sI https://wardleadershiptools.com/login | head -5
  curl -sI https://www.wardleadershiptools.com/login | head -5
  curl -sI https://wardleadershiptools.com/dashboard | head -5
  ```
  Expect 200 on the first, a redirect to the non-`www` address on the second, and
  `307 → /login?redirectTo=%2Fdashboard` on the third (the middleware guard, as recorded in
  `plans/deployment.md`).
- **Tell the user not to sign in on the new domain yet.** Sign-in itself would work, but a password
  reset from there would link to the old address until Task 4.

### Task 4: Teach Supabase the new address
**File:** none (Supabase dashboard)
**Action:** Add the new domain to the allow list, then switch the Site URL.
**Details:**
- Authentication → **URL Configuration**.
- **Redirect URLs — add first:** `https://wardleadershiptools.com/**`. Adding is harmless; the old
  entries keep working.
- **Keep** `http://localhost:3000/**` (local development) and the existing
  `https://wlt-iota.vercel.app/**` entry (still needed until Task 8, harmless after).
- **Site URL — then change** to `https://wardleadershiptools.com` (no trailing slash). Save.
- **Email templates** (Authentication → Emails → Templates): open *Reset Password* and *Confirm
  signup* and look for the old address typed in by hand. Expected: none, only placeholders such as
  `{{ .ConfirmationURL }}`. If one is found, replace it with `{{ .SiteURL }}` and tell the user why.
- This step answers the scope's third open question; record the answer.

### Task 5: Set the two settings in Vercel and redeploy
**File:** none (Vercel dashboard)
**Action:** Set the site address and the app's sender, for the **Production** environment.
**Details:**
- Settings → Environment Variables:
  - `NEXT_PUBLIC_SITE_URL` = `https://wardleadershiptools.com` — no trailing slash. Add it, or edit
    the existing value found in Task 1. Not sensitive; leave the Sensitive flag **off**.
  - `RESEND_FROM_ADDRESS` = `Ward Leadership Tools <noreply@wardleadershiptools.com>` — the name
    before the angle brackets is what an inbox shows as the sender. The plain address alone also
    works. Not sensitive.
- **Do not rename, re-prefix or re-enter any other variable.** In particular do not add
  `NEXT_PUBLIC_` to `RESEND_FROM_ADDRESS` (CLAUDE.md rule 4's neighbour: server-side settings stay
  server-side).
- **Redeploy:** Deployments → the latest Production deployment → ⋯ → **Redeploy**. A changed
  variable does nothing until this is done.
- **Check:** when it finishes, the footer on any signed-in page still reads "Version" followed by
  the same seven characters as before (same code, new settings).
- **Say this to the user once:** nobody can reply to `noreply@`. There is no mailbox at the domain,
  so a reply bounces. That matches how every email in the app is written today.
- If the Resend API key in Vercel was created restricted to a different domain, sends will be
  refused; the reason will be in **Resend → Logs**. Fix by creating a key allowed to send from
  `wardleadershiptools.com` and replacing the value — the user does this; never paste the key into
  the conversation.

### Task 6: Change the sender on Supabase's own email
**File:** none (Supabase dashboard)
**Action:** Point the password-reset sender at the new address.
**Details:**
- Authentication → Emails → **SMTP Settings**.
- **Sender email:** `noreply@wardleadershiptools.com`. **Sender name:** `Ward Leadership Tools`.
- Leave host, port, username and password as they are — they already point at Resend and worked on
  2026-08-18.
- Authentication → **Rate Limits:** read the "emails per hour" figure aloud. It is fine for one
  ward; note the number in `plans/deployment.md` so a future "resets stopped arriving" has a first
  place to look.
- **Optional but recommended, GoDaddy:** if no `_dmarc` record exists, add a `TXT` record, name
  `_dmarc`, value `v=DMARC1; p=none;`. Gmail and Outlook treat mail from a domain without one with
  more suspicion. `p=none` only asks for reports and blocks nothing. Ask the user before adding it.

### Task 7: Prove it on the new domain
**File:** none
**Action:** Walk the success criteria on `https://wardleadershiptools.com`. The old address is still
live at this point, so a failure here locks nobody out.
**Details:**
- **Adult sign-in:** sign in, reload, still signed in. (Being asked to sign in again on the new
  address is expected — a sign-in belongs to one address.)
- **Youth sign-in:** `/pin` on a phone, on the new domain.
- **Password reset, the test that matters:** on `/forgot-password`, request a reset for an account
  whose email is **not** the Resend account owner's. Confirm: it arrives; the sender reads
  `noreply@wardleadershiptools.com`; the link opens `wardleadershiptools.com/reset-password`; the
  reset completes; the next sign-in uses the new password.
  - If the account must be created for this, put it in the **Development Ward**
    (`00000000-0000-4000-8000-000000000001`), never the Harness Test Ward (deployment retro: the
    next seed deletes it there).
  - If nothing arrives: **Resend → Logs** first, then **Supabase → Logs → Auth**. The form's own
    message is the same on success and failure by design.
  - Check the spam folder before concluding it failed, and say which folder it landed in.
- **Programme:** open an approved programme, generate the PDF again, and scan the QR with a phone:
  it opens `wardleadershiptools.com/public/…`. If the route answers with the "printed without a QR
  code" warning, the redeploy in Task 5 did not pick up `NEXT_PUBLIC_SITE_URL`.
- **Email is on:** the programme's Distribute control offers email, not "Publish to the public
  page". Do **not** press send to a real ward list as a test (rule 3: a send is a human decision).
- **Audit trail (agent may suggest, user confirms):** the sign-ins above wrote `login` rows.

### Task 8: Forward the old address
**File:** none (Vercel dashboard)
**Action:** Make `wlt-iota.vercel.app` redirect to the new domain (D3). **Only after Task 7 passes.**
**Details:**
- Settings → Domains → the `wlt-iota.vercel.app` row → **Edit** → **Redirect to** →
  `wardleadershiptools.com`. Choose the permanent option (308) if offered a choice.
- Confirm `wardleadershiptools.com` is the one marked as the production domain.
- **Check (agent):**
  ```bash
  curl -sI https://wlt-iota.vercel.app/login | head -5
  ```
  Expect a 308 (or 301) with `location: https://wardleadershiptools.com/login`.
- **Check (user):** scan a QR from a programme printed before today, or open an old bookmark. It
  lands on the new domain.
- If the dashboard does not offer a redirect on the `vercel.app` row, **stop and tell the user**
  rather than improvising one in `vercel.json` or `next.config.ts` — that would be a code change
  this plan does not include and needs its own decision.

### Task 9: Update the deployment notes
**File:** `plans/deployment.md` (modify)
**Action:** Record what is now true. Show the user the planned edits first (three files change in
Tasks 9–11, so CLAUDE.md §10 asks for confirmation).
**Details:**
- **Step 2's table:** it says "Six variables". Add rows for `NEXT_PUBLIC_SITE_URL` and
  `RESEND_FROM_ADDRESS` with their non-secret values, and fix the count.
- **Step 3:** Site URL is `https://wardleadershiptools.com`; list the Redirect URLs as they now are.
- **Step 4's "Current state (2026-08-18): sender is `onboarding@resend.dev`, deliberately"** — do
  not delete it. Add beneath it a dated line: closed 2026-10-10 by ITER-039, sender is now
  `noreply@wardleadershiptools.com` on a domain verified in Resend, in both Supabase SMTP and
  `RESEND_FROM_ADDRESS`; a reset was received at an inbox other than the account owner's.
- **Outcome:** add "Moved 2026-10-10 to **https://wardleadershiptools.com**"; keep the original
  line, and say the old address forwards.
- **New section "Custom domain — 2026-10-10":** registrar GoDaddy; the DNS records as entered (A
  and CNAME values, and the note that Resend's records live beside them); `www` redirects to the
  main address; the old address forwards; the Supabase email rate limit read in Task 6; whether a
  `_dmarc` record was added; the Task 1 starting values as the rollback.
- **Pitfalls, add three:** GoDaddy's default parked A record and `www` CNAME must be edited, not
  added beside; GoDaddy Forwarding must be off; there is no mailbox at the domain, so a reply to
  any app email bounces.
- Match the file's existing voice and formatting. No secrets, no key values.

### Task 10: Update the example environment file
**File:** `.env.local.example` (modify)
**Action:** Change the example in the `NEXT_PUBLIC_SITE_URL` comment from
`https://wlt-iota.vercel.app` to `https://wardleadershiptools.com`. Nothing else in the file changes.

### Task 11: Update scenario 034's setup note
**File:** `testing/scenarios/program/scenario-034-print-it-and-fold-it/scenario.md` (modify)
**Action:** In "Before you start", the line
`deploy and set NEXT_PUBLIC_SITE_URL=https://wlt-iota.vercel.app` becomes the new domain.
**Details:**
- Then run `npm run manifest` and check `git status`: if `manifest.json` did not change, good; if
  it did, the change should be that one address and nothing else.

## Testing Strategy

**No automated tests are added, and that is deliberate.** No application code changes, and the
thing being changed lives in four vendors' dashboards where a test process cannot reach it. The
existing unit tests around the code paths involved are unaffected and stay as they are:
`tests/lib/qrCode.test.ts` and the programme distribution tests exercise `resolveSiteUrl()` and
`emailConfiguration()` against environment values they set themselves.

The evidence is Task 7's walk on the deployed site plus the `curl` and `nslookup` checks in
Tasks 3 and 8. Following `plans/deployment.md`'s own rule: a green deploy proves nothing about the
environment, so the walk is the test.

## Test Scenarios (Harness)

None. A harness scenario seeds database state, and nothing here depends on database state that is
hard to set up: the checks are a sign-in, a password reset and a QR scan against the live site.
Task 7 is the checklist. Scenario 034 gains a corrected address in its setup note (Task 11) and is
otherwise unchanged.

## Validation Commands

Only documentation and one comment in an example file change, so the full suite (50–75 minutes
against the shared hosted database) and a production build are not warranted. Run the cheap checks:

```bash
# Linting
npm run lint

# Type checking
npm run typecheck

# The tests nearest the settings involved
npx vitest run tests/lib/qrCode.test.ts

# Scenario manifest still in step with the scenario files
npm run manifest
git status --short
```

Live checks, after Task 8:

```bash
curl -sI https://wardleadershiptools.com/login | head -5
curl -sI https://www.wardleadershiptools.com/login | head -5
curl -sI https://wardleadershiptools.com/dashboard | head -5
curl -sI https://wlt-iota.vercel.app/login | head -5
```

Memory is tight on this machine: do not start `npm run dev` or `npm run build` for this work.

## Integration Notes

- **Everybody is signed out once.** A sign-in cookie belongs to one address. Expected; tell the
  user before Task 8, since that is when people on the old address are moved.
- **Rollback, any time before Task 8:** the old address is untouched, so nothing needs undoing for
  the site to keep working. To back out fully: Supabase Site URL back to the Task 1 value, the two
  Vercel variables back to their Task 1 values, redeploy, Supabase SMTP sender back to
  `onboarding@resend.dev`. After Task 8, also remove the redirect on the `vercel.app` row.
- **Programmes approved before the move** keep whatever link their PDF was generated with. The
  forward covers them; regenerating the PDF gives a new-domain QR.
- **The harness and the test suites** talk to the hosted database, not to the site address, so
  they are unaffected. `HARNESS_TEST_PASSWORD` stays out of Vercel.
- **Preview deployments stay disabled** (decided 2026-08-18). Not revisited.
- **Not in this plan:** a mailbox or reply address at the domain; an emailed invite flow (invites
  are still copy-a-link); the scheduled agenda email (P12); any change to `vercel.json`.
- **Docs:** `plans/deployment.md` is the record. `CLAUDE.md`, `SPEC.md` and `FEATURES.md` name no
  address and need no edit. The `/execute` retro should link `fixes`/`related` to the `deployment`
  retro, whose "No custom domain" and test-sender gaps this closes.
- **The user commits manually.** Do not commit or push.
