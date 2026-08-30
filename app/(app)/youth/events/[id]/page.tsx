import Link from "next/link";
import { notFound } from "next/navigation";
import { EventDetail } from "@/app/(app)/youth/events/[id]/EventDetail";
import { NotPermitted } from "@/components/ui/NotPermitted";
import { displayName, listWardUsers } from "@/lib/auth/adminUsers";
import { BISHOPRIC_ROLES, can, resolveRoleAccess } from "@/lib/auth/permissions";
import { requireSessionUser } from "@/lib/auth/session";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { readWardTimezone } from "@/lib/ward/wardTimezone";
import { listAttendeesForEvents } from "@/lib/youth/attendees";
import { wardDayBounds } from "@/lib/youth/occasionDay";
import { listActivityEvents, listActivityProfiles, getActivityEvent } from "@/lib/youth/queries";

// One evening, and every young person who is part of it — at /youth/events/[id].
//
// ---------------------------------------------------------------------------
// WHAT THIS PAGE IS FOR
// ---------------------------------------------------------------------------
// `activity_events.profile_id` is a single foreign key, so an event belongs to exactly ONE young
// person. Two team-mates at the same game are two rows, and until migration 059 nothing anywhere
// recorded that they are the same evening in the same gym. This is the screen that reads that
// link: every row on the occasion, each with its own coverage badge and its own "I'll go".
//
// An event with NO occasion opens here perfectly happily and shows exactly one row — that is the
// ordinary state of nearly every event in a ward, and it is where a leader goes to say "this is
// the same game as…" in the first place.
//
// ---------------------------------------------------------------------------
// THIS PAGE SEEDS THE SHARED CACHE. IT DOES NOT HAND DOWN A FINISHED LIST.
// ---------------------------------------------------------------------------
// A Server Component prop NEVER REFETCHES. Joining an occasion would otherwise succeed,
// invalidate keys this page did not read, and change nothing at all on screen — defect
// youth-a-D2, which app/(app)/youth/youthQueries.ts exists for and which ActivityCalendar's
// header calls the single most likely bug in this area. It is the single most likely bug in this
// slice too, because every control on this page is a mutation.
//
// can() rather than assertCan(): a ForbiddenError escaping a Server Component becomes a 500 whose
// message Next.js strips in production (plans/retros/auth-b-invites-admin.md).
//
// THIS PAGE DOES NOT IMPORT lib/youth/privateNotes.ts, AND MUST NOT. A private note belongs to
// its author and appears in no list, ever (CLAUDE.md rule 5).

// `params` is a Promise in Next 16, typed explicitly rather than with the generated PageProps
// helper — that only exists after a build (plans/retros/foundation-a-scaffold.md). The pattern is
// app/(app)/roster/household/[id]/page.tsx's.
export type YouthEventPageProps = { params: Promise<{ id: string }> };

export default async function YouthEventPage({ params }: YouthEventPageProps) {
  const user = await requireSessionUser();
  const supabase = await createServerSupabaseClient();
  const roleAccess = await resolveRoleAccess(supabase, user.wardId);

  if (!can(user, "youth_activities.view", roleAccess)) {
    return (
      <NotPermitted detail="Youth activity support is limited to ward and organization leadership." />
    );
  }

  const { id } = await params;

  // The clock enters ONCE and is handed down, so every row on this page is judged against the
  // same instant rather than against a clock that moves down the list.
  const asOf = new Date();

  const event = await getActivityEvent(user.wardId, id, supabase);

  // An event in another ward reads as missing rather than forbidden — RLS returns no row, and
  // "not found" is the honest answer to a caller who cannot know it exists.
  if (!event) notFound();

  const wardTimeZone = await readWardTimezone(user.wardId, supabase);

  // THE PICKER'S CANDIDATES ARE BOUNDED TO THIS EVENT'S OWN DAY IN THE WARD'S ZONE, and
  // lib/youth/occasionDay.ts argues why that is right here and wrong on the calendar: this is a
  // QUERY BOUND, so it must be the same set for every reader.
  const dayBounds = wardDayBounds(event.eventDate, wardTimeZone);

  const [occasionEvents, profiles, sameDayEvents] = await Promise.all([
    // `includePast: true` ALWAYS — the whole point of this page is that it works on a game that
    // has already happened, so it must not empty out the moment the last event passes.
    event.occasionId === null
      ? Promise.resolve([event])
      : listActivityEvents(
          user.wardId,
          { occasionId: event.occasionId, includePast: true, asOf },
          supabase,
        ),
    // For the names on each row AND for the "add a young person" picker — one fetch, two uses.
    listActivityProfiles(user.wardId, supabase),
    dayBounds === null
      ? Promise.resolve([])
      : listActivityEvents(
          user.wardId,
          { from: dayBounds.from, to: dayBounds.to, includePast: true, asOf },
          supabase,
        ),
  ]);

  // ONE QUERY FOR THE WHOLE SCREEN, keyed back by event — not one per card
  // (lib/youth/attendees.ts). The occasion's rows and the picker's candidates are fetched
  // together, because the candidate list is what the picker labels and the occasion's rows are
  // what it excludes.
  const attendeesByEvent = await listAttendeesForEvents(
    user.wardId,
    [...new Set([...occasionEvents, ...sameDayEvents].map((row) => row.id))],
    supabase,
  );

  const canManage = can(user, "youth_activities.manage", roleAccess);
  const isBishopric = (BISHOPRIC_ROLES as readonly string[]).includes(user.role);

  // ONLY FOR THE BISHOPRIC, because only they can use the control it feeds — copied from
  // /youth/calendar rather than re-derived. Everybody else gets an empty list and no picker:
  // absent rather than present-and-refusing.
  //
  // Mapped down to { id, label } HERE, so the email and role listWardUsers returns never cross
  // into a client component.
  const assignableUsers = isBishopric
    ? (await listWardUsers(user.wardId, supabase))
        .filter((wardUser) => wardUser.isActive)
        .map((wardUser) => ({ id: wardUser.id, label: displayName(wardUser) }))
    : [];

  return (
    <div className="flex flex-col gap-6">
      <div>
        <Link href="/youth/calendar" className="text-sm text-primary underline underline-offset-4">
          Back to the ward activity calendar
        </Link>
        <h1 className="mt-2 text-xl font-semibold text-foreground">{event.title}</h1>
        <p className="mt-1 text-sm text-muted">
          Everybody who is part of this evening, and who is going to be there for them.
        </p>
      </div>

      <EventDetail
        eventId={event.id}
        occasionId={event.occasionId}
        initialOccasionEvents={occasionEvents}
        initialProfiles={profiles}
        initialAttendees={Object.fromEntries(attendeesByEvent)}
        sameDayEvents={sameDayEvents}
        asOf={asOf.toISOString()}
        currentUserId={user.id}
        canManage={canManage}
        canAssign={isBishopric}
        assignableUsers={assignableUsers}
      />
    </div>
  );
}
