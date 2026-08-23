"use client";

import { useState } from "react";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { FormError } from "@/components/ui/FormError";
// Type-only, so nothing from the server-only module survives the build (roster-b).
import type { TopicCandidate } from "@/lib/topics/queries";
import { TOPIC_CATEGORY_LABELS } from "@/types/domain";

// The accept/reject queue for AI-suggested topics, SHIPPED EMPTY. Phase 5 is what fills it.
//
// Building it now is the point: the cheapest moment to find out that a suggestion can reach the
// topic library without an explicit accept is while there are no suggestions. By the time Phase 5
// has something to propose, the door it has to go through already exists and is already tested.
//
// There is NO "accept all" here, and there is no checkbox column. A bulk accept is an auto-add
// wearing a button, and CLAUDE.md rule 3 says every generated topic is a draft a human accepts
// individually. Adding one later would not be a convenience — it would be the rule being
// repealed.

export const EMPTY_STATE_HEADING = "No suggested topics";

export const EMPTY_STATE_BODY =
  "Suggestions appear here when AI topic generation is switched on. Nothing is ever added to " +
  "your topic library on its own — every suggestion waits here until somebody accepts it.";

export type CandidateQueueProps = {
  candidates: TopicCandidate[];
  canManage: boolean;
  onReviewed: () => Promise<void>;
};

async function readJson(response: Response): Promise<Record<string, unknown>> {
  try {
    return (await response.json()) as Record<string, unknown>;
  } catch {
    throw new Error("The server sent a response this page could not read.");
  }
}

export function CandidateQueue({ candidates, canManage, onReviewed }: CandidateQueueProps) {
  const [busyId, setBusyId] = useState<string | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | undefined>(undefined);

  async function review(
    candidateId: string,
    status: "accepted" | "rejected",
  ): Promise<void> {
    setBusyId(candidateId);
    setErrorMessage(undefined);

    try {
      const response = await fetch("/api/topic-candidates", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ candidateId, status }),
      });

      const payload = await readJson(response);

      if (!response.ok) {
        setErrorMessage(
          typeof payload.error === "string"
            ? payload.error
            : "Could not save that decision.",
        );
        return;
      }

      await onReviewed();
    } catch (error) {
      setErrorMessage(
        error instanceof Error ? error.message : "Could not save that decision.",
      );
    } finally {
      setBusyId(null);
    }
  }

  return (
    <section className="flex flex-col gap-3">
      <h2 className="text-base font-semibold text-foreground">Suggested topics</h2>

      <FormError message={errorMessage} />

      {candidates.length === 0 ? (
        // An empty state that EXPLAINS ITSELF is the deliverable here, not a placeholder. A
        // blank panel reads as a fault; this one says where suggestions come from and, more
        // importantly, that nothing arrives in the library without somebody accepting it.
        <Card>
          <h3 className="text-sm font-semibold text-foreground">{EMPTY_STATE_HEADING}</h3>
          <p className="mt-2 text-sm text-muted">{EMPTY_STATE_BODY}</p>
        </Card>
      ) : (
        <ul className="flex flex-col gap-3">
          {candidates.map((candidate) => (
            <li key={candidate.id}>
              <Card>
                <div className="flex flex-wrap items-baseline gap-2">
                  <h3 className="text-sm font-semibold text-foreground">
                    {candidate.title}
                  </h3>
                  {candidate.category && (
                    <span className="text-xs text-muted">
                      {TOPIC_CATEGORY_LABELS[candidate.category]}
                    </span>
                  )}
                </div>

                {candidate.description && (
                  <p className="mt-2 text-sm text-muted">{candidate.description}</p>
                )}

                {candidate.suggestedScriptures && (
                  <p className="mt-2 text-sm text-muted">
                    Scriptures: {candidate.suggestedScriptures.join(", ")}
                  </p>
                )}

                {candidate.suggestedTalks && (
                  <p className="mt-1 text-sm text-muted">
                    Talks: {candidate.suggestedTalks.join(", ")}
                  </p>
                )}

                {canManage && (
                  <div className="mt-3 flex flex-wrap gap-2">
                    {/* Two separate controls, never one toggle, and never a checkbox that a
                        later "Apply" sweeps up. One decision, one press, one candidate. */}
                    <Button
                      type="button"
                      disabled={busyId === candidate.id}
                      onClick={() => review(candidate.id, "accepted")}
                    >
                      Add to the library
                      <span className="sr-only"> — {candidate.title}</span>
                    </Button>
                    <Button
                      type="button"
                      variant="secondary"
                      disabled={busyId === candidate.id}
                      onClick={() => review(candidate.id, "rejected")}
                    >
                      Not this one
                      <span className="sr-only"> — {candidate.title}</span>
                    </Button>
                  </div>
                )}
              </Card>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
