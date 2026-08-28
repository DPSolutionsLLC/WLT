import type { ActivityEvent, ActivityProfile } from "@/lib/youth/queries";

// THE CLIENT SIDE'S SHARED CACHE KEYS AND FETCHERS, in one module so the three components on
// /youth cannot disagree about what they are reading.
//
// ---------------------------------------------------------------------------
// WHY THIS FILE EXISTS
// ---------------------------------------------------------------------------
// It did not, and that was defect youth-a-D2. ActivityProfileList held the profiles key and
// invalidated it; EventList held the events key; ManualEventForm's list of activities came from
// the SERVER as a prop and was never refetched at all. So creating an activity updated the list
// and left the form directly beneath it saying "Add an activity first", and the only way forward
// was a reload — on the module's primary flow, create an activity then add its first game.
// Removing an activity left its cascade-deleted events sitting in the schedule.
//
// StewardshipPanel already carried the rule, in as many words: "Invalidating BOTH is what keeps
// the panel and the numbers above it in step... router.refresh() alone is not enough: TanStack
// reads `initialData` once, on first mount." Stating a rule in one module does not apply it in
// another; one place to import from does.
//
// ---------------------------------------------------------------------------
// NO "use client" DIRECTIVE, AND NO VALUE FROM HERE MAY REACH page.tsx
// ---------------------------------------------------------------------------
// This module is plain TypeScript that only client components import, which is what keeps the
// keys importable between them without a directive. A constant imported from a "use client"
// module reaches a Server Component as a function rather than as a string — the bug that made
// visits-d's "Log this visit" flow silently dead. page.tsx imports COMPONENTS from this directory
// and never a constant.

export const YOUTH_PROFILES_QUERY_KEY = "youth-activity-profiles";
export const YOUTH_EVENTS_QUERY_KEY = "youth-activity-events";

export async function readJson(response: Response): Promise<Record<string, unknown>> {
  try {
    return (await response.json()) as Record<string, unknown>;
  } catch {
    throw new Error("The server sent a response this page could not read.");
  }
}

export function errorFrom(payload: Record<string, unknown>, fallback: string): string {
  return typeof payload.error === "string" ? payload.error : fallback;
}

export async function fetchProfiles(): Promise<ActivityProfile[]> {
  const response = await fetch("/api/youth/profiles");
  const payload = await readJson(response);

  if (!response.ok) {
    throw new Error(errorFrom(payload, "Could not load the youth activities."));
  }

  return payload.profiles as ActivityProfile[];
}

// `includePast` is part of the KEY, not just this argument — every view is its own cache entry.
// visits-c found a bookmark made under one filter invisible under another until a reload, and the
// cause was two views sharing one entry.
export async function fetchEvents(includePast: boolean): Promise<ActivityEvent[]> {
  const response = await fetch(`/api/youth/events${includePast ? "?includePast=true" : ""}`);
  const payload = await readJson(response);

  if (!response.ok) {
    throw new Error(errorFrom(payload, "Could not load the activity events."));
  }

  return payload.events as ActivityEvent[];
}

// WHAT A PROFILE MUTATION HAS TO INVALIDATE, in one function because the answer is "both" and the
// defect was somebody reasonably assuming it was "the profiles".
//
// Deleting a profile CASCADES to its events (migration 009), so a profile write moves the event
// list too. Creating one changes what the event form may offer. Neither is knowable from inside
// ActivityProfileList, which is exactly why this lives here rather than there.
export const PROFILE_MUTATION_INVALIDATES = [
  [YOUTH_PROFILES_QUERY_KEY],
  [YOUTH_EVENTS_QUERY_KEY],
] as const;
