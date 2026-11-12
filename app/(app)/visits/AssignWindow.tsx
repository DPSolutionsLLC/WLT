"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import type { AppointmentRow } from "@/app/(app)/visits/AppointmentPanel";
import { Button } from "@/components/ui/Button";
import { FormError } from "@/components/ui/FormError";
import {
  bishopricCallingLabel,
  memberDisplayName,
  type BishopricMember,
} from "@/lib/visits/assignmentShares";
import type { VisitAssignment } from "@/types/domain";

// DIVIDING THE BISHOPRIC'S HOUSEHOLDS (ITER-055 bv5, D4, D8). Tick households, choose who will
// visit, Assign. Each assignment puts "Visit the ___ family" on that person's To Do.
//
// A HOUSEHOLD SOMEBODY ELSE HOLDS IS A REASSIGNMENT, and the window says so before anything is sent:
// who loses it, and any visit they already scheduled — which stays on their appointments (D8).
// Unassign sends the household back to nobody. Once a ticked household is held by anyone, the box
// says what EACH button would do (decided walking scenario 102), including that Unassign skips the
// ticked households nobody holds.
//
// The server checks everything again (canAssignVisits, the assignee's calling, the households'
// ward); this window only keeps a person from being offered what it would refuse.

export type AssignableHousehold = { id: string; familyName: string };

export type AssignWindowProps = {
  households: AssignableHousehold[];
  members: BishopricMember[];
  openAssignments: VisitAssignment[];
  appointments: AppointmentRow[];
  onDone: () => void;
};

const SELECT_CLASSES =
  "min-h-11 rounded-md border border-border bg-surface-raised px-3 text-base text-foreground focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary";

const CHECKBOX_ROW_CLASSES =
  "flex min-h-11 items-center gap-3 rounded-md px-2 text-sm text-foreground " +
  "focus-within:outline-2 focus-within:outline-offset-2 focus-within:outline-primary";

