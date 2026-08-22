import { SpeakerLine, type SpeakerFieldsInput } from "@/components/assignments/SpeakerLine";

// The `speakers` reserved region calendar-b left on both SundayCell and SundayCard. One change
// fills the month grid and the 375px card list, which is the whole reason those props exist as
// real ReactNode props rather than a comment promising a refactor.

export type SpeakerListAssignment = SpeakerFieldsInput & {
  id: string;
  slotNumber: number | null;
};

export type SpeakerListProps = {
  speakingSlots: number;
  assignments: readonly SpeakerListAssignment[];
  memberNames: Record<string, string>;
};

export function SpeakerList({
  speakingSlots,
  assignments,
  memberNames,
}: SpeakerListProps) {
  // A Sunday with no speaking slots has nothing to say about speakers — not "0 speakers", which
  // reads as a planning gap on a stake conference weekend. Keyed off the slot count rather than
  // the Sunday type, so it covers a standard Sunday somebody deliberately set to zero too
  // (talks-a Decision 6).
  if (speakingSlots === 0) return null;

  const bySlot = new Map(
    assignments.flatMap((assignment) =>
      assignment.slotNumber === null ? [] : [[assignment.slotNumber, assignment] as const],
    ),
  );

  return (
    <ul className="flex flex-col gap-0.5 text-xs">
      {Array.from({ length: speakingSlots }, (_, index) => {
        const slotNumber = index + 1;
        const assignment = bySlot.get(slotNumber);

        // An unfilled slot is INFORMATION, not an absence. A blank line where slot 2 should be
        // looks like a rendering fault; "Slot 2 — open" is the thing the bishopric is looking
        // for when they open the month.
        if (!assignment) {
          return (
            <li key={slotNumber} className="text-muted">
              Slot {slotNumber} — open
            </li>
          );
        }

        return (
          <li key={assignment.id}>
            <span className="text-muted">{slotNumber}. </span>
            <SpeakerLine
              speaker={assignment}
              memberNames={memberNames}
              emptyLabel="No speaker yet"
            />
          </li>
        );
      })}
    </ul>
  );
}
