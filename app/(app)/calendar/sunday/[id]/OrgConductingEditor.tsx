"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { ConductingLabel } from "@/components/calendar/ConductingLabel";
import { Button } from "@/components/ui/Button";
import { FormError } from "@/components/ui/FormError";

// Who conducts each organization's meeting on ONE Sunday. Editing a row IS the override — there
// is no is_override flag, exactly as there is none on sundays.conducting_user_id (migration 024,
// Part 4). Overriding one Sunday leaves the rotation and every other Sunday alone.
//
// Each row saves on its own. There is deliberately no "save all" button: a bulk save over six
// organizations makes a partial failure impossible to report honestly, and the route accepts one
// organization per request for the same reason.

export type OrgConductingCandidate = {
  id: string;
  name: string;
};

export type OrgConductingRow = {
  orgId: string;
  organizationName: string;
  userId: string | null;
  // False for an organization this viewer may not manage — the row renders read-only, through
  // the same ConductingLabel, rather than disappearing. Who conducts Relief Society is not
  // sensitive; being able to CHANGE it is what is scoped.
  canManage: boolean;
  candidates: OrgConductingCandidate[];
};

export type OrgConductingEditorProps = {
  sundayId: string;
  rows: OrgConductingRow[];
  names: Record<string, string>;
};

const SELECT_CLASSES =
  "min-h-11 w-full rounded-md border border-border bg-surface-raised px-3 py-2 text-sm " +
  "text-foreground focus-visible:outline-2 focus-visible:outline-offset-2 " +
  "focus-visible:outline-primary";

export function OrgConductingEditor({ sundayId, rows, names }: OrgConductingEditorProps) {
  return (
    <ul className="flex flex-col gap-4">
      {rows.map((row) => (
        <li key={row.orgId} className="flex flex-col gap-1.5">
          {row.canManage ? (
            <EditableRow sundayId={sundayId} row={row} />
          ) : (
            <div className="flex flex-col gap-0.5 md:flex-row md:gap-3">
              <span className="text-sm text-muted md:w-40">{row.organizationName}</span>
              <span className="text-sm">
                <ConductingLabel conductingUserId={row.userId} names={names} />
              </span>
            </div>
          )}
        </li>
      ))}
    </ul>
  );
}

function EditableRow({ sundayId, row }: { sundayId: string; row: OrgConductingRow }) {
  const router = useRouter();

  const [userId, setUserId] = useState(row.userId ?? "");
  const [formError, setFormError] = useState<string>();
  const [statusMessage, setStatusMessage] = useState<string>();
  const [isSubmitting, setIsSubmitting] = useState(false);

  const selectId = `org-conducting-${row.orgId}`;

  async function handleSave() {
    setFormError(undefined);
    setStatusMessage(undefined);
    setIsSubmitting(true);

    try {
      const response = await fetch(`/api/sundays/${sundayId}/org-conducting`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          orgId: row.orgId,
          userId: userId === "" ? null : userId,
        }),
      });

      const body: { error?: string } = await response.json();

      // The server's own sentence, rendered verbatim. A catch that mapped every failure to one
      // message would eventually be wrong about the common case
      // (plans/retros/roster-c-csv-import.md).
      if (!response.ok) {
        setFormError(body.error ?? "Could not save who conducts. Please try again.");
        return;
      }

      setStatusMessage("Saved. This Sunday only — the rotation is unchanged.");
      router.refresh();
    } catch (error) {
      console.error("Could not set who conducts for an organization", error);
      setFormError("Could not reach the server. Check your connection and try again.");
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <>
      <label htmlFor={selectId} className="text-sm font-medium text-foreground">
        {row.organizationName}
      </label>

      <div className="flex flex-col gap-2 md:flex-row md:items-center">
        <select
          id={selectId}
          className={SELECT_CLASSES}
          value={userId}
          onChange={(event) => setUserId(event.target.value)}
        >
          <option value="">Nobody</option>
          {row.candidates.map((candidate) => (
            <option key={candidate.id} value={candidate.id}>
              {candidate.name}
            </option>
          ))}
        </select>

        <Button type="button" onClick={handleSave} disabled={isSubmitting}>
          {isSubmitting ? "Saving…" : "Save"}
        </Button>
      </div>

      <FormError message={formError} />

      {statusMessage && (
        <p role="status" className="text-sm text-muted">
          {statusMessage}
        </p>
      )}
    </>
  );
}
