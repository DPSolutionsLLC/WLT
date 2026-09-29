# Sacrament flow audit — prototype vs WLT

**2026-09-29.** Why this exists: P4's Sacrament slices were cut by *new behaviour* (References,
finalize, asks, cancellation), so each one bolted a feature onto the existing pages and none rebuilt
a screen into the prototype's shape. The features match; the **flow** does not. This file lists
every flow difference on the path a bishopric actually walks — hub → a Sunday's pills — so the
remaining slices are planned against the whole gap rather than one walk at a time.

Sources: `prototype/WLT.jsx` (line numbers below) read against the current code. Tags: **[flow]**
how you get somewhere / what opens, **[content]** what is shown, **[control]** buttons and inputs.
"Deliberate" marks a recorded decision, not a gap.

---

## 0. A bug found on the way — fix first, on its own

**Nothing in the UI approves a sacrament program.** `app/api/programs/[id]/approve/route.ts`
exists and no `.tsx` calls it. `ProgramBuilder.tsx` offers "Send for approval", and a program sent
is stranded at `pending_approval` for good. Needs an Approve control for `program.approve` holders.

---

## 1. The hub (`/sacrament`)

Prototype: `SacramentPage` 4820, `HomeCalendar` 5490.

- [content] **Three months side by side**, not one (4822–5053). Toolbar: Month + Year selects,
  **Go**, **Today** (5510–5521). WLT: one month, Previous / Today / Next.
- [content] Today's Sunday is outlined (`.cal-cell.today`, 5432). WLT: not highlighted.
- [control] **Undo / Redo** in the header (5191–5200). WLT: none.
- [content] Heading "Sacrament" eyebrow + "Meeting Planner". WLT: "Sacrament — {Month}".
- [content] Shortcut row is 8 links; WLT has 5 (Conducting, Messages, Assignments unbuilt —
  deliberate, `built: false`).
- [content] **Assign n/5** pill (ordinance assignments) — deliberate, P11. Music counts **/5**
  (3 hymns + chorister + accompanist), WLT **/3**.
- [content] Message icon on the card (a placeholder in the prototype). WLT adds a Sunday-type badge.

## 2. Conducting — a quick modal on the hub, not a trip away

- [flow] Prototype: the conducting name opens **ConductingModal** on the hub — "Who's
  conducting?", "Currently X. Pick a substitute just for this Sunday:", the other two bishopric
  members, "Or type a name…", Cancel / Save (5546, 5662, 5725). You never leave the calendar.
- WLT: the name links to `/calendar/sunday/[id]`, a full Sunday editor, whose back link goes to
  **`/calendar`, not the hub**.

## 3. Topics & Talks — the biggest gap

> **Planned and being built in [sacrament-topics-screen-rebuild.md](sacrament-topics-screen-rebuild.md)**
> (2026-09-29). That plan **overrides decision 2 below**: the user retired the topic library, so a
> topic is free text checked against a topic history, not free text with library hints.

Prototype: both pills open `ModuleView` (6372) **in place of the calendar**. WLT: both link to
`/assignments/[sunday_id]`, which is still the Phase 4 talk-pipeline page.

- [flow] Prototype back is **"← Back to calendar"** (the hub). WLT: "Back to the month" →
  `/assignments?month=`, a page no longer on any menu.
- [content] Prototype heading: eyebrow "Topics · {date}", **"What still needs to happen"**.
- [control] **"Category for today"** select + "+ New" (6400–6422) — module-map behaviour 8 (slice
  `d`). WLT has an "Assignment type" select inside the modal instead.
- [control] **"Speakers this week"** − / + stepper with Save, and "make this the new default?"
  (6424–6451, 5299–5328). WLT: slots are set in the Sunday editor on another page.
- [content] **One compact row per talk**: "Talk i" + category chip + **Delete**; a speaker line
  and a topic line, **each clickable to its own picker**, each with its own status tag (Needs
  speaker / Speaker selected / Ask sent / Accepted / Declined; Needs topic / Topic selected) and
  **Clear** (6452–6506). WLT: one big card per talk, one stage badge, one modal editing everything.
- [control] **Speaker picker** (`AssignSpeakerModal` 6091): per-slot category, household list
  **most-overdue first**, a **History** button per person opening **PersonHistoryModal** (talks +
  "Declined asks", 6646), and "use '…' as typed". WLT: generic `MemberPicker`, no overdue order, no
  history, no free text for a member.
- [control] **Topic picker** (`AssignTopicModal` 6275): free text with a live **"Used before, most
  recent first"** hint, **Check topic**, **Suggest topics**. WLT: a `<select>` from the topic
  library.
- [content] **Extra musical numbers** box positioned between talks (6509–6545) — behaviour 7
  (slice `e`). WLT: none.
