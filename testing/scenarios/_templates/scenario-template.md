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

**Write these against the RUNNING APP, not against the plan or the code.** A check describing a
state the app cannot reach is a broken check, not a broken app — and it will not be caught until
somebody walks it. If you have not seen the screen, do not write the line.

**Group by what kind of answer the check has.** `/walk` does the first pile itself and asks a
person only about the second, so the grouping is what keeps a human's attention on the part that
needs it. A flat list gets ticked, not read.

### Machine-checkable

A stored value, a row count, a refused permission, an audit row, an element present or absent,
no horizontal overflow at 375px, tap targets ≥ 44×44, no raw uuid on screen.

If a passing Vitest test would fully satisfy you, it belongs here. If it is *purely* logic with
no screen involved, write the Vitest test instead and leave it out.

- [ ] …

### Needs a human eye

Whether the wording lands and says the true thing. Whether an empty state reads as deliberate or
broken. Whether an absence reads as meaningful. Whether it is legible one-handed at 375px in both
themes.

Phrase each as something a person can answer yes or no to after looking for two seconds.

- [ ] …

## Failure Behavior

What should happen when things go wrong — the error message, the disabled button, the
redirect. Failure paths are where this app's rules live, so do not leave this empty.

Where a check here has become an automated test, say so and name the test rather than asking a
tester to paste `fetch` calls into a console.

- [ ] …

## Walkthrough record

<!--
Filled in when the scenario is actually walked. Delete this comment and write the record; leave
the section with "Not yet walked." until then, so its state is never ambiguous.

Name the DATE and WHO DROVE IT — a person using the app, or an agent driving it with a person
reviewing screenshots. Those are different evidence and `/confirm` carries the distinction into
the baseline record.

Record OBSERVED VALUES, not "passed" — a timestamp, a row count, the exact rendered string. That
is what a future regression gets diffed against.

Record any CHECKLIST CORRECTIONS made during the walk and why, and anything left unwalked.
-->

Not yet walked.

## Notes

Anything the tester needs to know: known-flaky steps, device-specific behaviour, things that
look wrong but are not.
