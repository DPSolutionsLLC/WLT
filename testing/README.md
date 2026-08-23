# Testing Harness

Scenario-based manual testing. Each scenario seeds a known database state, then gives you a
checklist to walk through in the running app.

This is **not** the automated test suite. Vitest (`npm test`) covers RLS policies, permission
helpers, and pure logic. The harness covers what only a human can check: does the screen show
the right thing, does the flow make sense, does the error message help.

---

## How this differs from a normal harness

There is no local database and no emulator — the dev machine cannot run one (CLAUDE.md §9), so
everything targets the linked hosted project. Two consequences shape the whole design:

1. **Isolation is a ward, not an ID prefix.** Every table in this schema is ward-scoped and
   cascades from `wards` on delete, so one ward id is a complete unit of cleanup. All harness
   data lives in the **Harness Test Ward**, `11111111-1111-4111-8111-111111111111`.
2. **Cleanup deletes that one ward and nothing else.** It never truncates and never runs
   `db:reset`, both of which would wipe the real database. `testing/infrastructure/cleanUp.ts`
   refuses to run if its target is not a well-formed id, or if it ever matches the Development
   Ward.

---

## One-time setup

Add a password for the harness accounts to `.env.local` (or `testing/.env`):

```
HARNESS_TEST_PASSWORD=pick-something-at-least-12-chars
```

It is not hardcoded because harness accounts are real accounts that can sign in to the real
app on the same project as real data.

No `npm install` is needed. The harness runs on Node's built-in TypeScript stripping and uses
the `@supabase/supabase-js` and `dotenv` already in the root `package.json`.

---

## Daily use

```bash
npm run seed -- <scope>/<scenario-folder>   # wipe harness data, seed this scenario
npm run seed -- <scope>/<folder> --no-clean # seed on top (for part 2 of a journey)
npm run seed:clean                          # remove all harness data
npm run manifest                            # rebuild scenarios/manifest.json
npm run harness:typecheck                   # typecheck the harness itself
```

Then `npm run dev`, open http://localhost:3000, sign in with the account the scenario names,
and work down its checklist.

**Clean up when you are done.** Harness accounts can sign in, so leaving them on a shared
project leaves working logins behind.

---

## Creating a scenario

Use `/new-scenario <scope>`, or copy by hand:

```
testing/scenarios/<scope>/scenario-NNN-<slug>/
  scenario.md   from _templates/scenario-template.md
  seed.ts       from _templates/seed-template.ts
```

Then `npm run manifest`.

`seed.ts` must export `async function seed(): Promise<void>` and build its state from the
factories in `infrastructure/seedUtils.ts` — never by writing raw SQL, and never against a
ward other than the test ward.

### Writing a good checklist

- One observable fact per line. What you should **see**, not what the code should do.
- Cover the failure path, not just the happy one. Most of this app's rules are about what
  should *not* appear.
- If a check can be made without a browser, it belongs in Vitest instead.
- **Write every check against the RUNNING APP, not against the plan or the code.** Two checks in
  scenarios 016 and 017 described states the app cannot reach — a disabled button on a slot that
  has no button, and a backward-move control that was never built. Both were written from what
  the code implied rather than from what the screen does, and only a walkthrough found them.
- **Group the checklist by what kind of answer each check has** — see the protocol below. A flat
  37-item list gets ticked, not read.

---

## The walkthrough protocol

Run a scenario with **`/walk <scope>/<scenario-folder>`**. It drives the real app through
Playwright, does everything checkable itself, and hands back only the judgements that need a
person. The full method lives in the global command; what follows is the WLT-specific half.

### Split every checklist in two

**Machine-checkable** — a stored value, a row count, a refused permission, an audit row, an
element present or absent, no horizontal overflow at 375px, tap targets ≥ 44×44, no raw uuid on
screen. `/walk` does these and reports them settled.

**Needs a human eye** — whether the wording lands, whether an empty state reads as deliberate,
whether an absence reads as meaningful. These come back as a question plus a screenshot.

If a passing Vitest test would fully satisfy you, the check is machine-checkable — and if it is
*purely* logic, it should have been a Vitest test rather than a checklist line at all.

### Verify writes against the database, never the UI

The harness talks to the **hosted** project, so a service-role client can read any row back:

```ts
import { createClient } from "@supabase/supabase-js";
const db = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);
const WARD = "11111111-1111-4111-8111-111111111111";
```

A screen can render a value the server never stored, and an optimistic TanStack Query update is
indistinguishable from a successful save until something reloads. **Read the row back.** Record
the actual value — a timestamp, a count, the exact string — not the word "passed".

Two things worth reading back on almost every walk:

- **`audit_log`** filtered to this ward and module. Every mutation writes one (CLAUDE.md rule 6),
  and it must carry ids and short descriptions — **never a member's name** (rule 8).
- **The row you just wrote**, to prove a replace replaced rather than inserted, or that a refused
  write genuinely wrote nothing. An RLS-denied UPDATE is a zero-row success, not an error.

### Where screenshots go

`review-shots/`, excluded via `.git/info/exclude`. **Do not delete them after the review** —
they are the evidence behind the confirmation record, and a regression months from now may want
them. Exclude, do not remove.

### Record the walk

Append a **Walkthrough record** to the scenario file naming the date, **who drove it**, the
observed values, and any checklist corrections made. Whether a human used the app or an agent
drove it and a human reviewed screenshots is a real difference in evidence, and `/confirm`
carries it forward into the baseline.

---

## What the factories cover

`infrastructure/seedUtils.ts` has factories for the roster, calendar, talk pipeline, music and
programs, visits and private notes, youth activities, goals, agendas, tithing, sacrament
administration, and notifications.

Accounts come in two shapes. `createTestUser()` builds an adult account that signs in with an
email address and `HARNESS_TEST_PASSWORD`. `createYouthAccount()` builds a
`sacrament_manager` account that signs in at `/pin` with a username and a PIN — no email, and
the PIN is a parameter because the checklist has to name the digits the tester will type. Pair
it with `setYouthLoginAttempts()` to seed a failed-attempt count, which is the only practical
way to reach the lockout boundary more than once.

Not yet covered, because those phases have no schema use yet: knowledge documents and
embeddings (phase 5), AI settings (phase 6), and conversation threads (no v1 UI). Add factories
alongside the phase that needs them.

`seedNotificationTriggers()` matters more than it looks. A ward created outside
`supabase/seed/ward.sql` has no `notification_settings` rows at all, and `emitNotification()`
warns and sends nothing for an unknown key — so any scenario expecting a notification must
call it.

---

## When something fails

Copy `failure-reports/_template.md` into `failure-reports/` with a dated name and fill it in.
It ends with a checklist against the CLAUDE.md §4 non-negotiables; anything ticked there
outranks a feature bug.
