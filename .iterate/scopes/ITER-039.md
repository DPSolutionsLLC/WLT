# ITER-039: Move the app to wardleadershiptools.com and send email from it

**Type:** Modification
**Status:** In Progress
**Plan:** plans/custom-domain-and-email-sender.md
**Created:** 2026-10-10

## Summary
Serve the app at `wardleadershiptools.com` instead of the Vercel-assigned address, and send all
email from `noreply@wardleadershiptools.com` instead of the Resend test sender.

## Context
The user bought `wardleadershiptools.com` at GoDaddy and has already verified it in Resend. Until
now the app has lived at `wlt-iota.vercel.app`, and `plans/deployment.md` records that the email
sender was left on Resend's test address *because* no domain was owned. That test sender delivers
only to the Resend account owner's own inbox, so no real ward leader can receive a password reset,
and an adult account has no admin-initiated reset to fall back on. Owning the domain lifts that
limit, which is the larger gain of the two.

The user is a beginner and wants to be walked through the change step by step, across the GoDaddy,
Vercel, Supabase and Resend dashboards.

## Current Behavior
- The site is live at `wlt-iota.vercel.app`. No application code names that address, so the app
  itself does not care which domain serves it.
- Password reset emails take their link from Supabase's Site URL setting, which points at the
  Vercel address. Supabase builds that link itself and ignores the address the visitor is using, so
  a missed setting keeps sending people to the old address with no error anywhere.
- Invite links are built from the address of the incoming request, so they follow the new domain
  with no change.
- Public programme links and QR codes use the `NEXT_PUBLIC_SITE_URL` setting first when it is set.
  A QR code already printed on a paper programme keeps whatever address it was made with.
- Email has two separate senders. Supabase's SMTP settings send password resets, currently from
  `onboarding@resend.dev`. The app's own emails (programme distribution, the music coordinator
  emails) read `RESEND_FROM_ADDRESS`, and stay switched off until that names an address at a
  verified domain.

## Desired Outcome
- The app is served at `wardleadershiptools.com` over HTTPS.
- `www.wardleadershiptools.com` redirects to `wardleadershiptools.com`.
- `wlt-iota.vercel.app` keeps working and forwards to the new domain, so bookmarks and printed QR
  codes do not break.
- Supabase's Site URL and redirect list name the new domain, with localhost kept for development.
- Email comes from `noreply@wardleadershiptools.com` in both places: Supabase's SMTP sender and the
  app's own sender setting in Vercel.
- `plans/deployment.md` records the new address and the new sender, and its "sender is the test
  address, deliberately" note is closed.

Done when all of these hold:
- An adult signs in at the new domain and the session survives a reload.
- A youth signs in at `/pin` on the new domain.
- A password reset requested for an address that is NOT the Resend account owner's arrives from
  `noreply@wardleadershiptools.com`, and its link opens the new domain.
- A programme's public link and QR code point at the new domain.
- The old Vercel address forwards to the new one.

## Scope Notes
- Mostly a dashboard walkthrough; little or no code change is expected. Any environment variable
  changed in Vercel reaches only a new deployment, so a redeploy is part of the steps.
- The domain is already verified in Resend, so the DNS records for sending mail should already be
  in GoDaddy. The website's DNS records are added beside them and must not replace them.
- A cookie belongs to one domain, so everybody is signed out once on the move. Expected, not a
  defect.
- `NEXT_PUBLIC_` values are fixed into the build, so the site address setting needs a redeploy
  before programme links change.
- Programmes approved before the move may hold a link made with the old address. The forward from
  the old address is what keeps those working.
- Preview deployments stay disabled (decided 2026-08-18); this item does not revisit that.
- The harness and the test suites run against the hosted database, not against the site address,
  so they should be unaffected. Worth confirming during planning rather than assuming.

## Open Questions
- Is `NEXT_PUBLIC_SITE_URL` set in the Vercel project today, and to what?
- Does anything need a reply address, or is `noreply@` enough for every email the app sends?
- Does the Supabase email template text mention the old address anywhere?
