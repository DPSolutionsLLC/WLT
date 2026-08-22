"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/Button";
import { FormError } from "@/components/ui/FormError";
import type { PipelineStage } from "@/types/domain";

// The n-of-3 gate, read as a sentence. "2/3" tells a bishopric nothing they can act on; the name
// of the person still to decide does.
//
// The copy must never hard-code three. A ward mid-reorganization has two bishopric members and
// needs both of them, and an empty roll refuses rather than passing a vacuous "0 outstanding"
// (talks-a).

export type ApprovalMember = {
  id: string;
  name: string;
};

export type ApprovalRow = {
  userId: string;
  approved: boolean | null;
  comment: string | null;
};

export type ApprovalPanelProps = {
  assignmentId: string;
  stage: PipelineStage;
  approvals: readonly ApprovalRow[];
  bishopric: readonly ApprovalMember[];
  currentUserId: string;
  canApprove: boolean;
  // Whether every bishopric member has approved. Computed on the server for the first paint and
  // replaced by the approve route's own answer after a decision — the route re-evaluates the
  // gate when the transition is actually requested, so a stale hint here cannot approve anything.
  readyToApprove: boolean;
};

function listNames(names: readonly string[]): string {
  if (names.length === 1) return names[0];
  if (names.length === 2) return `${names[0]} and ${names[1]}`;
  return `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}`;
}

export function describeApprovalState(
  approvedNames: readonly string[],
  outstandingNames: readonly string[],
): string {
  if (approvedNames.length === 0 && outstandingNames.length === 0) {
    return "This ward has no active bishopric members to approve a plan. Add them in Admin first.";
  }

  if (outstandingNames.length === 0) {
    return `Approved by ${listNames(approvedNames)}.`;
  }

  if (approvedNames.length === 0) {
    return `Nobody has approved this plan yet — waiting on ${listNames(outstandingNames)}.`;
  }

  return `Approved by ${listNames(approvedNames)} — waiting on ${listNames(outstandingNames)}.`;
}

async function readJson(response: Response): Promise<Record<string, unknown>> {
  try {
    return (await response.json()) as Record<string, unknown>;
  } catch {
    throw new Error("The server sent a response this page could not read.");
  }
}

export function ApprovalPanel({
  assignmentId,
  stage,
  approvals,
  bishopric,
  currentUserId,
  canApprove,
  readyToApprove,
}: ApprovalPanelProps) {
  const router = useRouter();

  const [comment, setComment] = useState("");
  const [isWorking, setIsWorking] = useState(false);
  const [formError, setFormError] = useState<string>();
  const [isReady, setIsReady] = useState(readyToApprove);

  // Counted over DISTINCT approving users against the bishopric roll, exactly as canTransition()
  // does. Counting rows instead would let one member's three rows satisfy a three-person gate.
  const approvedBy = new Set(
    approvals.filter((approval) => approval.approved === true).map((row) => row.userId),
  );

  const approvedNames = bishopric
    .filter((member) => approvedBy.has(member.id))
    .map((member) => member.name);

  const outstandingNames = bishopric
    .filter((member) => !approvedBy.has(member.id))
    .map((member) => member.name);

  const changeRequests = approvals.filter(
    (approval) => approval.approved === false && approval.comment !== null,
  );

  const hasDecided = approvedBy.has(currentUserId);

  async function post(body: unknown, url: string): Promise<boolean> {
    setFormError(undefined);
    setIsWorking(true);

    try {
      const response = await fetch(url, {
        method: url.endsWith("/approve") ? "POST" : "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });

      const payload = await readJson(response);

      if (!response.ok) {
        setFormError(
          typeof payload.error === "string"
            ? payload.error
            : "Could not record that decision. Please try again.",
        );
        return false;
      }

      if (typeof payload.readyToApprove === "boolean") {
        setIsReady(payload.readyToApprove);
      }

      router.refresh();
      return true;
    } catch (error) {
      console.error("Could not record an approval decision", error);
      setFormError("Could not reach the server. Check your connection and try again.");
      return false;
    } finally {
      setIsWorking(false);
    }
  }

  async function handleApprove(): Promise<void> {
    await post(
      { approved: true, comment: comment.trim() === "" ? null : comment.trim() },
      `/api/assignments/${assignmentId}/approve`,
    );
  }

  async function handleRequestChanges(): Promise<void> {
    // Refused BEFORE submit, not after. The schema enforces it too, but a change request with no
    // comment is a dead end for the planner — they get the plan back with nothing saying what to
    // change — and being told that after a round trip is being told it too late.
    if (comment.trim() === "") {
      setFormError("Say what needs changing — the planner only sees this comment.");
      return;
    }

    const posted = await post(
      { approved: false, comment: comment.trim() },
      `/api/assignments/${assignmentId}/approve`,
    );

    if (posted) setComment("");
  }

  // The explicit review -> approve move. It NEVER fires as a side effect of the last approval
  // being recorded: recording a decision and approving the plan are two different things, and
  // the phase's first pitfall is a stage that advances because something else happened.
  async function handleApprovePlan(): Promise<void> {
    await post({ action: "transition", to: "approve" }, `/api/assignments/${assignmentId}`);
  }

  return (
    <div className="flex flex-col gap-3">
      <p className="text-sm text-foreground">
        {describeApprovalState(approvedNames, outstandingNames)}
      </p>

      {changeRequests.length > 0 && (
        <ul className="flex flex-col gap-1">
          {changeRequests.map((request) => (
            <li key={request.userId} className="text-sm text-warning">
              Changes asked for: {request.comment}
            </li>
          ))}
        </ul>
      )}

      {canApprove && stage === "review" && (
        <div className="flex flex-col gap-2">
          <label htmlFor={`approval-comment-${assignmentId}`} className="text-sm font-medium text-foreground">
            Comment
          </label>
          <textarea
            id={`approval-comment-${assignmentId}`}
            value={comment}
            rows={3}
            disabled={isWorking}
            onChange={(event) => setComment(event.target.value)}
            className="rounded-md border border-border bg-surface-raised px-3 py-2 text-base text-foreground focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
          />
          <p className="text-sm text-muted">
            Optional when you approve. Required to ask for changes — it is the only explanation
            the planner gets.
          </p>

          {/* Two separate controls, never one toggle. Approving and sending a plan back are
              opposite decisions and must not share a button. */}
          <div className="flex flex-col gap-2 md:flex-row">
            <Button type="button" onClick={() => void handleApprove()} disabled={isWorking}>
              {hasDecided ? "Update my approval" : "Approve"}
            </Button>
            <Button
              type="button"
              variant="secondary"
              onClick={() => void handleRequestChanges()}
              disabled={isWorking}
            >
              Request changes
            </Button>
          </div>
        </div>
      )}

      {canApprove && stage === "review" && isReady && (
        <div className="rounded-md border border-border p-3">
          <p className="text-sm text-foreground">
            Every member of the bishopric has approved this plan. It still has to be moved on
            deliberately.
          </p>
          <Button
            type="button"
            className="mt-2"
            onClick={() => void handleApprovePlan()}
            disabled={isWorking}
          >
            Approve plan
          </Button>
        </div>
      )}

      <FormError message={formError} />
    </div>
  );
}
