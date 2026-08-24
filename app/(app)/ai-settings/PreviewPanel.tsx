"use client";

import { useState, type FormEvent } from "react";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { FormError } from "@/components/ui/FormError";
import type { AiSettingsInput } from "@/lib/validation/aiSettings";

// The preview runs against the DRAFT on screen, not against the saved row. That is the whole
// feature, and the note under the button says so rather than leaving it to be discovered.
//
// It writes nothing. POST /api/ai-settings/preview does not touch `ai_settings` at all.

const TEXTAREA_CLASSES =
  "w-full rounded-md border border-border bg-surface-raised px-3 py-2 text-base text-foreground " +
  "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary";

export type PreviewPanelProps = {
  draft: AiSettingsInput;
};

type PreviewUsage = {
  cacheReadTokens: number;
  inputTokens: number;
  outputTokens: number;
};

export function PreviewPanel({ draft }: PreviewPanelProps) {
  const [prompt, setPrompt] = useState("");
  const [output, setOutput] = useState<string>();
  const [usage, setUsage] = useState<PreviewUsage>();
  const [previewError, setPreviewError] = useState<string>();
  const [isRunning, setIsRunning] = useState(false);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setPreviewError(undefined);
    // Cleared before the call, so a failure never leaves the PREVIOUS draft on screen looking
    // like the answer to the request that just failed.
    setOutput(undefined);
    setUsage(undefined);
    setIsRunning(true);

    try {
      const response = await fetch("/api/ai-settings/preview", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ settings: draft, prompt }),
      });

      const body: { draft?: string; usage?: PreviewUsage; error?: string } =
        await response.json();

      if (!response.ok || body.draft === undefined) {
        // VERBATIM. The six messages in lib/ai/errors.ts are already written for a human, and
        // re-wording them here would collapse six distinguishable failures back into one.
        setPreviewError(body.error ?? "Could not run the preview. Please try again.");
        return;
      }

      setOutput(body.draft);
      setUsage(body.usage);
    } catch (error) {
      console.error("Could not run the AI preview", error);
      setPreviewError("Could not reach the server. Check your connection and try again.");
    } finally {
      setIsRunning(false);
    }
  }

  return (
    <Card>
      <form onSubmit={handleSubmit} className="flex flex-col gap-3" noValidate>
        <label
          htmlFor="ai-preview-prompt"
          className="flex flex-col gap-1 text-sm font-medium text-foreground"
        >
          Try these settings
          <span className="text-xs font-normal text-muted">
            Type something for the AI to respond to, so you can hear how it sounds.
          </span>
          <textarea
            id="ai-preview-prompt"
            rows={3}
            value={prompt}
            onChange={(event) => setPrompt(event.target.value)}
            className={TEXTAREA_CLASSES}
          />
        </label>

        <p className="text-xs text-muted">
          This runs against what is on screen, including changes you have not saved.
        </p>

        <div>
          <Button type="submit" disabled={isRunning}>
            {isRunning ? "Running…" : "Preview"}
          </Button>
        </div>

        <FormError message={previewError} />

        {output !== undefined && (
          <div className="flex flex-col gap-2">
            <p className="text-xs font-medium uppercase tracking-wide text-muted">
              Sample output — not sent to anyone
            </p>
            {/* Plain text in a bordered block. Deliberately not styled to look like a finished,
                sendable message: it is a sample the bishopric is judging. */}
            <p className="whitespace-pre-wrap rounded-md border border-dashed border-border bg-surface p-3 text-sm text-foreground">
              {output}
            </p>
            {usage && (
              <p className="text-xs text-muted">
                {usage.cacheReadTokens} tokens read from cache · {usage.outputTokens} tokens
                written
              </p>
            )}
          </div>
        )}
      </form>
    </Card>
  );
}
