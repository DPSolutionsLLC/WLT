"use client";

import { useState } from "react";
import { FormError } from "@/components/ui/FormError";
import { messageFromPayload, readJsonPayload } from "@/lib/program/requests";

// The music coordinator's "email me too" switch — ITER-038 slice mc (plan A5, D1).
//
// The To Do item always happens; this only adds an email on top. The page renders it for somebody
// whose active calling is `music_coordinator`, the only people the two triggers reach.
//
// WHETHER EMAIL IS SET UP is decided on the server and passed in as a sentence: lib/email/resend.ts
// throws when imported into a browser, by design, so this component must never ask it.
//
// Local state rather than router.refresh(): nothing else on the page reads this setting.

export type MusicEmailToggleProps = {
  initialEnabled: boolean;
  notConfiguredReason: string | null;
};

export function MusicEmailToggle({ initialEnabled, notConfiguredReason }: MusicEmailToggleProps) {
  const [enabled, setEnabled] = useState(initialEnabled);
  const [isSaving, setIsSaving] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string>();

  async function save(next: boolean) {
    setErrorMessage(undefined);
    setIsSaving(true);
    try {
      const response = await fetch("/api/session/music-email", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ enabled: next }),
      });
      const payload = await readJsonPayload(response);
      if (!response.ok) {
        setErrorMessage(messageFromPayload(payload, "Could not save your email setting. Please try again."));
        return;
      }
      setEnabled(next);
    } catch (error) {
      console.error("Could not save the music email setting", error);
      setErrorMessage("Could not reach the server. Check your connection and try again.");
    } finally {
      setIsSaving(false);
    }
  }

  return (
    <div className="flex flex-col gap-1">
      <label className="flex min-h-11 items-center gap-3 text-sm text-foreground">
        <input
          type="checkbox"
          checked={enabled}
          disabled={isSaving}
          onChange={(event) => void save(event.target.checked)}
          className="h-5 w-5 rounded border-border focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
        />
        Email me when topics are ready or the music is sent back
      </label>
      {notConfiguredReason !== null && <p className="text-xs text-muted">{notConfiguredReason}</p>}
      <FormError message={errorMessage} />
    </div>
  );
}
