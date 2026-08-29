import Link from "next/link";
import { ActivityProfileList } from "@/app/(app)/youth/ActivityProfileList";
import { EventList } from "@/app/(app)/youth/EventList";
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
import { listAttendeesForEvents } from "@/lib/youth/attendees";
import { listActivityEvents, listActivityProfiles } from "@/lib/youth/queries";

// Managing the activities themselves — the screen /youth was until youth-e, moved here unchanged.
//
// ---------------------------------------------------------------------------
// /youth/profiles RATHER THAN /youth/activities, BECAUSE SPEC.md ALREADY SAID SO
// ---------------------------------------------------------------------------
// SPEC.md's component tree has carried `/youth/page.tsx — Youth activity dashboard` and
// `/youth/profiles/page.tsx — Activity profiles` since before any of this was built. youth-a
// collapsed both onto /youth; this is the module arriving at the shape the spec described, which
// is what CLAUDE.md §1 asks for when code and spec disagree.
//
// There is no collision with `/api/youth/profiles` — different route trees.
//
// The page's HEADING is "Activities and schedule", not "Profiles". A leader does not read URLs,
// and "profile" is our word for it rather than theirs.
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
//
// FollowUpPanel does NOT come to this page. It lives on /youth now, and two copies would be two
// computations of one question — the drift describeHouseholdForVisits() exists to prevent.

export default async function YouthActivityProfilesPage() {
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

  const [profiles, events, organizations, homeVenues, crossOrgVisibility] = await Promise.all([
    listActivityProfiles(user.wardId, supabase),
    listActivityEvents(user.wardId, { asOf }, supabase),
    listWardOrganizations(user.wardId, supabase),
    readHomeVenues(user.wardId, supabase),
    readCrossOrgVisibility(user.wardId, supabase),
  ]);

  // AFTER the events, because it needs their ids — one query for the whole schedule rather than
  // one per card (lib/youth/attendees.ts). An empty list short-circuits without a round trip.
  const attendeesByEvent = await listAttendeesForEvents(
    user.wardId,
    events.map((event) => event.id),
    supabase,
  );

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
        <h1 className="text-xl font-semibold text-foreground">Activities and schedule</h1>
        <p className="mt-1 text-sm text-muted">
          The teams, choirs and clubs the ward&rsquo;s young people belong to, and what is coming
          up. Everybody here sees every organization&rsquo;s activities; you can change your own.
        </p>
        <p className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-sm">
          <Link href="/youth" className="text-primary underline underline-offset-4">
            Back to the young people
          </Link>
          {/* IN THE HEADING RATHER THAN BESIDE "Import a schedule", because that link sits inside
              the canManage branch and the calendar needs only `youth_activities.view`. A link
              offered to somebody the page would refuse is the same defect as a form that fails on
              submit, and so is one hidden from somebody it would admit. */}
          <Link href="/youth/calendar" className="text-primary underline underline-offset-4">
            Open the ward activity calendar
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
