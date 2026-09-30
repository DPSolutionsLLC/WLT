import type { DateOnly } from "@/lib/calendar/dates";
import { timeAgoLabel } from "@/lib/topics/topicHistory";
import type { AssignmentHistoryOutcome } from "@/types/domain";

// WHO TO ASK NEXT — the speaker window's list (Topics rebuild t4, the prototype's
// AssignSpeakerModal): members who have never spoken first, then whoever spoke longest ago.
//
// Pure: no clock (the caller passes `today`), no storage, client-safe.
//
// ONLY A COMPLETED TALK COUNTS AS SPEAKING — the rule lib/assignments/reliabilityFlags.ts uses for
// "not spoken recently". A cancelled talk was never given (Sacrament slice f2c) and a decline is
// not a talk, so neither may push somebody down the list.

export type SpeakerCandidate = { id: string; firstName: string; lastName: string };

type HistoryLike = { outcome: AssignmentHistoryOutcome | null; sundayDate: DateOnly | null };

export function lastSpokeOn(history: readonly HistoryLike[]): DateOnly | null {
  return history.reduce<DateOnly | null>((latest, entry) => {
    if (entry.outcome !== "completed" || entry.sundayDate === null) return latest;
    return latest === null || entry.sundayDate > latest ? entry.sundayDate : latest;
  }, null);
}

function byName(left: SpeakerCandidate, right: SpeakerCandidate): number {
  return (
    left.lastName.localeCompare(right.lastName, "en", { sensitivity: "base" }) ||
    left.firstName.localeCompare(right.firstName, "en", { sensitivity: "base" })
  );
}

// `historyByMember` is NULL when the reader may not see speaker history (it is bishopric-only,
// talks-d): the list is then plain alphabetical, and the window says nothing about when anybody
// spoke rather than claiming "Never spoken" for everybody.
export function orderSpeakerCandidates<Candidate extends SpeakerCandidate>(
  members: readonly Candidate[],
  historyByMember: ReadonlyMap<string, readonly HistoryLike[]> | null,
): Candidate[] {
  if (historyByMember === null) return [...members].sort(byName);

  const lastSpoke = new Map(
    members.map((member) => [member.id, lastSpokeOn(historyByMember.get(member.id) ?? [])]),
  );

  return [...members].sort((left, right) => {
    const leftDate = lastSpoke.get(left.id) ?? null;
    const rightDate = lastSpoke.get(right.id) ?? null;
    if (leftDate !== rightDate) {
      if (leftDate === null) return -1;
      if (rightDate === null) return 1;
      return leftDate < rightDate ? -1 : 1;
    }
    return byName(left, right);
  });
}

// "last spoke 8 months ago", or "Never spoken" — the prototype's words.
export function lastSpokeLabel(lastSpoke: DateOnly | null, today: DateOnly): string {
  return lastSpoke === null ? "Never spoken" : `last spoke ${timeAgoLabel(lastSpoke, today)}`;
}
