"use client";

import { useState } from "react";
import { ApprovalSafeSave } from "@/components/sacrament/ApprovalSafeSave";
import { FormError } from "@/components/ui/FormError";
import { Input } from "@/components/ui/Input";
import { Modal } from "@/components/ui/Modal";
import type { Assignment } from "@/lib/assignments/queries";
import { saveAssignment } from "@/lib/assignments/saveAssignment";
import { MAX_TOPIC_TITLE } from "@/types/domain";

// THE TOPIC WINDOW on the Topics screen (Topics rebuild t3) — the prototype's AssignTopicModal,
// opened from a talk row's topic line. A topic is the words typed for it (migration 086). It edits
// the topic and nothing else, so the speaker is never resent from here.
//
// On an OPEN slot there is no talk yet: Save creates one in that slot, as a sacrament talk.

export type TopicWindowProps = {
  sundayId: string;
  slotNumber: number;
  totalTalks: number;
  assignment: Assignment | null;
  approvedNames: readonly string[];
  onClose: () => void;
  onSaved: () => void;
};

export function TopicWindow({
  sundayId,
  slotNumber,
  totalTalks,
  assignment,
  approvedNames,
  onClose,
  onSaved,
}: TopicWindowProps) {
  const [topic, setTopic] = useState(assignment?.topicTitle ?? "");
  const [isSaving, setIsSaving] = useState(false);
  const [formError, setFormError] = useState<string>();

  async function save(): Promise<void> {
    setFormError(undefined);
    setIsSaving(true);
    const fields = { topicTitle: topic.trim() };
    const result = await saveAssignment(
      assignment === null
        ? { kind: "create", sundayId, slotNumber, assignmentType: "sacrament_talk", fields }
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
    <Modal
      isOpen
      onClose={onClose}
      title={assignment?.topicTitle ? "Change topic" : "Set a topic"}
    >
      <div className="flex flex-col gap-4">
        <p className="text-sm text-muted">
          Talk {slotNumber} of {totalTalks}
        </p>

        <Input
          id="topic-window-topic"
          label="Topic"
          value={topic}
          maxLength={MAX_TOPIC_TITLE}
          placeholder="Type a topic…"
          autoFocus
          disabled={isSaving}
          onChange={(event) => setTopic(event.target.value)}
        />

        <FormError message={formError} />

        <ApprovalSafeSave
          onCancel={onClose}
          onSave={save}
          isSaving={isSaving}
          saveDisabled={topic.trim() === ""}
          approvedCount={approvedNames.length}
          approvedNames={approvedNames}
        />
      </div>
    </Modal>
  );
}
