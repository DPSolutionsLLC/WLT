"use client";

import { useState } from "react";
import { Bug } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { FormError } from "@/components/ui/FormError";
import { Modal } from "@/components/ui/Modal";

// Report an issue. The value is in what the reporter does NOT have to type: the route takes the
// role and the calling from the session, and `pagePath` comes from the pathname the chrome bar
// already knows. A leader says what went wrong and nothing else.
//
// ON FAILURE THE MODAL STAYS OPEN WITH THE TEXT STILL IN IT. Losing somebody's typed report
// because a request failed is the one outcome that guarantees they never use the button again,
// and it is also the outcome a naive "close on submit" produces. The error is shown beside the
// box they are still looking at (CLAUDE.md rule 7 — never swallow, always actionable).
//
// THE REVIEW SCREEN IS P12's. Nothing in the app reads these rows yet. That is deliberate: a
// place to record a defect while P4–P13 are walked is worth having on its own.

export type ReportIssueButtonProps = {
  pagePath: string;
};

export function ReportIssueButton({ pagePath }: ReportIssueButtonProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [body, setBody] = useState("");
  const [isSending, setIsSending] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [wasSent, setWasSent] = useState(false);

  function close(): void {
    setIsOpen(false);
    setErrorMessage(null);
  }

  async function handleSubmit(): Promise<void> {
    setIsSending(true);
    setErrorMessage(null);

    try {
      const response = await fetch("/api/issue-reports", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ body, pagePath }),
      });
      const result: { error?: string } = await response.json();

      if (!response.ok) {
        // The text stays in `body`. See the header.
        setErrorMessage(result.error ?? "Could not send your report. Please try again.");
        setIsSending(false);
        return;
      }

      setBody("");
      setWasSent(true);
      setIsSending(false);
      setIsOpen(false);
    } catch (error) {
      console.error("The issue report request failed", error);
      setErrorMessage("Could not send your report. Please try again.");
      setIsSending(false);
    }
  }

  return (
    <>
      <button
        type="button"
        onClick={() => {
          setWasSent(false);
          setIsOpen(true);
        }}
        className="inline-flex min-h-11 min-w-11 shrink-0 items-center justify-center rounded-md text-muted hover:bg-surface-raised hover:text-foreground focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
      >
        <span className="sr-only">Report an issue</span>
        {/* Decorative: the accessible name above says what this is. */}
        <Bug aria-hidden="true" className="size-5" />
      </button>

      {wasSent ? (
        <p role="status" className="sr-only">
          Your report was sent.
        </p>
      ) : null}

      <Modal isOpen={isOpen} onClose={close} title="Report an issue">
        <div className="flex flex-col gap-4">
          <p className="text-sm text-muted">
            Say what went wrong. This report records that you were on{" "}
            <span className="font-medium text-foreground">{pagePath}</span> and which calling you
            are acting under, so you do not have to explain any of that.
          </p>

          <label htmlFor="issue-report-body" className="text-sm font-medium text-foreground">
            What happened?
          </label>
          <textarea
            id="issue-report-body"
            value={body}
            onChange={(event) => setBody(event.target.value)}
            rows={6}
            // text-base is load-bearing: iOS zooms the whole page when a focused field's font is
            // under 16px.
            className="w-full rounded-md border border-border bg-surface-raised p-3 text-base text-foreground focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
          />

          <FormError message={errorMessage ?? undefined} />

          <div className="flex flex-wrap gap-2">
            <Button onClick={() => void handleSubmit()} disabled={isSending}>
              {isSending ? "Sending…" : "Send report"}
            </Button>
            <Button variant="secondary" onClick={close} disabled={isSending}>
              Cancel
            </Button>
          </div>
        </div>
      </Modal>
    </>
  );
}
