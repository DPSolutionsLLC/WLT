import { z } from "zod";

// How a leader last left /visits — the tab and the household sort — remembered on their account
// (the user's standing rule: every page reopens as it was left). A reader who cannot see a stored
// tab gets Households; the page decides that through visibleVisitsTabs(), not this parse.
//
// bv4 added Goal history; bv5 adds My visits.

export const VISITS_TABS = [
  "households",
  "feed",
  "all_organizations",
  "goal_history",
  "sharing",
] as const;
export type VisitsTab = (typeof VISITS_TABS)[number];

export const VISITS_TAB_LABELS: Record<VisitsTab, string> = {
  households: "Households",
  feed: "Feed",
  all_organizations: "All orgs",
  // Short so five tabs still scroll rather than wrap at 375px (the 099-D2 lesson).
  goal_history: "Past goals",
  sharing: "Sharing",
};

export const VISIT_HOUSEHOLD_SORTS = [
  "priority",
  "familyName",
  "lastVisitedOn",
  "lastAttemptedOn",
  "dueOn",
  "conductedBy",
] as const;
export type VisitHouseholdSort = (typeof VISIT_HOUSEHOLD_SORTS)[number];

export const VISIT_HOUSEHOLD_SORT_LABELS: Record<VisitHouseholdSort, string> = {
  priority: "Priority",
  familyName: "Household",
  lastVisitedOn: "Last visited",
  lastAttemptedOn: "Last attempted",
  dueOn: "Due",
  conductedBy: "Conducted by",
};

export const visitsViewSchema = z.object({
  tab: z.enum(VISITS_TABS),
  sort: z.enum(VISIT_HOUSEHOLD_SORTS),
});
export type VisitsView = z.infer<typeof visitsViewSchema>;

export const DEFAULT_VISITS_VIEW: VisitsView = { tab: "households", sort: "priority" };

// Falls back field by field rather than throwing: a preference nobody can parse must not take the
// page down, and a stored tab from a later slice must not throw away a good sort.
export function parseVisitsView(value: unknown): VisitsView {
  const record = typeof value === "object" && value !== null ? (value as Record<string, unknown>) : {};
  const tab = z.enum(VISITS_TABS).safeParse(record.tab);
  const sort = z.enum(VISIT_HOUSEHOLD_SORTS).safeParse(record.sort);
  return {
    tab: tab.success ? tab.data : DEFAULT_VISITS_VIEW.tab,
    sort: sort.success ? sort.data : DEFAULT_VISITS_VIEW.sort,
  };
}

// `?tab=` on /visits — what the old /visits/feed and /visits/all-organizations addresses redirect
// with, so a bookmark still lands on the screen it named.
export function parseVisitsTabParam(value: string | string[] | undefined): VisitsTab | undefined {
  const raw = Array.isArray(value) ? value[0] : value;
  const parsed = z.enum(VISITS_TABS).safeParse(raw);
  return parsed.success ? parsed.data : undefined;
}

// Which tabs a reader sees, in order. All organizations is the bishopric's alone (ITER-055 P4), and
// so is Goal history (decided with the user at bv4 start); Sharing follows canManageVisitSharing().
export function visibleVisitsTabs(reader: {
  isBishopric: boolean;
  canManageSharing: boolean;
}): VisitsTab[] {
  const tabs: VisitsTab[] = ["households", "feed"];
  if (reader.isBishopric) tabs.push("all_organizations", "goal_history");
  if (reader.canManageSharing) tabs.push("sharing");
  return tabs;
}

// A tab asked for in the address wins over the remembered one; either is used only if visible.
export function initialVisitsTab(
  stored: VisitsTab,
  visible: readonly VisitsTab[],
  requested?: VisitsTab,
): VisitsTab {
  if (requested !== undefined && visible.includes(requested)) return requested;
  return visible.includes(stored) ? stored : "households";
}
