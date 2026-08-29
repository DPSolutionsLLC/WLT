import Link from "next/link";
import { ActivityProfileList } from "@/app/(app)/youth/ActivityProfileList";
import { EventList } from "@/app/(app)/youth/EventList";
import { FollowUpPanel } from "@/app/(app)/youth/FollowUpPanel";
import { HomeVenuePanel } from "@/app/(app)/youth/HomeVenuePanel";
import { ManualEventForm } from "@/app/(app)/youth/ManualEventForm";
import { Card } from "@/components/ui/Card";
import { NotPermitted } from "@/components/ui/NotPermitted";
import { displayName, listWardOrganizations, listWardUsers } from "@/lib/auth/adminUsers";
import { BISHOPRIC_ROLES, can, resolveRoleAccess } from "@/lib/auth/permissions";
import { requireSessionUser } from "@/lib/auth/session";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { readCrossOrgVisibility } from "@/lib/ward/crossOrgVisibility";
import { readHomeVenues } from "@/lib/ward/homeVenues";
import { listOwnLogsForEvents } from "@/lib/youth/activityLogs";
import { listAttendeesForEvents } from "@/lib/youth/attendees";
import { listActivityEvents, listActivityProfiles } from "@/lib/youth/queries";

// Youth activity support, at /youth — where lib/auth/navigation.ts has linked
// `youth_activities.view` holders since auth-a, and where nothing has existed until now. Four
// roles have had a navigation item that 404s; this page is what makes that link honest. No change
// to navigation.ts is needed, and adding one would be wrong.
//
// ---------------------------------------------------------------------------
// THIS IS NOT app/(youth)/ — AND THE TWO ARE UNRELATED
// ---------------------------------------------------------------------------
// `app/(youth)/` already exists and is the SACRAMENT MANAGER'S PIN-ONLY SHELL: a different
// feature, for a different kind of account, reachable at /sacrament. This page lives at
// `app/(app)/youth/` inside the ordinary authenticated shell. The URLs do not collide, but the
// directory names read as though they should, and a future reader will assume a connection that
// is not there.
//
// ---------------------------------------------------------------------------
// READS ARE WARD-WIDE; WRITES ARE ORG-SCOPED
// ---------------------------------------------------------------------------
// Everybody with `youth_activities.view` sees EVERY activity in the ward, whichever organization
// owns it — FEATURES.md §Module 10 gives the ward council the full calendar, and seeing across
// the organizations is the entire reason the ward council exists. Which of those a person may
// CHANGE is decided by migration 054d, in the database, not by a filter here (CLAUDE.md rule 2).
//
// can() rather than assertCan(): a ForbiddenError escaping a Server Component becomes a 500 whose
// message Next.js strips in production (plans/retros/auth-b-invites-admin.md).
//
// THIS PAGE DOES NOT IMPORT lib/youth/privateNotes.ts, AND MUST NOT. That module now exists
// (slice D), which makes this a live rule rather than a note about the future. A private note
// belongs to its author and appears in no list, ever — it is fetched by FollowUpForm from its own
// endpoint, one note at a time, and only ever the caller's own (CLAUDE.md rule 5).

