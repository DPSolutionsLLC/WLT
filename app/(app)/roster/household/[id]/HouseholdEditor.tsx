"use client";

import { useState } from "react";
import { HouseholdForm } from "@/components/roster/HouseholdForm";
import { Button } from "@/components/ui/Button";
import type { Household } from "@/lib/roster/queries";

export type HouseholdEditorProps = {
  household: Household;
};

// The form itself is shared with /roster; this wrapper only owns whether it is open. Keeping
// the toggle here is what lets the page above stay a Server Component.
export function HouseholdEditor({ household }: HouseholdEditorProps) {
  const [isOpen, setIsOpen] = useState(false);

  if (!isOpen) {
    return (
      <Button type="button" variant="secondary" onClick={() => setIsOpen(true)}>
        Edit household
      </Button>
    );
  }

  return (
    <div className="flex flex-col gap-3">
      <HouseholdForm household={household} />
      <Button type="button" variant="secondary" onClick={() => setIsOpen(false)}>
        Done
      </Button>
    </div>
  );
}