- [content] Finalize box at the **bottom** ("Not finalized yet" / **Finalize topics** / "✓
  Finalized" + **Undo**). WLT: a panel at the top, different wording.
- [content] Footer link "View the full program for this date →". WLT: none.
- [control] Talks send-asks: the prototype's check **is** the button; WLT splits it into a status
  tab plus "Send asks (N)" and adds a conductor gate. Same effect — acceptable.

**WLT-only on this page:** per talk — Approvals, "Contacting the speaker" (request outcome,
AI-drafted confirmation, SMS handoff, confirm the meeting happened, thank-you), Comments; per
Sunday — "Comments on this Sunday", goal alerts, slot length, visitor's title. The 9-stage pipeline
was kept beside the asks by decision U5 (2026-09-24).

## 4. Prayers — a modal on the hub, with asks

- [flow] Prototype: the Prayer pill opens **PrayerAssignModal** on the hub — "Prayers", both
  Invocation and Benediction in one window, each with Change / Clear, a search, a flat list
  **"Never prayed" first then longest since**, and "Or type a name not in the roster…" (5670,
  5977–6054). WLT: links to `/prayers`, a month page with a 5-stage pipeline per row.
- [control] **A send-asks check for prayers** beside the pill, making "Ask … to give the
  invocation" to-dos with accept/decline and decline history (5632–5644, 19232–19261) — slice `g`.
  WLT: none, and no "declined" pill tone.
- [content] Picker order: prototype flat, longest-since first; WLT households A–Z.
- [content] Prototype counts a prayer as "prayed" when assigned; WLT only when Done. **WLT's rule is
  better — keep it.**

## 5. References — matched

Opens as a modal on the hub in both. The differences are deliberate and recorded (module-map §2.1):
bishopric-only, skip refused while references exist, search/manual in their own windows, semantic
search on a button rather than keyword search per keystroke. The Talks asks are gated on References
being decided in both (verified on the 2026-09-28 walk).

## 6. Music — the list matches; an open Sunday does not

Matched and verified: 8 rolling Sundays, jump insertion, single-open, "Topics pending" dimming,
"Back to Sacrament Calendar". Inside an open Sunday (`MusicSundayEditor` 16777–16849):

- [flow] **Draft → Submit for approval → Approve** workflow with a status pill ("Draft", "Pending
  approval — {conductor}", "Approved"), a reopened banner, and a completion gate — module-map §2.2
  behaviours 1–2. WLT: none (a comment says deliberately deferred).
- [content] **Order of service**: opening → sacrament → each talk ("Talk N: speaker — topic",
  empty slots kept) with extra numbers under it → closing. WLT: topic titles in a separate list,
  three hymns stacked. (WLT shows topics without speaker names on purpose — `music/page.tsx:18-24`.)
- [control] **Chorister & Accompanist** with a default from the calling and "Substitute" / "Use
  default" (16735–16762). WLT: free-text Organist/Chorister on the program form only.
- [flow] **Extra numbers**: any number, each placed between talks, "+ Add musical number…" per talk.
  WLT: one unplaced performer/piece number.
- [content] Collapsed card shows "{n}/{m} picked" **and** the workflow pill. WLT: "n/3 chosen".

WLT-only: AI hymn suggestions, unverified-hymn badge, read-only view, Collapse all.

## 7. Program — a list you expand, not a separate page

Prototype: `ProgramPage` 17243, `ProgramSundayEditor` 17187.

- [flow] Clicking a hub card lands on the **Program list with that Sunday expanded** (8-Sunday
  list, jump insertion — the Music convention, module-map §6.2 says it was replicated on purpose).
  WLT: `/program/[id]`, a standalone page.
- [flow] Back link **"Back to Sacrament Calendar"**. WLT: no `from=sacrament`, only "All programs".
- [flow] Prototype workflow: **Draft ↔ Finalized**, reversible, "Approver for this Sunday:
  {conductor}". WLT: draft → pending approval → approved → distributed, distribution irreversible
  — and see §0, approve is unreachable.
- [content] Sections come from a **user-editable template** ("Manage Template", "+ Add line",
  delete per line). WLT: a fixed form.
- [control] **"Add from Calendar"** on announcements. WLT: none.
- [content] Prototype resolves the open date live; WLT needs a "Build the program" snapshot, then
  "Check for changes".

WLT-only: snapshot + change diff, Missing panel, Preview, PDF, email with recipient confirm, AI
edit, gaps summary, read-only mode.

---

## Decisions — made by the user, 2026-09-29

1. **The pipeline goes BEHIND each talk.** The Topics screen matches the prototype; each talk row
   gets a small "Details" link opening Approvals, Contacting the speaker and Comments on demand.
   Nothing is retired. (Refines U5: the pipeline stays, off the main screen.)
2. **Topics are free text with library hints.** Type any topic, as the prototype does, with
   "Used before" and ward-library topics offered as suggestions. The library and its AI candidate
   queue stay, as the source of hints. (Needs a free-text topic on the talk, which WLT does not
   have today — `assignments.topic_id` is a library reference.)
3. **Program becomes Draft ↔ Finalized**, the prototype's single reversible step, replacing
   approve → distribute. Finalizing publishes; un-finalizing takes it back. §0's missing Approve
   button is absorbed by this rather than fixed on its own. **No stopgap** — the user confirmed
   2026-09-29 that the live app is not in use by the ward yet.
4. **All three hub extras**: three months side by side (wide screens), the Month/Year jump plus a
   today outline, and **Undo / Redo** — the largest, since it needs a real change history under a
   server.

## Suggested order

1. **§3 — rebuild the Topics & Talks screen** as the prototype's sub-view, with the pipeline behind
   each talk and free-text topics, then slice `d` (day categories) and `e` (placed musical
   numbers) on top of it.
2. **§2 + §4 — hub modals**: the Conducting substitute modal, then the Prayer modal + prayer asks
   (slice `g`).
3. **§7 — Program**: Draft ↔ Finalized (absorbing §0), expand-in-list + back link, then the
   template.
4. **§6 — Music**: order of service, chorister/accompanist, the submit/approve workflow.
5. **§1 — hub**: today outline + Month/Year jump, three months, then Undo / Redo as its own design.
