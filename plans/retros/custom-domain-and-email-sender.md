---
id: custom-domain-and-email-sender
type: feature
iter: [ITER-039]
commits: []
date: 2026-11-22
files:
  - plans/deployment.md
  - .env.local.example
  - testing/scenarios/program/scenario-034-print-it-and-fold-it/scenario.md
related: [deployment, program-d-pdf-and-distribution, zoom-self-registration, zoom-link-email-and-text]
---

## What was done
The live app moved from `wlt-iota.vercel.app` to **https://wardleadershiptools.com**, and every
email now comes from `noreply@wardleadershiptools.com`, in Supabase's SMTP settings and in the app's
own `RESEND_FROM_ADDRESS`. That closes the deployment retro's test-sender gap: a password reset now
reaches any inbox, and the app's own email (programme distribution, music, Zoom "Email it") is
switched on for the first time. It was a dashboard walkthrough across GoDaddy, Vercel, Supabase and
Resend with no application code change; `plans/deployment.md` records the records, the settings and
the rollback values.

## Key decisions
- `wardleadershiptools.com` is the main address; `www` and the old `wlt-iota.vercel.app` both 308 to
  it, keeping the path, so programme and Zoom QR codes already on paper still work.
- The old address stays on Supabase's Redirect URLs (harmless now it forwards); localhost stays for
  development.
- GoDaddy's existing `_dmarc` (`p=quarantine`) was kept. Resend's DKIM signs for the domain, so the
  plan's optional `p=none` record was not added.

## What differed from the plan (written 2026-10-10)
- **Resend now uses "Forge" records:** `CNAME send` and `CNAME rsend` (`*.forge.rmta.net`) plus the
  DKIM TXT, with no MX record. These are what must survive any DNS edit.
- **Vercel's add-domain flow defaulted to the apex redirecting to `www`**, and the first fix landed
  as a 307. Both were corrected on the Domains page; the deployment Pitfalls now warn about it.
- **`resolveSiteUrl()` had grown three Zoom consumers** since planning (the sign-up page's link and
  QR, a registrant's status-page link, and its share link), so the walk also checked the Zoom
  sign-up QR.

## Pitfall found while validating
Every Vitest file failed before running a test with `TypeError: Cannot read properties of undefined
(reading 'config')` at its first `describe`. Nothing in the project had changed: the session's shell
had started in **`c:\`** (lowercase drive letter, as VS Code opened the folder), and Vitest on
Windows then loads itself twice. Running from `C:\Claude\WardLeadershipTools` made
`tests/lib/qrCode.test.ts` pass, 7 of 7. If every suite fails identically at line one, check the
drive letter before the code.
