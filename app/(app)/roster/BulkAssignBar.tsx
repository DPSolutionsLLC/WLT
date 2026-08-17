"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useQueryClient } from "@tanstack/react-query";
import { MemberList } from "@/components/roster/MemberList";
import { MEMBERS_QUERY_KEY } from "@/components/roster/MemberPicker";
import { Button } from "@/components/ui/Button";
import { FormError } from "@/components/ui/FormError";
import type { WardOrganization } from "@/lib/auth/adminUsers";
import type { Member } from "@/lib/roster/queries";

export type BulkAssignBarProps = {
  members: Member[];
  householdNames: Record<string, string>;
  organizations: WardOrganization[];
  canManage: boolean;
};

const SELECT_CLASSES =
  "min-h-11 w-full rounded-md border border-border bg-surface-raised px-3 py-2 text-sm " +
  "text-foreground focus-visible:outline-2 focus-visible:outline-offset-2 " +
  "focus-visible:outline-primary md:w-56";

// Owns the selection AND renders the list, rather than being only the bar the plan's file name
// suggests. The roster page is a Server Component and cannot hand MemberList an
// onSelectionChange callback, so the state has to live on this side of the boundary and the
// list has to be rendered from here.
//
// Selection is offered in the FLAT LIST only, never the household view. Selecting across
// expanded and collapsed households is a state problem nobody has asked to have.
export function BulkAssignBar({
  members,
  householdNames,
  organizations,
  canManage,
}: BulkAssignBarProps) {
  const router = useRouter();
  const queryClient = useQueryClient();

  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [organizationId, setOrganizationId] = useState("");
  const [formError, setFormError] = useState<string>();
  const [confirmation, setConfirmation] = useState<string>();
  const [isAssigning, setIsAssigning] = useState(false);

  if (!canManage) {
    return <MemberList members={members} householdNames={householdNames} />;
  }

  async function handleAssign() {
    setFormError(undefined);
    setConfirmation(undefined);

    // Refused in the form, not by the server. A round trip to be told to pick something from a
    // select that is right there is a worse answer than the select turning red.
    if (organizationId === "") {
      setFormError("Choose an organization to assign to.");
      return;
    }

    setIsAssigning(true);

    try {
      const response = await fetch("/api/roster/bulk-assign", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ memberIds: selectedIds, organizationId }),
      });

      const payload: { assigned?: number; alreadyMember?: number; error?: string } =
        await response.json();

      if (!response.ok || payload.assigned === undefined) {
        setFormError(payload.error ?? "Could not assign those members. Please try again.");
        return;
      }

      // The counts the server actually wrote, not the count that was asked for. Re-running the
      // same assign reports "0 assigned, 9 were already members" rather than a silent success.
      const alreadyMember = payload.alreadyMember ?? 0;
      setConfirmation(
        `${payload.assigned} assigned` +
          (alreadyMember > 0 ? `, ${alreadyMember} were already members.` : "."),
      );

      setSelectedIds([]);
      await queryClient.invalidateQueries({ queryKey: [MEMBERS_QUERY_KEY] });
      router.refresh();
    } catch (error) {
      console.error("Could not bulk assign members", error);
      setFormError("Could not reach the server. Check your connection and try again.");
    } finally {
      setIsAssigning(false);
    }
  }

  return (
    <div className="flex flex-col gap-3">
      {confirmation && (
        <p role="status" className="text-sm text-success">
          {confirmation}
        </p>
      )}

      <MemberList
        members={members}
        householdNames={householdNames}
        selectable
        selectedIds={selectedIds}
        onSelectionChange={setSelectedIds}
      />

      {/* Fixed to the bottom of the viewport on a phone so it is reachable one-handed during a
          meeting; inline above the list from md up. Only present when something is selected. */}
      {selectedIds.length > 0 && (
        <div className="fixed inset-x-0 bottom-0 z-10 border-t border-border bg-surface-raised p-4 md:static md:rounded-lg md:border">
          <div className="flex flex-col gap-3 md:flex-row md:items-center">
            <p className="text-sm font-medium text-foreground md:flex-1">
              {selectedIds.length} selected
            </p>

            <label htmlFor="bulk-assign-organization" className="sr-only">
              Organization
            </label>
            <select
              id="bulk-assign-organization"
              className={SELECT_CLASSES}
              value={organizationId}
              onChange={(event) => setOrganizationId(event.target.value)}
            >
              <option value="">Choose an organization</option>
              {organizations.map((organization) => (
                <option key={organization.id} value={organization.id}>
                  {organization.name}
                </option>
              ))}
            </select>

            <Button type="button" onClick={handleAssign} disabled={isAssigning}>
              {isAssigning ? "Assigning…" : "Assign"}
            </Button>

            <Button
              type="button"
              variant="secondary"
              onClick={() => setSelectedIds([])}
              disabled={isAssigning}
            >
              Clear
            </Button>
          </div>

          <FormError message={formError} />
        </div>
      )}
    </div>
  );
}
