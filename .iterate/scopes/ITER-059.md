# ITER-059: Organization event history

**Type:** Feature
**Status:** Backlogged
**Created:** 2026-11-01

## Summary
A lasting record of the events an organization runs — fundraisers, service projects, activity
nights — with their numbers and notes, so next year's leaders can repeat or improve on what worked.
An event can belong to several organizations at once (a joint Young Men / Young Women fundraiser).

## Context
Raised by the user right after a youth fundraiser. Today nothing in the app remembers how an
organization's own event went; the knowledge leaves with whoever ran it. This is NOT the existing
Youth Support module — that tracks young people's outside activities (school games) so leaders can
go and support them. This is about events an organization itself puts on.

## Desired Outcome
- **Each event records:** a name, a date, a **type** (Fundraiser, Service Project, Activity Night…),
  money raised, expenses, attendance, and free-written notes ("what worked", "change next time").
- **History is found two ways, both wanted:** filter by type, AND link a repeating event (e.g.
  "Youth Spaghetti Dinner") as **one recurring event with a row per year**, compared side by side
  so a presidency can see whether results are holding or improving.
- **Who sees it:** only the organizations on the event, and within each only its **current
  presidency — president, counselors and secretary**. A released leader loses access; the incoming
  presidency inherits the whole history.
- **The bishopric is not automatic.** It sees an event only when added as one of its organizations
  — a deliberate departure from the rest of the app, where the bishopric sees every organization's
  work. **Exception by role, not by rank: for Young Men the bishopric IS the presidency** (the bishop
  as president, his counselors as counselors), since there is no ward Young Men presidency.
- **Sharing:** each added organization gets **read & write** or **read only**. Any read & write
  organization may add or remove organizations and change their access level — **except the
  creating organization**, which nobody else can change or remove.
- **Handing over the creator role:** the creator can pass it to another organization on the event;
  the handover completes only once the receiving organization **accepts**.
- Done looks like: YW and the bishopric (as YM) both open the youth fundraiser history next year,
  see last year's raised/expenses/attendance and notes beside this year's, and nobody outside those
  presidencies can see it.

## Scope Notes
- "Current presidency" depends on knowing who holds which calling in which organization — see
  ITER-058 (roster decides callings), which may change where that answer comes from.
- Presidency-only visibility is narrower than the app's usual org-wide reads; it needs to be
  enforced at the database, not only hidden in the UI.
- The bishopric-not-automatic rule contradicts the app's standing "bishopric sees everything"
  pattern by the user's explicit choice — record it as a decision so it is not "fixed" later.
- Money needs exact arithmetic (whole cents), as the tithing calculator already requires.
- A creator handover that is never accepted must leave the creator unchanged.

## Open Questions
- **Young Men's secretary:** who fills that seat when the bishopric is the YM presidency — the
  executive secretary, the ward clerk, or nobody?
- **Deleting:** can an event or one year's row be deleted, or only edited? The app normally refuses
  to destroy what somebody wrote.
- **Read-only organizations:** can they add their own notes, or only view?
- **Event types:** a fixed list, or can a ward add its own?
- **Can the creator leave entirely**, or must it hand over before removing itself?
