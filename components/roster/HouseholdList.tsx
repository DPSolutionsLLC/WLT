import Link from "next/link";
import { MemberStatusBadge } from "@/components/roster/MemberStatusBadge";
import { Card } from "@/components/ui/Card";
import type { HouseholdWithMembers } from "@/lib/roster/queries";

export type HouseholdListProps = {
  households: HouseholdWithMembers[];
  canManage: boolean;
};

// Not virtualized. 02-roster.md says "virtualized if over ~200 households"; a real ward is
// 100–150, no virtualization library is installed, and adding a dependency needs permission.
// Revisit if a ward ever exceeds ~200 — that is the threshold, and it is a real one.
//
// Expand-to-members uses <details>, so the whole list stays a Server Component and still works
// before hydration. A useState toggle would buy nothing here except a client bundle.
export function HouseholdList({ households, canManage }: HouseholdListProps) {
  return (
    <ul className="flex flex-col gap-3">
      {households.map((household) => (
        <li key={household.id}>
          <Card>
            <details>
              <summary className="flex min-h-11 cursor-pointer list-none items-center justify-between gap-3">
                <span className="min-w-0">
                  <span className="block text-sm font-medium text-foreground">
                    {household.familyName}
                  </span>
                  {/* The address is what distinguishes two unrelated Smith households. */}
                  <span className="mt-0.5 block text-sm text-muted">
                    {household.address ?? "No address on file"}
                  </span>
                </span>
                <span className="shrink-0 text-sm text-muted">
                  {household.members.length}{" "}
                  {household.members.length === 1 ? "member" : "members"}
                </span>
              </summary>

              <div className="mt-3 border-t border-border pt-3">
                {household.members.length === 0 ? (
                  <p className="text-sm text-muted">
                    No members match the current filters.
                  </p>
                ) : (
                  <ul className="flex flex-col gap-2">
                    {household.members.map((member) => (
                      <li
                        key={member.id}
                        className="flex flex-col gap-1 md:flex-row md:items-center md:justify-between"
                      >
                        <Link
                          href={`/roster/member/${member.id}`}
                          className="text-sm text-primary underline underline-offset-4"
                        >
                          {member.firstName} {member.lastName}
                        </Link>
                        <MemberStatusBadge status={member.status} />
                      </li>
                    ))}
                  </ul>
                )}

                <div className="mt-3 flex flex-col gap-2 md:flex-row">
                  <Link
                    href={`/roster/household/${household.id}`}
                    className="text-sm text-primary underline underline-offset-4"
                  >
                    Open household
                  </Link>
                  {canManage && (
                    <Link
                      href={`/roster/household/${household.id}`}
                      className="text-sm text-muted underline underline-offset-4"
                    >
                      Edit details
                    </Link>
                  )}
                </div>
              </div>
            </details>
          </Card>
        </li>
      ))}
    </ul>
  );
}
