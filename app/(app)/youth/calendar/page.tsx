import Link from "next/link";
import {
  ActivityCalendar,
  type CalendarEvent,
} from "@/app/(app)/youth/calendar/ActivityCalendar";
import { NotPermitted } from "@/components/ui/NotPermitted";
import { listWardOrganizations } from "@/lib/auth/adminUsers";
import { can, resolveRoleAccess } from "@/lib/auth/permissions";
import { requireSessionUser } from "@/lib/auth/session";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { listAttendeesForEvents } from "@/lib/youth/attendees";
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
// COVERAGE IS COMPUTED IN THE CLIENT, from props handed down here, against ONE `asOf` resolved
// once on this line. The count strip and the badges beneath it therefore come from one
// computation over one list — see ActivityCalendar's header on why the filters are client-side.
//
// THIS PAGE DOES NOT IMPORT lib/youth/privateNotes OR ANYTHING THAT READS
// `activity_private_notes` — no such module exists yet, and slice D must not make this page the
// first. A private note belongs to its author and appears in no list, ever (CLAUDE.md rule 5).

export default async function YouthCalendarPage() {
  const user = await requireSessionUser();
  const supabase = await createServerSupabaseClient();
  const roleAccess = await resolveRoleAccess(supabase, user.wardId);

  if (!can(user, "youth_activities.view", roleAccess)) {
    return (
      <NotPermitted detail="The youth activity calendar is limited to ward and organization leadership." />
    );
  }

  // The clock enters ONCE and is handed down, so every event on this page is judged against the
  // same instant rather than against a clock that moves down the list.
  const asOf = new Date();

  const [profiles, events, organizations] = await Promise.all([
    listActivityProfiles(user.wardId, supabase),
    // `includePast: false` — a calendar that opens on last season is a calendar nobody opens
    // twice, the same rule /youth follows.
    listActivityEvents(user.wardId, { includePast: false, asOf }, supabase),
    listWardOrganizations(user.wardId, supabase),
  ]);

  const attendeesByEvent = await listAttendeesForEvents(
    user.wardId,
    events.map((event) => event.id),
    supabase,
  );

  const profilesById = new Map(profiles.map((profile) => [profile.id, profile]));

  const calendarEvents: CalendarEvent[] = events.map((event) => {
    const profile = event.profileId === null ? undefined : profilesById.get(event.profileId);
    const attendees = attendeesByEvent.get(event.id) ?? [];

    return {
      id: event.id,
      title: event.title,
      eventType: event.eventType,
      eventDate: event.eventDate,
      location: event.location,
      allDay: event.allDay,
      status: event.status,
      profileId: event.profileId,
      memberName: profile?.memberName ?? null,
      activityName: profile?.activityName ?? null,
      activityType: profile?.activityType ?? null,
      // An event inherits its organization THROUGH ITS PROFILE — `activity_events` has no org_id
      // and migration 054d says why: a second copy of the answer could disagree with the first.
      orgId: profile?.orgId ?? null,
      // ONLY THE NAMES cross to the client. Not user ids, not emails — this page shows no
      // attendance controls, so it needs nothing to address a request with.
      attendeeNames: attendees.map((attendee) => attendee.displayName),
      attendeeCount: attendees.length,
    };
  });

  const youthOptions = profiles.map((profile) => ({
    id: profile.id,
    // The youth AND the activity, because two young people on the same team would otherwise give
    // two identical options — the same label ManualEventForm builds.
    label: `${profile.memberName} — ${profile.activityName}`,
  }));

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
            Back to youth activities
          </Link>
        </p>
      </div>

      <ActivityCalendar
        events={calendarEvents}
        organizations={organizations.map((organization) => ({
          id: organization.id,
          label: organization.name,
        }))}
        youth={youthOptions}
        asOf={asOf.toISOString()}
      />
    </div>
  );
}
