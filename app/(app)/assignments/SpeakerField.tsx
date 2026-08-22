"use client";

import { MemberPicker } from "@/components/roster/MemberPicker";
import { Input } from "@/components/ui/Input";
import {
  MAX_EXTERNAL_SPEAKER_NAME,
  MAX_EXTERNAL_SPEAKER_TITLE,
  type MemberCategory,
  type SessionUser,
} from "@/types/domain";

// ITER-004 on screen. A speaker is a ward member OR somebody invited from outside, never both
// and never neither-but-half-filled — the assignments_speaker_exactly_one CHECK (migration 025)
// is the real boundary, and this control is shaped so the impossible state cannot be typed.

export type SpeakerSide = "member" | "external";

export type SpeakerValue = {
  side: SpeakerSide;
  memberId: string | null;
  externalName: string;
  externalTitle: string;
};

export type SpeakerFieldProps = {
  user: SessionUser;
  value: SpeakerValue;
  onChange: (value: SpeakerValue) => void;
  // "youth" when the assignment type is youth_speaker, "adult" otherwise. The picker narrows in
  // memory, so switching this does not refetch the roster (roster-b).
  category: MemberCategory;
  disabled?: boolean;
};

export const EXTERNAL_TITLE_HINT =
  "Type the title exactly as it should print — “President”, “Sister”, “Elder”.";

// Switching sides CLEARS the other, rather than remembering it. A remembered member id behind an
// external name is a row the database refuses, and a form that holds a value the user cannot see
// is one the user cannot correct.
export function switchSide(value: SpeakerValue, side: SpeakerSide): SpeakerValue {
  if (side === value.side) return value;

  return { side, memberId: null, externalName: "", externalTitle: "" };
}

export function SpeakerField({
  user,
  value,
  onChange,
  category,
  disabled = false,
}: SpeakerFieldProps) {
  return (
    <fieldset className="flex flex-col gap-3">
      <legend className="text-sm font-medium text-foreground">Speaker</legend>

      <div className="flex flex-col gap-2 md:flex-row md:gap-4">
        {(
          [
            ["member", "A ward member"],
            ["external", "Someone outside the ward"],
          ] as const
        ).map(([side, label]) => (
          <label key={side} className="flex min-h-11 items-center gap-2 text-sm text-foreground">
            <input
              type="radio"
              name="speaker-side"
              value={side}
              checked={value.side === side}
              disabled={disabled}
              onChange={() => onChange(switchSide(value, side))}
              className="h-4 w-4"
            />
            {label}
          </label>
        ))}
      </div>

      {value.side === "member" ? (
        // mode="inline", not the default modal. MemberPicker's modal is a native <dialog>, and
        // this field is already inside one — Modal is deliberately not built to stack
        // (components/ui/Modal.tsx).
        //
        // showFlags renders nothing until talks-d; ReliabilityFlag is a deliberate no-op. It is
        // passed anyway because this is the planning view that wants it, and wiring a guessed
        // rule here instead is exactly what that slice exists to decide.
        <MemberPicker
          value={value.memberId === null ? [] : [value.memberId]}
          onChange={(memberIds) =>
            onChange({ ...value, memberId: memberIds[0] ?? null })
          }
          user={user}
          multiple={false}
          filter={{ categories: [category] }}
          showFlags
          mode="inline"
          label="Choose the speaker"
          disabled={disabled}
        />
      ) : (
        <div className="flex flex-col gap-3">
          <Input
            id="external-speaker-name"
            label="Name"
            value={value.externalName}
            maxLength={MAX_EXTERNAL_SPEAKER_NAME}
            disabled={disabled}
            onChange={(event) => onChange({ ...value, externalName: event.target.value })}
            placeholder="Mark Andersen"
          />

          <div>
            <Input
              id="external-speaker-title"
              label="Title (optional)"
              value={value.externalTitle}
              maxLength={MAX_EXTERNAL_SPEAKER_TITLE}
              disabled={disabled}
              onChange={(event) =>
                onChange({ ...value, externalTitle: event.target.value })
              }
              placeholder="President"
            />
            {/* Nothing is derived. `users` records no gender, which is why
                bishopricDisplayName() already refuses to guess an honorific — a title this app
                invented would be wrong for somebody, in print, on a Sunday morning. */}
            <p className="mt-1 text-sm text-muted">{EXTERNAL_TITLE_HINT}</p>
          </div>
        </div>
      )}
    </fieldset>
  );
}
