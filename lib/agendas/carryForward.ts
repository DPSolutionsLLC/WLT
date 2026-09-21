// Which action items follow a meeting to the next one.
//
// PURE, and for the same reason lib/agendas/sections.ts is: the builder renders the result and the
// create route computes it, so this file imports nothing that reaches for a database or a clock.
// `asOf` is not a parameter anywhere below — nothing here asks what time it is. An item carries
// because it is OPEN, not because of how long it has been open.

// One action item, as every screen reads it. A structural type rather than an import from
// lib/agendas/queries.ts, which is server-only.
export type ActionItem = {
  id: string;
  agendaId: string | null;
  description: string;
  assignedTo: string | null;
  dueDate: string | null;
  status: "open" | "complete";
  carriedFromAgendaId: string | null;
  completedAt: string | null;
  createdAt: string;
};

// What a carried item needs to know about where it came from, so the screen can say
// "carried from Nov 12" — 09-meetings-tithing.md §Step A3 asks for the origin by name.
export type CarriedActionItem = {
  description: string;
  assignedTo: string | null;
  dueDate: string | null;
  carriedFromAgendaId: string;
};

// ---------------------------------------------------------------------------
// A COPY, NEVER A MOVE. THIS IS THE WHOLE DESIGN.
// ---------------------------------------------------------------------------
// 09-meetings-tithing.md §Step A3: "Carry-forward is a copy, not a move, so each agenda remains an
// accurate record of what was discussed that day."
//
// Move the row and last month's agenda silently loses a line it genuinely contained — the minutes
// would then disagree with the meeting. Copy it and both agendas are true: the old one records
// that the item was raised, the new one that it is still open. The cost is that completing the
// copy does not complete the original, and that is CORRECT: the original is a historical record,
// not a live task.
//
// The chain is readable through `carriedFromAgendaId`, so "how many meetings has this been open?"
// is answerable by walking it — which is a question a bishopric actually asks and which a move
// would have destroyed the evidence for.
export function itemsToCarryForward(
  previousItems: readonly ActionItem[],
  previousAgendaId: string,
): CarriedActionItem[] {
  return previousItems
    .filter((item) => item.status === "open")
    .map((item) => ({
      description: item.description,
      assignedTo: item.assignedTo,
      dueDate: item.dueDate,
      // ALWAYS THE AGENDA IT IS BEING COPIED FROM, never the original's own
      // `carriedFromAgendaId`. An item open across four meetings should read "carried from" the
      // LAST one, because that is where it was last discussed; pointing every copy back at the
      // first would make the chain a star rather than a line and lose the intervening meetings.
      carriedFromAgendaId: previousAgendaId,
    }));
}

// Completing an item stops the carry, and that is expressed by the status alone — there is no
// second flag to keep in step. `completed_at` is the timestamp for the record; `status` is what
// the filter above reads.
export function isCarryable(item: ActionItem): boolean {
  return item.status === "open";
}

// "carried from Nov 12", or null for an item raised in this meeting.
//
// TAKES A FORMATTED DATE RATHER THAN A DATE, so the zone decision stays with the caller. Every
// date formatter in this codebase names its zone explicitly (c24d52b), and a pure module cannot
// know whether this one is a ward-zone instant or a UTC `date` column — `agendas.meeting_date` is
// a `date`, so lib/calendar/dates.ts formats it and hands the string here.
export function describeCarriedFrom(formattedMeetingDate: string | null): string | null {
  return formattedMeetingDate === null ? null : `carried from ${formattedMeetingDate}`;
}

// Open items first, then completed, each oldest first.
//
// COMPLETED ITEMS STAY ON THE AGENDA rather than disappearing when ticked. A bishopric wants to
// see what was closed at this meeting — that is half of what a meeting produces — and an item that
// vanished on completion would make the agenda a to-do list rather than a record. They sort below
// the open ones because the open ones are what the meeting is for.
export function compareActionItems(left: ActionItem, right: ActionItem): number {
  if (left.status !== right.status) return left.status === "open" ? -1 : 1;
  return left.createdAt < right.createdAt ? -1 : left.createdAt > right.createdAt ? 1 : 0;
}

export function openActionItems(items: readonly ActionItem[]): ActionItem[] {
  return items.filter((item) => item.status === "open");
}
