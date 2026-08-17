"use client";

import Link from "next/link";
import { MemberStatusBadge } from "@/components/roster/MemberStatusBadge";
import { Card } from "@/components/ui/Card";
import type { Member } from "@/lib/roster/queries";

export type MemberListProps = {
  members: Member[];
  householdNames?: Record<string, string>;
  selectable?: boolean;
  selectedIds?: readonly string[];
  onSelectionChange?: (memberIds: string[]) => void;
};

// The flat view. Its reason to exist is the member with no household — they are invisible in
// the household view by construction, and losing someone silently is worse than a second view
// to maintain.
//
// Client-side since roster-b: a checkbox needs a change handler, and a Server Component cannot
// be handed one. When `selectable` is absent this renders exactly what it rendered before, so
// roster-a's callers did not change.
export function MemberList({
  members,
  householdNames = {},
  selectable = false,
  selectedIds = [],
  onSelectionChange,
}: MemberListProps) {
  const selected = new Set(selectedIds);

  function toggle(memberId: string): void {
    if (!onSelectionChange) return;

    onSelectionChange(
      selected.has(memberId)
        ? selectedIds.filter((id) => id !== memberId)
        : [...selectedIds, memberId],
    );
  }

  return (
    <ul className="flex flex-col gap-3">
      {members.map((member) => {
        const householdName = member.householdId
          ? householdNames[member.householdId]
          : undefined;

        return (
          <li key={member.id}>
            <Card>
              <div className="flex flex-col gap-2 md:flex-row md:items-center md:justify-between">
                <div className="flex min-w-0 items-center gap-3">
                  {selectable && (
                    <input
                      type="checkbox"
                      checked={selected.has(member.id)}
                      onChange={() => toggle(member.id)}
                      aria-label={`Select ${member.firstName} ${member.lastName}`}
                      className="h-5 w-5 shrink-0 rounded border-border focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
                    />
                  )}

                  <div className="min-w-0">
                    <Link
                      href={`/roster/member/${member.id}`}
                      className="text-sm font-medium text-primary underline underline-offset-4"
                    >
                      {member.firstName} {member.lastName}
                    </Link>
                    <p className="mt-1 text-sm text-muted">
                      {householdName ?? "No household"}
                      {member.category ? ` · ${member.category}` : ""}
                    </p>
                  </div>
                </div>

                <MemberStatusBadge status={member.status} />
              </div>
            </Card>
          </li>
        );
      })}
    </ul>
  );
}
