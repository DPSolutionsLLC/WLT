# P12 — Scheduler · Notifications · Audit · Dashboards

**Depends on:** most of the P-track. **Size:** Medium. **Status:** Stub — flesh out with `/planning` when approached.

**Load with this:** the retired [11-notifications-admin.md](11-notifications-admin.md).

> **This is a stub on purpose.** It carries the scope, the dependencies and the known traps, so
> `/planning` can write the real plan against what the code actually looks like by then rather
> than against a guess made on 2026-09-20. Do not treat the absence of detail as absence of scope.

The read side of notifications, the audit log viewer, the role dashboards — and **the
scheduler**, which is the reason this phase matters more than it looks.

## The scheduler — one mechanism, for everything

**Nothing in this project fires from a clock.** `pg_cron` is not enabled,
`supabase/functions/` does not exist, and `vercel.json` declares no crons. Nine separate things
have been deferred to "whatever Phase 11 decides", each one computable and firing from nothing:

| Thing | Deferred from |
|---|---|
| `visit_overdue` | Phase 7 |
| `youth_event_uncovered` | `youth-c` |
| The Monday away-digest | `youth-b` |
| `youth_followup_prompt` | `youth-d` |
| ICS re-sync | `youth-b` |
| The scheduled agenda email | Phase 9 §A4 |
| **The Sunday tithing clear** | CLAUDE.md rule 11, changed 2026-09-20 |
| Auto-expiry of past calendar-linked items | the prototype |
| **Rolling the 12-month Sunday horizon forward** | `music-collapsed-list-and-rolling-year`, 2026-09-23 |

~~`refresh_goal_status()`~~ left the list when `goals` was retired in P4.

The ninth is the mildest of them and is named rather than left implicit. `ensureHorizonGenerated()`
keeps a rolling 12 months of Sundays in place, but **it rolls forward only when somebody holding
`calendar.manage` opens `/calendar`**. If only a music coordinator uses the app for three months
the year quietly becomes nine, and it self-heals on the next calendar visit — so unlike the other
eight, nothing is lost and nobody is un-notified, the horizon just shrinks. It belongs here anyway
because the fix is the same fix, and inventing a tenth mechanism for it inside P4 would have
pre-empted the decision this phase owns.

**Settle the mechanism once, for all of them.** Options are a Supabase Edge Function on a
schedule, Vercel cron, or `pg_cron` if it can be enabled. Whichever wins, **CLAUDE.md rule 3
still holds**: no AI output and no message reaches a human without an explicit human action. A
cron may compute, notify and clear — it may not send a draft.

## Auto-expiry needs three different answers, not one sweep

- A **conducting-sheet** item linked to a past event → hide on date
- An **agenda** item linked to a past event → depends on its **discussion status**, not the date;
  a still-pending item silently vanishing buries something nobody resolved
- The **calendar event itself** → never auto-drops. Past events are the record.

**Hide from the active view, never delete.** decisions.md §4.2.

## Also here

- Notification read UI, per-trigger opt-outs, the bell
- The audit log viewer — every mutation has been writing rows since Phase 0 and nothing reads them
- Per-role dashboards (the tile grid from P3 is the shell; these are the contents)
- **Concurrency**, decisions.md §4.1 — never block, last-write-wins for simple toggles,
  **idempotent destructive actions by id**, field-level granularity
- The **issue reports** captured by P3's chrome bar finally get a review screen
