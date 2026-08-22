import { externalDisplayName, speakerFrom } from "@/lib/assignments/speaker";

// One speaker, however they were named. Phase 6's program builder reuses this rather than
// re-deriving a display name from member_id — two callers that disagree is exactly how an
// external speaker's title goes missing on the printed program (talks-a).

export type SpeakerFieldsInput = {
  memberId: string | null;
  externalSpeakerName: string | null;
  externalSpeakerTitle: string | null;
};

export type SpeakerLineProps = {
  speaker: SpeakerFieldsInput;
  // memberId -> "Sarah Whitfield". Resolved by the page from the roster; this component never
  // reaches for one, which is what keeps it importable by a client component.
  memberNames: Record<string, string>;
  emptyLabel?: string;
};

// The name a member speaker is shown by, or null when the roster does not have them. A raw uuid
// on screen tells a bishop nothing they could act on (calendar-b's ConductingLabel).
export function speakerDisplayName(
  speaker: SpeakerFieldsInput,
  memberNames: Record<string, string>,
): string | null {
  const resolved = speakerFrom(speaker);

  if (resolved.kind === "member") {
    return memberNames[resolved.memberId] ?? null;
  }

  return externalDisplayName(resolved);
}

export function SpeakerLine({ speaker, memberNames, emptyLabel = "Open" }: SpeakerLineProps) {
  const name = speakerDisplayName(speaker, memberNames);

  if (name === null) {
    return <span className="text-muted">{emptyLabel}</span>;
  }

  return <span className="text-foreground">{name}</span>;
}
