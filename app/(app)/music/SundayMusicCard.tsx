"use client";

import { HymnSearchModal } from "@/app/(app)/music/HymnSearchModal";
import { MusicalNumberForm } from "@/app/(app)/music/MusicalNumberForm";
import { MusicPeopleForm } from "@/app/(app)/music/MusicPeopleForm";
import type { MusicDirectoryEntry } from "@/app/(app)/music/MusicPersonWindow";
import { MusicReviewControls } from "@/app/(app)/music/MusicReviewControls";
import { SubmitMusicButton } from "@/app/(app)/music/SubmitMusicButton";
import { SuggestHymnsButton } from "@/app/(app)/music/SuggestHymnsButton";
import { SundayTypeBadge } from "@/components/calendar/SundayTypeBadge";
import { UnverifiedHymnBadge } from "@/components/music/UnverifiedHymnBadge";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { Pill, type PillTone } from "@/components/ui/Pill";
import { formatSundayLabelWithYear } from "@/lib/calendar/dates";
// TYPE-ONLY, AND IT MUST STAY THAT WAY. A VALUE import of a queries.ts from a client component
// pulls in next/headers, which `npm run lint` and `npm run typecheck` both pass and only
// `npm run build` catches (plans/retros/roster-b-picker-and-orgs.md). This file became
// "use client" without that import moving, which is the only reason the change was a directive
// rather than a rewrite.
import type { HymnSelection, MusicalNumber } from "@/lib/music/queries";
import type { MusicCompletion } from "@/lib/music/musicCompletion";
import { pillStatus } from "@/lib/sacrament/sundayStatus";
import { HYMN_TYPES, type HymnType, type SundayMusic, type SundayType } from "@/types/domain";

// One Sunday: what it is about, what has been chosen, and what has not.
//
// ---------------------------------------------------------------------------
// COLLAPSED BY DEFAULT, ONE OPEN AT A TIME
// ---------------------------------------------------------------------------
// The prototype works /music as a collapsed list of dates you click into (module-map.md §6.2),
// and this card is one row of it. It does NOT own which card is open — MusicSundayList does,
// because "one open at a time" is a fact about the list and not about any card in it.
//
// A "use client" file now, for the toggle alone. The three interactive pieces inside it — the
// picker, the AI path and the musical number form — remain their own client files owning their
// own state, so a hymn saved in one slot still cannot stale the other two.
//
// ---------------------------------------------------------------------------
// TOPICS PENDING — DIMMED, THE PILL REPLACED, AND STILL CLICKABLE (p4-sacrament-b2)
// ---------------------------------------------------------------------------
// module-map.md §6.2 item 4, built. A Sunday whose topics nobody has finalized renders at
// `opacity-70` with the completion pill REPLACED — not accompanied — by a single `Topics pending`.
//
// The build note's reason for replacing rather than adding: a completion count is "premature
// before the conductor has actually decided the day's shape". `2/3 chosen` beside `Topics pending`
// would be two answers to one question — pick hymns now, or wait — and the coordinator would have
// to work out which one governs.
//
// ⚠️ DIMMED, NEVER DISABLED. The card still opens, every control inside it still works, and a
// coordinator who wants to get ahead may. P3 deleted `Tile.locked` outright for this reason and
// components/sacrament/StatusPill.tsx states the same rule from the other side: a control
// somebody cannot act on is one that should not have been rendered. This is a SIGNAL about
// somebody else's work, not a lock on this reader's.
//
// ⚠️ IT IS THE COLUMN, NEVER A DERIVATION. `topicsFinalized` arrives as a boolean resolved from
// `sundays.topics_finalized_at`. decisions.md §1.15 is explicit that finalize is "a conductor's
// deliberate click, NOT derived from every slot happening to have a topic", so inferring it from
// "this Sunday has topics assigned" would tell a coordinator the topics were settled when nobody
// had said so — which is the single thing this signal exists to prevent.
//
// ---------------------------------------------------------------------------
// TWO PILLS ONCE THE TOPICS ARE FINAL — ITER-038 slice mb
// ---------------------------------------------------------------------------
// `n/m picked` is lib/music/musicCompletion.ts's count — the same definition the Submit button and
// the server use — and the workflow pill (`Draft` / `Pending approval — <conductor>` / `Approved` /
// `Sent back`) is the MUSIC SUBMISSION's own status, `sunday_music.status`. This header used to say
// that pill reported the programme's state and belonged with the programme; that was a misreading
// of the prototype's MusicSundayEditor, corrected here and in module-map.md §6.2. While the topics
// are pending, `Topics pending` still replaces BOTH, for the reason above.

