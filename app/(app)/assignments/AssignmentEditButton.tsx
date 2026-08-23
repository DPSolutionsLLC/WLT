"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { AssignmentModal } from "@/app/(app)/assignments/AssignmentModal";
import { Button } from "@/components/ui/Button";
import type { Assignment } from "@/lib/assignments/queries";
import type { TopicOption } from "@/lib/topics/queries";
import type { SessionUser } from "@/types/domain";

// The detail page is a Server Component and cannot hand AssignmentModal its open state, so the
// state lives on this side of the boundary — the same shape BulkAssignBar ended up with when the
// roster page could not hand MemberList a callback (roster-b).
//
// It exists rather than reusing the planner's own trigger because this page knows something the
// month view does not: WHO approved. The month read carries approval counts only, deliberately,
// so the planner's warning counts and this one names names.

export type AssignmentEditButtonProps = {
  user: SessionUser;
  assignment: Assignment;
  sundayId: string;
  sundayLabel: string;
  topics: TopicOption[];
  approvedNames: string[];
};

export function AssignmentEditButton({
  user,
  assignment,
  sundayId,
  sundayLabel,
  topics,
  approvedNames,
}: AssignmentEditButtonProps) {
  const router = useRouter();
  const [isOpen, setIsOpen] = useState(false);

  return (
    <>
      <Button type="button" variant="secondary" onClick={() => setIsOpen(true)}>
        Edit
      </Button>

      {isOpen && (
        <AssignmentModal
          isOpen
          onClose={() => setIsOpen(false)}
          onSaved={() => {
            setIsOpen(false);
            router.refresh();
          }}
          user={user}
          sundayId={sundayId}
          sundayLabel={sundayLabel}
          slotNumber={assignment.slotNumber ?? 1}
          assignment={assignment}
          topics={topics}
          approvedCount={approvedNames.length}
          approvedNames={approvedNames}
        />
      )}
    </>
  );
}
