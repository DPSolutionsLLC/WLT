"use client";

import { useId, useState } from "react";
import { X } from "lucide-react";
import { EXTERNAL_TITLE_HINT } from "@/app/(app)/assignments/SpeakerField";
import { ReliabilityFlag, type ReliabilityFlagKind } from "@/components/roster/ReliabilityFlag";
import { ApprovalSafeSave } from "@/components/sacrament/ApprovalSafeSave";
import { PersonHistoryWindow } from "@/components/sacrament/PersonHistoryWindow";
import { FormError } from "@/components/ui/FormError";
import { Input } from "@/components/ui/Input";
import { Modal } from "@/components/ui/Modal";
import type { DateOnly } from "@/lib/calendar/dates";
import type { Assignment, SpeakerHistoryRow } from "@/lib/assignments/queries";
import { saveAssignment } from "@/lib/assignments/saveAssignment";
import {
  lastSpokeLabel,
  lastSpokeOn,
  orderSpeakerCandidates,
  type SpeakerCandidate,
} from "@/lib/assignments/speakerOrder";
import {
  ASSIGNMENT_TYPE_LABELS,
  ASSIGNMENT_TYPES,
  MAX_EXTERNAL_SPEAKER_NAME,
  MAX_EXTERNAL_SPEAKER_TITLE,
  type AssignmentType,
  type MemberCategory,
} from "@/types/domain";

// THE SPEAKER WINDOW on the Topics screen — the prototype's AssignSpeakerModal (Topics rebuild t3,
// upgraded in t4). It edits the speaker and the kind of talk and nothing else, so a topic typed in
// the other window is never resent from here. On an OPEN slot, Save creates the talk.
//
// THE LIST IS WHO TO ASK NEXT: members who have never spoken first, then whoever spoke longest ago
// (lib/assignments/speakerOrder.ts), each with "last spoke …" and the reliability flags. Speaker
// history is bishopric-only (talks-d), so for anybody else `historyByMember` is null: the list is
// alphabetical, says nothing about when anybody spoke, and has no History button.
//
// "USE … AS TYPED" is WLT's visiting speaker (ITER-004), reached the prototype's way: a name the
// roster does not have becomes an outside speaker, with an optional title beneath it.
//
// HISTORY IS NOT A SECOND WINDOW. Modal does not stack (talks-b-month-planner), so it replaces the
// list, with "← Back to the list".
//
// THE MEMBERS ARRIVE SLIM — id, name and category only, active members only, the roster's own
// status rule (MemberPicker's resolvePickerFilter) — so no phone or address reaches the browser for
// a list of names. The category narrowing is MemberPicker's narrowPickerMembers() rule, applied
// here because that function takes full member rows.

const SELECT_CLASSES =
  "min-h-11 w-full rounded-md border border-border bg-surface-raised px-3 py-2 text-base " +
  "text-foreground focus-visible:outline-2 focus-visible:outline-offset-2 " +
  "focus-visible:outline-primary";

const LINK_BUTTON =
  "min-h-11 px-2 text-sm text-primary underline-offset-4 hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary";

export type SpeakerDirectoryEntry = SpeakerCandidate & { category: MemberCategory | null };

type Chosen =
  | { kind: "member"; memberId: string; name: string }
  | { kind: "external"; name: string; title: string }
  | null;

export type SpeakerWindowProps = {
  sundayId: string;
  slotNumber: number;
  totalTalks: number;
  assignment: Assignment | null;
  // The talk's current speaker, resolved on the server — they may no longer be on the active list.
  speakerName: string | null;
  approvedNames: readonly string[];
  // Who changing the speaker would affect — scheduled or accepted (ITER-036, D4). Null for nobody.
  changeWarning: string | null;
  members: readonly SpeakerDirectoryEntry[];
  historyByMember: Readonly<Record<string, readonly SpeakerHistoryRow[]>> | null;
  speakerFlags?: Readonly<Record<string, readonly ReliabilityFlagKind[]>>;
  today: DateOnly;
  onClose: () => void;
  onSaved: () => void;
};

