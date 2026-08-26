"use client";

import { useState } from "react";
import { MemberPicker } from "@/components/roster/MemberPicker";
import { Button } from "@/components/ui/Button";
import { FormError } from "@/components/ui/FormError";
import { Input } from "@/components/ui/Input";
import {
  MAX_PARTICIPANT_LABEL,
  MAX_VISIT_COMPANIONS,
  MAX_VISIT_PARTICIPANTS,
  type VisitParticipantInput,
} from "@/lib/validation/visit";
import { VISIT_NOBODY_RECORDED, type SessionUser, type VisitOutcome } from "@/types/domain";

// WHO ACTUALLY WENT.
//
// The person recording a visit is frequently not the person who made it — a secretary types up
// the visits their presidency made, a counselor writes up the round they did with the president.
// visits-a had one column for both and no way to say so. This field is where a leader answers
// the question directly.
//
// ---------------------------------------------------------------------------
// THE RECORDER IS HERE BY DEFAULT, AND CAN BE REMOVED
// ---------------------------------------------------------------------------
// Present by default because most of the time the person typing did go, and making them add
// themselves every time would be a tax on the common case. Removable because the whole point is
// that they sometimes did not, and a default nobody can clear is just a lie with extra steps.
//
// An empty list is a legitimate state and reads as "Nobody recorded as visiting" IN WORDS. Not a
// blank, not a dash: a blank space where a name goes reads as a page that failed to load, and
// this one is a fact about the visit.
//
// The type is a discriminated union on `kind`, matching lib/validation/visit.ts and migration
// 046's CHECK. `users` and `members` are unlinked in this schema, so a leader, a spouse and a
// neighbour are three different kinds of row rather than three rows in one table.

export type ParticipantDraft =
  | { kind: "user"; userId: string; displayName: string }
  | { kind: "member"; memberId: string; displayName: string }
  | { kind: "label"; label: string; displayName: string };

export type LeaderOption = { id: string; label: string };

export type VisitParticipantsFieldProps = {
  value: ParticipantDraft[];
  onChange: (participants: ParticipantDraft[]) => void;
  user: SessionUser;
  leaders: LeaderOption[];
  // id -> full name, for the chip a MemberPicker selection produces. The picker hands back ids
  // only, and re-deriving its member list here is the documented bug in roster-b's retro — so
  // the page passes the lookup down instead.
  memberNames: Record<string, string>;
  // The empty state has to say the true thing, and what is true depends on what happened. A form
  // set to "Attempted" that says "Nobody recorded as visiting" is the same contradiction the
  // visit list had (types/domain.ts §VISIT_NOBODY_RECORDED).
  outcome: VisitOutcome;
  disabled?: boolean;
};

type AddMode = "leader" | "member" | "name";

const SELECT_CLASSES =
  "min-h-11 rounded-md border border-border bg-surface-raised px-3 text-base text-foreground focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary";

export const AT_CAPACITY_MESSAGE =
  `This visit already lists ${MAX_VISIT_PARTICIPANTS} people, which is the most a visit can ` +
  `record — the person writing it up plus ${MAX_VISIT_COMPANIONS} companions. Remove somebody ` +
  "to add another.";

// The payload the routes take. `displayName` is a rendering concern and never crosses the wire:
// the server resolves every name itself, so a request cannot label somebody else's row.
export function toParticipantPayload(
  participants: readonly ParticipantDraft[],
): VisitParticipantInput[] {
  return participants.map((participant) => {
    if (participant.kind === "user") return { kind: "user", userId: participant.userId };
    if (participant.kind === "member") return { kind: "member", memberId: participant.memberId };
    return { kind: "label", label: participant.label };
  });
}

// The recorder, as the default single entry. Exported so the form can rebuild it after a save
// rather than keeping a second copy of the rule.
export function recorderParticipant(user: SessionUser): ParticipantDraft {
  const name = `${user.firstName ?? ""} ${user.lastName ?? ""}`.trim();

  return { kind: "user", userId: user.id, displayName: name === "" ? "You" : name };
}

function isSamePerson(a: ParticipantDraft, b: ParticipantDraft): boolean {
  if (a.kind === "user" && b.kind === "user") return a.userId === b.userId;
  if (a.kind === "member" && b.kind === "member") return a.memberId === b.memberId;
  // Two people can genuinely both be "a neighbour", so a label is never a duplicate of another
  // label. Migration 046 has no unique index on it either, for the same reason.
  return false;
}

