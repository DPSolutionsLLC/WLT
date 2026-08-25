"use client";

import { useState } from "react";
import { Button } from "@/components/ui/Button";
import { FormError } from "@/components/ui/FormError";
import { Modal } from "@/components/ui/Modal";
import { messageFromPayload, readJsonPayload } from "@/lib/program/requests";
import type { ProgramStatus } from "@/types/domain";

// The two controls that turn an approved program into a physical object and then into an email.
//
// A separate file rather than another 200 lines inside ProgramBuilder, following the pattern that
// file already established with RefreshButton and AiEditPanel.
//
// ---------------------------------------------------------------------------------------------
// THE CONFIRM IS WORDED BY CONSEQUENCE, AND IT NAMES THE NUMBER
// ---------------------------------------------------------------------------------------------
// "Email this program to 12 people?" — not "Confirm distribution?" (calendar-b). The count comes
// from the server render, and it is sent back to the route as `expectedRecipientCount` so that a
// list edited in another tab between this dialog opening and the button being pressed is REFUSED
// rather than quietly sent to a different set of people. Distribution cannot be undone.
//
// THE CONFIRM MODAL LIVES INSIDE THE approved-AND-canDistribute BRANCH, NOT BESIDE IT.
//
// components/ui/Modal.tsx is built on the native <dialog> and ALWAYS renders its children into the
// DOM — `isOpen` drives showModal()/close(), not whether the markup exists. Mounted unconditionally,
// a DISTRIBUTED programme carried a hidden "Send it to 3 people?" dialog saying "a distributed
// program cannot be reopened", which then collided with the same sentence in
// PostDistributionNotice. A closed <dialog> is not visible, so this was never a user-facing bug —
// it was a component holding markup for an action it can no longer offer, and the existing
// ProgramBuilder suite caught it as a duplicate-text query.
//
// ---------------------------------------------------------------------------------------------
// GENERATING IS SLOW AND THE BUTTON SAYS SO
// ---------------------------------------------------------------------------------------------
// @react-pdf/renderer is a large server-only dependency and a Vercel cold start pays for all of
// it. Several seconds is normal, so the button reports real progress rather than appearing hung.

export type DistributionRecipients = {
  count: number;
  invalid: string[];
};

export type ProgramDistributionProps = {
  programId: string;
  status: ProgramStatus;
  pdfUrl: string | null;
  canBuild: boolean;
  canDistribute: boolean;
  recipients: DistributionRecipients;
  // Null when email is configured. Non-null carries the reason it is not, written for a person.
  emailDisabledReason: string | null;
};

export function confirmDistributionQuestion(count: number): string {
  return `Email this program to ${count} ${count === 1 ? "person" : "people"}?`;
}