function initialChoice(assignment: Assignment | null, speakerName: string | null): Chosen {
  if (assignment?.externalSpeakerName) {
    return {
      kind: "external",
      name: assignment.externalSpeakerName,
      title: assignment.externalSpeakerTitle ?? "",
    };
  }
  if (assignment?.memberId) {
    return { kind: "member", memberId: assignment.memberId, name: speakerName ?? "A ward member" };
  }
  return null;
}

function fullName(member: SpeakerCandidate): string {
  return `${member.firstName} ${member.lastName}`.trim();
}

export function SpeakerWindow({
  sundayId,
  slotNumber,
  totalTalks,
  assignment,
  speakerName,
  approvedNames,
  changeWarning,
  members,
  historyByMember,
  speakerFlags,
  today,
  onClose,
  onSaved,
}: SpeakerWindowProps) {
  const searchId = useId();
  const [chosen, setChosen] = useState<Chosen>(() => initialChoice(assignment, speakerName));
  const [assignmentType, setAssignmentType] = useState<AssignmentType>(
    assignment?.assignmentType ?? "sacrament_talk",
  );
  const [search, setSearch] = useState("");
  const [showList, setShowList] = useState(true);
  const [historyFor, setHistoryFor] = useState<SpeakerDirectoryEntry | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  const [formError, setFormError] = useState<string>();

  const hadSpeaker = initialChoice(assignment, speakerName) !== null;
  const category: MemberCategory = assignmentType === "youth_speaker" ? "youth" : "adult";
  const term = search.trim().toLowerCase();

  const history =
    historyByMember === null ? null : new Map(Object.entries(historyByMember));
  const listed = orderSpeakerCandidates(
    members.filter(
      (member) =>
        member.category === category && (term === "" || fullName(member).toLowerCase().includes(term)),
    ),
    history,
  );

  async function save(): Promise<void> {
    setFormError(undefined);
    if (chosen === null) {
      setFormError("Choose a speaker first.");
      return;
    }

    let memberId: string | null = null;
    let externalSpeaker: { name: string; title: string | null } | null = null;
    if (chosen.kind === "member") {
      memberId = chosen.memberId;
    } else {
      const name = chosen.name.trim();
      if (name === "") {
        setFormError("Type the speaker's name.");
        return;
      }
      const title = chosen.title.trim();
      externalSpeaker = { name, title: title === "" ? null : title };
    }

    setIsSaving(true);
    const fields = { assignmentType, memberId, externalSpeaker };
    const result = await saveAssignment(
      assignment === null
        ? { kind: "create", sundayId, slotNumber, assignmentType, fields }
        : { kind: "update", assignmentId: assignment.id, fields },
    );
    setIsSaving(false);

    if (!result.ok) {
      setFormError(result.message);
      return;
    }
    onSaved();
  }

  return (
    <Modal isOpen onClose={onClose} title={hadSpeaker ? "Change speaker" : "Assign a speaker"}>
      <div className="flex flex-col gap-4">
        <p className="text-sm text-muted">
          Talk {slotNumber} of {totalTalks}
        </p>

        {historyFor !== null && historyByMember !== null ? (
          <PersonHistoryWindow
            name={fullName(historyFor)}
            history={historyByMember[historyFor.id] ?? []}
            onBack={() => setHistoryFor(null)}
          />
        ) : chosen !== null ? (
          <div className="flex flex-col gap-3">
            <div className="flex flex-wrap items-center gap-2">
              <span className="inline-flex items-center gap-1 rounded-full border border-border bg-surface px-3 py-1 text-sm font-medium text-foreground">
                {chosen.name}
                <button
                  type="button"
                  onClick={() => setChosen(null)}
                  disabled={isSaving}
                  aria-label={`Remove ${chosen.name}`}
                  className="-my-3 -mr-2 inline-flex min-h-11 min-w-11 items-center justify-center rounded-full text-muted hover:text-foreground focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
                >
                  <X aria-hidden="true" className="h-4 w-4" />
                </button>
              </span>
              {chosen.kind === "external" && (
                <span className="text-xs text-muted">Not on the roster</span>
              )}
            </div>
            {chosen.kind === "external" && (
              <div>
                <Input
                  id="speaker-window-title"
                  label="Title (optional)"
                  value={chosen.title}
                  maxLength={MAX_EXTERNAL_SPEAKER_TITLE}
                  disabled={isSaving}
                  placeholder="President"
                  onChange={(event) => setChosen({ ...chosen, title: event.target.value })}
                />
                <p className="mt-1 text-sm text-muted">{EXTERNAL_TITLE_HINT}</p>
              </div>
            )}
          </div>
        ) : (
          <div className="flex flex-col gap-2">
            <div className="flex items-end gap-2">
              <div className="min-w-0 flex-1">
                <Input
                  id={searchId}
                  label="Speaker"
                  value={search}
                  maxLength={MAX_EXTERNAL_SPEAKER_NAME}
                  autoFocus
                  placeholder="Search by name, or browse the list below…"
                  onChange={(event) => setSearch(event.target.value)}
                />
              </div>
              <button
                type="button"
                className={LINK_BUTTON}
                aria-expanded={showList}
                onClick={() => setShowList((open) => !open)}
              >
                {showList ? "Hide list" : "Show list"}
              </button>
            </div>

            {term !== "" && (
              <button
                type="button"
                className={`${LINK_BUTTON} self-start px-0 text-left`}
                onClick={() => setChosen({ kind: "external", name: search.trim(), title: "" })}
              >
                Can&apos;t find them? Use &ldquo;{search.trim()}&rdquo; as typed
              </button>
            )}

            {showList &&
              (listed.length === 0 ? (
                <p className="text-sm text-muted">
                  {term === "" ? "Nobody on the roster to list." : "Nobody on the roster matches."}
                </p>
              ) : (
                <ul
                  aria-label="Ward members, longest since speaking first"
                  className="flex max-h-80 flex-col divide-y divide-border overflow-y-auto rounded-md border border-border"
                >
                  {listed.map((member) => {
                    const name = fullName(member);
                    return (
                      <li key={member.id} className="flex items-center gap-2 px-2 py-1">
                        <button
                          type="button"
                          onClick={() => setChosen({ kind: "member", memberId: member.id, name })}
                          className="flex min-h-11 min-w-[9rem] flex-1 flex-col items-start justify-center py-1 text-left focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
                        >
                          <span className="text-sm font-medium text-foreground">{name}</span>
                          {history !== null && (
                            <span className="text-xs text-muted">
                              {lastSpokeLabel(lastSpokeOn(history.get(member.id) ?? []), today)}
                            </span>
                          )}
                        </button>
                        {/* The flags never squeeze the name and "last spoke" line (walking scenario
                            084): the name keeps a minimum width, and the flags stack in a column
                            on a phone and wrap in a row on a wider screen. */}
                        <div className="flex min-w-0 justify-end *:flex-col *:items-end sm:*:flex-row sm:*:flex-wrap sm:*:justify-end">
                          <ReliabilityFlag flags={speakerFlags?.[member.id] ?? []} />
                        </div>
                        {historyByMember !== null && (
                          <button
                            type="button"
                            className={LINK_BUTTON}
                            onClick={() => setHistoryFor(member)}
                          >
                            History{" "}
                            <span className="sr-only">for {name}</span>
                          </button>
                        )}
                      </li>
                    );
                  })}
                </ul>
              ))}
          </div>
        )}

        {historyFor === null && (
          <>
            <div className="flex flex-col gap-1.5">
              <label htmlFor="speaker-window-kind" className="text-sm font-medium text-foreground">
                Kind of talk
              </label>
              <select
                id="speaker-window-kind"
                value={assignmentType}
                disabled={isSaving}
                onChange={(event) => setAssignmentType(event.target.value as AssignmentType)}
                className={SELECT_CLASSES}
              >
                {ASSIGNMENT_TYPES.map((type) => (
                  <option key={type} value={type}>
                    {ASSIGNMENT_TYPE_LABELS[type]}
                  </option>
                ))}
              </select>
            </div>

            <FormError message={formError} />

            <ApprovalSafeSave
              onCancel={onClose}
              onSave={save}
              isSaving={isSaving}
              saveDisabled={chosen === null}
              approvedCount={approvedNames.length}
              approvedNames={approvedNames}
              extraWarning={changeWarning}
            />
          </>
        )}
      </div>
    </Modal>
  );
}
