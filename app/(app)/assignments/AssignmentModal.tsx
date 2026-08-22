"use client";

import { useState } from "react";
import { SpeakerField, type SpeakerValue } from "@/app/(app)/assignments/SpeakerField";
import { Button } from "@/components/ui/Button";
import { FormError } from "@/components/ui/FormError";
import { Input } from "@/components/ui/Input";
import { Modal } from "@/components/ui/Modal";
import type { Assignment, TopicOption } from "@/lib/assignments/queries";
import {
  ASSIGNMENT_TYPES,
  type AssignmentType,
  type MemberCategory,
  type SessionUser,
} from "@/types/domain";

// Where most of the planning happens. The pipeline is nine STAGES, not nine screens — a bishopric
// plans a whole Sunday from the month view through this modal, and the per-Sunday page carries
// the long-form work afterwards (04-talks-pipeline.md's last pitfall).
//
// `counts_toward_rotation` is deliberately absent. The server sets it from the assignment type,
// so nobody answers the same question twice, and it is STORED rather than derived so a later
// change to COUNTS_TOWARD_ROTATION cannot silently rewrite what a ward decided (talks-a Task 9).

const ASSIGNMENT_TYPE_LABELS: Record<AssignmentType, string> = {
  sacrament_talk: "Sacrament talk",
  organizational: "Organizational",
  returning_missionary: "Returning missionary",
  new_member: "New member",
  youth_speaker: "Youth speaker",
  high_council: "High council",
  other: "Other",
};

const SELECT_CLASSES =
  "min-h-11 w-full rounded-md border border-border bg-surface-raised px-3 py-2 text-base " +
  "text-foreground focus-visible:outline-2 focus-visible:outline-offset-2 " +
  "focus-visible:outline-primary";

export type AssignmentModalProps = {
  isOpen: boolean;
  onClose: () => void;
  onSaved: () => void | Promise<void>;
  user: SessionUser;
  sundayId: string;
  sundayLabel: string;
  slotNumber: number;
  assignment: Assignment | null;
  topics: TopicOption[];
  approvedCount: number;
  // Who loses their approval, when the caller knows. The month read carries counts only, so the
  // planner passes nothing and the warning counts; the Sunday detail page has the approval rows
  // and names them. Both warn — only the wording differs.
  approvedNames?: readonly string[];
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

  return {
    side: "member",
    memberId: assignment?.memberId ?? null,
    externalName: "",
    externalTitle: "",
  };
}

// A sentence naming the consequence, not the mechanism. roster-c shipped a confirm button whose
// explanation was never announced with it; calendar-b's rule is that the button is
// aria-describedby this exact text.
export function describeInvalidation(
  approvedCount: number,
  approvedNames?: readonly string[],
): string {
  const who =
    approvedNames && approvedNames.length > 0
      ? approvedNames.length === 1
        ? `${approvedNames[0]} has approved this plan.`
        : `${approvedNames.slice(0, -1).join(", ")} and ${approvedNames[approvedNames.length - 1]} have approved this plan.`
      : `${approvedCount} ${approvedCount === 1 ? "member has" : "members have"} approved this plan.`;

  return `${who} Saving clears those approvals and asks them again.`;
}

async function readJson(response: Response): Promise<Record<string, unknown>> {
  try {
    return (await response.json()) as Record<string, unknown>;
  } catch {
    throw new Error("The server sent a response this page could not read.");
  }
}

