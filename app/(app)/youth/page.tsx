import Link from "next/link";
import { YouthOverview } from "@/app/(app)/youth/YouthOverview";
import { NotPermitted } from "@/components/ui/NotPermitted";
import { displayName, listWardUsers } from "@/lib/auth/adminUsers";
import { BISHOPRIC_ROLES, can, resolveRoleAccess } from "@/lib/auth/permissions";
import { requireSessionUser } from "@/lib/auth/session";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { readCrossOrgVisibility } from "@/lib/ward/crossOrgVisibility";
import { readWardTimezone } from "@/lib/ward/wardTimezone";
import { listOwnLogsForEvents } from "@/lib/youth/activityLogs";
import { listAttendeesForEvents } from "@/lib/youth/attendees";
import { listActivityEvents, listActivityProfiles } from "@/lib/youth/queries";
import { listParticipationForEvents } from "@/lib/youth/rosterQueries";

// Youth activity support, at /youth — where lib/auth/navigation.ts has linked
// `youth_activities.view` holders since auth-a. THE FRONT DOOR DID NOT MOVE, so navigation.ts is
// unchanged and changing it would be wrong.
//
// ---------------------------------------------------------------------------
// THE YOUNG PERSON, NOT THE SCHEDULE
// ---------------------------------------------------------------------------
// This page was four jobs on one screen — activity profiles, the venue panel, the follow-up
// panel, the schedule and an add-event form — and none of them was organised around the unit the
// whole module exists to serve. Managing the activities themselves moved to /youth/profiles,
// which is where SPEC.md's component tree has said it belongs all along.
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

// searchParams is a Promise in Next 16, typed explicitly rather than with the generated PageProps
// helper — that only exists after a build (plans/retros/foundation-a-scaffold.md). The pattern is
// app/(app)/roster/page.tsx's.
export type YouthPageProps = { searchParams: Promise<{ youth?: string }> };

