import type { HymnSelection, MusicalNumber } from "@/lib/music/queries";
import { HYMN_TYPES, type HymnType, type SundayMusic } from "@/types/domain";

// IS A SUNDAY'S MUSIC READY TO SUBMIT? — ITER-038 slice mb (the prototype's `music-completion-gate`).
//
// ONE DEFINITION, USED THREE TIMES: the card's `n/m picked` pill, the Submit button's "n left", and
// the server — lib/music/musicReview.ts re-checks it in submitMusic() and approveMusic(). Three
// copies would be three chances to disagree, and the one that matters is the server's.
//
// PURE, and type-only imports, so a client component may call it.
//
// The items: the three hymns, the chorister and the organist — plus the musical number ONLY when a
// live one exists, and then it counts as filled only with BOTH a piece and a performer. A Sunday
// with no musical number is not missing one; most Sundays have none.
//
// Feed it LIVE rows only. A cancelled hymn choice or musical number is a record, not music on the
// Sunday (Sacrament slice f2c), and the readers skip them by default — so a caller that opted into
// cancelled rows would count music that is not there.

export type MusicCompletion = {
  filled: number;
  total: number;
  // The human labels of what is still to do, in the card's order.
  missing: string[];
  complete: boolean;
};

const HYMN_LABELS: Record<HymnType, string> = {
  opening: "Opening hymn",
  sacrament: "Sacrament hymn",
  closing: "Closing hymn",
};

function isFilledText(value: string | null): boolean {
  return value !== null && value.trim() !== "";
}

export function musicCompletionFor(input: {
  selections: readonly HymnSelection[];
  musicalNumber: MusicalNumber | null;
  sundayMusic: SundayMusic;
}): MusicCompletion {
  const items: { label: string; filled: boolean }[] = HYMN_TYPES.map((hymnType) => ({
    label: HYMN_LABELS[hymnType],
    filled: input.selections.some(
      (selection) =>
        selection.hymnType === hymnType &&
        selection.hymnNumber !== null &&
        selection.cancelledAt === null,
    ),
  }));

  items.push({ label: "Chorister", filled: input.sundayMusic.chorister !== null });
  items.push({ label: "Organist", filled: input.sundayMusic.organist !== null });

  if (input.musicalNumber !== null && input.musicalNumber.cancelledAt === null) {
    items.push({
      label: "Musical number",
      filled:
        isFilledText(input.musicalNumber.pieceTitle) && isFilledText(input.musicalNumber.performer),
    });
  }

  const missing = items.filter((item) => !item.filled).map((item) => item.label);

  return {
    filled: items.length - missing.length,
    total: items.length,
    missing,
    complete: missing.length === 0,
  };
}

// "Still to pick: Opening hymn, Organist." — the server's refusal, and the button's reason.
export function describeMissingMusic(missing: readonly string[]): string {
  return `Still to pick: ${missing.join(", ")}.`;
}
