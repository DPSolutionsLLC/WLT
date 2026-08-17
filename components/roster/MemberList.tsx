import Link from "next/link";
import { MemberStatusBadge } from "@/components/roster/MemberStatusBadge";
import { Card } from "@/components/ui/Card";
import type { Member } from "@/lib/roster/queries";

export type MemberListProps = {
  members: Member[];
  householdNames?: Record<string, string>;
};

// The flat view. Its reason to exist is the member with no household — they are invisible in
// the household view by construction, and losing someone silently is worse than a second view
// to maintain.
export function MemberList({ members, householdNames = {} }: MemberListProps) {
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

                <MemberStatusBadge status={member.status} />
              </div>
            </Card>
          </li>
        );
      })}
    </ul>
  );
}
