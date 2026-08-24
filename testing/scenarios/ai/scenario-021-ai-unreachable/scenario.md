---
name: The AI is unreachable
scope: ai-a-client-and-settings
part: 2
tags: [ai, full, failure]
prerequisites: none
---

## Purpose

The phase plan's most important pitfall is a **silent AI failure**: a spinner that never resolves,
an empty output box that looks like an answer, a message so generic the bishopric cannot tell a
missing key from a busy server. `tests/lib/aiErrorHandling.test.ts` already proves the six error
kinds are distinct and that an unknown error is rethrown rather than dressed up. What it cannot
show is **what a bishop actually sees**.

That cannot be seeded — it is an environment manipulation, which is exactly why this is a scenario
and not a test. Two of the six failures are reachable by hand without touching any code: an
invalid key and an absent one.

## Seed Data

Reuses scenario 020's seed exactly — one ward, three users, two saved AI settings versions.

| Entity | Detail |
|---|---|
| Ward | Harness Test Ward |
| Users | `bishop` (bishop, Mark Andersen) |
| | `counselor1` (counselor, Peter Nakamura) |
| | `secretary` (ward_secretary, Ruth Kaufman) |
| AI settings | 2 versions — 12 July 2026 and 12 August 2026 |

**Sign in with:** `bishop@harness.wardleadershiptools.test`
**Password:** the value of `HARNESS_TEST_PASSWORD` in your env file.

## Steps

1. `npm run seed -- ai/scenario-021-ai-unreachable`
2. Stop the dev server if it is running.
3. In `.env.local`, change `ANTHROPIC_API_KEY` to an obviously invalid value — for example
   `sk-ant-not-a-real-key`. **Keep a copy of the real one.**
4. `npm run dev`. Sign in as `bishop`, open **AI Settings**, type anything in the preview box and
   press **Preview**. Read what appears, and roughly how long it took.
5. Press **Preview** again without reloading.
6. Stop the server. **Remove** the `ANTHROPIC_API_KEY` line from `.env.local` entirely.
7. `npm run dev`, press **Preview** again, and note how quickly the message appears this time.
8. Scroll down and read the version history.
9. Restore the real key in `.env.local` and restart. Press **Preview** once more.

## Verification Checklist

### Machine-checkable

- [ ] An **invalid** key produces a visible error message, not a spinner that never resolves
- [ ] An **absent** key produces the *not configured* message naming the API key, and it appears
      effectively **instantly** — the client refuses before any network call is made
- [ ] The output area stays **empty** in both cases. There is no blank bordered block presented as
      a draft
- [ ] The Preview button returns to "Preview" — it does not stay stuck on "Running…"
- [ ] Preview can be pressed again straight away, and pressing it clears the old error before
      showing the new one
- [ ] The version history still shows **exactly two** rows — 12 August 2026 and 12 July 2026.
      A failed preview wrote nothing
- [ ] The form's own values are unchanged after every failure
- [ ] With the real key restored, Preview returns real text again with no reload needed
- [ ] The error message contains no API key, no key fragment, and no stack trace

### Needs a human eye

- [ ] Read the absent-key message cold. Does it tell a bishop **what to do next**, or only that
      something went wrong? It should point at an administrator and the API key.
- [ ] Is the invalid-key message *distinguishable* from a "the service is busy" message? If the
      two read the same, six error kinds have collapsed into one and the whole error table is
      wasted.
- [ ] Does the failure read as **the app being honest** rather than the app being broken?
- [ ] Is the error legible at 375px in both themes, and does it stand out from the muted note
      above the button rather than blending into it?

## Failure Behavior

This scenario **is** the failure behaviour. The remaining four error kinds are not reachable by
hand and are covered in `tests/lib/aiErrorHandling.test.ts`:

- `rate_limited` — driven by a mocked `Anthropic.RateLimitError`
- `refused` — driven by a response with `stop_reason: "refusal"`
- `truncated` — driven by a response with `stop_reason: "max_tokens"`
- `unavailable` — driven by `Anthropic.APIConnectionError` and by a 5xx

Do not try to provoke those by hand. If you want to see them in the UI, the fastest honest way is
to make `callClaude` throw the kind you want in a scratch branch and revert it.

## Walkthrough record

Not yet walked.

## Notes

- **Put the real `ANTHROPIC_API_KEY` back** when you are done. Step 9 exists so the scenario
  cannot be left half-finished with a broken environment.
- Next.js reads `.env.local` at startup, so every key change needs a server restart. A change with
  no restart will look like the app ignoring you.
- The invalid-key case does make a real network round trip — the API is what rejects it. Expect a
  short pause before the message. The absent-key case does not, and the difference in speed is
  itself worth noticing.
