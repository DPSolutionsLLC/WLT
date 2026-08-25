import { HymnSearchModal } from "@/app/(app)/music/HymnSearchModal";
import { MusicalNumberForm } from "@/app/(app)/music/MusicalNumberForm";
import { SuggestHymnsButton } from "@/app/(app)/music/SuggestHymnsButton";
import { SundayTypeBadge } from "@/components/calendar/SundayTypeBadge";
import { UnverifiedHymnBadge } from "@/components/music/UnverifiedHymnBadge";
import { Card } from "@/components/ui/Card";
import { formatSundayLabelWithYear } from "@/lib/calendar/dates";
import type { HymnSelection, MusicalNumber } from "@/lib/music/queries";
import { HYMN_TYPES, type HymnType, type SundayType } from "@/types/domain";

// One Sunday: what it is about, what has been chosen, and what has not.
//
// A SERVER COMPONENT. The three interactive pieces — the picker, the AI path and the musical
// number form — are their own "use client" files, each owning its own state. That keeps the card
// itself a rendering of the data rather than a state machine, and it means a hymn saved in one
// slot cannot silently stale the other two.

const HYMN_SLOT_LABELS: Record<HymnType, string> = {
  opening: "Opening hymn",
  sacrament: "Sacrament hymn",
  closing: "Closing hymn",
};

export type SundayMusicCardProps = {
  sunday: { id: string; date: string; type: SundayType };
  topicTitles: string[];
  selections: HymnSelection[];
  musicalNumber: MusicalNumber | null;
  canManage: boolean;
};

// AN ABSENCE RENDERS AS AN ABSENCE (talks-c). A slot with no hymn chosen shows the slot and an
// empty value — never "None selected", which reads as a decision somebody made.
function HymnSlot({
  sundayId,
  hymnType,
  selection,
  canManage,
}: {
  sundayId: string;
  hymnType: HymnType;
  selection: HymnSelection | null;
  canManage: boolean;
}) {
  return (
    <div className="flex flex-col gap-2 border-t border-border py-3 first:border-t-0 sm:flex-row sm:items-center sm:justify-between">
      <div className="flex flex-col gap-1">
        <span className="text-xs font-medium uppercase tracking-wide text-muted">
          {HYMN_SLOT_LABELS[hymnType]}
        </span>

        {selection === null || selection.hymnNumber === null ? (
          <span className="text-sm text-muted">Not chosen yet</span>
        ) : (
          <span className="flex flex-wrap items-center gap-2 text-sm text-foreground">
            <span>
              {selection.hymnNumber}
              {selection.hymnTitle === null ? "" : ` — ${selection.hymnTitle}`}
            </span>
            <UnverifiedHymnBadge title={selection.hymnTitle} />
            {selection.aiSuggested && (
              // Shown because it is true, and because it is what makes "how often is the AI
              // actually right" a question anybody can answer by looking (CLAUDE.md rule 3's
              // spirit: an AI's part in a decision stays visible after the decision).
              <span className="inline-flex items-center rounded-full border border-border px-2 py-0.5 text-xs text-muted">
                Suggested by AI
              </span>
            )}
          </span>
        )}
      </div>

      {canManage && (
        <HymnSearchModal
          sundayId={sundayId}
          hymnType={hymnType}
          slotLabel={HYMN_SLOT_LABELS[hymnType]}
          hasSelection={selection !== null && selection.hymnNumber !== null}
        />
      )}
    </div>
  );
}

export function SundayMusicCard({
  sunday,
  topicTitles,
  selections,
  musicalNumber,
  canManage,
}: SundayMusicCardProps) {
  const byType = new Map(selections.map((selection) => [selection.hymnType, selection]));

  const missingCount = HYMN_TYPES.filter((hymnType) => {
    const selection = byType.get(hymnType);
    return selection === undefined || selection.hymnNumber === null;
  }).length;

  return (
    <Card>
      <div className="flex flex-wrap items-center gap-2">
        <h2 className="text-base font-semibold text-foreground">
          {formatSundayLabelWithYear(sunday.date)}
        </h2>
        <SundayTypeBadge type={sunday.type} />
      </div>

      {/* Correctly pluralised, and the two states are written rather than templated. "1 hymns
          still to choose" is the plural bug ai-b recorded, and a count of zero is a different
          sentence rather than the same one with a 0 in it. */}
      <p className="mt-1 text-sm text-muted">
        {missingCount === 0
          ? "All three hymns are chosen."
          : missingCount === 1
            ? "One hymn still to choose."
            : `${missingCount} hymns still to choose.`}
      </p>

      <div className="mt-3 flex flex-col gap-1">
        <span className="text-xs font-medium uppercase tracking-wide text-muted">
          Talks that Sunday
        </span>
        {topicTitles.length === 0 ? (
          // NOT "no topics assigned" as a warning. A coordinator often works ahead of the
          // bishopric, and a Sunday without topics yet is an ordinary state, not a problem
          // theirs to fix.
          <p className="text-sm text-muted">No topics yet.</p>
        ) : (
          <ul className="flex flex-col gap-0.5 text-sm text-foreground">
            {topicTitles.map((title) => (
              <li key={title}>{title}</li>
            ))}
          </ul>
        )}
      </div>

      {canManage && (
        <div className="mt-3">
          <SuggestHymnsButton sundayId={sunday.id} hasTopics={topicTitles.length > 0} />
        </div>
      )}

      <div className="mt-3">
        {HYMN_TYPES.map((hymnType) => (
          <HymnSlot
            key={hymnType}
            sundayId={sunday.id}
            hymnType={hymnType}
            selection={byType.get(hymnType) ?? null}
            canManage={canManage}
          />
        ))}
      </div>

      <div className="mt-3 border-t border-border pt-3">
        <span className="text-xs font-medium uppercase tracking-wide text-muted">
          Musical number
        </span>
        {canManage ? (
          <MusicalNumberForm sundayId={sunday.id} musicalNumber={musicalNumber} />
        ) : musicalNumber === null ? (
          <p className="mt-1 text-sm text-muted">None.</p>
        ) : (
          <p className="mt-1 text-sm text-foreground">
            {[musicalNumber.performer, musicalNumber.pieceTitle]
              .filter((part) => part !== null && part !== "")
              .join(" — ")}
          </p>
        )}
      </div>
    </Card>
  );
}
