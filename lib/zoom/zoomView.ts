import { z } from "zod";

// Which Zoom tab a leader last had open, remembered on their account (the user's standing rule:
// every page reopens as it was left). A reader who cannot manage links always gets `remote`, even
// with `links` stored — the page decides that, not this parse.

export const ZOOM_TABS = ["remote", "links"] as const;
export type ZoomTab = (typeof ZOOM_TABS)[number];

export const zoomViewSchema = z.object({ tab: z.enum(ZOOM_TABS) });
export type ZoomView = z.infer<typeof zoomViewSchema>;

export const DEFAULT_ZOOM_VIEW: ZoomView = { tab: "remote" };

// Falls back rather than throwing: a preference nobody can parse must not take the page down.
export function parseZoomView(value: unknown): ZoomView {
  const parsed = zoomViewSchema.safeParse(value);
  return parsed.success ? parsed.data : DEFAULT_ZOOM_VIEW;
}
