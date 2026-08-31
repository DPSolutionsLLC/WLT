import Link from "next/link";
import { notFound } from "next/navigation";
import {
  YouthHistory,
  type ClosedSeason,
} from "@/app/(app)/youth/history/[member_id]/YouthHistory";
import { NotPermitted } from "@/components/ui/NotPermitted";
import { can, resolveRoleAccess } from "@/lib/auth/permissions";
import { requireSessionUser } from "@/lib/auth/session";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { readWardTimezone } from "@/lib/ward/wardTimezone";
import { listAttendeesForEvents } from "@/lib/youth/attendees";
import { activitySupport, type SupportEvent } from "@/lib/youth/profileNeed";
import { listActivityEvents, listActivityProfiles } from "@/lib/youth/queries";

// One young person's finished seasons, at /youth/history/[member_id].
//
// ---------------------------------------------------------------------------
// WHAT THIS PAGE IS FOR
// ---------------------------------------------------------------------------
// Closing a season takes it out of the ranking on /youth (ITER-028). It must not take it out of
// the ward's memory — "how well was he supported last winter" is a question a new presidency asks
// about a season that is over, and the answer used to be unreachable because there was no way to
// end one at all. This is where a closed season goes, and the link to it renders on every /youth
// card that has one.
//
// ---------------------------------------------------------------------------
// EVERY NUMBER IS RECOMPUTED WITH `closed_at` AS THE CLOCK
// ---------------------------------------------------------------------------
// `activitySupport(profile, events, new Date(profile.closedAt))`. Nothing is stored, and that is
// ITER-028's one real design question answered the way this module has answered it every other
// time: a stored value the clock decides goes stale the moment nobody refreshes it, and NOTHING IN
// THIS PROJECT REFRESHES ANYTHING (CLAUDE.md §9 — no pg_cron, no edge functions, no crons). The
// number here is frozen because its INPUT is frozen, so reading the page a month later gives the
// same answer with no machinery at all.
//
// ---------------------------------------------------------------------------
// `can()` RATHER THAN `assertCan()`
// ---------------------------------------------------------------------------
// A ForbiddenError escaping a Server Component becomes a 500 whose message Next.js strips in
// production (plans/retros/auth-b-invites-admin.md), so every page under /youth uses this shape.
//
// THIS PAGE DOES NOT IMPORT lib/youth/privateNotes.ts, AND MUST NOT. A private note belongs to its
// author and appears in no list, ever (CLAUDE.md rule 5) — least of all in a history somebody else
// opens to read about a season.

// `params` is a Promise in Next 16, typed explicitly rather than with the generated PageProps
// helper — that only exists after a build (plans/retros/foundation-a-scaffold.md).
export type YouthHistoryPageProps = { params: Promise<{ member_id: string }> };

