# Retro Context Index

Quick-reference for the retrolearn command. One line per entry.

## Features

- [foundation-a-scaffold](foundation-a-scaffold.md) — Next.js 16 + Supabase skeleton, three client factories, class-based dark mode, Vitest runner (c5ca596)
- [foundation-b-schema](foundation-b-schema.md) — 19 migrations, 49 tables, RLS on all of them, two restricted public views, seed data, generated types (78ef8fe)
- [foundation-c-services](foundation-c-services.md) — scopedQuery, permission matrix, writeAuditLog, emitNotification, six RLS suites, 108 tests (5ccf83a)
- [auth-a-session-shell](auth-a-session-shell.md) — session resolution, adult sign-in, deactivation enforcement, middleware guard, role-filtered app shell, ward-scoped users read (e403c51)
- [auth-b-invites-admin](auth-b-invites-admin.md) — role-bearing invite links, atomic single-use redemption, registration page, admin user management, last-bishop lockout guard (8f10ec1)
- [auth-c-youth-pin](auth-c-youth-pin.md) — youth username+PIN accounts, synthetic .invalid auth addresses, 5-failure lockout, separate youth shell, `pin_hash` dropped (e8f3a66)
- [roster-a-data-and-pages](roster-a-data-and-pages.md) — roster data layer with an active-only default, browse and detail pages, household/member CRUD, bishopric-only member notes, `apply_roster_import`, `users` column grant closed (f185c7d)
- [roster-b-picker-and-orgs](roster-b-picker-and-orgs.md) — frozen controlled `MemberPicker`, native-dialog `Modal`, TanStack Query provider, organization membership with per-member and bulk assign, org-scoped roster default (d6cb4da)
- [roster-c-csv-import](roster-c-csv-import.md) — LCR CSV import wizard, dependency-free RFC 4180 parser, no-write preview, single-transaction apply; scenario 009 walked, preview/result count mismatch and file-changed error message fixed, alias table still unverified against a real export (6d405a6)
- [deployment](deployment.md) — live on Vercel at wlt-iota.vercel.app, Node 22 pinned, previews disabled in `vercel.json`, Supabase auth URLs and Resend SMTP configured, password reset verified end to end; a build with no env vars still exits 0 (0a4c33a, 1febf89)
- [calendar-a-rules-and-api](calendar-a-rules-and-api.md) — UTC date-only helpers, Fast Sunday as a re-running resolution rule with a 409 confirm path, versioned conducting rotation, ward-configurable default speaker count; select-column concatenation and a shape-only date schema both fixed (6d5048f)
- [calendar-b-month-view](calendar-b-month-view.md) — month grid and 375px card list, Sunday detail and editor, the 409 confirm dialog worded by consequence, nine pipeline-stage tokens and real reserved-region props for Phase 4; scenario 010 walked with no code defects, but surfaced that the rotation should be monthly (b4b721d)
- [calendar-c-rotation-cadence](calendar-c-rotation-cadence.md) — weekly/monthly rotation cadence, independent rotations for the six organizations, per-Sunday org conducting, and the first org-scoped write boundary in the app (RLS, not just the route); half-generated months found and made self-repairing; scenario 011 written but not yet walked (13fced6)
- [talks-a-pipeline-core](talks-a-pipeline-core.md) — nine-stage pipeline as a pure state machine, 3-of-3 approval gate with a DB uniqueness constraint behind it, ITER-004 external speakers with an explicit contact waiver, four assignment routes, and the `assignment_reverted` notification calendar-b handed forward (a260ca6)

## Bug Fixes
