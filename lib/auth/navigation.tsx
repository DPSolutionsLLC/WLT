import type { ReactNode } from "react";
import {
  BookOpen,
  Calculator,
  CalendarDays,
  Church,
  ClipboardList,
  FileText,
  Home,
  Lightbulb,
  Mic,
  Music2,
  ScrollText,
  Settings,
  Sparkles,
  Target,
  Trophy,
  Users,
} from "lucide-react";
import type { TileAccent } from "@/components/ui/Tile";
import { can, type KnownPermission, type RoleAccess } from "@/lib/auth/permissions";
import type { SessionUser } from "@/types/domain";

// One list, read by the tile dashboard, the sub-dashboards, the quick-links modal and the page
// guards, so a link can never point at a page the user will be refused.
//
// Hiding a link is cosmetic, never a security boundary. Every guarded page still calls
// assertCan() server-side (01-auth-rbac.md §Pitfalls) and RLS still blocks the query behind it.
//
// One entry per module, not per page. The hrefs come from SPEC.md §Component Structure.
//
// A .tsx FILE BECAUSE THE ICONS ARE ELEMENTS. `icon` holds `<Mic />`, not `Mic` — a component
// REFERENCE is a function and functions do not cross the Server → Client boundary, while a
// rendered element does. That is what lets the server compute the grid and hand it to a client
// header that filters it.
//
// ---------------------------------------------------------------------------
// NOTHING MAY KEEP A SECOND COPY OF THIS LIST
// ---------------------------------------------------------------------------
// This is the single list behind the dashboard grid, the sub-dashboards, the quick-links modal
// and tests/lib/navigationRoutesExist.test.ts. A pathname → title lookup table, a hardcoded module
// array in a component, or a CHECK constraint naming these hrefs would each be a second copy, and
// one list hand-maintained in two places always drifts (plans/retros/notification-trigger-drift.md).
//
// ---------------------------------------------------------------------------
// `built` — AND WHY A ROW SURVIVES WITH IT SET FALSE
// ---------------------------------------------------------------------------
// This file used to carry rows for routes with no page, on the reasoning that "a link to an
// unbuilt route 404s, which is the right answer for an unbuilt module". It is not: a bishop was
// offered /admin/audit-log and the ordinance screen on every page, Next.js prefetched them, and
// the console carried two errors on every page a bishop opened (CLAUDE.md §9). `built: false` keeps the
// forward map — where a module belongs, what colour it is, what it is for — while
// visibleNavigationItems() withholds it, so a later phase flips one boolean rather than
// re-deriving all of that.
//
// tests/lib/navigationRoutesExist.test.ts reads `app/` from disk and enforces the gate
// mechanically. No assertion about a rendered component can catch a dead route: the failure is a
// FILE THAT IS NOT THERE, which is why that test reads the filesystem the way
// tests/lib/explicitTimeZone.test.ts reads source.

export type NavigationSection = "meetings" | "people" | "tasks" | "finance";

export type NavigationItem = {
  label: string;
  href: string;
  permission: KnownPermission;
  section: NavigationSection;
  // One short line saying what the module is for. Rendered on the tile.
  blurb: string;
  // Decorative — the label beside it names the module. Tile wraps this in an aria-hidden span,
  // so pass the bare element.
  icon: ReactNode;
  // EQUAL TO THE SECTION'S ACCENT, always. Duplicated here so a tile rendered outside the grid
  // (quick links, a sub-dashboard) carries its colour without the caller looking the section up.
  // tests/lib/navigation.test.ts asserts the two agree, so the duplication cannot drift.
  //
  // THE ACCENT CARRIES NO MEANING — Tile's header states this and it must stay true. It is a
  // find-the-same-tile-twice aid, exactly like CONTEXT_TONES. Nothing reads a state out of it.
  accent: TileAccent;
  // Is there a page at this href, reachable from the app shell? See the header above.
  built: boolean;
};

export const NAVIGATION_SECTIONS: readonly {
  id: NavigationSection;
  label: string;
  accent: TileAccent;
}[] = [
  { id: "meetings", label: "Meetings & Programs", accent: "pine" },
  { id: "people", label: "People & Care", accent: "rust" },
  // EMPTY TODAY, AND DELIBERATELY SO. To Do, My Appointments, Message and Zoom are P5 and P10.
  // Adding placeholder items for them is the exact bug the `built` gate closes. The grid renders
  // nothing at all for a section with no visible tiles, so an empty heading never appears; P5
  // flips the first item to `built: true` and this section starts rendering in one line.
  { id: "tasks", label: "Tasks & Communication", accent: "gold" },
  { id: "finance", label: "Finance & Admin", accent: "pine" },
] as const;

