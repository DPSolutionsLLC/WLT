# ITER-017: Token Counts Are Redacted Out of Every AI Audit Row

**Type:** Bug
**Status:** Backlogged
**Created:** 2026-08-24

## Summary

Every AI route logs `outputTokens` to the audit log so spend is traceable. The audit log stores
the string `"[redacted]"` instead of the number, every time, because `writeAuditLog`'s
sensitive-key filter matches the substring `token` in the field name `outputTokens`.

It is failing **safe** — nothing is leaking — but the one signal these rows exist to carry is
silently gone, and has been since `ai-a`.

## Context

Found 2026-08-24 walking scenario 027 for `ai-d`. Every one of the six resolver calls wrote an
audit row of this shape:

```json
{"kind":"filter","phrase":"talks by President Nelson","outputTokens":"[redacted]"}
```

The `kind` and the `phrase` came through. The number did not.

## Root cause

`lib/audit/writeAuditLog.ts` redacts by KEY NAME against:

```
/pin|token|secret|password|passcode|credential|api[_-]?key|\bkey\b|hash|authorization|note/i
```

`outputTokens` contains `token`, so it matches. The pattern is a substring test with no word
boundary on that alternative — unlike `\bkey\b`, which does have one.

The pattern is deliberately over-broad, and its comment says so: it is "a backstop, not the
rule", and `note` is included even though it over-matches, because an audit row is
bishopric-readable and a private note landing in one would defeat CLAUDE.md rule 5 entirely.
**That reasoning is sound and should not be weakened.** The problem is narrower: a token COUNT is
not a token.

## Blast radius — wider than the route that found it

Every AI route logs this field. All of them have been redacting it since they shipped:

- `app/api/topics/ai-suggest/route.ts` — `topic_candidates_generated` (`ai-c`)
- `app/api/assignments/[id]/ai-message/route.ts` — the message-draft rows (`ai-c`)
- `app/api/knowledge/filters/resolve/route.ts` — `retrieval_filter_resolved` (`ai-d`)
- `app/api/ai-settings/preview/route.ts` — check whether it logs usage too

So there is **no usable record of AI spend anywhere in this app**, and nobody noticed because the
rows look populated.

## Options

1. **Rename the field.** `outputTokenCount`, or `usageOut`. One line per route, no change to the
   safety net. Cheapest and least risky, but it leaves the trap armed for the next person who
   writes `tokensUsed`.
2. **Add a word boundary to the `token` alternative** (`\btoken\b`). Fixes the class rather than
   the instance, but `outputTokens` still would not match `\btoken\b`… and `token` on its own
   still would. Needs care: `access_token` must keep matching.
3. **Redact by VALUE SHAPE as well as key name** — never redact a `number`. A token, key or hash
   is always a string; a count never is. Probably the real fix, and it makes the backstop smarter
   rather than looser.

**Leaning option 3, with 1 as the safe interim.** Option 3 is a change to a security-relevant
helper and deserves its own tests over the redaction matrix, including the `note` case that
CLAUDE.md rule 5 depends on.

## Definition of done

- [ ] `outputTokens` (or its replacement) appears in `audit_log.detail` as a NUMBER
- [ ] `tests/lib/audit.test.ts` gains a case proving a numeric field survives redaction
- [ ] `tests/lib/audit.test.ts` keeps proving that `note`, `pin`, `api_key` and `access_token`
      are still redacted — this must not loosen
- [ ] Every AI route audited for the same field name, not just the one that found it

## Open questions

- Is there value in backfilling? No — the numbers were never stored. History starts at the fix.
- Should usage live in the audit log at all, or in its own table? The audit log is a record of
  **who did what**; cost is a different question and may deserve a different home. Worth deciding
  before adding more usage fields to it.
