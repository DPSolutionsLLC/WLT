"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/Button";
import { FormError } from "@/components/ui/FormError";
import type { MusicCompletion } from "@/lib/music/musicCompletion";
import { messageFromPayload, readJsonPayload } from "@/lib/program/requests";

// Sending a Sunday's music to the conductor (ITER-038 slice mb).
//
// DISABLED WITH A REASON, NEVER HIDDEN, while something is still to pick — the prototype's
// "disable with a message, don't just hide". The reason is the same `missing` list the server
// refuses with (lib/music/musicCompletion.ts), so the button and the route cannot disagree.
//
// The card renders this only for a holder of `music.manage`, and only while the music is a draft.

export type SubmitMusicButtonProps = {
  sundayId: string;
  completion: MusicCompletion;
  topicsFinalized: boolean;
};

export function SubmitMusicButton({ sundayId, completion, topicsFinalized }: SubmitMusicButtonProps) {
  const router = useRouter();
  const [isSaving, setIsSaving] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string>();

  const reason = !topicsFinalized
    ? "The conductor hasn't finalized the topics yet."
    : completion.complete
      ? null
      : `${completion.missing.length} left: ${completion.missing.join(", ")}`;

  async function submit(): Promise<void> {
    setErrorMessage(undefined);
    setIsSaving(true);
    try {
      const response = await fetch(`/api/sundays/${sundayId}/music/submit`, { method: "POST" });
      const payload = await readJsonPayload(response);
      if (!response.ok) {
        setErrorMessage(messageFromPayload(payload, "Could not submit the music. Please try again."));
        return;
      }
      router.refresh();
    } catch (error) {
      console.error("Could not submit a Sunday's music", error);
      setErrorMessage("Could not reach the server. Check your connection and try again.");
    } finally {
      setIsSaving(false);
    }
  }

  return (
    <div className="flex flex-col gap-1">
      <div className="flex flex-wrap items-center gap-2">
        <Button disabled={isSaving || reason !== null} onClick={() => void submit()}>
          {isSaving ? "Submitting…" : "Submit for review"}
        </Button>
        {reason === null ? null : <span className="text-sm text-muted">{reason}</span>}
      </div>
      <FormError message={errorMessage} />
    </div>
  );
}
