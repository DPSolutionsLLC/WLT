import Link from "next/link";
import { ActivityCalendar } from "@/app/(app)/youth/calendar/ActivityCalendar";
import { NotPermitted } from "@/components/ui/NotPermitted";
import { displayName, listWardOrganizations, listWardUsers } from "@/lib/auth/adminUsers";
import { BISHOPRIC_ROLES, can, resolveRoleAccess } from "@/lib/auth/permissions";
import { requireSessionUser } from "@/lib/auth/session";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { listAttendeesForEvents } from "@/lib/youth/attendees";
import { readWardTimezone } from "@/lib/ward/wardTimezone";
import { listActivityEvents, listActivityProfiles } from "@/lib/youth/queries";

// The whole ward's youth calendar, at /youth/calendar.
//
// ---------------------------------------------------------------------------
// WARD-WIDE, ALWAYS. THERE IS NO SECOND GATE.
// ---------------------------------------------------------------------------
// A ward council member sees every organization's events. That is 08-youth-activities.md §Step 7
// and FEATURES.md §Module 10 — seeing across the organizations is the entire reason a ward
// council exists — and it is what migration 054's UNTOUCHED select policy already delivers.
//
// This is deliberately UNLIKE /visits/all-organizations, which has a second gate because a ward
// setting decides whether one organization's leaders may read another's visit reports. No ward
// setting narrows this one, and adding one would contradict the decision migration 054 recorded.
//
// can() rather than assertCan(): a ForbiddenError escaping a Server Component becomes a 500 whose
// message Next.js strips in production (plans/retros/auth-b-invites-admin.md).
//
// ---------------------------------------------------------------------------
// THIS PAGE SEEDS THE SHARED CACHE. IT NO LONGER HANDS DOWN A FINISHED LIST.
// ---------------------------------------------------------------------------
// It used to build a merged `CalendarEvent[]` here and pass it as a plain prop. That was correct
// while the page had no controls on it — and it became a bug the moment one was added, because a
// Server Component prop never refetches: "I'll go" would succeed, invalidate two cache keys this
// page did not read, and change nothing on screen (youth-a-D2, the defect youthQueries.ts exists
// for).
//
// So the three lists below SEED the same entries /youth seeds, and ActivityCalendar composes its
// rows from them exactly as EventList does. The server still fetches, so first paint is right.
//
// THIS PAGE DOES NOT IMPORT lib/youth/privateNotes.ts, AND MUST NOT. A private note belongs to
// its author and appears in no list, ever (CLAUDE.md rule 5).

export default async function YouthCalendarPage() {
  const user = await requireSessionUser();
  const supabase = await createServerSupabaseClient();
  const roleAccess = await resolveRoleAccess(supabase, user.wardId);

  if (!can(user, "youth_activities.view", roleAccess)) {
    return (
      <NotPermitted detail="The youth activity calendar is limited to ward and organization leadership." />
    );
  }

  const isBishopric = (BISHOPRIC_ROLES as readonly string[]).includes(user.role);

  // The clock enters ONCE and is handed down, so every event on this page is judged against the
  // same instant rather than against a clock that moves down the list.
  const asOf = new Date();

  const [profiles, events, organizations, wardTimeZone] = await Promise.all([
    listActivityProfiles(user.wardId, supabase),
    // `includePast: false` — a calendar that opens on last season is a calendar nobody opens
    // twice, the same rule /youth follows. It is also what makes these the NARROW cache entries,
    // [.., false], which is the pair the component reads.
    listActivityEvents(user.wardId, { includePast: false, asOf }, supabase),
    listWardOrganizations(user.wardId, supabase),
    // Beside the clock and for the same reason: one value for the whole render, so no two cards
    // are printed or bucketed against different answers. ActivityCalendar's zone trap says why it
    // is the ward's zone rather than the reader's.
    readWardTimezone(user.wardId, supabase),
  ]);

  const attendeesByEvent = await listAttendeesForEvents(
    user.wardId,
    events.map((event) => event.id),
    supabase,
  );

  // ONLY FOR THE BISHOPRIC, because only they can use the control it feeds — copied from /youth
  // rather than re-derived. Everybody else gets an empty list and no picker: absent rather than
  // present-and-refusing.
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
        <h1 className="text-xl font-semibold text-foreground">Ward activity calendar</h1>
        <p className="mt-1 text-sm text-muted">
          Every organization&rsquo;s youth activities in one place, so a clash is visible before
          it happens and a home event nobody is going to is not.
        </p>
        <p className="mt-2 text-sm">
          <Link href="/youth" className="text-primary underline underline-offset-4">
            Back to the young people
          </Link>
        </p>
      </div>

      <ActivityCalendar
        initialProfiles={profiles}
        initialEvents={events}
        initialAttendees={Object.fromEntries(attendeesByEvent)}
        organizations={organizations.map((organization) => ({
          id: organization.id,
          label: organization.name,
        }))}
        asOf={asOf.toISOString()}
        currentUserId={user.id}
        canAssign={isBishopric}
        assignableUsers={assignableUsers}
        wardTimeZone={wardTimeZone}
      />
    </div>
  );
}