export default async function YouthActivitiesPage({ searchParams }: YouthPageProps) {
  const user = await requireSessionUser();
  const supabase = await createServerSupabaseClient();
  const roleAccess = await resolveRoleAccess(supabase, user.wardId);

  if (!can(user, "youth_activities.view", roleAccess)) {
    return (
      <NotPermitted detail="Youth activity support is limited to ward and organization leadership." />
    );
  }

  const canManage = can(user, "youth_activities.manage", roleAccess);
  const canLog = can(user, "youth_activities.log", roleAccess);
  const isBishopric = (BISHOPRIC_ROLES as readonly string[]).includes(user.role);

  // The clock enters ONCE and is handed down, so every event in this render is judged against the
  // same instant rather than against a fresh Date per query.
  const asOf = new Date();

  const [profiles, events, pastEvents, crossOrgVisibility, wardTimeZone] = await Promise.all([
    listActivityProfiles(user.wardId, supabase),
    listActivityEvents(user.wardId, { asOf }, supabase),
    // THE WIDENED LIST, for the follow-up panel AND for the pastoral ranking — "nobody has been
    // to one of Ethan's games all season" is a question about games already played. It is a
    // DIFFERENT cache entry from the upcoming-only one the expanded EventList opens on, and
    // seeding them separately is what stops one view rendering the other's rows (visits-c).
    listActivityEvents(user.wardId, { includePast: true, asOf }, supabase),
    readCrossOrgVisibility(user.wardId, supabase),
    // Beside the clock and for the same reason: one value for the whole render, so no two rows
    // are formatted against different answers. EventList.formatInstant says why it is the ward's
    // zone rather than the reader's.
    readWardTimezone(user.wardId, supabase),
  ]);

  // AFTER the events, because all three need their ids — one query for the whole schedule rather
  // than one per card (lib/youth/attendees.ts). An empty list short-circuits without a round trip.
  //
  // The follow-up map is the CALLER'S OWN, over the PAST events: migration 057 lets a leader read
  // other people's follow-ups, and the panel is about what this reader still owes.
  const [attendeesByEvent, pastAttendeesByEvent, ownLogsByEvent, participationByEvent] =
    await Promise.all([
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
      // THE WIDENED SET, matching the events and attendees beside it. The pastoral ranking reads
      // games already played, so the narrow list would leave every past absence unknown and every
      // marked game back in a denominator it had been taken out of.
      listParticipationForEvents(
        user.wardId,
        pastEvents.map((event) => event.id),
        supabase,
      ),
    ]);

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

  // RESOLVED HERE RATHER THAN WITH useSearchParams(), which would need a Suspense boundary around
  // the whole overview. Resolving it against the fetched profiles also means an id naming no
  // profile becomes `null` — a card that never opens is worse than no deep link at all.
  //
  // ---------------------------------------------------------------------------
  // `?youth=` STILL NAMES A PROFILE, AND A PROFILE IS NOW A TEAM WITH SEVERAL YOUNG PEOPLE
  // ---------------------------------------------------------------------------
  // The parameter is unchanged on purpose: /youth/calendar builds it from `row.event.profileId`,
  // which is still the only id an event carries, and changing the contract would break a link
  // that already works.
  //
  // WHAT CHANGED IS THAT THE ANSWER IS NO LONGER UNIQUE. A profile used to name exactly one young
  // person; it now names a roster, so this resolves to the FIRST member on it. That is a
  // deliberate, stated limitation rather than an oversight — the link means "show me this
  // activity", and one card must be chosen to open.
  //
  // THE HONEST FIX IS ON THE OTHER SIDE and belongs to whoever next touches the calendar: a card
  // there is one TEAM's game, so the link would have to name the young person it is about, which
  // that card does not currently single out either. Guessing harder here would not help.
  //
  // An id naming no profile, or one whose team has an empty roster, resolves to `null` — a card
  // that never opens is worse than no deep link at all.
  const params = await searchParams;
  const requestedProfileId = params.youth ?? null;
  const initialExpandedMemberId =
    requestedProfileId === null
      ? null
      : (profiles.find((profile) => profile.id === requestedProfileId)?.roster[0]?.memberId ??
        null);

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-xl font-semibold text-foreground">Youth activities</h1>
        <p className="mt-1 text-sm text-muted">
          The ward&rsquo;s young people and what is happening in their lives outside church.
          Everybody here sees every organization&rsquo;s activities; you can change your own.
        </p>
        {/* NOT ADDED TO lib/auth/navigation.ts, and checked rather than assumed: that file lists
            neither /visits/all-organizations nor /visits/feed, so putting three youth items in
            the sidebar would be a navigation decision this slice was not asked to take.

            THE FEED IS LAST. It was the second link on this page and it is a place to read what
            has already been written — a leader who has something to write finds it in the panel at
            the top of this page, or on a young person's own card. */}
        <p className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-sm">
          <Link href="/youth/calendar" className="text-primary underline underline-offset-4">
            Open the ward activity calendar
          </Link>
          <Link href="/youth/profiles" className="text-primary underline underline-offset-4">
            Activities and schedule
          </Link>
          <Link href="/youth/feed" className="text-primary underline underline-offset-4">
            Read the follow-up feed
          </Link>
        </p>
      </div>

      <YouthOverview
        initialProfiles={profiles}
        // The WIDENED seeds, [.., true] — read by the pastoral ranking and by FollowUpPanel.
        initialAllEvents={pastEvents}
        initialAllAttendees={Object.fromEntries(pastAttendeesByEvent)}
        // The NARROW seeds, [.., false] — handed through to the EventList inside an expanded card.
        // WHOLE rather than pre-filtered: the entry is shared with every other reader on the page.
        initialUpcomingEvents={events}
        initialUpcomingAttendees={Object.fromEntries(attendeesByEvent)}
        initialFollowUps={Object.fromEntries(ownLogsByEvent)}
        initialParticipation={Object.fromEntries(participationByEvent)}
        initialExpandedMemberId={initialExpandedMemberId}
        // The SAME instant every query above was judged against. Creating a second clock in the
        // client would let a row be listed as upcoming and then rendered as past.
        asOf={asOf.toISOString()}
        currentUserId={user.id}
        currentUserRole={user.role}
        currentUserOrgId={user.orgId}
        canManage={canManage}
        canLog={canLog}
        canAssign={isBishopric}
        assignableUsers={assignableUsers}
        wardTimeZone={wardTimeZone}
        crossOrgVisibility={crossOrgVisibility}
      />
    </div>
  );
}
