"use client";

import { useState } from "react";
import { SpeakerField, type SpeakerValue } from "@/app/(app)/assignments/SpeakerField";
import type { ReliabilityFlagKind } from "@/components/roster/ReliabilityFlag";
import { ApprovalSafeSave } from "@/components/sacrament/ApprovalSafeSave";
import { FormError } from "@/components/ui/FormError";
import { Modal } from "@/components/ui/Modal";
import type { Assignment } from "@/lib/assignments/queries";
import { saveAssignment } from "@/lib/assignments/saveAssignment";
import {
  ASSIGNMENT_TYPE_LABELS,
  ASSIGNMENT_TYPES,
  type AssignmentType,
  type MemberCategory,
  type SessionUser,
} from "@/types/domain";

// THE SPEAKER WINDOW on the Topics screen (Topics rebuild t3) — the prototype's AssignSpeakerModal,
// opened from a talk row's speaker line. It edits the speaker and the kind of talk and nothing
// else, so a topic typed in the other window is never resent from here.
//
// On an OPEN slot there is no talk yet: Save creates one in that slot.
//
// The picker is INLINE (SpeakerField → MemberPicker mode="inline"): Modal is a native <dialog> and
// is deliberately not built to stack (talks-b-month-planner).

const SELECT_CLASSES =
  "min-h-11 w-full rounded-md border border-border bg-surface-raised px-3 py-2 text-base " +
  "text-foreground focus-visible:outline-2 focus-visible:outline-offset-2 " +
  "focus-visible:outline-primary";

export type SpeakerWindowProps = {
  user: SessionUser;
  sundayId: string;
  slotNumber: number;
  totalTalks: number;
  assignment: Assignment | null;
  approvedNames: readonly string[];
  speakerFlags?: Readonly<Record<string, readonly ReliabilityFlagKind[]>>;
  onClose: () => void;
  onSaved: () => void;
};

function initialSpeaker(assignment: Assignment | null): SpeakerValue {
  if (assignment?.externalSpeakerName) {
    return {
      side: "external",
      memberId: null,
      externalName: assignment.externalSpeakerName,
      externalTitle: assignment.externalSpeakerTitle ?? "",
    };
  }
  return { side: "member", memberId: assignment?.memberId ?? null, externalName: "", externalTitle: "" };
}

export function SpeakerWindow({
  user,
  sundayId,
  slotNumber,
  totalTalks,
  assignment,
  approvedNames,
  speakerFlags,
  onClose,
  onSaved,
}: SpeakerWindowProps) {
  const [speaker, setSpeaker] = useState<SpeakerValue>(() => initialSpeaker(assignment));
  const [assignmentType, setAssignmentType] = useState<AssignmentType>(
    assignment?.assignmentType ?? "sacrament_talk",
  );
  const [isSaving, setIsSaving] = useState(false);
  const [formError, setFormError] = useState<string>();

  const hasSpeaker = assignment !== null && (assignment.memberId !== null || assignment.externalSpeakerName !== null);
  const category: MemberCategory = assignmentType === "youth_speaker" ? "youth" : "adult";

  async function save(): Promise<void> {
    setFormError(undefined);

    let memberId: string | null = null;
    let externalSpeaker: { name: string; title: string | null } | null = null;

    if (speaker.side === "external") {
      const name = speaker.externalName.trim();
      if (name === "") {
        setFormError("Type the speaker's name.");
        return;
      }
      const title = speaker.externalTitle.trim();
      externalSpeaker = { name, title: title === "" ? null : title };
    } else {
      memberId = speaker.memberId;
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
    <Modal isOpen onClose={onClose} title={hasSpeaker ? "Change speaker" : "Assign a speaker"}>
      <div className="flex flex-col gap-4">
        <p className="text-sm text-muted">
          Talk {slotNumber} of {totalTalks}
        </p>

        <SpeakerField
          user={user}
          value={speaker}
          onChange={setSpeaker}
          category={category}
          flags={speakerFlags}
          disabled={isSaving}
        />

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
          approvedCount={approvedNames.length}
          approvedNames={approvedNames}
        />
      </div>
    </Modal>
  );
}