export function ProgramDistribution({
  programId,
  status,
  pdfUrl,
  canBuild,
  canDistribute,
  recipients,
  emailDisabledReason,
}: ProgramDistributionProps) {
  const [isGenerating, setIsGenerating] = useState(false);
  const [isDistributing, setIsDistributing] = useState(false);
  const [isConfirmOpen, setIsConfirmOpen] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string>();
  const [note, setNote] = useState<string>();
  const [warnings, setWarnings] = useState<string[]>([]);
  const [currentPdfUrl, setCurrentPdfUrl] = useState<string | null>(pdfUrl);

  const emailConfigured = emailDisabledReason === null;

  async function generate(): Promise<void> {
    setErrorMessage(undefined);
    setNote(undefined);
    setWarnings([]);
    setIsGenerating(true);

    try {
      const response = await fetch(`/api/programs/${programId}/generate-pdf`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
      });

      const payload = await readJsonPayload(response);

      if (!response.ok) {
        setErrorMessage(
          messageFromPayload(payload, "Could not generate the PDF. Please try again."),
        );
        return;
      }

      const generatedUrl = typeof payload.pdfUrl === "string" ? payload.pdfUrl : null;

      // A 200 with no link in it looks like an answer and is not one — the same backstop
      // RefreshButton keeps for a refresh that returns no draft (CLAUDE.md rule 7).
      if (generatedUrl === null) {
        setErrorMessage(
          "The PDF was generated but no link came back. Reload the page to find it.",
        );
        return;
      }

      setCurrentPdfUrl(generatedUrl);
      // WARNINGS ARE SHOWN, NOT SWALLOWED. A cover image that silently never appears, or a ward
      // colour quietly replaced because it was too pale to read, is a setting that looks broken
      // rather than one that was overruled.
      setWarnings(Array.isArray(payload.warnings) ? (payload.warnings as string[]) : []);
      setNote("The PDF is ready. Open it, check the fold, then print it double-sided.");
    } catch (error) {
      console.error("Could not generate a program PDF", error);
      setErrorMessage("Could not reach the server. Check your connection and try again.");
    } finally {
      setIsGenerating(false);
    }
  }

  async function distribute(): Promise<void> {
    setErrorMessage(undefined);
    setNote(undefined);
    setIsDistributing(true);

    try {
      const response = await fetch(`/api/programs/${programId}/distribute`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(
          // Only sent when email is on. With email off there is no dialog and no number that was
          // agreed to, so a stale-count refusal would be a guard against nothing.
          emailConfigured ? { expectedRecipientCount: recipients.count } : {},
        ),
      });

      const payload = await readJsonPayload(response);

      if (!response.ok) {
        setErrorMessage(
          messageFromPayload(payload, "Could not distribute the program. Please try again."),
        );
        return;
      }

      setIsConfirmOpen(false);

      const sentCount = typeof payload.sentCount === "number" ? payload.sentCount : 0;
      const failedCount = typeof payload.failedCount === "number" ? payload.failedCount : 0;

      // PARTIAL FAILURE IS REPORTED AS ITSELF. "Sent to 9 people" when three bounced is the lie
      // this feature was most likely to ship; both numbers, always.
      setNote(
        payload.emailConfigured === false
          ? "The program is now on the public page and its QR code works. It was not emailed — download the PDF and send it yourself."
          : failedCount > 0
            ? `Sent to ${sentCount} of ${sentCount + failedCount}. ${failedCount} could not be delivered — check the addresses in ward settings.`
            : `Sent to ${sentCount} ${sentCount === 1 ? "person" : "people"}. The program is now on the public page.`,
      );

      const failures = Array.isArray(payload.failures)
        ? (payload.failures as { address: string; reason: string }[])
        : [];

      setWarnings(failures.map((failure) => `${failure.address} — ${failure.reason}`));

      // A full reload rather than a cache write. Distribution changes the status, both stamps and
      // whether the whole screen is locked; re-reading is simpler than mirroring five fields, and
      // unlike an edit there is nothing unsaved on screen to lose.
      window.location.reload();
    } catch (error) {
      console.error("Could not distribute a program", error);
      setErrorMessage("Could not reach the server. Check your connection and try again.");
    } finally {
      setIsDistributing(false);
    }
  }

  // Nothing to offer on a program the bishopric has not approved. Hidden rather than disabled:
  // both routes answer 409, and a UI should not offer a thing it knows will be refused
  // (ProgramBuilder's rule for the refresh and AI panels).
  if (status !== "approved" && status !== "distributed") return null;

  return (
    <div className="flex flex-col gap-3">
      {canBuild && (
        <div className="flex flex-col gap-2">
          <Button
            type="button"
            variant="secondary"
            className="self-start"
            disabled={isGenerating}
            onClick={() => void generate()}
          >
            {isGenerating
              ? "Building the PDF…"
              : currentPdfUrl === null
                ? "Generate the PDF"
                : "Generate it again"}
          </Button>
          <p className="text-sm text-muted">
            One landscape sheet, printed double-sided and folded once. This takes a few seconds.
          </p>
        </div>
      )}

      {currentPdfUrl !== null && (
        <a
          className="text-sm font-medium text-primary underline underline-offset-4"
          href={currentPdfUrl}
          target="_blank"
          rel="noreferrer"
        >
          Open the printed program (PDF)
        </a>
      )}

      {canDistribute && status === "approved" && (
        <div className="flex flex-col gap-2 border-t border-border pt-3">
          {/* WORDED BY CONSEQUENCE and, when email is off, HONEST ABOUT WHAT IT WILL DO. A button
              labelled "Email the program" that emails nobody is the exact failure the deployment
              retro recorded once already. */}
          <Button
            type="button"
            className="self-start"
            disabled={
              isDistributing || currentPdfUrl === null || (emailConfigured && recipients.count === 0)
            }
            onClick={() => (emailConfigured ? setIsConfirmOpen(true) : void distribute())}
          >
            {emailConfigured ? "Email the program" : "Publish to the public page"}
          </Button>

          {currentPdfUrl === null && (
            <p className="text-sm text-muted">
              Generate the PDF first — that is the file people receive.
            </p>
          )}

          {/* The honest message, shown where the decision is made rather than after it. */}
          {!emailConfigured && (
            <p className="text-sm text-muted">
              {emailDisabledReason} Publishing still puts this program on the public page and makes
              its QR code work.
            </p>
          )}

          {emailConfigured && recipients.count === 0 && (
            <p className="text-sm text-muted">
              Nobody is on the distribution list yet. Add at least one email address in ward
              settings.
            </p>
          )}

          {emailConfigured && recipients.count > 0 && (
            <p className="text-sm text-muted">
              This cannot be undone — an email cannot be recalled.
            </p>
          )}

          {recipients.invalid.length > 0 && (
            <p className="text-sm text-muted">
              {recipients.invalid.length}{" "}
              {recipients.invalid.length === 1 ? "entry is" : "entries are"} not a valid email
              address and will be skipped: {recipients.invalid.join(", ")}
            </p>
          )}

          <Modal
            isOpen={isConfirmOpen}
            onClose={() => setIsConfirmOpen(false)}
            title={confirmDistributionQuestion(recipients.count)}
          >
            <div className="flex flex-col gap-4">
              <p className="text-sm text-muted">
                They each receive the PDF as an attachment. The program also goes onto the public page,
                so the QR code printed on it starts working.
              </p>
              <p className="text-sm text-muted">
                This cannot be undone. An email cannot be recalled, and a distributed program cannot be
                reopened.
              </p>

              <div className="flex flex-col gap-2 sm:flex-row">
                <Button type="button" disabled={isDistributing} onClick={() => void distribute()}>
                  {isDistributing
                    ? "Sending…"
                    : `Send it to ${recipients.count} ${recipients.count === 1 ? "person" : "people"}`}
                </Button>
                <Button
                  type="button"
                  variant="secondary"
                  disabled={isDistributing}
                  onClick={() => setIsConfirmOpen(false)}
                >
                  Not yet
                </Button>
              </div>
            </div>
          </Modal>
        </div>
      )}

      <FormError message={errorMessage} />
      {note && <p className="text-sm text-success">{note}</p>}

      {warnings.length > 0 && (
        <ul className="flex flex-col gap-1">
          {warnings.map((warning) => (
            <li key={warning} className="text-sm text-muted">
              {warning}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