async function send(url: string, method: "POST" | "PATCH", body: unknown): Promise<void> {
  const response = await fetch(url, {
    method,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (response.ok) return;

  let message = "Could not save that. Please try again.";
  try {
    const payload = (await response.json()) as { error?: unknown };
    if (typeof payload.error === "string") message = payload.error;
  } catch {
    message = "The server sent a response this page could not read.";
  }
  throw new Error(message);
}

function plural(count: number, word: string): string {
  return count === 1 ? word : `${word}s`;
}

function joinNames(names: string[]): string {
  if (names.length <= 1) return names.join("");
  return `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}`;
}

export function AssignWindow({
  households,
  members,
  openAssignments,
  appointments,
  onDone,
}: AssignWindowProps) {
  const router = useRouter();
  const [assigneeId, setAssigneeId] = useState(members[0]?.id ?? "");
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | undefined>();

  const memberById = new Map(members.map((member) => [member.id, member]));
  const holderByHousehold = new Map(
    openAssignments.map((assignment) => [assignment.householdId, assignment]),
  );
  const labelFor = (userId: string) => {
    const member = memberById.get(userId);
    return member === undefined ? "a former member of the bishopric" : bishopricCallingLabel(member);
  };

  const chosen = households.filter((household) => selected.has(household.id));
  const movingAway = chosen.filter((household) => {
    const holder = holderByHousehold.get(household.id);
    return holder !== undefined && holder.assignedTo !== assigneeId;
  });
  const assignedSelected = chosen.filter((household) => holderByHousehold.has(household.id));
  const unassignedSelected = chosen.filter((household) => !holderByHousehold.has(household.id));
  const assigneeMember = memberById.get(assigneeId);
  const assigneeLabel =
    assigneeMember === undefined ? "the person chosen" : bishopricCallingLabel(assigneeMember);
  const familyNames = (list: AssignableHousehold[]) => joinNames(list.map((household) => household.familyName));
  const scheduledMoving = appointments.filter(
    (appointment) =>
      appointment.status === "scheduled" &&
      appointment.householdId !== null &&
      movingAway.some((household) => household.id === appointment.householdId),
  );

  const unassignedIds = households
    .filter((household) => !holderByHousehold.has(household.id))
    .map((household) => household.id);

  function toggle(householdId: string) {
    setSelected((current) => {
      const next = new Set(current);
      if (next.has(householdId)) next.delete(householdId);
      else next.add(householdId);
      return next;
    });
  }

  async function run(action: () => Promise<void>) {
    setSaving(true);
    setError(undefined);
    try {
      await action();
      router.refresh();
      setSelected(new Set());
      onDone();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Could not save that. Please try again.");
    } finally {
      setSaving(false);
    }
  }

  const assign = () =>
    run(() => send("/api/visit-assignments", "POST", { householdIds: [...selected], assignedTo: assigneeId }));

  const unassign = () =>
    run(async () => {
      for (const household of assignedSelected) {
        const holder = holderByHousehold.get(household.id);
        if (holder !== undefined) {
          await send(`/api/visit-assignments/${holder.id}`, "PATCH", { unassign: true });
        }
      }
    });

  if (members.length === 0) {
    return (
      <p className="text-sm text-muted">
        Nobody holds a bishopric calling in this ward yet, so there is nobody to assign households to.
      </p>
    );
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-col gap-1.5">
        <label htmlFor="assign-to" className="text-sm font-medium text-foreground">
          Who will visit
        </label>
        <select
          id="assign-to"
          className={SELECT_CLASSES}
          value={assigneeId}
          onChange={(event) => setAssigneeId(event.target.value)}
        >
          {members.map((member) => (
            <option key={member.id} value={member.id}>
              {bishopricCallingLabel(member)} — {memberDisplayName(member)}
            </option>
          ))}
        </select>
      </div>

      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm text-muted">
          {selected.size} {plural(selected.size, "household")} chosen
        </p>
        {unassignedIds.length === 0 ? null : (
          <Button
            variant="secondary"
            onClick={() => setSelected(new Set(unassignedIds))}
            disabled={saving}
          >
            Choose every unassigned one
          </Button>
        )}
      </div>

      {households.length === 0 ? (
        <p className="text-sm text-muted">There are no households to assign.</p>
      ) : (
        <div className="max-h-96 overflow-y-auto rounded-md border border-border">
          {households.map((household) => {
            const holder = holderByHousehold.get(household.id);
            return (
              <label key={household.id} className={CHECKBOX_ROW_CLASSES}>
                <input
                  type="checkbox"
                  className="h-5 w-5 shrink-0"
                  checked={selected.has(household.id)}
                  onChange={() => toggle(household.id)}
                />
                <span className="flex min-w-0 flex-col">
                  <span>{household.familyName}</span>
                  {holder === undefined ? null : (
                    <span className="text-xs text-muted">Assigned to {labelFor(holder.assignedTo)}</span>
                  )}
                </span>
              </label>
            );
          })}
        </div>
      )}

      {assignedSelected.length === 0 ? null : (
        <div className="flex flex-col gap-2 rounded-md border border-warning/40 bg-warning/10 p-3 text-sm text-foreground">
          <div>
            <p>
              <span className="font-medium text-warning">Assign</span> gives {familyNames(chosen)} to{" "}
              {assigneeLabel}.
            </p>
            {movingAway.length === 0 ? null : (
              <ul className="mt-0.5 flex flex-col gap-0.5">
                {movingAway.map((household) => (
                  <li key={household.id}>
                    {household.familyName} moves from{" "}
                    {labelFor(holderByHousehold.get(household.id)!.assignedTo)}, and their to-do closes.
                  </li>
                ))}
              </ul>
            )}
            {scheduledMoving.length === 0 ? null : (
              <p className="mt-0.5">
                {scheduledMoving
                  .map(
                    (appointment) =>
                      `${appointment.householdName ?? "A household"} has a visit scheduled` +
                      (appointment.madeByName === null ? "" : ` by ${appointment.madeByName}`),
                  )
                  .join(". ")}
                . It stays on their appointments.
              </p>
            )}
          </div>
          <div>
            <p>
              <span className="font-medium text-warning">
                Unassign {assignedSelected.length} {plural(assignedSelected.length, "household")}
              </span>{" "}
              gives {familyNames(assignedSelected)} back to nobody, and{" "}
              {assignedSelected.length === 1
                ? `${labelFor(holderByHousehold.get(assignedSelected[0].id)!.assignedTo)}'s to-do closes.`
                : "their to-dos close."}
            </p>
            {unassignedSelected.length === 0 ? null : (
              <p className="mt-0.5">
                {familyNames(unassignedSelected)}{" "}
                {unassignedSelected.length === 1
                  ? "isn't assigned to anyone, so Unassign leaves it as it is."
                  : "aren't assigned to anyone, so Unassign leaves them as they are."}
              </p>
            )}
          </div>
        </div>
      )}

      <FormError message={error} />

      <div className="flex flex-wrap gap-2">
        <Button onClick={() => void assign()} disabled={saving || selected.size === 0 || assigneeId === ""}>
          {saving ? "Saving…" : "Assign"}
        </Button>
        {assignedSelected.length === 0 ? null : (
          <Button variant="secondary" onClick={() => void unassign()} disabled={saving}>
            Unassign {assignedSelected.length} {plural(assignedSelected.length, "household")}
          </Button>
        )}
      </div>
    </div>
  );
}
