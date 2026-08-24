"use client";

import { useState, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { AiDraftButton } from "@/components/assignments/AiDraftButton";
import { SmsHandoff } from "@/components/assignments/SmsHandoff";
import { Button } from "@/components/ui/Button";
import { FormError } from "@/components/ui/FormError";
import { nextStage } from "@/lib/assignments/pipeline";
import {
  buildConfirmationMessage,
  buildThankYouMessage,
} from "@/lib/assignments/messageTemplate";
import type { Assignment } from "@/lib/assignments/queries";
import { speakerFrom } from "@/lib/assignments/speaker";
import type { DateOnly } from "@/lib/calendar/dates";
import {
  PIPELINE_STAGE_LABELS,
  REQUEST_OUTCOMES,
  type PipelineStage,
  type RequestOutcome,
} from "@/types/domain";

// REQUEST → CONFIRM → NOTIFY → APPRECIATE, or the waiver.
//
// ITER-004 exists to prevent one precise failure: a pipeline sitting in a stuck state waiting on
// a confirmation that was never going to arrive, because the speaker was invited from outside
// the ward and nobody was ever going to text them. The fix is not to skip those stages silently
// — that hides a decision nobody made — but to record the decision, with a name and a date, and
// then render the stages as NOT APPLICABLE rather than as outstanding work.
//
// What that means concretely, and what tests/components/assignments/ContactStagePanel.test.tsx
// asserts: a waived stage shows no progress styling, no disabled button, and none of the
// outstanding-task wording. A disabled button reads as "this is coming"; the whole point is that
// it is not.

export const NOT_APPLICABLE_LABEL = "Not applicable — invited outside the ward";

export const WAIVER_EXPLANATION =
  "Records that this ward is not contacting this speaker, with your name and today's date. It " +
  "does not move the assignment on — every step after it is still yours to take.";

// The four stages a waiver covers, in order. `speak` is absent deliberately: whether the meeting
// happened is a fact about the meeting, not about who spoke in it, and the pipeline refuses to
// waive it (talks-a).
const CONTACT_STAGES: readonly PipelineStage[] = [
  "request",
  "confirm",
  "notify",
  "appreciate",
];

const REQUEST_OUTCOME_LABELS: Record<RequestOutcome, string> = {
  accepted: "Accepted",
  declined: "Declined",
  pending: "Still waiting for an answer",
};

const TEXTAREA_CLASSES =
  "rounded-md border border-border bg-surface-raised px-3 py-2 text-base text-foreground " +
  "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary";

// Said out loud under the thank-you textarea, because otherwise the connection is invisible and
// the comment thread stays empty forever. A field nobody knows feeds anything does not get used.
export const THANK_YOU_COMMENT_SOURCE =
  "Anything the bishopric wrote in the comments on this assignment is used here.";

// WITH NOTHING RECORDED, THERE IS NO MESSAGE TO OFFER — not a generic one, and not an AI-drafted
// version of a generic one. A thank-you that says nothing specific is worse than no text at all:
// by the appreciate stage somebody has almost certainly thanked them in person, and a form letter
// afterwards subtracts from that rather than adding to it.
//
// The stage still completes. "Mark the thank-you as sent" stays, because the thanking may well
// have happened — it just did not happen here.
export const NOTHING_SPECIFIC_TO_SAY =
  "Nobody recorded anything about this talk, so there is nothing specific to write. An " +
  "in-person thank-you is probably enough.";

export const COMMENT_TO_ENABLE_DRAFTING =
  "Add a comment on this assignment if you would like a message drafted from it.";

export type ContactStagePanelProps = {
  assignment: Assignment;
  sundayDate: DateOnly;
  speakerFirstName: string | null;
  speakerPhone: string | null;
  topicTitle: string | null;
  // From the topic library (talks-c). An empty list omits the scripture sentence rather than
  // emitting a placeholder — buildConfirmationMessage's signature is unchanged.
  suggestedScriptures: readonly string[];
  // The assignment's own comment thread, oldest first. `buildThankYouMessage` has always taken
  // this parameter and this panel has always passed `[]` — the template had the input and
  // nothing ever wrote it (ai-c). Real comments now reach both the template AND the AI prompt,
  // which is the whole reason a thank-you can say something specific.
  assignmentComments: readonly string[];
  waivedByName: string | null;
  requestedByName: string | null;
  canPlan: boolean;
  canRequest: boolean;
  canConfirm: boolean;
};

// A timestamptz is a real instant, so a Date is the right thing to build from it — unlike a
// `date` column, which must never be round-tripped through local time (lib/calendar/dates.ts).
function formatStamp(iso: string): string {
  return new Intl.DateTimeFormat("en-US", {
    timeZone: "UTC",
    year: "numeric",
    month: "long",
    day: "numeric",
  }).format(new Date(iso));
}

async function readJson(response: Response): Promise<Record<string, unknown>> {
  try {
    return (await response.json()) as Record<string, unknown>;
  } catch {
    throw new Error("The server sent a response this page could not read.");
  }
}

function StageBlock({
  stage,
  children,
}: {
  stage: PipelineStage;
  children: ReactNode;
}) {
  return (
    <section className="border-t border-border pt-3">
      <h4 className="text-sm font-semibold text-foreground">
        {PIPELINE_STAGE_LABELS[stage]}
      </h4>
      <div className="mt-1 text-sm">{children}</div>
    </section>
  );
}

export function ContactStagePanel({
  assignment,
  sundayDate,
  speakerFirstName,
  speakerPhone,
  topicTitle,
  suggestedScriptures,
  assignmentComments,
  waivedByName,
  requestedByName,
  canPlan,
  canRequest,
  canConfirm,
}: ContactStagePanelProps) {
  const router = useRouter();

  const [outcome, setOutcome] = useState<RequestOutcome>(
    assignment.requestOutcome ?? "pending",
  );
  const [requestNotes, setRequestNotes] = useState(assignment.requestNotes ?? "");
  // Held as named values rather than computed inline, because both are now needed twice: once as
  // the textarea's starting content, and once as the thing "Back to the plain version" restores.
  // Pure functions of their inputs, so recomputing per render costs nothing.
  const confirmationTemplate = buildConfirmationMessage({
    speakerFirstName,
    date: sundayDate,
    topicTitle,
    slotLengthMinutes: assignment.slotLengthMinutes,
    suggestedScriptures: [...suggestedScriptures],
  });

  const thankYouTemplate = buildThankYouMessage({
    speakerFirstName,
    date: sundayDate,
    comments: assignmentComments,
  });

  const [confirmationDraft, setConfirmationDraft] = useState(
    assignment.notifyMessage ?? confirmationTemplate,
  );
  const [thankYouDraft, setThankYouDraft] = useState(
    assignment.thankYouMessage ?? thankYouTemplate,
  );

  const [isWorking, setIsWorking] = useState(false);
  const [formError, setFormError] = useState<string>();

  const speaker = speakerFrom(assignment);
  const isExternal = speaker.kind === "external";
  const isWaived = assignment.contactWaivedAt !== null;
  const stage = assignment.stage;

  // An already-approved message counts: somebody wrote it when there was something to say, and
  // it must not vanish because the comments were later removed.
  const hasSomethingToSay =
    assignmentComments.length > 0 || assignment.thankYouMessage !== null;

  // The one transition this panel does NOT offer is review -> approve. That belongs to
  // ApprovalPanel, where the gate it depends on is visible — two buttons for one move, in two
  // places, is how somebody approves a plan without meaning to.
  const upcoming = stage === "review" ? null : nextStage(stage);

  async function send(body: unknown): Promise<boolean> {
    setFormError(undefined);
    setIsWorking(true);

    try {
      const response = await fetch(`/api/assignments/${assignment.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });

      const payload = await readJson(response);

      if (!response.ok) {
        setFormError(
          typeof payload.error === "string"
            ? payload.error
            : "Could not save that. Please try again.",
        );
        return false;
      }

      router.refresh();
      return true;
    } catch (error) {
      console.error("Could not update an assignment", error);
      setFormError("Could not reach the server. Check your connection and try again.");
      return false;
    } finally {
      setIsWorking(false);
    }
  }

  async function saveRequestOutcome(): Promise<void> {
    const notes = requestNotes.trim();

    const saved = await send({
      action: "update",
      fields: {
        requestOutcome: outcome,
        requestNotes: notes === "" ? null : notes,
      },
    });

    if (!saved || outcome !== "declined") return;

    // A decline is not merely an outcome to record. The slot goes back to planning and the
    // speaker's name is cleared by the route, so the planner sees an open slot rather than a
    // speaker who is still coming. The reason is required on every backward move.
    await send({
      action: "transition",
      to: "plan",
      reason:
        notes === "" ? "The speaker declined." : `The speaker declined. ${notes}`.slice(0, 300),
    });
  }

  async function approveConfirmationMessage(): Promise<void> {
    // Only this approval writes notify_message. Nothing auto-populates it — the draft above is
    // a suggestion the counselor edits, and Phase 5's AI route will deliver into the same
    // textarea on exactly the same terms (CLAUDE.md rule 3).
    await send({
      action: "update",
      fields: { notifyMessage: confirmationDraft.trim() },
    });
  }

  async function markNotifySent(): Promise<void> {
    await send({
      action: "update",
      fields: { notifySentAt: new Date().toISOString() },
    });
  }

  async function markMeetingHappened(): Promise<void> {
    await send({
      action: "update",
      fields: { sundayConfirmedAt: new Date().toISOString() },
    });
  }

  async function approveThankYou(): Promise<void> {
    await send({ action: "update", fields: { thankYouMessage: thankYouDraft.trim() } });
  }

  async function markThankYouSent(): Promise<void> {
    await send({
      action: "update",
      fields: { thankYouSentAt: new Date().toISOString() },
    });
  }

  async function waiveContact(): Promise<void> {
    await send({ action: "waive_contact" });
  }

  async function advance(): Promise<void> {
    if (upcoming === null) return;
    await send({ action: "transition", to: upcoming });
  }

  // Every waived stage, rendered identically and plainly. No progress bar, no muted-but-present
  // action, no "pending" anywhere — the whole shape of an outstanding task is absent.
  if (isWaived) {
    return (
      <div className="flex flex-col gap-3">
        <p className="text-sm text-foreground">
          {NOT_APPLICABLE_LABEL}
          {waivedByName !== null && assignment.contactWaivedAt !== null && (
            <span className="text-muted">
              {" "}
              — recorded by {waivedByName} on {formatStamp(assignment.contactWaivedAt)}
            </span>
          )}
        </p>

        <ul className="flex flex-col gap-1">
          {CONTACT_STAGES.map((contactStage) => (
            <li key={contactStage} className="text-sm text-muted">
              {PIPELINE_STAGE_LABELS[contactStage]}: {NOT_APPLICABLE_LABEL}
            </li>
          ))}
        </ul>

        {/* The waiver moved nothing. Every step is still an explicit transition somebody takes. */}
        {canPlan && upcoming !== null && (
          <div>
            <Button type="button" onClick={() => void advance()} disabled={isWorking}>
              Move to {PIPELINE_STAGE_LABELS[upcoming]}
            </Button>
          </div>
        )}

        <FormError message={formError} />
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-3">
      {isExternal && canRequest && (
        <div className="rounded-md border border-border p-3">
          <p className="text-sm text-foreground">
            This speaker is not on the ward roster.
          </p>
          <p className="mt-1 text-sm text-muted">{WAIVER_EXPLANATION}</p>
          <Button
            type="button"
            variant="secondary"
            className="mt-2"
            onClick={() => void waiveContact()}
            disabled={isWorking}
          >
            Mark not applicable
          </Button>
        </div>
      )}

      <StageBlock stage="request">
        {assignment.requestedAt !== null && (
          <p className="text-muted">
            Asked on {formatStamp(assignment.requestedAt)}
            {requestedByName !== null && ` by ${requestedByName}`}.
          </p>
        )}

        {stage === "request" && canRequest ? (
          <div className="mt-2 flex flex-col gap-2">
            <fieldset className="flex flex-col gap-1">
              <legend className="text-sm font-medium text-foreground">
                What did they say?
              </legend>
              {REQUEST_OUTCOMES.map((value) => (
                <label
                  key={value}
                  className="flex min-h-11 items-center gap-2 text-sm text-foreground"
                >
                  <input
                    type="radio"
                    name={`request-outcome-${assignment.id}`}
                    value={value}
                    checked={outcome === value}
                    disabled={isWorking}
                    onChange={() => setOutcome(value)}
                    className="h-4 w-4"
                  />
                  {REQUEST_OUTCOME_LABELS[value]}
                </label>
              ))}
            </fieldset>

            <label
              htmlFor={`request-notes-${assignment.id}`}
              className="text-sm font-medium text-foreground"
            >
              Notes
            </label>
            <textarea
              id={`request-notes-${assignment.id}`}
              rows={3}
              value={requestNotes}
              disabled={isWorking}
              onChange={(event) => setRequestNotes(event.target.value)}
              className={TEXTAREA_CLASSES}
            />

            {/* The consequence is ON the button when there is one. "Save" would not tell anybody
                that the slot is about to reopen and the speaker's name is about to be cleared. */}
            <Button
              type="button"
              onClick={() => void saveRequestOutcome()}
              disabled={isWorking}
            >
              {outcome === "declined"
                ? "Record the decline and reopen this slot"
                : "Save their answer"}
            </Button>
          </div>
        ) : (
          <p className="text-muted">
            {assignment.requestOutcome === null
              ? "Not started."
              : REQUEST_OUTCOME_LABELS[assignment.requestOutcome]}
          </p>
        )}
      </StageBlock>

      <StageBlock stage="confirm">
        {stage === "confirm" && canConfirm ? (
          <div className="mt-2 flex flex-col gap-2">
            <label
              htmlFor={`confirmation-message-${assignment.id}`}
              className="text-sm font-medium text-foreground"
            >
              Confirmation message
            </label>
            {/* Inside the `stage === "confirm" && canConfirm` branch, so a WAIVED assignment —
                which returns above with no controls at all — gains nothing. There is no disabled
                variant on purpose: a disabled button reads as "this is coming", and the point of
                the waiver is that it is not (talks-b). */}
            <AiDraftButton
              assignmentId={assignment.id}
              type="confirmation"
              currentValue={confirmationDraft}
              templateValue={confirmationTemplate}
              onDraft={setConfirmationDraft}
              disabled={isWorking}
            />
            <textarea
              id={`confirmation-message-${assignment.id}`}
              rows={8}
              value={confirmationDraft}
              disabled={isWorking}
              onChange={(event) => setConfirmationDraft(event.target.value)}
              className={TEXTAREA_CLASSES}
            />
            <p className="text-sm text-muted">
              A draft. Edit it until it says what you want, then approve it — approving is what
              saves it.
            </p>
            <Button
              type="button"
              onClick={() => void approveConfirmationMessage()}
              disabled={isWorking}
            >
              Approve this message
            </Button>
          </div>
        ) : (
          <p className="text-muted">
            {assignment.notifyMessage === null
              ? "Not started."
              : "The message has been approved."}
          </p>
        )}
      </StageBlock>

      <StageBlock stage="notify">
        {stage === "notify" ? (
          <div className="mt-2 flex flex-col gap-2">
            <SmsHandoff
              phone={speakerPhone}
              body={assignment.notifyMessage ?? confirmationDraft}
            />
            {canPlan && (
              <div>
                <Button
                  type="button"
                  variant="secondary"
                  onClick={() => void markNotifySent()}
                  disabled={isWorking}
                >
                  Mark as sent
                </Button>
                {/* There is no delivery confirmation anywhere in this flow, and saying so is
                    more honest than a tick that implies one. */}
                <p className="mt-1 text-sm text-muted">
                  Nothing here can tell whether a message arrived. This records that you sent it.
                </p>
              </div>
            )}
          </div>
        ) : (
          <p className="text-muted">
            {assignment.notifySentAt === null
              ? "Not started."
              : `Marked sent on ${formatStamp(assignment.notifySentAt)}.`}
          </p>
        )}
      </StageBlock>

      <StageBlock stage="speak">
        {stage === "speak" && canPlan ? (
          <div className="mt-2">
            <Button
              type="button"
              onClick={() => void markMeetingHappened()}
              disabled={isWorking}
            >
              Confirm the meeting happened
            </Button>
          </div>
        ) : (
          <p className="text-muted">
            {assignment.sundayConfirmedAt === null
              ? "Not started."
              : `Confirmed on ${formatStamp(assignment.sundayConfirmedAt)}.`}
          </p>
        )}
      </StageBlock>

      <StageBlock stage="appreciate">
        {stage === "appreciate" && canPlan && !hasSomethingToSay ? (
          <div className="mt-2 flex flex-col gap-2">
            <p className="text-sm text-foreground">{NOTHING_SPECIFIC_TO_SAY}</p>
            <div>
              <Button
                type="button"
                onClick={() => void markThankYouSent()}
                disabled={isWorking}
              >
                Mark the thank-you as sent
              </Button>
            </div>
            <p className="text-sm text-muted">{COMMENT_TO_ENABLE_DRAFTING}</p>
          </div>
        ) : stage === "appreciate" && canPlan ? (
          <div className="mt-2 flex flex-col gap-2">
            <label
              htmlFor={`thank-you-${assignment.id}`}
              className="text-sm font-medium text-foreground"
            >
              Thank-you message
            </label>
            <AiDraftButton
              assignmentId={assignment.id}
              type="thank_you"
              currentValue={thankYouDraft}
              templateValue={thankYouTemplate}
              onDraft={setThankYouDraft}
              disabled={isWorking}
            />
            <textarea
              id={`thank-you-${assignment.id}`}
              rows={6}
              value={thankYouDraft}
              disabled={isWorking}
              onChange={(event) => setThankYouDraft(event.target.value)}
              className={TEXTAREA_CLASSES}
            />
            <p className="text-sm text-muted">{THANK_YOU_COMMENT_SOURCE}</p>
            <div className="flex flex-col gap-2 md:flex-row">
              <Button
                type="button"
                variant="secondary"
                onClick={() => void approveThankYou()}
                disabled={isWorking}
              >
                Save this draft
              </Button>
              <Button
                type="button"
                onClick={() => void markThankYouSent()}
                disabled={isWorking}
              >
                Mark the thank-you as sent
              </Button>
            </div>

            <SmsHandoff phone={speakerPhone} body={thankYouDraft} />
          </div>
        ) : (
          <p className="text-muted">
            {assignment.thankYouSentAt === null
              ? "Not started."
              : `Sent on ${formatStamp(assignment.thankYouSentAt)}.`}
          </p>
        )}
      </StageBlock>

      {canPlan && upcoming !== null && (
        <div className="border-t border-border pt-3">
          <Button type="button" onClick={() => void advance()} disabled={isWorking}>
            Move to {PIPELINE_STAGE_LABELS[upcoming]}
          </Button>
        </div>
      )}

      <FormError message={formError} />
    </div>
  );
}
