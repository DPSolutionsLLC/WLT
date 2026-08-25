import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import { programDraftSchema, type ProgramDraft } from "@/lib/program/draft";
import type { ChatTurn } from "@/lib/validation/aiProgramEdit";

// The plain-English program editor's prompt and its output format.
//
// PURE. No client, no database, no next/headers — it builds a string and a format object, and
// the route does the calling. Same reason lib/ai/topicSuggestions.ts is pure: a function of its
// inputs is a function a test can reach without a network.
//
// ---------------------------------------------------------------------------------------------
// THE OUTPUT SCHEMA IS program-a'S DRAFT SCHEMA, UNCHANGED
// ---------------------------------------------------------------------------------------------
// Not a second "editable subset" shape. A separate schema would be free to drift from the one
// the renderer reads, and the first symptom would be a program that printed a field the editor
// could no longer produce. One schema, and the API is handed the whole of it.
//
// What the API can enforce by constrained decoding is the STRUCTURE. Zod keywords it does not
// support — the `version` literal, the date pattern, the sundayType enum — are downgraded by the
// SDK into schema descriptions, so they guide the model without binding it. That is exactly why
// the route re-validates what comes back rather than trusting `parsed`.
//
// ---------------------------------------------------------------------------------------------
// THE MODEL EDITS CURRENT STATE; IT DOES NOT REMEMBER IT
// ---------------------------------------------------------------------------------------------
// Every call carries the whole current draft AND the whole conversation so far. There is no
// server-side session, and a follow-up instruction ("no, make it the second speaker") is
// meaningless without both. The draft is the state; the history is why it looks the way it does.

export const programEditOutputFormat = zodOutputFormat(programDraftSchema);

export type ProgramEditPromptInput = {
  draft: ProgramDraft;
  history: readonly ChatTurn[];
  instruction: string;
};

const TURN_LABELS: Record<ChatTurn["role"], string> = {
  user: "They asked",
  assistant: "What changed",
};

// The draft goes in as JSON rather than as the rendered meeting order. The model is being asked
// to return that exact shape, and showing it the shape it must produce is worth more than prose
// — a prose program would have to be mapped back onto field names by the model, which is where a
// silently dropped benediction comes from.
function renderDraft(draft: ProgramDraft): string {
  return JSON.stringify(draft, null, 2);
}

function renderHistory(history: readonly ChatTurn[]): string {
  return history.map((turn) => `${TURN_LABELS[turn.role]}: ${turn.content}`).join("\n\n");
}

// Kept plain. Current models follow instructions closely, and step-by-step scripts and emphatic
// ALL-CAPS directives DEGRADE the output — the model starts hedging instead of doing the edit.
// State the task, name the constraints once, and stop (lib/ai/moduleInstructions.ts).
export function buildProgramEditPrompt(input: ProgramEditPromptInput): string {
  const sections: string[] = [
    "This is the sacrament meeting program as it stands right now:\n\n" +
      renderDraft(input.draft),
  ];

  if (input.history.length > 0) {
    sections.push(
      "Earlier in this conversation, working on this same program:\n\n" +
        renderHistory(input.history),
    );
  }

  sections.push(`What they have asked for now: ${input.instruction}`);

  sections.push(
    "Return the whole program with that change made. Every field they did not mention keeps " +
      "exactly the value it has above, including `version`, `date` and `sundayType`.",
  );

  return sections.join("\n\n");
}
