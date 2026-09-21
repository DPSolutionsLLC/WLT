# P10 — Message & Zoom

**Depends on:** P3, P5 (Zoom referral needs To Do). **Size:** Medium. **Status:** Stub — flesh out with `/planning` when approached.

**Load with this:** [prototype/module-map.md](prototype/module-map.md), and build-notes-raw.md §`messages-role-based-groups`, §`zoom`, §`zoom-referral-requests`.

> **This is a stub on purpose.** It carries the scope, the dependencies and the known traps, so
> `/planning` can write the real plan against what the code actually looks like by then rather
> than against a guess made on 2026-09-20. Do not treat the absence of detail as absence of scope.

> **Both of these were out of scope until 2026-09-20.** `plans/INDEX.md` listed "Org discussion
> threads — ship no UI" and "email or push notifications" as v1 guardrails; the user brought both
> in. See CLAUDE.md §9.

## Message

**Groups hold role ids, never people** — a calling changing hands needs nothing re-created. But
a message's `authorName` is **snapshotted at send time**, so old messages keep who actually said
them. The calling label stays on every message as the historical record of which role they were
speaking as.

History visibility is a **per-group setting**, not a global policy. The confidentiality notice —
no real privacy once a role changes hands — shows every time the group is opened.

**Removal and leaving are announced events** posted into the timeline itself, not a separate
notification system. **No creator/owner role**: anyone in a group can remove anyone, including
themselves. A creator-only gate creates its own edge case the moment that calling changes hands.

Personal nicknames layered over the canonical name, resolved in exactly one place.

> ⚠️ **A known-unfixed bug:** the sticky header's scroll-direction reveal stutters on a fast
> scroll after two fix attempts. Re-verify in this environment before assuming it is fine; a
> transform-based slide rather than `max-height` is the likely clean rebuild. decisions.md §6.

## Zoom

**The risk named plainly:** almost all of this module's value needs infrastructure that does not
exist — Zoom Server-to-Server OAuth, a webhook receiver, a scheduled distribution job, email
sending, and an OBS companion agent on a dedicated machine for muting during ordinances. The
prototype says outright that almost none of it can be faked.

**Build the parts that are real without that infrastructure:**
- The recipient list — roster or manual, soft-off opt-out with a visible timestamp, and a merge
  path where **attendance references the recipient row** so a merge needs no history migration
- Correction-triggers-alert: editing a roster-sourced contact fires an alert that ward records
  are stale, separate from updating the distribution list
- Self-service opt-out and missionary referral via the unauthenticated token pattern
- Concurrency detection — a real algorithm over attendance windows

**Treat the OAuth/webhook/OBS half as a separate infrastructure decision**, not a slice.
Credentials storage in particular needs an encrypted-at-rest answer this project has never had.
