"use client";

import { useState } from "react";
import { MemberForm, type MemberFormHousehold } from "@/components/roster/MemberForm";
import { Button } from "@/components/ui/Button";
import type { Member } from "@/lib/roster/queries";

export type MemberEditorProps = {
  member: Member;
  households: MemberFormHousehold[];
};

export function MemberEditor({ member, households }: MemberEditorProps) {
  const [isOpen, setIsOpen] = useState(false);

  if (!isOpen) {
    return (
      <Button type="button" variant="secondary" onClick={() => setIsOpen(true)}>
        Edit member
      </Button>
    );
  }

  return (
    <div className="flex flex-col gap-3">
      <MemberForm member={member} households={households} />
      <Button type="button" variant="secondary" onClick={() => setIsOpen(false)}>
        Done
      </Button>
    </div>
  );
}
