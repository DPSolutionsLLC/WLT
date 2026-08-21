import type { SpeakerKind } from "@/types/domain";

// The one place in the app that answers "who is speaking in this slot". Every caller goes
// through it rather than reading `member_id` and `external_speaker_name` and reaching its own
// conclusion — two callers that disagree is how an external speaker vanishes from a printed
// program while still appearing on the planner.
//
// Nothing outside `@/types/domain` may be imported here: talks-b renders this in client
// components (plans/retros/roster-b-picker-and-orgs.md).

export type AssignmentSpeaker =
  | { kind: "member"; memberId: string }
  | { kind: "external"; name: string; title: string | null }
  | { kind: "empty" };

export type SpeakerFields = {
  memberId: string | null;
  externalSpeakerName: string | null;
  externalSpeakerTitle: string | null;
};

// `member` wins when both are somehow set. The database CHECK
// (assignments_speaker_exactly_one, migration 025) makes that row unwritable, so this branch is
// unreachable through the app — but a discriminator that throws on impossible data would take a
// whole page down over one bad row, and the member is the answer the roster agrees with.
export function speakerFrom(row: SpeakerFields): AssignmentSpeaker {
  if (row.memberId !== null) {
    return { kind: "member", memberId: row.memberId };
  }

  const name = row.externalSpeakerName?.trim() ?? "";
  if (name !== "") {
    const title = row.externalSpeakerTitle?.trim() ?? "";
    return { kind: "external", name, title: title === "" ? null : title };
  }

  return { kind: "empty" };
}

export function speakerKind(speaker: AssignmentSpeaker): SpeakerKind {
  return speaker.kind;
}

// "President Mark Andersen" when a title is set, "Mark Andersen" when it is not.
//
// Returns null for a member speaker, deliberately: the caller resolves a member name from the
// roster, and this module does not reach for one. Returning a member's name from here would
// mean a pure module needed the roster, and every client component importing it would need one
// too.
//
// The title is TYPED, never derived. `users` records no gender, which is why
// bishopricDisplayName() in lib/calendar/queries.ts already refuses to guess an honorific
// (ITER-004 §Scope Notes). Do not add a title-guessing heuristic here.
export function externalDisplayName(speaker: AssignmentSpeaker): string | null {
  if (speaker.kind !== "external") return null;
  return speaker.title === null ? speaker.name : `${speaker.title} ${speaker.name}`;
}

export function isExternalSpeaker(speaker: AssignmentSpeaker): boolean {
  return speaker.kind === "external";
}

// Whether the REQUEST, CONFIRM, NOTIFY and APPRECIATE stages are real work for this speaker.
//
// An empty slot answers `true`: nobody has decided who is speaking yet, so nobody has decided
// the contact stages do not apply either. Answering `false` would make an unfilled slot look
// waived, which is exactly the "outstanding task that reads as done" ITER-004 exists to prevent
// — in the opposite direction.
export function contactStagesApply(speaker: AssignmentSpeaker): boolean {
  return speaker.kind !== "external";
}
