---
id: program-b-builder-screen
type: feature
iter: null
commits: ["b8470ab"]
date: 2026-08-24
files:
  - app/(app)/program/page.tsx
  - app/(app)/program/[sunday_id]/page.tsx
  - app/(app)/program/[sunday_id]/ProgramBuilder.tsx
  - app/(app)/program/[sunday_id]/MeetingOrderForm.tsx
  - app/(app)/program/[sunday_id]/MissingPanel.tsx
  - app/(app)/program/[sunday_id]/RefreshButton.tsx
  - app/(app)/program/[sunday_id]/AiEditPanel.tsx
  - app/(app)/program/[sunday_id]/BuildProgramButton.tsx
  - components/program/ProgramPreview.tsx
  - components/program/DraftDiff.tsx
  - components/program/ProgramStatusBadge.tsx
  - lib/program/missingMessages.ts
  - lib/program/requests.ts
  - lib/program/queries.ts
  - lib/ai/programEdit.ts
  - lib/ai/moduleInstructions.ts
  - lib/validation/aiProgramEdit.ts
  - app/api/programs/[id]/ai-edit/route.ts
  - types/domain.ts
  - SPEC.md
related:
  - program-a-draft-and-approval
  - ai-a-client-and-settings
  - ai-b-knowledge-and-retrieval
  - ai-c-feature-routes
  - talks-b-month-planner
  - talks-c-prayers-topics
  - calendar-b-month-view
  - roster-b-picker-and-orgs
  - route-tests-and-realtime
---

## What was done

The on-screen half of the sacrament program builder: a Sunday list, a field-by-field editor over
`program-a`'s draft, a missing-work panel written as sentences, a shared diff panel that both the
refresh flow and the AI editor render, and `POST /api/programs/[id]/ai-edit` — plain-English editing
that returns a proposed draft and **writes nothing**. Saving stays the existing `POST /api/programs`
call a person makes by pressing Apply.

Scenario 031 was walked in a real browser. It found three defects, a fourth surfaced while fixing
them, and one judgement that came back a fail and rebuilt the preview.

## Key decisions

- **The sentences already existed, so no second copy was written.** The plan asked for a new
  `MISSING_MESSAGES` map; `types/domain.ts` already held `MISSING_FIELD_LABELS` with exactly those
  sentences. `lib/program/missingMessages.ts` consumes it and adds only grouping, counting and the
  plural form. The closed-`Record` compile discipline is unchanged, one file earlier.
- **`speaker_slot`'s count comes from the speakers, never from `missing`.** `assembleDraft` emits the
  key once however many slots are open (it is a `.some()` check), so counting the array would always
  say one. Scenario 031 seeds **two** open slots for exactly this reason.
- **The AI edit route re-validates what the SDK already parsed.** Structured output makes the response
  parseable, `programDraftSchema` makes it valid, the diff makes it visible. The keywords the API
  cannot constrain — the `version` literal, the date pattern, the enums — are downgraded by the SDK
  into schema descriptions, so "the SDK parsed it" and "this app can print it" are not one claim.
- **`date` and `sundayType` are shown but not editable.** They identify which meeting this is; a
  program disagreeing with its Sunday would be a program for a meeting that does not exist.
- **`missing` is not recomputed while somebody types.** It moves on a refresh or an AI edit. The
  alternative is a second copy of the missing-field rule on the client, and
  `presiding_unconfirmed_ward_conference` is not derivable from the draft alone. Said out loud under
  the panel instead; the walk confirmed one sentence is enough.

## What the walk changed

- **An omitted line reads as a failure, not as an absence.** `ProgramPreview` first deleted every
  meeting-order line with nobody on it, reading `talks-c`'s "an absence renders as an absence" as
  "delete the row". With five lines gone the preview read as a program that had **failed to load**.
  `talks-c` actually says a missing organist is *a blank* — not "Never", not "None assigned" — which
  is a weaker and more literal thing than no line at all. The nine fixed lines of a sacrament meeting
  now always render, greyed where empty; the optional blocks (ward business, musical number,
  announcements) are still omitted, which is a different decision because no slot stands open for
  them.
- **A claim the client cannot verify is a silent failure pointed the other way.** The builder printed
  "Sent for approval. The bishopric has been notified." while **zero** notification rows were written.
  `emitNotification` is fire-and-forget and returns silently on an unknown trigger key, so the screen
  can never know. It now says only "Sent for approval."
- **A cache write can be overwritten by a refetch already in flight.** Found by the regression test
  for the above, not by clicking: writing the new status into the TanStack cache raced a query issued
  at mount, reverting the badge with no error anywhere. This is `ai-a`'s stale-client failure in
  another costume. Every cache write in `ProgramBuilder` now cancels in-flight queries first.
- **"The next 1 Sunday that holds a sacrament meeting."** The singular now drops the count entirely.
  Found on the very page whose scenario exists to catch that class of bug (`ai-b`).

## Pitfalls for whoever comes next

- **The harness cannot test any program notification.** `NOTIFICATION_TRIGGERS` in
  `testing/infrastructure/seedUtils.ts` has **no `program_*` keys**, while
  `supabase/seed/notification_triggers.sql` defines three. In production the notification works; in
  the harness `emitNotification` warns to the console and returns. Scenarios 028, 029 and 031 all
  inherit this. Left unfixed here on purpose — it is shared infrastructure and predates this plan.
- **A 20px inline text link is the app's established pattern**, not a regression. `/assignments`
  renders "Open this Sunday" at the same height with a byte-identical class string. A checklist line
  demanding 44×44 of *every* tap target fails on every screen in the app; scope it to buttons and
  inputs.
- **A program at `pending_approval` is still editable.** `isLocked()` covers `approved` and
  `distributed` only. A secretary can therefore change a program while the bishopric reads it, and
  approve does not check that the draft is the one they saw. That is `program-a`'s design, recorded
  here because it surprised the walk.
- **An `AnthropicError` from the SDK's own Zod parse still becomes a generic 500.** `translateError`
  rethrows unknown errors untouched and `AnthropicError` is not an `APIError`. The ai-edit route's own
  `safeParse` covers the realistic cases with a written 422, but the SDK path is unfixed and
  `topics/ai-suggest` shares it.
- **`outputTokens` in the ai-edit audit row stores `"[redacted]"`** — ITER-017, pre-existing. Logged
  anyway, exactly as `ai-c`'s routes do, so this route is fixed along with them.
