---
id: sacrament-f3a-time-elsewhere
type: feature
iter: null
commits: ["4fcd059"]
date: 2026-09-30
files:
  - lib/todos/timeElsewhere.ts
  - lib/todos/askLinks.ts
  - lib/todos/queries.ts
  - lib/todos/askSource.ts
  - lib/sacrament/conductorHandover.ts
  - app/(app)/todos/AskDetails.tsx
  - types/domain.ts
related: [sacrament-f2-asks-follow-the-conductor, sacrament-f1-send-asks-and-answers, p5-c-schedule-and-my-appointments]
---

## What was done
P4 Sacrament slice `f3a`, the first half of f3, split out because it changes f2's shipped
behaviour. **Nobody inherits another leader's appointment** (decision A1, 2026-09-30). A handover
no longer copies the old conductor's `scheduled_for` / "With" onto the new copy. The old copy keeps
them as its record. The new holder's ask card says instead: *"Peter Nakamura had this set for Sat,
Sep 26, 7:00 PM with Maria Lopez."* It reads "has" while the other copy is still open, which is the
case f3b's assistant will meet. The line disappears once the owner sets their own time.

## Key decisions
- **Reversal of f2's "the appointment follows the work."** Walking scenario 079 had shown the new
  conductor's My Appointments holding a meeting somebody else arranged around their own week. The
  user's answer: they need to *know* the time, so they can fit it in or reschedule. It should not
  be put on their calendar.
- **Read live, never copied into notes.** `listAskCopies()` (service role, in `askLinks.ts`
  beside the other ask reads) selects only a time, a "with" name and the holder's name. The select
  list is the privacy guarantee: another leader's title, notes and steps are never read. It is the
  first read in the app that shows one leader anything from another's to-do, which is why it is
  this narrow. The pure chooser is `lib/todos/timeElsewhere.ts`, so tests import it without a
  database client. That split differs from the plan's single `askElsewhere.ts`.
- **Which copy counts:** same talk, a different holder, a time set, and either still open or closed
  as `handed_over`. Every other close (answered, released, speaker changed, told) makes the time
  meaningless. An open copy outranks a handed-over one, and after that the most recent wins.
- **Filled in by the To Do read only** (`listTodos`, `getTodo`), and only for an open,
  unscheduled ask on a talk that is on. `mapAskSource()` sets `timeElsewhere: null`, so My
  Appointments, which lists only scheduled items, never shows it. `updateTodo` clears it in its
  response when the owner schedules, so the note goes without a refetch.
- **`AskDetails` gained a required `wardZone`.** The line is a time somebody turns up at, so it
  renders in the ward's zone (rule 12). The test asserts that 01:00 UTC on the 27th reads Sep 26 at
  7:00 in Denver.
- **The chooser's filter was proved able to fail:** loosening it to `true` turned "ignores a copy
  closed any way but a handover" red. The negative cases each differ from a valid copy in exactly
  one field.
