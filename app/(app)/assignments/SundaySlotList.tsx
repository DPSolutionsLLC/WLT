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
// The Topics screen (Topics rebuild t3) renders one TalkRow per entry. The list component that used
// to live here went with the old per-Sunday page; this ordering rule did not.

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
