"use client";

import { useRef, useState } from "react";
import { Button } from "@/components/ui/Button";
import { FormError } from "@/components/ui/FormError";
import type { AiMessageType } from "@/lib/validation/aiRequests";

// The button above each of the two message textareas. It talks to the route over `fetch` like
// every other control on that panel — a client component must not import lib/ai/client,
// lib/ai/retrieve, or anything that reaches next/headers
// (plans/retros/roster-b-picker-and-orgs.md).
//
// It NEVER SAVES. On success it hands the text to the parent, which replaces the textarea
// contents; approving is still the only thing that writes a message (CLAUDE.md rule 3).

export const DRAFT_DISCLAIMER =
  "A starting point. Read it, change it, and approve it when it says what you mean.";

export const REPLACE_CONFIRMATION =
  "This will replace what you have written. Continue?";

export const RESTORE_TEMPLATE_LABEL = "Back to the plain version";

const LABELS: Record<AiMessageType, string> = {
  confirmation: "Draft the confirmation with AI",
  thank_you: "Draft the thank-you with AI",
};

export type AiDraftButtonProps = {
  assignmentId: string;
  type: AiMessageType;
  // What the textarea currently holds, so an edit the user has made can be protected.
  currentValue: string;
  // The plain written template for this message. When it is supplied and the textarea no longer
  // matches it, a second control offers the way back.
  //
  // Both directions live in THIS component rather than in the panel, because the set of
  // "values nobody typed by hand" below is what decides whether replacing needs a confirm. A
  // restore driven from outside would leave that set stale, and the next AI press would warn
  // about losing an edit the user never made.
  templateValue?: string;
  onDraft: (text: string) => void;
  disabled?: boolean;
};

async function readJson(response: Response): Promise<Record<string, unknown>> {
  try {
    return (await response.json()) as Record<string, unknown>;
  } catch {
    throw new Error("The server sent a response this page could not read.");
  }
}

export function AiDraftButton({
  assignmentId,
  type,
  currentValue,
  templateValue,
  onDraft,
  disabled = false,
}: AiDraftButtonProps) {
  const [isDrafting, setIsDrafting] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | undefined>(undefined);

  // The last value this component produced, and the value the textarea held before it did. A
  // textarea matching either one has not been edited by hand, so replacing it loses nothing.
  //
  // A ref rather than state: nothing renders from it, and putting it in state would re-render
  // the panel every time a draft lands for no visible reason.
  const untouched = useRef<Set<string>>(
    new Set(templateValue === undefined ? [currentValue] : [currentValue, templateValue]),
  );

  // Offered only once the textarea has moved away from the template — otherwise it is a button
  // that would do nothing, sitting beside one that does something.
  const canRestore = templateValue !== undefined && currentValue !== templateValue;

  // The same guard in both directions. Going back to the plain version can discard typing just
  // as thoroughly as generating over it.
  function replaceWith(next: string): void {
    if (!untouched.current.has(currentValue) && !window.confirm(REPLACE_CONFIRMATION)) {
      return;
    }

    untouched.current.add(next);
    setErrorMessage(undefined);
    onDraft(next);
  }

  async function draft(): Promise<void> {
    // A CONFIRM STEP BEFORE REPLACING TYPING THE USER HAS DONE. Silently discarding somebody's
    // edit is not recoverable, and losing it to a button they pressed expecting an improvement
    // is the worst version of this feature.
    if (!untouched.current.has(currentValue) && !window.confirm(REPLACE_CONFIRMATION)) {
      return;
    }

    setErrorMessage(undefined);
    setIsDrafting(true);

    try {
      const response = await fetch(`/api/assignments/${assignmentId}/ai-message`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ type }),
      });

      const payload = await readJson(response);

      if (!response.ok) {
        // The textarea is left EXACTLY as it was. Every one of ai-a's six error kinds arrives
        // here as its own written sentence; re-wording them would collapse six distinguishable
        // failures into one.
        setErrorMessage(
          typeof payload.error === "string"
            ? payload.error
            : "Could not draft that message. Please try again.",
        );
        return;
      }

      const text = typeof payload.draft === "string" ? payload.draft : "";

      // An empty draft is the silent failure rule 7 forbids — it looks like an answer and it is
      // not one. The route's own error kinds cover every real cause, so this is a backstop.
      if (text.trim() === "") {
        setErrorMessage("The AI returned an empty draft. Try again.");
        return;
      }

      untouched.current.add(text);
      onDraft(text);
    } catch (error) {
      console.error("Could not draft a message", error);
      setErrorMessage("Could not reach the server. Check your connection and try again.");
    } finally {
      setIsDrafting(false);
    }
  }

  return (
    <div className="flex flex-col gap-1">
      <div className="flex flex-col gap-2 md:flex-row">
        <Button
          type="button"
          variant="secondary"
          className="self-start"
          // A draft takes several seconds. A button with no progress state gets clicked three
          // times, and each click is a separate outbound call the ward pays for.
          disabled={disabled || isDrafting}
          onClick={() => void draft()}
        >
          {isDrafting ? "Drafting…" : LABELS[type]}
        </Button>

        {/* The written template is often the better message, and before this it was reachable
            only by navigating away and coming back — which also threw away the AI draft. */}
        {canRestore && (
          <Button
            type="button"
            variant="secondary"
            className="self-start"
            disabled={disabled || isDrafting}
            onClick={() => replaceWith(templateValue)}
          >
            {RESTORE_TEMPLATE_LABEL}
          </Button>
        )}
      </div>

      <p className="text-sm text-muted">{DRAFT_DISCLAIMER}</p>

      <FormError message={errorMessage} />
    </div>
  );
}
