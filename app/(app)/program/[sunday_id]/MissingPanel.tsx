import { Card } from "@/components/ui/Card";
import type { ProgramDraft } from "@/lib/program/draft";
import { missingItems, missingSummary } from "@/lib/program/missingMessages";

// What is still needed, as sentences.
//
// ---------------------------------------------------------------------------------------------
// MISSING IS NOT AN ERROR STATE
// ---------------------------------------------------------------------------------------------
// A Thursday program with five gaps is the NORMAL case (06-program-music.md §Step 2). Nothing
// here uses role="alert", the danger token, a warning icon, or the word "error", "invalid",
// "problem" or "required". It is a checklist of work remaining, and it reads as one.
//
// It is also the ONE place the app says a thing is needed. Every empty field apologising for
// itself is the failure mode this panel exists to prevent — an absent organist is a blank line on
// the program and one line here, never "None assigned" in both (talks-c).
//
// ---------------------------------------------------------------------------------------------
// THE COUNT LINE NEEDS BOTH FIXTURES
// ---------------------------------------------------------------------------------------------
// "all 1 of its passages" (plans/retros/ai-b-knowledge-and-retrieval.md) survived because every
// fixture had exactly one of everything. tests/components/program/MissingPanel.test.tsx renders
// one gap and several, and one open speaking slot and several, for that reason.
//
// A Server Component. It takes a draft and renders it — no state, no effects, no handlers — so
// it stays renderable from the page as well as from inside the client editor.

export const NOTHING_MISSING = "Everything this program needs is filled in.";

export type MissingPanelProps = {
  draft: ProgramDraft;
};

export function MissingPanel({ draft }: MissingPanelProps) {
  const items = missingItems(draft);

  return (
    <Card>
      <h2 className="text-base font-semibold text-foreground">Still needed</h2>

      {items.length === 0 ? (
        <p className="mt-2 text-sm text-muted">{NOTHING_MISSING}</p>
      ) : (
        <>
          <p className="mt-1 text-sm text-muted">{missingSummary(items.length)}</p>
          <ul className="mt-3 flex flex-col gap-2">
            {items.map((item) => (
              <li key={item.key} className="flex gap-2 text-sm text-foreground">
                {/* A bullet, not a warning glyph. The mark in front of a line is most of what
                    decides whether a list reads as a checklist or as a validation summary. */}
                <span aria-hidden="true" className="text-muted">
                  •
                </span>
                <span>{item.message}</span>
              </li>
            ))}
          </ul>
        </>
      )}
    </Card>
  );
}
