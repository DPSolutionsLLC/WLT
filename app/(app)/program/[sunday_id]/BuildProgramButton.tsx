"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/Button";
import { FormError } from "@/components/ui/FormError";
import { messageFromPayload, readJsonPayload } from "@/lib/program/requests";

// The one action a Sunday with no program row offers. It POSTs the build action and lets the
// server re-render the page, which now finds a program and shows the editor instead.
//
// router.refresh() is CORRECT here and only here: there is no client form state to go stale,
// because there is no form yet. Everywhere else on this screen a refresh is not enough — see
// ProgramBuilder's applyDraft (plans/retros/ai-a-settings-and-preview.md).

export type BuildProgramButtonProps = {
  sundayId: string;
};

export function BuildProgramButton({ sundayId }: BuildProgramButtonProps) {
  const router = useRouter();
  const [isBuilding, setIsBuilding] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string>();

  async function build(): Promise<void> {
    setErrorMessage(undefined);
    setIsBuilding(true);

    try {
      const response = await fetch("/api/programs", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "build", sundayId }),
      });

      const payload = await readJsonPayload(response);

      if (!response.ok) {
        setErrorMessage(
          messageFromPayload(payload, "Could not build that program. Please try again."),
        );
        return;
      }

      router.refresh();
    } catch (error) {
      console.error("Could not build a program", error);
      setErrorMessage("Could not reach the server. Check your connection and try again.");
    } finally {
      setIsBuilding(false);
    }
  }

  return (
    <div className="flex flex-col gap-2">
      <Button
        type="button"
        className="self-start"
        disabled={isBuilding}
        onClick={() => void build()}
      >
        {isBuilding ? "Building…" : "Build the program"}
      </Button>
      <FormError message={errorMessage} />
    </div>
  );
}