export function AssignmentModal({
  isOpen,
  onClose,
  onSaved,
  user,
  sundayId,
  sundayLabel,
  slotNumber,
  assignment,
  topics,
  approvedCount,
  approvedNames,
}: AssignmentModalProps) {
  const [speaker, setSpeaker] = useState<SpeakerValue>(() => initialSpeaker(assignment));
  const [assignmentType, setAssignmentType] = useState<AssignmentType>(
    assignment?.assignmentType ?? "sacrament_talk",
  );
  const [topicId, setTopicId] = useState<string>(assignment?.topicId ?? "");
  const [slotLength, setSlotLength] = useState<string>(
    assignment?.slotLengthMinutes === null || assignment?.slotLengthMinutes === undefined
      ? ""
      : String(assignment.slotLengthMinutes),
  );

  const [isConfirmingSave, setIsConfirmingSave] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [formError, setFormError] = useState<string>();

  const willInvalidate = assignment !== null && approvedCount > 0;
  const invalidationId = "assignment-invalidation-warning";

  // Youth speakers come from the youth, everybody else from the adults. The picker narrows in
  // memory, so changing the type does not refetch the roster.
  const category: MemberCategory =
    assignmentType === "youth_speaker" ? "youth" : "adult";

  function readSpeakerFields():
    | { ok: true; memberId: string | null; externalSpeaker: { name: string; title: string | null } | null }
    | { ok: false; message: string } {
    if (speaker.side === "external") {
      const name = speaker.externalName.trim();
      const title = speaker.externalTitle.trim();

      // Refused in the form rather than by the server. A round trip to be told to fill in the
      // box that is right there is a worse answer than the box turning red (roster-b).
      if (name === "") {
        return { ok: false, message: "Type the speaker's name." };
      }

      return {
        ok: true,
        memberId: null,
        externalSpeaker: { name, title: title === "" ? null : title },
      };
    }

    return { ok: true, memberId: speaker.memberId, externalSpeaker: null };
  }

  function readSlotLength(): { ok: true; value: number | null } | { ok: false; message: string } {
    if (slotLength.trim() === "") return { ok: true, value: null };

    const minutes = Number(slotLength);

    if (!Number.isInteger(minutes) || minutes < 1 || minutes > 60) {
      return { ok: false, message: "A slot is a whole number of minutes, from 1 to 60." };
    }

    return { ok: true, value: minutes };
  }

  async function save(): Promise<void> {
    setFormError(undefined);

    const speakerFields = readSpeakerFields();
    if (!speakerFields.ok) {
      setFormError(speakerFields.message);
      return;
    }

    const minutes = readSlotLength();
    if (!minutes.ok) {
      setFormError(minutes.message);
      return;
    }

    setIsSaving(true);

    try {
      const response = assignment
        ? await fetch(`/api/assignments/${assignment.id}`, {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              action: "update",
              fields: {
                assignmentType,
                slotNumber,
                slotLengthMinutes: minutes.value,
                memberId: speakerFields.memberId,
                externalSpeaker: speakerFields.externalSpeaker,
                topicId: topicId === "" ? null : topicId,
              },
            }),
          })
        : await fetch("/api/assignments", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              sundayId,
              assignmentType,
              slotNumber,
              slotLengthMinutes: minutes.value,
              memberId: speakerFields.memberId,
              externalSpeaker: speakerFields.externalSpeaker,
              topicId: topicId === "" ? null : topicId,
            }),
          });

      const payload = await readJson(response);

      if (!response.ok) {
        setFormError(
          typeof payload.error === "string"
            ? payload.error
            : "Could not save that assignment. Please try again.",
        );
        return;
      }

      setIsConfirmingSave(false);
      await onSaved();
    } catch (error) {
      console.error("Could not save an assignment", error);
      setFormError("Could not reach the server. Check your connection and try again.");
    } finally {
      setIsSaving(false);
    }
  }

  function handleSaveClicked(): void {
    // The warning arrives BEFORE the write, not as a report afterwards. A counselor must never
    // find they approved something that was changed underneath them (04-talks-pipeline.md §Step 3).
    if (willInvalidate && !isConfirmingSave) {
      setIsConfirmingSave(true);
      return;
    }

    void save();
  }

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title={`Slot ${slotNumber} — ${sundayLabel}`}
    >
      <div className="flex flex-col gap-4">
        <SpeakerField
          user={user}
          value={speaker}
          onChange={setSpeaker}
          category={category}
          disabled={isSaving}
        />

        <div className="flex flex-col gap-1.5">
          <label htmlFor="assignment-type" className="text-sm font-medium text-foreground">
            Assignment type
          </label>
          <select
            id="assignment-type"
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

        <div className="flex flex-col gap-1.5">
          <label htmlFor="assignment-topic" className="text-sm font-medium text-foreground">
            Topic
          </label>
          <select
            id="assignment-topic"
            value={topicId}
            disabled={isSaving}
            onChange={(event) => setTopicId(event.target.value)}
            className={SELECT_CLASSES}
          >
            <option value="">No topic yet</option>
            {topics.map((topic) => (
              <option key={topic.id} value={topic.id}>
                {topic.title}
              </option>
            ))}
          </select>
          {topics.length === 0 && (
            <p className="text-sm text-muted">
              There are no topics in the ward&apos;s library yet, and an assignment needs one
              before it can go for review.
            </p>
          )}
        </div>

        <Input
          id="slot-length"
          label="Slot length in minutes"
          type="number"
          inputMode="numeric"
          min={1}
          max={60}
          value={slotLength}
          disabled={isSaving}
          onChange={(event) => setSlotLength(event.target.value)}
        />

        <FormError message={formError} />

        {isConfirmingSave && (
          <p id={invalidationId} role="alert" className="text-sm text-warning">
            {describeInvalidation(approvedCount, approvedNames)}
          </p>
        )}

        <div className="flex flex-col gap-2 md:flex-row md:justify-end">
          <Button type="button" variant="secondary" onClick={onClose} disabled={isSaving}>
            Cancel
          </Button>

          {/* aria-describedby the paragraph explaining the consequence, not merely near it.
              roster-c shipped this exact button with an unconnected announcement and it had to
              be fixed (calendar-b). */}
          <Button
            type="button"
            onClick={handleSaveClicked}
            disabled={isSaving}
            aria-describedby={isConfirmingSave ? invalidationId : undefined}
          >
            {isSaving
              ? "Saving…"
              : isConfirmingSave
                ? "Save and clear the approvals"
                : "Save"}
          </Button>
        </div>
      </div>
    </Modal>
  );
}