export const NAVIGATION_ITEMS: readonly NavigationItem[] = [
  // ---------------------------------------------------------------------------
  // ONE TILE FOR THE MEETING, WHERE THERE WERE THREE — p4-sacrament-a
  // ---------------------------------------------------------------------------
  // This row REPLACED separate Talks (/assignments) and Prayers (/prayers) tiles. Both routes
  // are untouched and still work; they are reached through the hub's per-Sunday pills instead of
  // from the dashboard, so anybody with one bookmarked keeps working. Leaving their tiles here
  // would put three tiles on the dashboard for one module, which is the thing the hub exists to
  // undo.
  //
  // `talks.view`, which is what both of those pages already gate on. Prayers ride on it rather
  // than a permission of their own: a prayer is part of planning the meeting, and there is
  // deliberately no `prayers.*` in PERMISSIONS (talks-c).
  //
  // THE BLURB NAMES THE MEETING, NOT THE ORDINANCE. The `Sacrament Ordinances` row further down
  // is the other sense of the word and the two must be tellable apart at a glance.
  {
    label: "Sacrament",
    href: "/sacrament",
    permission: "talks.view",
    section: "meetings",
    blurb: "Every Sunday's meeting — topics, speakers, prayers, music and the programme.",
    icon: <Mic />,
    accent: "pine",
    built: true,
  },
  {
    label: "Topics",
    href: "/talks/topics",
    permission: "topics.view",
    section: "meetings",
    blurb: "The pool of subjects talks are assigned from.",
    icon: <Lightbulb />,
    accent: "pine",
    built: true,
  },
  {
    label: "Program",
    href: "/program",
    permission: "program.view",
    section: "meetings",
    blurb: "Build, approve and publish the sacrament programme.",
    icon: <FileText />,
    accent: "pine",
    built: true,
  },
  {
    label: "Music",
    href: "/music",
    permission: "music.view",
    section: "meetings",
    blurb: "Hymns for each Sunday, and the musical numbers between.",
    icon: <Music2 />,
    accent: "pine",
    built: true,
  },
  {
    label: "Calendar",
    href: "/calendar",
    permission: "calendar.view",
    section: "meetings",
    blurb: "Every Sunday, who is conducting, and what is planned.",
    icon: <CalendarDays />,
    accent: "pine",
    built: true,
  },
  {
    label: "Agendas",
    href: "/agendas",
    permission: "agendas.view",
    section: "meetings",
    blurb: "Ward council and bishopric meeting agendas.",
    icon: <ClipboardList />,
    accent: "pine",
    built: true,
  },
  // ---------------------------------------------------------------------------
  // THE OTHER SENSE OF THE WORD — P11's, AND STILL UNBUILT
  // ---------------------------------------------------------------------------
  // `Sacrament Ordinances`, not `Sacrament`: who PASSES, BLESSES and PREPARES the ordinance,
  // which is a different feature from the Sacrament row above (the meeting being planned). Two
  // rows both labelled "Sacrament" would be indistinguishable on a grid of tiles, so this one
  // says which it is.
  //
  // It moved from `/sacrament` to `/sacrament/ordinances` in p4-sacrament-a, when the meeting hub
  // took the shorter path. The youth PIN screen that used to answer `/sacrament` is now at
  // `/ordinances` (app/(youth)/ordinances/page.tsx); this href has no page ANYWHERE until P11
  // builds the adult view, which is a plainer kind of `built: false` than the one that used to
  // be recorded here — a click no longer bounces silently off a foreign shell, because there is
  // nothing at the path at all.
  {
    label: "Sacrament Ordinances",
    href: "/sacrament/ordinances",
    permission: "sacrament.view_assignments",
    section: "meetings",
    blurb: "Who is passing, blessing and preparing the sacrament.",
    icon: <Church />,
    accent: "pine",
    built: false,
  },
  {
    label: "Roster",
    href: "/roster",
    permission: "roster.view",
    section: "people",
    blurb: "Every member and household in the ward.",
    icon: <Users />,
    accent: "rust",
    built: true,
  },
  {
    label: "Visits",
    href: "/visits",
    permission: "visits.view",
    section: "people",
    blurb: "Who is due a visit, and what happened last time.",
    icon: <Home />,
    accent: "rust",
    built: true,
  },
  {
    label: "Youth Activities",
    href: "/youth",
    permission: "youth_activities.view",
    section: "people",
    blurb: "Teams, games, and who is going along to support them.",
    icon: <Trophy />,
    accent: "rust",
    built: true,
  },
  {
    label: "Goals",
    href: "/goals",
    permission: "goals.view",
    section: "people",
    blurb: "What each organization is working towards.",
    icon: <Target />,
    accent: "rust",
    built: true,
  },
  {
    label: "Tithing",
    href: "/tithing",
    permission: "tithing.view",
    section: "finance",
    blurb: "The Sunday counting worksheet.",
    icon: <Calculator />,
    accent: "pine",
    built: true,
  },
  {
    label: "Knowledge Base",
    href: "/knowledge",
    permission: "knowledge.view",
    section: "finance",
    blurb: "The scripture and talks the drafts are written from.",
    icon: <BookOpen />,
    accent: "pine",
    built: true,
  },
  {
    label: "AI Settings",
    href: "/ai-settings",
    permission: "ai_settings.view",
    section: "finance",
    blurb: "How this ward wants its drafts written.",
    icon: <Sparkles />,
    accent: "pine",
    built: true,
  },
  {
    label: "Admin",
    href: "/admin",
    permission: "admin.view",
    section: "finance",
    blurb: "Accounts, access requests, and ward settings.",
    icon: <Settings />,
    accent: "pine",
    built: true,
  },
  // No page at all — P12 owns the audit viewer. This row is also the ANCHOR
  // tests/lib/navigationRoutesExist.test.ts uses to prove it can fail. If it is ever flipped to
  // `built: true`, that test needs another unbuilt href or it starts passing trivially.
  {
    label: "Audit Log",
    href: "/admin/audit-log",
    permission: "audit.view",
    section: "finance",
    blurb: "Every change anybody made, and when.",
    icon: <ScrollText />,
    accent: "pine",
    built: false,
  },
] as const;

// BUILT *AND* PERMITTED, IN THAT ORDER. Permission alone is what produced the standing
// broken-link bug CLAUDE.md §9 records: a bishop holds `audit.view`, so the audit log was offered
// on every page and 404'd on every click.
export function visibleNavigationItems(
  user: SessionUser,
  roleAccess: RoleAccess,
): NavigationItem[] {
  return NAVIGATION_ITEMS.filter(
    (item) => item.built && can(user, item.permission, roleAccess),
  );
}
