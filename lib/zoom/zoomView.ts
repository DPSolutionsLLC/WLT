import { z } from "zod";

// Which Zoom tab a leader last had open, remembered on their account (the user's standing rule:
// every page reopens as it was left). A reader who cannot see a stored tab gets `remote` — the page
// decides that through visibleZoomTabs(), not this parse.

export const ZOOM_TABS = ["remote", "invitees", "registrations", "pool", "links"] as const;
export type ZoomTab = (typeof ZOOM_TABS)[number];

export const zoomViewSchema = z.object({ tab: z.enum(ZOOM_TABS) });
export type ZoomView = z.infer<typeof zoomViewSchema>;

export const DEFAULT_ZOOM_VIEW: ZoomView = { tab: "remote" };

// Falls back rather than throwing: a preference nobody can parse must not take the page down.
export function parseZoomView(value: unknown): ZoomView {
  const parsed = zoomViewSchema.safeParse(value);
  return parsed.success ? parsed.data : DEFAULT_ZOOM_VIEW;
}

// Which tabs a reader sees, in order (ITER-053, ITER-052). Invitees and Sign-ups are read by the
// bishopric, the clerk and the executive secretary; the pool and the remote links only by the
// bishopric.
export function visibleZoomTabs(reader: {
  canViewInvitees: boolean;
  canManageInvitees: boolean;
  canManageRemoteLinks: boolean;
}): ZoomTab[] {
  const tabs: ZoomTab[] = ["remote"];
  if (reader.canViewInvitees) tabs.push("invitees", "registrations");
  if (reader.canManageInvitees) tabs.push("pool");
  if (reader.canManageRemoteLinks) tabs.push("links");
  return tabs;
}

export function initialZoomTab(stored: ZoomTab, visible: readonly ZoomTab[]): ZoomTab {
  return visible.includes(stored) ? stored : "remote";
}
