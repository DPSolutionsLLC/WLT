import { NAVIGATION_SECTIONS, type NavigationItem } from "@/lib/auth/navigation";
import { SectionHeader } from "@/components/ui/SectionHeader";
import { Tile } from "@/components/ui/Tile";

// The dashboard, as sections of Tile. It is also what a sub-dashboard renders, so it takes its
// items entirely from props — NOTHING IN HERE KNOWS WHAT A MODULE IS.
//
// ---------------------------------------------------------------------------
// ⚠️ A PERSON SEES ONLY WHAT THEY CAN OPEN. THERE ARE NO LOCKED TILES.
// ---------------------------------------------------------------------------
// DECIDED BY THE USER 2026-09-22, walking scenario 069, and it REVERSES what P3 first shipped.
//
// The first version rendered every built module a person lacked as a LOCKED tile: un-clickable,
// with a sentence naming the module and telling them to ask the bishopric. The walk showed what
// that actually produces. A music coordinator got 4 tiles they could use and 11 they could not.
// A stake officer — who holds no permissions at all by design — got FIFTEEN locks and not one
// thing to do, each one advising them to ask a bishopric that has no power to grant it.
//
// The user's rule is simpler and better: **show what somebody can do, and nothing else.** A grid
// is a place to start work from, not an inventory of what the app contains. Telling a leader
// eleven times over what they may not touch is noise on every visit, to make a point that matters
// at most once.
//
// A SECTION WITH NO ACCESSIBLE TILES THEREFORE RENDERS NOTHING — not an empty heading. That was
// already true for "Tasks & Communication" (empty until P5 builds To Do), and it is now the same
// rule for a section a particular person simply cannot reach. A heading with nothing under it
// reads as a section that failed to load, which is the defect plans/retros/youth-h recorded.
//
// `Tile` still SUPPORTS `locked`/`lockedReason` and its test still covers them — P1 built that
// primitive and P3 does not get to redesign it. Nothing in the app passes them any more. If a
// later phase wants a locked tile, read this header first: the reason it was removed is a product
// decision about what a dashboard is for, not an implementation detail.
//
// No "use client": no state, no handlers. It is rendered from inside DashboardHeader's client
// tree, so it must stay free of anything that reaches next/headers — lib/auth/navigation.tsx
// imports nothing server-only, which `npm run build` is what proves.

export type DashboardGridProps = {
  // Built AND permitted — already filtered by visibleNavigationItems(). There is no second list.
  items: NavigationItem[];
  // Filters on label and blurb, case-insensitively. Filtering is the ONLY thing it does.
  searchTerm: string;
  pinnedHrefs: string[];
  // A SUB-DASHBOARD RENDERS ONE FLAT GRID. Its page title already names the section, so grouping
  // three admin pages under "Finance & Admin" would repeat the heading the reader just read —
  // and grouping them under section headings while showing none of them would leave unexplained
  // gaps between the rows. So this switches the GROUPING as well as the headings, and the items
  // keep the order they were given.
  showSectionHeadings?: boolean;
};

function matchesSearch(item: NavigationItem, needle: string): boolean {
  if (needle.length === 0) return true;

  return (
    item.label.toLowerCase().includes(needle) || item.blurb.toLowerCase().includes(needle)
  );
}

export function DashboardGrid({
  items,
  searchTerm,
  pinnedHrefs,
  showSectionHeadings = true,
}: DashboardGridProps) {
  const needle = searchTerm.trim().toLowerCase();
  const pinned = new Set(pinnedHrefs);

  const tile = (item: NavigationItem) => (
    <Tile
      key={item.href}
      href={item.href}
      label={item.label}
      blurb={item.blurb}
      icon={item.icon}
      accent={item.accent}
      pinned={pinned.has(item.href)}
    />
  );

  const visible = items.filter((item) => matchesSearch(item, needle));

  if (visible.length === 0) {
    return (
      <p className="text-sm text-muted">
        {needle.length === 0
          ? // Reachable, and not only in theory: STAKE_OFFICER_PERMISSIONS is an empty list by
            // design (CLAUDE.md §7). Before locked tiles were removed this branch was DEAD CODE —
            // a role with nothing got fifteen locks instead, which is how the walk of scenario 069
            // found it.
            "Your calling has no modules assigned yet. Ask a member of the bishopric."
          : `Nothing matches “${searchTerm.trim()}”.`}
      </p>
    );
  }

  if (!showSectionHeadings) {
    return <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">{visible.map(tile)}</div>;
  }

  const sections = NAVIGATION_SECTIONS.map((section) => ({
    ...section,
    tiles: visible.filter((item) => item.section === section.id),
  })).filter((section) => section.tiles.length > 0);

  return (
    <div className="flex flex-col gap-6">
      {sections.map((section) => (
        <section key={section.id} className="flex flex-col gap-3">
          <SectionHeader title={section.label} headingLevel={2} />

          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {section.tiles.map(tile)}
          </div>
        </section>
      ))}
    </div>
  );
}
