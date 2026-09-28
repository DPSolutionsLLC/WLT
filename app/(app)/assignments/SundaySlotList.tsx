import { Fragment, type ReactNode } from "react";
import { Card } from "@/components/ui/Card";
import type { Assignment } from "@/lib/assignments/queries";

// EVERY SLOT, not every assignment. The page used to list only the talks that already existed, so
// a Sunday with nothing planned read "Plan a slot from the month view" and offered no way to do
// it — and the hub's Talks pill is the only route here since the Talks tile went. The prototype
// plans slots ON the per-Sunday page (module-map.md §2.1 note (c)).
//
// A talk whose slot is outside 1..speakingSlots, or that has no slot at all, is listed AFTER the
// slots rather than dropped. Hiding a talk somebody planned because the numbers no longer line up
// would lose it from the one page that shows it in full.
//
// No "use client": the filled card is rendered by the page, which holds the approvals, comments
// and contact data this list has no business knowing about.

export type SundaySlotEntry =
  | { kind: "planned"; assignment: Assignment }
  | { kind: "open"; slotNumber: number };

export function sundaySlotEntries(
  speakingSlots: number,
  assignments: Assignment[],
): SundaySlotEntry[] {
  const entries: SundaySlotEntry[] = [];

  for (let slotNumber = 1; slotNumber <= speakingSlots; slotNumber += 1) {
    const inSlot = assignments.filter((assignment) => assignment.slotNumber === slotNumber);

    if (inSlot.length === 0) {
      entries.push({ kind: "open", slotNumber });
    } else {
      entries.push(...inSlot.map((assignment) => ({ kind: "planned" as const, assignment })));
    }
  }

  const outsideSlots = assignments
    .filter(
      (assignment) =>
        assignment.slotNumber === null ||
        assignment.slotNumber < 1 ||
        assignment.slotNumber > speakingSlots,
    )
    .sort(
      (left, right) =>
        (left.slotNumber ?? Number.MAX_SAFE_INTEGER) -
        (right.slotNumber ?? Number.MAX_SAFE_INTEGER),
    );

  entries.push(...outsideSlots.map((assignment) => ({ kind: "planned" as const, assignment })));

  return entries;
}

export type SundaySlotListProps = {
  speakingSlots: number;
  assignments: Assignment[];
  renderAssignment: (assignment: Assignment) => ReactNode;
  // Null for somebody without `talks.plan`: they see which slots are open and are offered nothing
  // the API would refuse.
  renderPlanButton: ((slotNumber: number) => ReactNode) | null;
};

export function SundaySlotList({
  speakingSlots,
  assignments,
  renderAssignment,
  renderPlanButton,
}: SundaySlotListProps) {
  const entries = sundaySlotEntries(speakingSlots, assignments);

  if (entries.length === 0) {
    return (
      <Card>
        <p className="text-sm text-muted">
          This Sunday has no speaking slots, so there are no talks to plan.
        </p>
      </Card>
    );
  }

  return (
    <>
      {entries.map((entry) =>
        entry.kind === "planned" ? (
          <Fragment key={entry.assignment.id}>{renderAssignment(entry.assignment)}</Fragment>
        ) : (
          <Card key={`open-${entry.slotNumber}`}>
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h2 className="text-base font-semibold text-foreground">
                Slot {entry.slotNumber} — <span className="font-normal text-muted">open</span>
              </h2>
              {renderPlanButton?.(entry.slotNumber)}
            </div>
          </Card>
        ),
      )}
    </>
  );
}
