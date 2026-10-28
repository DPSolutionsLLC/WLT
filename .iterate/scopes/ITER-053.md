# ITER-053: Zoom link pool, visit hand-out, and invitee list

**Type:** Feature
**Status:** In Progress
**Plan:** plans/zoom-link-pool-and-invitees.md
**Created:** 2026-10-27
**Group:** GROUP-05 — Zoom stream: remote controls and invitees

## Summary
Store a pool of pre-registered personal Zoom join links, hand one out on a visit from a phone
(text / share / QR), and keep a list of everyone holding a link — who they are, who gave or
referred it, and when they last watched.

## Context
Raised 2026-10-27 by the user (from a pasted design prompt, refined in discovery). Sacrament
meeting streams on the church's Zoom account with **no API access**. Zoom registration needs a
unique email per registrant and does not allow editing a registrant afterwards; CSV registrant
import does not work on recurring meetings.

So the ward pre-registers placeholder registrants by hand ("Guest 01", "Guest 02", … using
plus-addressed emails on a ward-controlled Gmail, e.g. `sacrament+guest01@gmail.com`) and stores
each placeholder's personal join link in the app. A link is then given to a real person. This
pool is also what ITER-052's public self-registration draws from, so **this item comes first**.

## Desired Outcome

**Link pool**
- Paste many links at once (placeholder name/email + join URL).
- See available vs. assigned.
- Low-pool warning to the bishopric (e.g. "4 links left").

**Visit hand-out** — phone-first, for a bishopric member on a visit
- Start typing a name → matching **roster members** appear; pick one, or enter a non-member's
  name. Picking a roster member **skips** the member-match task the public page creates.
- Phone, optional email, notes. **Assigned by** filled automatically with the signed-in leader.
- The app takes the next free link and offers: **text it** (opens the leader's own phone
  messaging), **share**, or **show a QR code** on screen.
- The mapping is stored (e.g. Guest 07 = John Smith, phone, date assigned, who assigned it).

**Invitee list**
- Everyone holding a link, whether from a visit or from self-registration (ITER-052).
- Per person: placeholder name, who assigned or **referred** them, **last attended date**,
  **number of Sundays watched** (both filled by ITER-054's import; blank until then).
- **No "regular" / engagement status yet** — decided to wait until real attendance data shows
  what is useful.

**Access**

| | Pool, hand-out, edit invitees | View |
|---|---|---|
| Bishop, 1st & 2nd Counselor | ✓ | ✓ |
| Ward clerk, executive secretary | — | ✓ (read-only) |

## Scope Notes
- Depends on ITER-051 for the Zoom tile itself.
- Non-member names and phones are stored — the first such records in the app. Keep them inside
  the ward boundary (RLS) and out of every public page.
- A person can move from placeholder to real Zoom registration later (with the API). Attendance
  must attach to the **person**, not to the link, so history survives a link change. The
  prototype's Zoom design states the same rule ("attendance references the recipient row").
- A roster-linked invitee whose member record changes must not lose their history.
- SMS is the leader's own phone (`sms:` handoff) — no delivery confirmation (CLAUDE.md §9).
- Future, design for but don't build: with API access, register real people from this flow and
  store Zoom's returned `join_url` instead of drawing from the pool.
- Out of scope: pausing a link (Deferred, needs a Zoom test), attendance import (ITER-054),
  self-registration (ITER-052).

## Decisions (settled with the user 2026-10-28, during `/planning`)
- **Empty pool:** save the person as *Waiting for a link*; a to-do on the leader's list closes
  itself when a link is given.
- **Take back:** not in this slice; a given link stays with its person.
- **Editing:** bishop and both counselors, audited by field name only; clerk and executive
  secretary read-only.
- **Picker:** active members only; anyone else is entered as a typed name.

## Open Questions (answered above)
- What does the leader see if the pool is **empty** mid-visit?
- Can a link be taken back from someone and returned to the pool (and what happens to their
  history)? Ties to the deferred pause/resume item.
- Edit / correct an invitee's details after the fact — who, and is it audited?
- Is the roster-member picker limited to active members, or anyone on the roster?
