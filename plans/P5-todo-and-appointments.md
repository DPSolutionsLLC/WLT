# P5 — To Do & My Appointments

**Depends on:** P3. **Size:** Medium. **Status:** Planned in full in
[todo-and-my-appointments.md](todo-and-my-appointments.md) — **read that, not this stub**.

| Slice | What | State |
|---|---|---|
| p5-a | To Do core — migration 081, owner-only RLS, `personal_tools.use`, `/todos` | ✅ Built 2026-09-24 (9290b9f) |
| p5-b | Agenda link and two-key completion — migration 082 | ✅ Built 2026-09-24 (303ed3d) |
| p5-c | Schedule this, and My Appointments — day-grouped, remembered view | ✅ Built 2026-09-24 (pending commit) |

**Load with this:** [prototype/module-map.md](prototype/module-map.md) §2.10, and build-notes-raw.md §`to-do`, §`my-appointments`, §`meeting-invites-role-scoped-appointments`.

> **This is a stub on purpose.** It carries the scope, the dependencies and the known traps, so
> `/planning` can write the real plan against what the code actually looks like by then rather
> than against a guess made on 2026-09-20. Do not treat the absence of detail as absence of scope.

## Why this is early

**To Do is a spine.** Four other things hang off it: Sacrament's finalize→ask→accept/decline
(P4), Agendas' delegate-to-absent-leader (P4), My Appointments itself, and Zoom's referral
assignment (P10). Building any of those first means building a second assignment mechanism and
retiring it later.

## Scope

**To Do** — separate do-date and due-date, not one field. Optional steps with **computed**
progress (zero steps behaves as a plain item; the first step implicitly makes it a project, with
no mode switch). One combined log timeline where automatic step lines interleave with written
notes by time, never two records.

**Two-key completion with agendas** — the agenda item is removed immediately regardless, but a
linked todo is *flagged* rather than deleted; the reverse direction only flags when a link
exists. **Auto-create on assignment**, and on unassignment delete only if untouched, otherwise
unlink and keep.

**My Appointments** aggregates visit appointments, scheduled todos and youth commitments, sorted
chronologically with past items collapsed behind a toggle — **never destroyed**.

## Known traps

- **Everything is role-scoped.** The prototype found visit attendees, todos and youth attendees
  all carrying a hardcoded `"current-user"` string. Here that is `auth.uid()`, but the same
  question applies: an appointment belongs to a **person**, while a meeting invite belongs to a
  **role**. Decide which per entity and write it down.
- **One computation, not two.** The prototype built conflict-checking as a separate function
  from what a recipient would actually see, then folded it back into one. Do not fork it.
- **Google Calendar sync is out of scope** — see plans/INDEX.md. A disabled control with an
  honest note, never one that pretends.
