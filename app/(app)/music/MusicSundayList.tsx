"use client";

import { useState } from "react";
import { SundayMusicCard } from "@/app/(app)/music/SundayMusicCard";
// TYPE-ONLY. A VALUE import of a queries.ts from a client component pulls in next/headers, which
// lint and typecheck both pass and only `npm run build` catches
// (plans/retros/roster-b-picker-and-orgs.md).
import type { HymnSelection, MusicalNumber } from "@/lib/music/queries";
import type { SundayType } from "@/types/domain";

// The collapsed list of dates /music is worked as (module-map.md §6.2).
//
// ---------------------------------------------------------------------------
// ONE OPEN AT A TIME — A SINGLE VALUE, NEVER A `Set`
// ---------------------------------------------------------------------------
// §6.1's rule is SINGLE-OPEN ⇔ JUMP TARGET, and this page is a jump target: the Sacrament hub's
// Music pill deep-links a Sunday into it. A `Set` here would lose the answer to "which one did I
// come here for" the moment the reader opened a second card. A browse-and-compare page — the
// Prayer Roll, Access Control, Ministering — gets the `Set`; this one does not.
//
// The state lives in the list rather than in the card because "one open at a time" is a fact
// about the LIST. A card owning its own boolean could not close its neighbour.
//
// The page is a Server Component and this board is the "use client" boundary, taking serializable
// props — PrayerBoard's shape exactly.
//
// ---------------------------------------------------------------------------
// COLLAPSE ALL, AND WHY THERE IS NO "EXPAND ALL" BESIDE IT
// ---------------------------------------------------------------------------
// Added on the user's request, 2026-09-23, while reviewing the walk of scenario 072. They asked
// for "the option to collapse everything if you wanted to", and said of the other half: "I don't
// know if you'd ever want to expand all".
//
// **There is no Expand all, and it must not be added.** §6.1's rule is SINGLE-OPEN ⇔ JUMP TARGET,
// and expanding everything is the `Set` that rule forbids on a page somebody is deep-linked into
// — it would lose the answer to "which one did I come here for" the moment it was pressed. So the
// asymmetry is the design, not an omission.
//
// It follows that at most ONE card is ever open, so this control closes exactly one. It is
// deliberately still called "Collapse all": it names what the reader wants to happen to the page,
// and it would remain correct if the list ever did hold several open cards. It renders only while
// something IS open — a control that is always there and usually does nothing is worse than one
// that appears when it has a job.

export type MusicSundayEntry = {
  sunday: { id: string; date: string; type: SundayType };
  topicTitles: string[];
  selections: HymnSelection[];
  musicalNumber: MusicalNumber | null;
};

export type MusicSundayListProps = {
  entries: MusicSundayEntry[];
  // The Sunday `?sunday=` named, already resolved by the page against this ward. Null is the
  // ordinary arrival from the navigation, and it opens NOTHING — the list is collapsed.
  initialOpenSundayId: string | null;
  canManage: boolean;
};

export function MusicSundayList({
  entries,
  initialOpenSundayId,
  canManage,
}: MusicSundayListProps) {
  const [openSundayId, setOpenSundayId] = useState<string | null>(initialOpenSundayId);

  return (
    <div className="flex flex-col gap-3">
      {openSundayId !== null && (
        <div className="flex justify-end">
          <button
            type="button"
            onClick={() => setOpenSundayId(null)}
            className="inline-flex min-h-11 items-center rounded-md px-3 text-sm font-medium text-primary hover:bg-surface-raised focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
          >
            Collapse all
          </button>
        </div>
      )}

      <ul className="flex flex-col gap-4">
      {entries.map((entry) => (
        <li key={entry.sunday.id}>
          <SundayMusicCard
            sunday={entry.sunday}
            topicTitles={entry.topicTitles}
            selections={entry.selections}
            musicalNumber={entry.musicalNumber}
            canManage={canManage}
            isOpen={openSundayId === entry.sunday.id}
            // Opening a card CLOSES whatever was open, because the state is one value rather
            // than a set. Pressing the open card closes it, which is what the Collapse button
            // inside it calls too.
            onToggle={() =>
              setOpenSundayId((current) =>
                current === entry.sunday.id ? null : entry.sunday.id,
              )
            }
          />
        </li>
        ))}
      </ul>
    </div>
  );
}
