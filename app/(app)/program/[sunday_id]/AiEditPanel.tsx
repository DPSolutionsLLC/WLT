"use client";

import { useState } from "react";
import { DraftDiff } from "@/components/program/DraftDiff";
import { Button } from "@/components/ui/Button";
import { FormError } from "@/components/ui/FormError";
import type { DraftChange } from "@/lib/program/diff";
import type { ProgramDraft } from "@/lib/program/draft";
import { messageFromPayload, readJsonPayload } from "@/lib/program/requests";
import { MAX_EDIT_INSTRUCTION, type ChatTurn } from "@/lib/validation/aiProgramEdit";

// Changing the program by describing the change.
//
// ---------------------------------------------------------------------------------------------
// A REPLY IS A DIFF AND AN APPLY BUTTON. NEVER AN APPLIED CHANGE.
// ---------------------------------------------------------------------------------------------
// The route stores nothing; this panel stores nothing until somebody presses Apply; and there is
// no "always apply" preference to add later. That is CLAUDE.md rule 3, and it is the single most
// consequential line in this file.
//
// ---------------------------------------------------------------------------------------------
// APPLYING RESETS THE FORM, IT DOES NOT REFRESH THE PAGE
// ---------------------------------------------------------------------------------------------
// router.refresh() PRESERVES client state. Restoring a settings version left the form holding
// stale values while every server-side test passed
// (plans/retros/ai-a-settings-and-preview.md). onApply hands the new draft up and the builder
// replaces its state from it.
//
// ---------------------------------------------------------------------------------------------
// HISTORY IS COMPONENT STATE
// ---------------------------------------------------------------------------------------------
// SPEC.md §Program AI Editor: a conversation about a draft is working state, not a record.
// Nothing persists it, and the whole of it is sent on every call because the model edits current
// state rather than remembering it.
//
// A FAILURE CLEARS NOTHING. The conversation, the pending diff and the unchanged draft are all
// still there, with the route's own sentence beside them — never a generic "something went
// wrong" (plans/retros/ai-c-feature-routes.md).

const TEXTAREA_CLASSES =
  "min-h-24 rounded-md border border-border bg-surface-raised px-3 py-2 text-base " +
  "text-foreground placeholder:text-muted focus-visible:outline-2 " +
  "focus-visible:outline-offset-2 focus-visible:outline-primary";

export const AI_EDIT_DISCLAIMER =
  "Describe the change in your own words. Nothing is saved until you have read what it would " +
  "do and pressed Apply.";

export const NO_CHANGE_PROPOSED =
  "That did not change anything on the program. Try describing it a different way.";

// What goes into the history as the assistant's turn, so the next instruction edits from here.
// The CHANGES, not the draft — the draft travels in its own field on every call, and a second
// copy of it inside the conversation would double the prompt for nothing.
export function describeChanges(changes: readonly DraftChange[]): string {
  if (changes.length === 0) return "Nothing changed.";

  return changes
    .map((change) => `${change.label}: ${change.before ?? "nothing"} → ${change.after ?? "nothing"}`)
    .join("; ");
}

type Proposal = {
  draft: ProgramDraft;
  changes: DraftChange[];
};

export type AiEditPanelProps = {
  programId: string;
  // The draft ON SCREEN, including edits not yet saved. The model edits what the user is looking
  // at, not what the database last stored.
  draft: ProgramDraft;
  onApply: (draft: ProgramDraft) => void;
  disabled: boolean;
};

