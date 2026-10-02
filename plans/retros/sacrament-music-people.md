---
id: sacrament-music-people
type: feature
iter: [ITER-038]
commits: []
date: 2026-10-02
files:
  - supabase/migrations/089_sunday_music_review.sql
  - supabase/seed/notification_triggers.sql
  - types/domain.ts
  - lib/music/sundayMusic.ts
  - lib/validation/music.ts
  - app/api/sundays/[id]/music/route.ts
  - app/(app)/music/MusicPeopleForm.tsx
  - app/(app)/music/MusicPersonWindow.tsx
  - app/(app)/music/SundayMusicCard.tsx
  - app/(app)/music/MusicSundayList.tsx
  - app/(app)/music/page.tsx
  - lib/program/gather.ts
  - lib/program/assembleDraft.ts
  - testing/infrastructure/seedUtils.ts
  - SPEC.md
related:
  - sacrament-finalize-hands-off-asks
  - sacrament-finalize-prayers
  - sacrament-f2c-cancelled-sunday-work
---

## What was done

ITER-038 slice `ma` (the first of three). Migration 089 — one migration for all three slices —
adds `sunday_music` (a Sunday's chorister, organist and music submission status), the to-do link
columns, the new close reasons and log kinds, `notification_user_prefs.email_enabled` and three
trigger keys. On `/music` each open Sunday card now has Chorister and Organist lines: press one to
choose a roster member or type a name, ✕ to clear (`PATCH /api/sundays/[id]/music`,
`music.manage`). The programme's Organist and Chorister lines, hard-coded `null` since program-a,
now assemble from it.

## Key decisions

- **`sunday_music` has a SELECT policy and no write policy** (073's `access_requests` shape), so
  every write is the service role behind a route. That makes the route's own checks the whole
  guard: the Sunday and any member id are read through the CALLER's client first. Without the
  roster check a member from another ward is a 500 from the composite key (proved by disabling it).
- **A person is a member OR a typed name**, never both (a CHECK); setting one clears the other.
  The programme follows its name rule: a member is a record name, a typed name is printed verbatim.
- **`gather.ts` carries a narrow `musicPeople`**, not the whole row — the submission status is a
  fact about the workflow, not the meeting, and has no place in a snapshot.
- **The to-do side of 089 lands in the SQL now and in TypeScript in `mb`.** `TODO_LOG_KINDS` /
  `TODO_CLOSED_REASONS` / `Todo.musicLink` are not extended yet: `logLines.ts` is exhaustive over
  the kinds, so extending them here would pull `mb`'s sentences in. The CHECKs admit a superset for
  one commit, which nothing writes.
- **A no-meeting Sunday is a 422**, following `/api/musical-numbers`, not the plan's 400.

## What to watch

- The three trigger keys had to go into the seed, SPEC.md and `NOTIFICATION_TRIGGERS` together —
  `tests/db/notification-triggers-seed.test.ts` diffs all three.
- `mb` must extend `TODO_LOG_KINDS` and `TODO_CLOSED_REASONS` in the same order as 089c/089d.