export default async function YouthActivitiesPage() {
  const user = await requireSessionUser();
  const supabase = await createServerSupabaseClient();
  const roleAccess = await resolveRoleAccess(supabase, user.wardId);

  if (!can(user, "youth_activities.view", roleAccess)) {
    return (
      <NotPermitted detail="Youth activity support is limited to ward and organization leadership." />
    );
  }

  const canManage = can(user, "youth_activities.manage", roleAccess);
  const isBishopric = (BISHOPRIC_ROLES as readonly string[]).includes(user.role);

  // The clock enters ONCE and is handed down, so every event in this render is judged against the
  // same instant rather than against a fresh Date per query.
  const asOf = new Date();

  const canLog = can(user, "youth_activities.log", roleAccess);

  const [profiles, events, pastEvents, organizations, homeVenues, crossOrgVisibility] =
    await Promise.all([
      listActivityProfiles(user.wardId, supabase),
      listActivityEvents(user.wardId, { asOf }, supabase),
      // THE WIDENED LIST, for the follow-up panel. A follow-up is only ever due on an event that
      // has already happened, so the panel reads the `includePast` view — which is a DIFFERENT
      // cache entry from the upcoming-only one EventList opens on, and seeding them separately is
      // what stops one view rendering the other's rows (visits-c).
      listActivityEvents(user.wardId, { includePast: true, asOf }, supabase),
      listWardOrganizations(user.wardId, supabase),
      readHomeVenues(user.wardId, supabase),
      readCrossOrgVisibility(user.wardId, supabase),
    ]);

  // AFTER the events, because both need their ids — one query for the whole schedule rather than
  // one per card (lib/youth/attendees.ts). An empty list short-circuits without a round trip.
  //
  // The follow-up map is the CALLER'S OWN, over the PAST events: migration 057 lets a leader read
  // other people's follow-ups, and the panel is about what this reader still owes.
  const [attendeesByEvent, pastAttendeesByEvent, ownLogsByEvent] = await Promise.all([
    listAttendeesForEvents(
      user.wardId,
      events.map((event) => event.id),
      supabase,
    ),
    listAttendeesForEvents(
      user.wardId,
      pastEvents.map((event) => event.id),
      supabase,
    ),
    listOwnLogsForEvents(
      user.wardId,
      user.id,
      pastEvents.map((event) => event.id),
      supabase,
    ),
  ]);

  const organizationOptions = organizations.map((organization) => ({
    id: organization.id,
    label: organization.name,
  }));

  // ONLY FOR THE BISHOPRIC, because only they can use the control it feeds. Everybody else gets
  // an empty list and no picker — absent rather than present-and-refusing.
  //
  // Mapped down to { id, label } HERE, so the email and role listWardUsers returns never cross
  // into a client component. An attendee list is a display of who is going; every other column on
  // `users` has its own read path and its own permission behind it.
  const assignableUsers = isBishopric
    ? (await listWardUsers(user.wardId, supabase))
        .filter((wardUser) => wardUser.isActive)
        .map((wardUser) => ({ id: wardUser.id, label: displayName(wardUser) }))
    : [];

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-xl font-semibold text-foreground">Youth activities</h1>
        <p className="mt-1 text-sm text-muted">
          The teams, choirs and clubs the ward&rsquo;s young people belong to, and what is coming
          up. Everybody here sees every organization&rsquo;s activities; you can change your
          own.
        </p>
        {/* IN THE HEADING RATHER THAN BESIDE "Import a schedule", because that link sits inside
            the canManage branch and the calendar needs only `youth_activities.view`. A link
            offered to somebody the page would refuse is the same defect as a form that fails on
            submit, and so is one hidden from somebody it would admit.

            NOT ADDED TO lib/auth/navigation.ts. /visits/all-organizations is reached the same
            way, and putting a second youth item in the sidebar for four roles is a navigation
            decision this slice was not asked to take. */}
        <p className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-sm">
          <Link
            href="/youth/calendar"
            className="text-primary underline underline-offset-4"
          >
            Open the ward activity calendar
          </Link>
          {/* NOT ADDED TO lib/auth/navigation.ts, for the reason recorded above and checked
              rather than assumed: that file does not list /visits/feed either, so a youth feed
              item in the sidebar would be a navigation decision this slice was not asked to
              take. */}
          <Link href="/youth/feed" className="text-primary underline underline-offset-4">
            Read the follow-up feed
          </Link>
        </p>
      </div>

      <ActivityProfileList
        initialProfiles={profiles}
        user={user}
        canManage={canManage}
        organizations={organizationOptions}
        // Only the bishopric is asked which organization. Everybody else has theirs stamped from
        // the session by the route, so a control would be offering a decision that is not theirs.
        canChooseOrganization={isBishopric}
      />

      {/* Both of these take `profiles` to SEED a shared client query rather than as a standing
          answer. A Server Component prop never refetches, so passing derived lists straight into
          them left the event form and the schedule stale after any activity change — that was
          defect youth-a-D2. app/(app)/youth/youthQueries.ts owns the key they share. */}
      {/* BISHOPRIC ONLY, and ABSENT for everybody else rather than present-and-refusing. The
          route enforces the same rule again; this is the half that stops a leader being invited
          through a locked door (youth-a-D1, visits-d). */}
      {isBishopric ? <HomeVenuePanel initialVenues={homeVenues} /> : null}

      {/* ABOVE the schedule, because it is the one thing on this page that is waiting on the
          reader personally — everything below it is a list to browse. youth-c found a banner that
          was correct and unfindable; the fix there was to NAME the events rather than count them,
          and this panel is built that way from the start. */}
      <FollowUpPanel
        initialFollowUps={Object.fromEntries(ownLogsByEvent)}
        initialPastEvents={pastEvents}
        initialPastAttendees={Object.fromEntries(pastAttendeesByEvent)}
        profiles={profiles}
        currentUserId={user.id}
        currentUserRole={user.role}
        currentUserOrgId={user.orgId}
        // The SAME instant every query above was judged against.
        asOf={asOf.toISOString()}
        canLog={canLog}
        crossOrgVisibility={crossOrgVisibility}
      />

      <EventList
        initialEvents={events}
        initialProfiles={profiles}
        initialAttendees={Object.fromEntries(attendeesByEvent)}
        // Empty by construction on first paint: the server rendered the UPCOMING view, where a
        // follow-up is never due. It seeds the shared query so the widened view fills in from one
        // fetch rather than from a prop that never refetches (youth-a-D2).
        initialFollowUps={{}}
        canManage={canManage}
        canLog={canLog}
        crossOrgVisibility={crossOrgVisibility}
        // The SAME instant every query above was judged against. Creating a second clock here
        // would let a row be listed as upcoming and then rendered as past.
        asOf={asOf.toISOString()}
        currentUserId={user.id}
        currentUserRole={user.role}
        currentUserOrgId={user.orgId}
        canAssign={isBishopric}
        assignableUsers={assignableUsers}
      />

      {canManage ? (
        <div className="flex flex-col gap-3">
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <h2 className="text-base font-semibold text-foreground">Add an event</h2>
            {/* Inside the existing canManage branch, because importing writes events and
                `youth_activities.manage` is what the route requires. A link offered to somebody
                the API would refuse is the same defect as a form that fails on submit. */}
            <Link
              href="/youth/import"
              className="text-sm text-primary underline underline-offset-4"
            >
              Import a schedule
            </Link>
          </div>
          <ManualEventForm initialProfiles={profiles} />
        </div>
      ) : (
        // ABSENT rather than present-and-refusing, with a sentence saying why. An org secretary
        // holds `youth_activities.view` and `.log` but not `.manage`, and a form that fails on
        // submit is worse than no form (ITER-007).
        <Card>
          <p className="text-sm text-muted">
            You can read the ward&rsquo;s youth activities. Adding or changing one is done by an
            organization presidency or the bishopric.
          </p>
        </Card>
      )}
    </div>
  );
}