export function AiEditPanel({ programId, draft, onApply, disabled }: AiEditPanelProps) {
  const [instruction, setInstruction] = useState("");
  // Held separately from `instruction` so the textarea can be cleared the moment a proposal
  // arrives while the words that produced it are still available to the history.
  const [lastInstruction, setLastInstruction] = useState("");

  const [history, setHistory] = useState<ChatTurn[]>([]);
  const [proposal, setProposal] = useState<Proposal | null>(null);
  const [isWorking, setIsWorking] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string>();

  async function ask(): Promise<void> {
    const asked = instruction.trim();
    if (asked === "") return;

    setErrorMessage(undefined);
    setIsWorking(true);

    try {
      const response = await fetch(`/api/programs/${programId}/ai-edit`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ draft, history, instruction: asked }),
      });

      const payload = await readJsonPayload(response);

      if (!response.ok) {
        // Every one of the six AI error kinds arrives here as its own written sentence.
        // Re-wording them would collapse six distinguishable failures into one. The textarea,
        // the history and any pending proposal are left exactly as they were.
        setErrorMessage(
          messageFromPayload(payload, "Could not change that program. Please try again."),
        );
        return;
      }

      const proposed = payload.draft as ProgramDraft | undefined;
      const changes = (payload.changes ?? []) as DraftChange[];

      if (!proposed) {
        setErrorMessage(
          "The AI sent back no program, so nothing was changed. Try asking again.",
        );
        return;
      }

      // A reply that changed nothing is a real answer with nothing to apply, not an error. Said
      // plainly, and the instruction is left in the box so it can be reworded.
      if (changes.length === 0) {
        setErrorMessage(NO_CHANGE_PROPOSED);
        return;
      }

      setProposal({ draft: proposed, changes });
      setInstruction("");
    } catch (error) {
      console.error("Could not run an AI program edit", error);
      setErrorMessage("Could not reach the server. Check your connection and try again.");
    } finally {
      setIsWorking(false);
    }
  }

  function apply(): void {
    if (proposal === null) return;

    // The turn pair is appended ONLY on apply. A proposal the user rejected is not part of the
    // conversation the next instruction edits from — recording it would have the model working
    // forward from a draft nobody accepted.
    setHistory((current) => [
      ...current,
      { role: "user", content: lastInstruction },
      { role: "assistant", content: describeChanges(proposal.changes) },
    ]);

    onApply(proposal.draft);
    setProposal(null);
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-col gap-1.5">
        <label
          htmlFor={`${programId}-ai-instruction`}
          className="text-sm font-medium text-foreground"
        >
          What would you like changed?
        </label>
        <textarea
          id={`${programId}-ai-instruction`}
          value={instruction}
          disabled={disabled || isWorking}
          maxLength={MAX_EDIT_INSTRUCTION}
          placeholder="Add a note that the Primary children will sing during the sacrament."
          onChange={(event) => setInstruction(event.target.value)}
          className={TEXTAREA_CLASSES}
        />
      </div>

      <p className="text-sm text-muted">{AI_EDIT_DISCLAIMER}</p>

      <Button
        type="button"
        variant="secondary"
        className="self-start"
        // A call takes several seconds. A button with no progress state gets pressed three times,
        // and each press is a separate outbound call the ward pays for.
        disabled={disabled || isWorking || instruction.trim() === ""}
        onClick={() => {
          setLastInstruction(instruction.trim());
          void ask();
        }}
      >
        {isWorking ? "Working…" : "Ask for the change"}
      </Button>

      <FormError message={errorMessage} />

      {history.length > 0 && (
        <section className="flex flex-col gap-2 border-t border-border pt-3">
          <h3 className="text-sm font-semibold text-foreground">This conversation</h3>
          <ol className="flex flex-col gap-2">
            {history.map((turn, index) => (
              <li key={index} className="text-sm">
                <span className="text-muted">
                  {turn.role === "user" ? "You asked: " : "Applied: "}
                </span>
                <span className="text-foreground">{turn.content}</span>
              </li>
            ))}
          </ol>
        </section>
      )}

      {proposal !== null && (
        <section className="flex flex-col gap-3 border-t border-border pt-3">
          <h3 className="text-sm font-semibold text-foreground">What this would change</h3>
          <DraftDiff changes={proposal.changes} />
          <div className="flex flex-col gap-2 sm:flex-row">
            <Button type="button" disabled={disabled} onClick={apply}>
              {proposal.changes.length === 1
                ? "Apply this change"
                : `Apply these ${proposal.changes.length} changes`}
            </Button>
            <Button type="button" variant="secondary" onClick={() => setProposal(null)}>
              Discard it
            </Button>
          </div>
        </section>
      )}
    </div>
  );
}