export default async function YouthHistoryPage({ params }: YouthHistoryPageProps) {
  const user = await requireSessionUser();
  const supabase = await createServerSupabaseClient();
  const roleAccess = await resolveRoleAccess(supabase, user.wardId);

  if (!can(user, "youth_activities.view", roleAccess)) {
    return (
      <NotPermitted detail="Youth activity support is limited to ward and organization leadership." />
    );
  }

  const { member_id: memberId } = await params;

  const [profiles, wardTimeZone] = await Promise.all([
    // READS ARE WARD-WIDE (migration 054d leaves the SELECT untouched), so this resolves every
    // organization's activities for this young person. Which of them a reader may CHANGE is a
    // different question and it is not asked on this page — nothing here writes.
    listActivityProfiles(user.wardId, supabase),
    readWardTimezone(user.wardId, supabase),
  ]);

  const theirProfiles = profiles.filter((profile) => profile.memberId === memberId);

  // A member id naming nobody with any activity at all reads as missing rather than as an empty
  // page: RLS and the ward filter make "another ward's youth" indistinguishable from "no such
  // youth", and "not found" is the honest answer to a caller who cannot know either way.
  if (theirProfiles.length === 0) notFound();

  const memberName = theirProfiles[0].memberName;

  // CLOSED SEASONS ONLY, most recently closed first — a history is read from the end.
  const closedProfiles = theirProfiles
    .filter((profile) => profile.closedAt !== null)
    .sort((left, right) => (left.closedAt! < right.closedAt! ? 1 : -1));

  // `includePast: true` ALWAYS. Every event on a finished season is in the past by definition, so
  // the upcoming-only default would render every season as empty — the failure mode that looks
  // exactly like a season nobody ever scheduled anything for.
  //
  // `asOf` is not passed and is not needed: `includePast` widens the query to everything, and each
  // season's arithmetic below is judged against its own `closedAt` rather than against now.
  //
  // ONE WARD-SCOPED QUERY, NARROWED IN TYPESCRIPT, which is what /youth does too. It is not the
  // roster-b defect: that one is a list narrowed one way beside a count answering a different
  // question, and here every number on the page is derived from this one filtered set. A
  // per-profile query would be one round trip per closed season for the same rows.
  const events =
    closedProfiles.length === 0
      ? []
      : (await listActivityEvents(user.wardId, { includePast: true }, supabase)).filter(
          (event) =>
            event.profileId !== null &&
            closedProfiles.some((profile) => profile.id === event.profileId),
        );

  // ONE QUERY FOR THE WHOLE SCREEN, keyed back by event (lib/youth/attendees.ts) — not one per
  // season and certainly not one per game.
  const attendeesByEvent = await listAttendeesForEvents(
    user.wardId,
    events.map((event) => event.id),
    supabase,
  );

  const seasons: ClosedSeason[] = closedProfiles.map((profile) => {
    const theirEvents = events
      .filter((event) => event.profileId === profile.id)
      .sort((left, right) => (left.eventDate < right.eventDate ? 1 : -1));

    const supportEvents: SupportEvent[] = theirEvents.map((event) => {
      const attendees = attendeesByEvent.get(event.id) ?? [];

      return {
        eventType: event.eventType,
        eventDate: event.eventDate,
        status: event.status,
        attendeeCount: attendees.length,
        // `=== true` EXPLICITLY. `confirmedAttendance` is `boolean | null` and null means NOBODY
        // HAS SAID EITHER WAY — a truthiness check would be correct today and would stop somebody
        // later reading null as "did not go", which it is not (YouthOverview says the same).
        confirmedAttendeeCount: attendees.filter(
          (attendee) => attendee.confirmedAttendance === true,
        ).length,
        // Migration 061, AND THIS IS WHERE ITER-028 AND ITER-030 MEET. The frozen number is
        // recomputed against `closedAt`, and carriesCoverageExpectation() now excludes absences
        // from that pass too — which is correct: the snapshot should say what was true at the
        // closing instant, absences included. They compose with no extra code.
        youthAttended: event.youthAttended,
      };
    });

    return {
      profileId: profile.id,
      activityName: profile.activityName,
      activityType: profile.activityType,
      schoolOrg: profile.schoolOrg,
      seasonSchedule: profile.seasonSchedule,
      // Non-null by the filter above; narrowed here rather than asserted at the call site so the
      // component's type carries the guarantee.
      closedAt: profile.closedAt as string,
      // THE CLOCK IS THE SEASON'S OWN CLOSING INSTANT. This is the whole design of the page: the
      // upcoming half of the metric resolves to nothing, and the history half counts exactly the
      // games that had been played when somebody said the season was over.
      support: activitySupport(profile, supportEvents, new Date(profile.closedAt as string)),
      events: theirEvents.map((event) => ({
        id: event.id,
        title: event.title,
        eventDate: event.eventDate,
        eventType: event.eventType,
        allDay: event.allDay,
      })),
    };
  });

  return (
    <div className="flex flex-col gap-6">
      <div>
        <Link href="/youth" className="text-sm text-primary underline underline-offset-4">
          Back to the ward&rsquo;s young people
        </Link>
        <h1 className="mt-2 text-xl font-semibold text-foreground">{memberName}</h1>
        <p className="mt-1 text-sm text-muted">
          Seasons that have been closed out, and how often somebody was there for them.
        </p>
      </div>

      <YouthHistory seasons={seasons} wardTimeZone={wardTimeZone} />
    </div>
  );
}
