"use client";

import { useState, type ReactNode } from "react";
import { ApprovalSafeSave } from "@/components/sacrament/ApprovalSafeSave";
import { FormError } from "@/components/ui/FormError";
import { Input } from "@/components/ui/Input";
import { Modal } from "@/components/ui/Modal";
import { saveAssignment } from "@/lib/assignments/saveAssignment";

// ONE TALK'S DETAILS, in a window (the user's decision, 2026-09-29: "Details opens a window").
// Everything the pipeline needs that used to fill the per-Sunday page — slot length, approvals,
// contacting the speaker, comments — kept whole and moved off the main screen (decision U5: the
// nine stages stay). The three panels arrive already rendered by the server page, so opening the
// window fetches nothing.

export type TalkDetailsWindowProps = {
  slotNumber: number;
  assignmentId: string;
  slotLengthMinutes: number | null;
  canPlan: boolean;
  approvedNames: readonly string[];
  approvals: ReactNode;
  contacting: ReactNode;
  comments: ReactNode;
  onClose: () => void;
  onSaved: () => void;
};

function SlotLength({
  assignmentId,
  slotLengthMinutes,
  approvedNames,
  onSaved,
}: {
  assignmentId: string;
  slotLengthMinutes: number | null;
  approvedNames: readonly string[];
  onSaved: () => void;
}) {
  const initial = slotLengthMinutes === null ? "" : String(slotLengthMinutes);
  const [minutes, setMinutes] = useState(initial);
  const [isSaving, setIsSaving] = useState(false);
  const [formError, setFormError] = useState<string>();

  async function save(): Promise<void> {
    setFormError(undefined);
    let value: number | null = null;
    if (minutes.trim() !== "") {
      value = Number(minutes);
      if (!Number.isInteger(value) || value < 1 || value > 60) {
        setFormError("A slot is a whole number of minutes, from 1 to 60.");
        return;
      }
    }

    setIsSaving(true);
    const result = await saveAssignment({
      kind: "update",
      assignmentId,
      fields: { slotLengthMinutes: value },
    });
    setIsSaving(false);

    if (!result.ok) {
      setFormError(result.message);
      return;
    }
    onSaved();
  }

  return (
    <div className="flex flex-col gap-2">
      <Input
        id={`slot-length-${assignmentId}`}
        label="Minutes"
        type="number"
        inputMode="numeric"
        min={1}
        max={60}
        value={minutes}
        disabled={isSaving}
        onChange={(event) => setMinutes(event.target.value)}
      />
      <FormError message={formError} />
      {minutes !== initial && (
        <ApprovalSafeSave
          onCancel={() => setMinutes(initial)}
          onSave={save}
          isSaving={isSaving}
          approvedCount={approvedNames.length}
          approvedNames={approvedNames}
        />
      )}
    </div>
  );
}

function Section({ heading, children }: { heading: string; children: ReactNode }) {
  return (
    <section className="flex flex-col gap-2">
      <h3 className="text-sm font-semibold text-foreground">{heading}</h3>
      {children}
    </section>
  );
}

export function TalkDetailsWindow({
  slotNumber,
  assignmentId,
  slotLengthMinutes,
  canPlan,
  approvedNames,
  approvals,
  contacting,
  comments,
  onClose,
  onSaved,
}: TalkDetailsWindowProps) {
  return (
    <Modal isOpen onClose={onClose} title={`Talk ${slotNumber} — details`}>
      <div className="flex flex-col gap-5">
        <Section heading="Slot length">
          {canPlan ? (
            <SlotLength
              assignmentId={assignmentId}
              slotLengthMinutes={slotLengthMinutes}
              approvedNames={approvedNames}
              onSaved={onSaved}
            />
          ) : (
            <p className="text-sm text-foreground">
              {slotLengthMinutes === null ? "Not set" : `${slotLengthMinutes} minutes`}
            </p>
          )}
        </Section>
        <Section heading="Approvals">{approvals}</Section>
        <Section heading="Contacting the speaker">{contacting}</Section>
        <Section heading="Comments">{comments}</Section>
      </div>
    </Modal>
  );
}
