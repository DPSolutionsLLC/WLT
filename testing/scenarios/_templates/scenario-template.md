---
name: Short human name for this scenario
scope: ITER-000 or the phase this belongs to
part: 1
tags: [smoke]
prerequisites: none
---

<!--
tags guidance
  smoke — the handful of scenarios you run on every change. Keep this tier under ~10 minutes.
  full  — everything else. Run before a phase closes.
  Add module tags too (auth, roster, talks, visits, youth, program, tithing, sacrament, admin).

part — use when one user journey is too long for a single sitting. Part 1 seeds, part 2
continues from where part 1 left off with --no-clean.
-->

## Purpose

One paragraph. What behaviour is this proving, and why does it deserve a manual walkthrough
rather than a unit test? If the answer is "it is pure logic", write a Vitest test instead.

## Seed Data

What `seed.ts` creates. Keep this in step with the script — it is what the tester reads to
know whether the screen is showing the right thing.

| Entity | Detail |
|---|---|
| Ward | Harness Test Ward |
| Users | `bishop@harness.wardleadershiptools.test` (bishop) |
| Members | 3 adults, 1 youth |

**Sign in with:** `someone@harness.wardleadershiptools.test`
**Password:** the value of `HARNESS_TEST_PASSWORD` in your env file.

## Steps

1. `npm run seed -- <scope>/<this-folder>`
2. `npm run dev`, then open http://localhost:3000
3. Sign in as the account above.
4. …

## Verification Checklist

Each line is one observable fact. Write what you should SEE, not what the code should do.

- [ ] The dashboard shows the ward name "Harness Test Ward"
- [ ] …

## Failure Behavior

What should happen when things go wrong — the error message, the disabled button, the
redirect. Failure paths are where this app's rules live, so do not leave this empty.

- [ ] …

## Notes

Anything the tester needs to know: known-flaky steps, device-specific behaviour, things that
look wrong but are not.
