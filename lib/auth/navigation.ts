import { can, type KnownPermission, type RoleAccess } from "@/lib/auth/permissions";
import type { SessionUser } from "@/types/domain";

// One list, read by both the sidebar and the page guards, so a link can never point at a page
// the user will be refused.
//
// Hiding a link is cosmetic, never a security boundary. Every guarded page still calls
// assertCan() server-side (01-auth-rbac.md §Pitfalls) and RLS still blocks the query behind it.
//
// One entry per module, not per page. Most of these routes have no page yet — each arrives
// with its phase. A link to an unbuilt route 404s, which is the right answer for an unbuilt
// module and keeps this file from needing an edit in every later phase. The hrefs come from
// SPEC.md §Component Structure so those pages drop straight in.

export type NavigationItem = {
  label: string;
  href: string;
  permission: KnownPermission;
};

export const NAVIGATION_ITEMS: readonly NavigationItem[] = [
  { label: "Roster", href: "/roster", permission: "roster.view" },
  { label: "Calendar", href: "/calendar", permission: "calendar.view" },
  // Points at the month PLANNER, not at SPEC.md's /talks/pipeline kanban. talks-b built the
  // planner as the primary surface deliberately — the pipeline is nine stages, not nine screens
  // (04-talks-pipeline.md) — so the one Talks link goes where the work happens.
  { label: "Talks", href: "/assignments", permission: "talks.view" },
  { label: "Topics", href: "/talks/topics", permission: "topics.view" },
  { label: "Program", href: "/program", permission: "program.view" },
  { label: "Music", href: "/music", permission: "music.view" },
  { label: "Visits", href: "/visits", permission: "visits.view" },
  { label: "Goals", href: "/goals", permission: "goals.view" },
  { label: "Youth Activities", href: "/youth", permission: "youth_activities.view" },
  { label: "Agendas", href: "/agendas", permission: "agendas.view" },
  { label: "Tithing", href: "/tithing", permission: "tithing.view" },
  { label: "Knowledge Base", href: "/knowledge", permission: "knowledge.view" },
  { label: "AI Settings", href: "/ai-settings", permission: "ai_settings.view" },
  { label: "Sacrament", href: "/sacrament", permission: "sacrament.view_assignments" },
  { label: "Admin", href: "/admin", permission: "admin.view" },
  { label: "Audit Log", href: "/admin/audit-log", permission: "audit.view" },
] as const;

export function visibleNavigationItems(
  user: SessionUser,
  roleAccess?: RoleAccess,
): NavigationItem[] {
  return NAVIGATION_ITEMS.filter((item) => can(user, item.permission, roleAccess));
}
