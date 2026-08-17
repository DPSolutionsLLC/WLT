"use client";

import { useState, type FormEvent } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { MEMBERS_QUERY_KEY } from "@/components/roster/MemberPicker";
import { Button } from "@/components/ui/Button";
import { FormError } from "@/components/ui/FormError";
import type { WardOrganization } from "@/lib/auth/adminUsers";
import type { MemberOrganization } from "@/lib/roster/organizations";

export type MemberOrganizationsProps = {
  memberId: string;
  organizations: WardOrganization[];
  initialMemberships: MemberOrganization[];
  canManage: boolean;
};

// THE WARD HAS NO YOUNG MEN ORGANIZATION. The bishopric fulfils that presidency, and
// 02-roster.md §Step 5 says not to create one. Phase 10 draws youth for sacrament ordinances by
// category and gender, never from a Young Men organization. This list renders whatever
// `organizations` holds, so nothing in the code enforces that — this comment is the guard.
export function MemberOrganizations({
  memberId,
  organizations,
  initialMemberships,
  canManage,
}: MemberOrganizationsProps) {
  const queryClient = useQueryClient();

  const [memberships, setMemberships] = useState(initialMemberships);
  const [selectedIds, setSelectedIds] = useState<string[]>(
    initialMemberships.map((membership) => membership.organizationId),
  );
  const [formError, setFormError] = useState<string>();
  const [confirmation, setConfirmation] = useState<string>();
  const [isSaving, setIsSaving] = useState(false);

  // Read-only for anyone without roster.manage rather than absent. Knowing which organizations
  // someone belongs to is useful to an org leader and carries no risk — unlike member notes,
  // which are not fetched at all for them.
  if (!canManage) {
    return (
      <div className="flex flex-col gap-2">
        <h2 className="text-base font-semibold text-foreground">Organizations</h2>
        {memberships.length === 0 ? (
          <p className="text-sm text-muted">No organizations.</p>
        ) : (
          <p className="text-sm text-foreground">
            {memberships
              .map((membership) => membership.organizationName)
              .join(", ")}
          </p>
        )}
      </div>
    );
  }

  function toggle(organizationId: string): void {
    setSelectedIds((current) =>
      current.includes(organizationId)
        ? current.filter((id) => id !== organizationId)
        : [...current, organizationId],
    );
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setFormError(undefined);
    setConfirmation(undefined);
    setIsSaving(true);

    try {
      const response = await fetch(`/api/members/${memberId}/organizations`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ organizationIds: selectedIds }),
      });

      const payload: {
        organizations?: MemberOrganization[];
        added?: string[];
        removed?: string[];
        error?: string;
      } = await response.json();

      if (!response.ok || !payload.organizations) {
        setFormError(
          payload.error ?? "Could not save those organizations. Please try again.",
        );
        return;
      }

      setMemberships(payload.organizations);
      setSelectedIds(
        payload.organizations.map((membership) => membership.organizationId),
      );

      const added = payload.added?.length ?? 0;
      const removed = payload.removed?.length ?? 0;
      setConfirmation(
        added === 0 && removed === 0
          ? "Nothing changed."
          : `Saved — ${added} added, ${removed} removed.`,
      );

      // Any open picker is showing a roster that may now be filtered differently.
      await queryClient.invalidateQueries({ queryKey: [MEMBERS_QUERY_KEY] });
    } catch (error) {
      console.error("Could not save the member's organizations", error);
      setFormError("Could not reach the server. Check your connection and try again.");
    } finally {
      setIsSaving(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="flex flex-col gap-3">
      <div>
        <h2 className="text-base font-semibold text-foreground">Organizations</h2>
        <p className="mt-1 text-sm text-muted">
          Which organizations are responsible for this member.
        </p>
      </div>

      {organizations.length === 0 ? (
        <p className="text-sm text-muted">This ward has no organizations yet.</p>
      ) : (
        <ul className="flex flex-col">
          {organizations.map((organization) => (
            <li key={organization.id}>
              <label className="flex min-h-11 items-center gap-3 text-sm text-foreground">
                <input
                  type="checkbox"
                  checked={selectedIds.includes(organization.id)}
                  onChange={() => toggle(organization.id)}
                  className="h-5 w-5 rounded border-border focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
                />
                {organization.name}
              </label>
            </li>
          ))}
        </ul>
      )}

      <FormError message={formError} />

      {confirmation && (
        <p role="status" className="text-sm text-success">
          {confirmation}
        </p>
      )}

      <Button type="submit" disabled={isSaving} className="self-start">
        {isSaving ? "Saving…" : "Save organizations"}
      </Button>
    </form>
  );
}
