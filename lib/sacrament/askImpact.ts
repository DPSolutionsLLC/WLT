import { formatAppointmentInstant } from "@/lib/visits/visitDates";

// WHO A CHANGE WOULD LEAVE HANGING — ITER-036, D4. Pure: no clock, no database, so it can sit one
// import from the browser bundle beside the windows that show it.
//
// An ask that is only on somebody's To Do is withdrawn quietly when its decision is reopened (D3).
// Two states are not quiet, because a real person is already involved:
//   - its holder has an APPOINTMENT booked with the speaker to ask them, or
//   - the speaker has already ACCEPTED.
// Any change that affects such a person — un-finalizing, changing the speaker, or changing their
// topic — warns first, naming them. The warning is SOFT: the change still goes ahead when confirmed
// (CLAUDE.md §12, "conflict checks are soft, never blocking").
//
// NO PRONOUN IS GUESSED from a name: every sentence says "them".
//
// `scheduledFor` is a timestamptz, so it is formatted in the WARD's zone (CLAUDE.md rule 12), passed
// in by the caller. `holderName` is whoever holds the appointment, and null when that is the person
// reading the warning — f3a's rule that another leader's time is theirs, not the reader's.

export type AskImpact = {
  personName: string;
  scheduledFor: string | null;
  holderName: string | null;
  accepted: boolean;
};

export type AskImpactChange = "unfinalize" | "speaker" | "topic";

function appointmentSentence(impact: AskImpact, change: AskImpactChange, wardZone: string): string {
  const when = formatAppointmentInstant(impact.scheduledFor ?? "", wardZone);
  const who = impact.holderName === null ? "You have" : `${impact.holderName} has`;
  const base = `${who} an appointment with ${impact.personName} on ${when} to ask them to speak`;
  switch (change) {
    case "unfinalize":
      return `${base}. That ask stays on the list.`;
    case "speaker":
      return `${base} — it stays on the list, so cancel it or use it for something else.`;
    case "topic":
      return `${base} — you'll want to tell them about the new topic.`;
  }
}

function acceptedSentence(impact: AskImpact, change: AskImpactChange): string {
  const base = `${impact.personName} has already accepted`;
  switch (change) {
    case "unfinalize":
      return `${base} — you'll need to let them know if anything changes.`;
    case "speaker":
      return `${base} — you'll need to let them know they're no longer speaking.`;
    case "topic":
      return `${base} — you'll want to tell them about their new topic.`;
  }
}

// Null when nobody is scheduled or accepted, which is how a caller knows not to warn at all.
export function describeAskImpact(
  impacts: readonly AskImpact[],
  change: AskImpactChange,
  wardZone: string,
): string | null {
  const sentences = impacts.flatMap((impact) => {
    if (impact.accepted) return [acceptedSentence(impact, change)];
    if (impact.scheduledFor !== null) return [appointmentSentence(impact, change, wardZone)];
    return [];
  });
  return sentences.length === 0 ? null : sentences.join(" ");
}

// One talk's two warnings, built on the server (which knows the ward's zone) and handed to the
// windows that edit it: the speaker window and the row's Clear speaker use `speaker`, the topic
// window and Clear topic use `topic`. Null means nobody is affected.
export type TalkChangeWarnings = { speaker: string | null; topic: string | null };

export const NO_CHANGE_WARNINGS: TalkChangeWarnings = { speaker: null, topic: null };