export function VisitParticipantsField({
  value,
  onChange,
  user,
  leaders,
  memberNames,
  outcome,
  disabled = false,
}: VisitParticipantsFieldProps) {
  const [mode, setMode] = useState<AddMode>("leader");
  const [typedName, setTypedName] = useState("");
  const [addError, setAddError] = useState<string | undefined>(undefined);

  const atCapacity = value.length >= MAX_VISIT_PARTICIPANTS;

  const chosenUserIds = value.flatMap((participant) =>
    participant.kind === "user" ? [participant.userId] : [],
  );
  const chosenMemberIds = value.flatMap((participant) =>
    participant.kind === "member" ? [participant.memberId] : [],
  );

  function add(participant: ParticipantDraft): void {
    setAddError(undefined);

    if (value.some((existing) => isSamePerson(existing, participant))) {
      setAddError("That person is already on this visit.");
      return;
    }

    if (atCapacity) {
      setAddError(AT_CAPACITY_MESSAGE);
      return;
    }

    onChange([...value, participant]);
  }

  function removeAt(index: number): void {
    setAddError(undefined);
    onChange(value.filter((_, position) => position !== index));
  }

  function addTypedName(): void {
    const trimmed = typedName.trim();

    if (trimmed === "") {
      setAddError("Type a name first.");
      return;
    }

    add({ kind: "label", label: trimmed, displayName: trimmed });
    setTypedName("");
  }

  const availableLeaders = leaders.filter((leader) => !chosenUserIds.includes(leader.id));

  return (
    <fieldset className="m-0 flex flex-col gap-3 border-0 p-0">
      <legend className="mb-2 text-sm font-semibold text-foreground">Who went</legend>

      <p className="text-sm text-muted">
        You are on this list by default. Take yourself off if you did not go — the person who
        writes a visit up is not always the person who made it.
      </p>

      {value.length === 0 ? (
        // Words, never a blank. A blank where a name goes reads as a page that failed to load.
        <p className="text-sm text-muted">{`${VISIT_NOBODY_RECORDED[outcome]}.`}</p>
      ) : (
        <ul className="flex flex-wrap gap-2">
          {value.map((participant, index) => (
            <li
              key={`${participant.kind}-${
                participant.kind === "user"
                  ? participant.userId
                  : participant.kind === "member"
                    ? participant.memberId
                    : `${participant.label}-${index}`
              }`}
              className="inline-flex min-h-11 items-center gap-1 rounded-full border border-border bg-surface-raised pl-3 pr-1 text-sm text-foreground"
            >
              {participant.displayName}
              <button
                type="button"
                aria-label={`Remove ${participant.displayName} from this visit`}
                // 44x44, not the 32x32 this first shipped as. Every tap target in this app
                // clears 44 (components/ui/Button.tsx says so), and a chip's remove control is
                // the smallest thing on the page — it needs the floor most, not least.
                className="inline-flex h-11 w-11 items-center justify-center rounded-full text-base text-muted hover:text-foreground focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
                disabled={disabled}
                onClick={() => removeAt(index)}
              >
                ×
              </button>
            </li>
          ))}
        </ul>
      )}

      {atCapacity ? (
        // VISIBLE TEXT, never a tooltip. A control that stops working with no explanation on the
        // page is indistinguishable from one that is broken, and a tooltip does not exist on a
        // phone at all.
        <p role="status" className="text-sm text-warning">
          {AT_CAPACITY_MESSAGE}
        </p>
      ) : (
        <div className="flex flex-col gap-3">
          <div className="flex flex-wrap gap-2">
            {(
              [
                ["leader", "A leader"],
                ["member", "A member"],
                ["name", "Someone else"],
              ] as const
            ).map(([addMode, label]) => (
              <Button
                key={addMode}
                variant={mode === addMode ? "primary" : "secondary"}
                aria-pressed={mode === addMode}
                disabled={disabled}
                onClick={() => {
                  setMode(addMode);
                  setAddError(undefined);
                }}
              >
                {label}
              </Button>
            ))}
          </div>

          {mode === "leader" ? (
            <div className="flex flex-col gap-1.5">
              <label
                htmlFor="visit-participant-leader"
                className="text-sm font-medium text-foreground"
              >
                Add a leader
              </label>
              <select
                id="visit-participant-leader"
                className={SELECT_CLASSES}
                value=""
                disabled={disabled || availableLeaders.length === 0}
                onChange={(event) => {
                  const leader = availableLeaders.find(
                    (candidate) => candidate.id === event.target.value,
                  );
                  if (leader) {
                    add({ kind: "user", userId: leader.id, displayName: leader.label });
                  }
                }}
              >
                <option value="">
                  {availableLeaders.length === 0
                    ? "Everyone with an account is already listed"
                    : "Choose a leader…"}
                </option>
                {availableLeaders.map((leader) => (
                  <option key={leader.id} value={leader.id}>
                    {leader.label}
                  </option>
                ))}
              </select>
            </div>
          ) : null}

          {mode === "member" ? (
            // mode="inline", not the default modal — this field sits inside a form rather than
            // beside a trigger, and MemberPicker's modal is a native <dialog> that is not built
            // to stack (components/ui/Modal.tsx).
            //
            // `value` is passed EMPTY on purpose: the picker is being used as a chooser, not as
            // the store of who is on this visit. The chips above are the store. Handing it the
            // current selection would make two components own one list, which is the frozen
            // component's documented failure mode (roster-b).
            <MemberPicker
              value={[]}
              onChange={(memberIds) => {
                const memberId = memberIds[0];
                if (memberId === undefined) return;

                add({
                  kind: "member",
                  memberId,
                  displayName: memberNames[memberId] ?? "A member",
                });
              }}
              user={user}
              multiple={false}
              excludeIds={chosenMemberIds}
              mode="inline"
              label="Add a member"
              disabled={disabled}
            />
          ) : null}

          {mode === "name" ? (
            <div className="flex flex-col gap-2">
              <Input
                id="visit-participant-name"
                label="Add somebody by name"
                value={typedName}
                maxLength={MAX_PARTICIPANT_LABEL}
                disabled={disabled}
                placeholder="A neighbour, a visiting missionary…"
                onChange={(event) => setTypedName(event.target.value)}
              />
              <div>
                <Button variant="secondary" disabled={disabled} onClick={addTypedName}>
                  Add name
                </Button>
              </div>
            </div>
          ) : null}
        </div>
      )}

      <FormError message={addError} />
    </fieldset>
  );
}
