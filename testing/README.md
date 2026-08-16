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

---

## What the factories cover

`infrastructure/seedUtils.ts` has factories for the roster, calendar, talk pipeline, music and
programs, visits and private notes, youth activities, goals, agendas, tithing, sacrament
administration, and notifications.

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
