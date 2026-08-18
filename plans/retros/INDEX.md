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

## Bug Fixes