const HYMN_SLOT_LABELS: Record<HymnType, string> = {
  opening: "Opening hymn",
  sacrament: "Sacrament hymn",
  closing: "Closing hymn",
};

export type SundayMusicCardProps = {
  sunday: { id: string; date: string; type: SundayType };
  // Resolved from `sundays.topics_finalized_at` by the page and handed down as a boolean. This is
  // a "use client" file, so it could not read the column itself even if it wanted to.
  topicsFinalized: boolean;
  topicTitles: string[];
  selections: HymnSelection[];
  musicalNumber: MusicalNumber | null;
  // The chorister and organist (ITER-038, `sunday_music`) — an empty draft when nobody has set any.
  sundayMusic: SundayMusic;
  // The roster for choosing them, slim. Empty for a reader without `music.manage`.
  members: readonly MusicDirectoryEntry[];
  // musicCompletionFor() over this Sunday's live music, computed by the page.
  completion: MusicCompletion;
  // Who the submitted music waits on, for `Pending approval — <name>`.
  conductorName: string | null;
  // `music.manage`: choose the music and submit it.
  canManage: boolean;
  // `topics.manage`: approve it or send it back (the whole bishopric, plan A2).
  canReview: boolean;
  viewerUserId: string;
  isOpen: boolean;
  onToggle: () => void;
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

const COMPLETION_TONES = {
  complete: "ok",
  partial: "pending",
  empty: "neutral",
} as const;

function workflowPill(
  sundayMusic: SundayMusic,
  conductorName: string | null,
): { label: string; tone: PillTone } {
  if (sundayMusic.status === "approved") return { label: "Approved", tone: "ok" };
  if (sundayMusic.status === "submitted") {
    return {
      label: conductorName === null ? "Pending approval" : `Pending approval — ${conductorName}`,
      tone: "pending",
    };
  }
  if (sundayMusic.returnedReason === "sent_back") return { label: "Sent back", tone: "missing" };
  return { label: "Draft", tone: "neutral" };
}

// Why a draft is a draft again. Shown until the music is submitted again, which clears the reason.
function ReturnedBanner({ sundayMusic }: { sundayMusic: SundayMusic }) {
  if (sundayMusic.status !== "draft" || sundayMusic.returnedReason === null) return null;
  const message =
    sundayMusic.returnedReason === "sent_back"
      ? `Sent back by the conductor: ${sundayMusic.returnNote ?? ""}`
      : sundayMusic.returnedReason === "topics_changed"
        ? "The topics changed after this was submitted. Your picks are kept — check them and submit again."
        : "Changed after it was submitted — submit again when it's ready.";
  return (
    <p role="status" className="mt-3 rounded-md border border-warning px-3 py-2 text-sm text-foreground">
      {message}
    </p>
  );
}

export function SundayMusicCard({
  sunday,
  topicsFinalized,
  topicTitles,
  selections,
  musicalNumber,
  sundayMusic,
  members,
  completion,
  conductorName,
  canManage,
  canReview,
  viewerUserId,
  isOpen,
  onToggle,
}: SundayMusicCardProps) {
  const byType = new Map(selections.map((selection) => [selection.hymnType, selection]));

  const missingCount = HYMN_TYPES.filter((hymnType) => {
    const selection = byType.get(hymnType);
    return selection === undefined || selection.hymnNumber === null;
  }).length;

  const workflow = workflowPill(sundayMusic, conductorName);

  const panelId = `sunday-${sunday.id}-music`;

  return (
    // The anchor the Sacrament hub's Music pill lands on: /music?sunday=<id>&from=sacrament
    // #sunday-<id>. The query parameter is what OPENS this card; the fragment is what scrolls to
    // it with no JavaScript. PrayerBoard carries the identical spelling on its own Sunday cards
    // (p4-sacrament-a).
    // opacity-70 ON THE CARD, exactly as the prototype dims it. Nothing inside is disabled and
    // nothing is aria-hidden — a dimmed card is still read, still tabbed into and still opened.
    <Card
      id={`sunday-${sunday.id}`}
      className={topicsFinalized ? undefined : "opacity-70"}
    >
      {/* THE WHOLE SUMMARY ROW IS THE CONTROL, and it is a real <button> inside the heading —
          the WAI-ARIA accordion shape, which keeps the document outline and gives the row one
          keyboard path rather than a div with a key handler bolted on. min-h-11 is 44px;
          p4-sacrament-a found every pill on the hub was a 19px tap target.

          The expanded card's own controls are SIBLINGS of this button, never nested inside it —
          a button inside a button is the interactive-nesting bug components/calendar/SundayCard
          already avoided with a stretched pseudo-element. */}
      <h2>
        <button
          type="button"
          onClick={onToggle}
          aria-expanded={isOpen}
          // Only while the panel exists. The panel is unmounted when collapsed — it holds three
          // modals and a form, and mounting those for every card in the list is the cost the
          // collapsed shape exists to avoid — so pointing at it unconditionally would be a
          // dangling reference on every closed card.
          aria-controls={isOpen ? panelId : undefined}
          className="flex min-h-11 w-full flex-wrap items-center gap-2 rounded-md py-1 text-left focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
        >
          <span className="text-base font-semibold text-foreground">
            {formatSundayLabelWithYear(sunday.date)}
          </span>
          <SundayTypeBadge type={sunday.type} />
          {/* REPLACED, NOT ACCOMPANIED — see the header. Two pills here would be two answers to
              "is this ready to work on". */}
          {topicsFinalized ? (
            <>
              <Pill tone={COMPLETION_TONES[pillStatus(completion.filled, completion.total)]}>
                {completion.filled}/{completion.total} picked
              </Pill>
              <Pill tone={workflow.tone}>{workflow.label}</Pill>
            </>
          ) : (
            <Pill tone="pending">Topics pending</Pill>
          )}
        </button>
      </h2>

      {isOpen && (
        <div id={panelId} className="mt-2">
          {/* Explicit, at the top, because the summary row above has scrolled out of reach on a
              long card — module-map.md §6.2 item 3 asks for it by name. */}
          <Button variant="secondary" onClick={onToggle}>
            Collapse
          </Button>

          <ReturnedBanner sundayMusic={sundayMusic} />

          {/* Correctly pluralised, and the two states are written rather than templated. "1 hymns
              still to choose" is the plural bug ai-b recorded, and a count of zero is a different
              sentence rather than the same one with a 0 in it. */}
          <p className="mt-3 text-sm text-muted">
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

          <MusicPeopleForm
            sundayId={sunday.id}
            sundayMusic={sundayMusic}
            members={members}
            canManage={canManage}
          />

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

          {/* THE WORKFLOW, LAST — after everything it is about. Submit while it is a draft; Approve
              or Send back while it waits. An approved Sunday shows neither: changing anything
              above returns it to draft by itself. */}
          {canManage && sundayMusic.status === "draft" ? (
            <div className="mt-3 border-t border-border pt-3">
              <SubmitMusicButton
                sundayId={sunday.id}
                completion={completion}
                topicsFinalized={topicsFinalized}
              />
            </div>
          ) : null}
          {canReview && sundayMusic.status === "submitted" ? (
            <div className="mt-3 border-t border-border pt-3">
              <MusicReviewControls
                sundayId={sunday.id}
                isOwnSubmission={sundayMusic.submittedByUserId === viewerUserId}
              />
            </div>
          ) : null}
        </div>
      )}
    </Card>
  );
}
