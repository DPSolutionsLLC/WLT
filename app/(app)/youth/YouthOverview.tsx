"use client";

import { useCallback, useMemo, useState } from "react";
import Link from "next/link";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { AddToActivity } from "@/app/(app)/youth/AddToActivity";
import { EventList } from "@/app/(app)/youth/EventList";
import { FollowUpPanel } from "@/app/(app)/youth/FollowUpPanel";
import {
  ROSTER_MUTATION_INVALIDATES,
  YOUTH_ATTENDEES_QUERY_KEY,
  YOUTH_EVENTS_QUERY_KEY,
  YOUTH_PARTICIPATION_QUERY_KEY,
  YOUTH_PROFILES_QUERY_KEY,
  errorFrom,
  fetchAttendees,
  fetchEvents,
  fetchParticipation,
  fetchProfiles,
  readJson,
} from "@/app/(app)/youth/youthQueries";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { FormError } from "@/components/ui/FormError";
import { Input } from "@/components/ui/Input";
import { CoverageBadge } from "@/components/youth/CoverageBadge";
import type { ActivityAttendee } from "@/lib/youth/attendees";
import {
  YOUTH_SORTS,
  YOUTH_SORT_DIRECTION_LABELS,
  YOUTH_SORT_LABELS,
  buildSupportEvents,
  compareYouth,
  describeActivitySupport,
  describeNothingRunning,
  youthNeed,
  type ActivitySupport,
  type SupportEvent,
  type YouthSort,
} from "@/lib/youth/profileNeed";
import type { ActivityEvent, ActivityLog, ActivityProfile } from "@/lib/youth/queries";
import type { EventParticipation, RosterMember } from "@/lib/youth/roster";
import type { SessionUser } from "@/types/domain";

// The front door of the module: every young person, ranked by how well they are being supported,
// each card opening in place.
//
// ---------------------------------------------------------------------------
// A CARD IS A YOUNG PERSON, NOT A YOUNG PERSON AND ONE ACTIVITY
// ---------------------------------------------------------------------------
// `youth_activity_profiles` holds one row per (member, activity) with NO uniqueness on the
// member, so Ethan doing basketball and track is two rows — and this page rendered him as two
// cards until 2026-08-29. Walking scenario 057 did not catch it because every young person in
// that seed had exactly one activity.
//
// So the rows are GROUPED BY MEMBER here, and an activity is a pill on the card. Everything the
// card renders comes out of one `youthNeed()` per person: the pills, the badge, the count and the
// sort. A card that sorts first because of a number it does not display is ITER-022, and the walk
// on 2026-08-29 found its second instance on this very screen — a literal zero passed to
// CoverageBadge made every covered card read "Covered · 0" above an event card reading
// "Covered · 1".
//
// ---------------------------------------------------------------------------
// THE WIDENED CACHE ENTRIES, DELIBERATELY
// ---------------------------------------------------------------------------
// The support percentage is a question about games ALREADY PLAYED, so this component reads
// `[YOUTH_EVENTS_QUERY_KEY, true]` and `[YOUTH_ATTENDEES_QUERY_KEY, true]` — the same entries
// FollowUpPanel reads, and the attendee one is where `confirmedAttendance` comes from. The
// EventList inside an expanded card opens on the NARROW entries (`, false`), which are seeded
// separately by the server. Every view is its own cache key: visits-c found a row made under one
// filter invisible under another until a reload, because two views shared one entry.
//
// THAT IS ALSO WHAT MAKES A PILL MOVE WHEN A FOLLOW-UP IS SAVED. FOLLOW_UP_MUTATION_INVALIDATES
// includes the attendees key, so confirming attendance refetches the entry this percentage is
// derived from. If a pill ever fails to move, the derivation has started reading a prop rather
// than the query — which is defect youth-a-D2 exactly.
//
// ---------------------------------------------------------------------------
// SEARCH AND SORT ARE CLIENT-SIDE OVER THE LOADED LIST
// ---------------------------------------------------------------------------
// No query parameter is added to `GET /api/youth/events`. A filter the route's schema does not
// carry is silently ignored with no error (roster-b), which produces a page that looks filtered
// and is not — and a list narrowed one way beside a count answering a different question is the
// same defect from the other side.
//
// ---------------------------------------------------------------------------
// EVERY PERMISSION ARRIVES RESOLVED. THIS COMPONENT DERIVES NONE.
// ---------------------------------------------------------------------------
// AttendeeControls' header states the rule and youth-a-D1 is why: a client component has no role
// access to resolve against, and a second answer that disagreed with the route's would be a UI
// offering a control the API refuses.

export type YouthOverviewProps = {
  // Seeds [YOUTH_PROFILES_QUERY_KEY] — the same entry EventList and FollowUpPanel read.
  initialProfiles: ActivityProfile[];
  // Seed the WIDENED entries, [.., true]. The support percentage needs past games, and it needs
  // `confirmedAttendance` on the attendee rows of those games.
  initialAllEvents: ActivityEvent[];
  initialAllAttendees: Record<string, ActivityAttendee[]>;
  // Handed straight through to EventList, which seeds the NARROW entries, [.., false]. WHOLE, not
  // pre-filtered: the seed is shared with every other reader on this page, and narrowing it would
  // leave FollowUpPanel rendering one young person's events and calling it the ward's.
  initialUpcomingEvents: ActivityEvent[];
  initialUpcomingAttendees: Record<string, ActivityAttendee[]>;
  initialFollowUps: Record<string, ActivityLog>;
  // Seeds the SHARED participation query, keyed by event id. An event nobody has answered for is
  // simply ABSENT — migration 062d's third state arriving as a missing key rather than as a null
  // somebody has to remember to read correctly. The WIDENED entry, [.., true], matching the event
  // and attendee seeds beside it.
  initialParticipation: Record<string, EventParticipation[]>;
  // From ?youth= on the URL, which names a PROFILE, resolved to the member who owns it on the
  // SERVER — a card is a person now, so a profile id can no longer address one. Null when the
  // parameter is absent or names a profile that is not there: a card that never opens is worse
  // than no deep link.
  initialExpandedMemberId: string | null;
  // ONE INSTANT for the whole render, resolved on the server. An ISO string because a Date does
  // not survive the server-to-client boundary as itself.
  asOf: string;
  currentUserId: string;
  currentUserRole: SessionUser["role"];
  currentUserOrgId: string | null;
  canManage: boolean;
  canLog: boolean;
  canAssign: boolean;
  assignableUsers: { id: string; label: string }[];
  crossOrgVisibility: boolean;
  // Handed straight through to EventList, which formats every event time with it. Resolved once
  // on the server: a client component is server-rendered before it is hydrated, so "the reader's
  // zone" is the server's zone on first paint. EventList.formatInstant carries the full reasoning.
  wardTimeZone: string;
};

const WIDENED = true;

const SELECT_CLASSES =
  "min-h-11 rounded-md border border-border bg-surface-raised px-3 py-2 text-base " +
  "text-foreground focus-visible:outline-2 focus-visible:outline-offset-2 " +
  "focus-visible:outline-primary";

const PILL_CLASSES =
  "rounded-full border border-border px-2 py-0.5 text-xs font-medium text-muted";

// A FINISHED SEASON'S PILL. Same shape and same place as a running one — only the border is dashed
// and the trailing value is a word rather than a percentage. Tailwind scans source text for
// COMPLETE class strings, so this is a second literal rather than an interpolation onto
// PILL_CLASSES (ActivityProfileList's TONE_CLASSES records the same trap).
const CLOSED_PILL_CLASSES =
  "rounded-full border border-dashed border-border px-2 py-0.5 text-xs font-medium text-muted";

// Case- and whitespace-insensitive, because a leader typing on a phone types "ethan brooks" and
// sometimes "ethan  brooks".
function normalise(value: string): string {
  return value.toLowerCase().replace(/\s+/g, " ").trim();
}

function upcomingCount(count: number): string {
  return count === 1 ? "1 event coming up" : `${count} events coming up`;
}

function youthCount(count: number): string {
  // YOUNG PEOPLE, NOT ACTIVITIES, now that a card is a person. The old sentence counted rows and
  // the rows changed underneath it — a count beside a list answering a different question is the
  // ITER-022 defect whichever half moved.
  return count === 1 ? "1 young person" : `${count} young people`;
}

// THE PILL'S TEXT, AND THE ONE PLACE AN EM DASH IS DECIDED.
//
// NEVER "0%" FOR A YOUNG PERSON WITH NOTHING TO COUNT. 0% is a judgement, and there is nothing
// here to judge: no home game has been played and none is coming up, so nobody could have turned
// up to one and nobody can be asked to. It would also sort them straight to the top of "least
// supported" if the null ever leaked into the arithmetic — visits-f's defect, and the single most
// likely bug in this slice.
//
// A GENUINE ZERO IS A DIFFERENT THING and does render as "0%": a next game with nobody down for it
// is the one number on this page a leader can move today.
function supportPill(support: ActivitySupport): string {
  if (support.supportedFraction === null) return `${support.activityName} · —`;

  return `${support.activityName} · ${Math.round(support.supportedFraction * 100)}%`;
}

// THE TOOLTIP IS THE COUNTS, NOT THE PERCENTAGE AGAIN. At small N a percentage misleads — one
// game of two is 50% and says almost nothing — so the auditable form sits behind the pill and a
// leader can check the number rather than trust it. Both come from the same ActivitySupport, so
// they cannot disagree.
//
// The fallback names BOTH halves being empty, because after the horizon change "nothing played" is
// no longer the whole reason a pill is blank — an activity with a game coming up has a number even
// before its season starts.
function supportTitle(support: ActivitySupport): string {
  return (
    describeActivitySupport(support) ?? "No home games played yet, and none coming up."
  );
}

export function YouthOverview({
  initialProfiles,
  initialAllEvents,
  initialAllAttendees,
  initialUpcomingEvents,
  initialUpcomingAttendees,
  initialFollowUps,
  initialParticipation,
  initialExpandedMemberId,
  asOf,
  currentUserId,
  currentUserRole,
  currentUserOrgId,
  canManage,
  canLog,
  canAssign,
  assignableUsers,
  crossOrgVisibility,
  wardTimeZone,
}: YouthOverviewProps) {
  // Parsed ONCE, outside the row loop, for the reason the server resolved it once: a `new Date()`
  // per row would judge the bottom of a long list against a later instant than the top
  // (lib/youth/profileNeed.ts).
  const asOfInstant = useMemo(() => new Date(asOf), [asOf]);

  const [search, setSearch] = useState("");
  const [sort, setSort] = useState<YouthSort>("priority");
  // ASCENDING MEANS "LEAST SUPPORTED FIRST" under priority and "A to Z" under name — the toggle
  // renders the words rather than the direction, because "ascending" says nothing at all about a
  // percentage (YOUTH_SORT_DIRECTION_LABELS).
  const [ascending, setAscending] = useState(true);

  // ONE CARD OPEN AT A TIME, which is this module's existing idiom — FollowUpPanel's `openEventId`
  // and EventList's `followingUp`. It also keeps exactly ONE EventList mounted, so there is one
  // seeder of the narrow cache entries rather than one per card.
  const [expandedMemberId, setExpandedMemberId] = useState<string | null>(
    initialExpandedMemberId,
  );

  const [rosterError, setRosterError] = useState<string | undefined>(undefined);
  const queryClient = useQueryClient();

  const profilesQuery = useQuery({
    queryKey: [YOUTH_PROFILES_QUERY_KEY],
    queryFn: fetchProfiles,
    initialData: initialProfiles,
  });

  const eventsQuery = useQuery({
    queryKey: [YOUTH_EVENTS_QUERY_KEY, WIDENED],
    queryFn: () => fetchEvents(WIDENED),
    initialData: initialAllEvents,
  });

  const attendeesQuery = useQuery({
    queryKey: [YOUTH_ATTENDEES_QUERY_KEY, WIDENED],
    queryFn: () => fetchAttendees(WIDENED),
    initialData: initialAllAttendees,
  });

  const participationQuery = useQuery({
    queryKey: [YOUTH_PARTICIPATION_QUERY_KEY, WIDENED],
    queryFn: () => fetchParticipation(WIDENED),
    initialData: initialParticipation,
  });

  // PUTTING A YOUNG PERSON ON A TEAM, from their own card. One route, two entry points — the
  // team-first half is RosterPanel on /youth/profiles, and POST
  // /api/youth/profiles/[id]/roster's header says why they must not be two implementations.
  const rosterMutation = useMutation({
    mutationFn: async ({ profileId, memberId }: { profileId: string; memberId: string }) => {
      const response = await fetch(`/api/youth/profiles/${profileId}/roster`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ memberId }),
      });

      const payload = await readJson(response);
      if (!response.ok) {
        throw new Error(errorFrom(payload, "Could not add them to that activity."));
      }
    },
    onSuccess: async () => {
      setRosterError(undefined);
      await Promise.all(
        ROSTER_MUTATION_INVALIDATES.map((queryKey) =>
          queryClient.invalidateQueries({ queryKey: [...queryKey] }),
        ),
      );
    },
    onError: (error: Error) => setRosterError(error.message),
  });

  // ONE PASS, THEN EVERY RENDERING READS IT. The sort, the pills, the badge and the count all come
  // from this single array, so a card cannot sort first because of a number it does not display —
  // which is what ITER-022 was, and what summariseCoverage() and describeHouseholdForVisits() both
  // exist to prevent.
  //
  // The `?? []` fallbacks live INSIDE the callback rather than above it. A `??` in the dependency
  // list allocates a fresh empty array on every render, which would defeat the memo entirely.
  const rows = useMemo(() => {
    const profiles = profilesQuery.data ?? [];
    const events = eventsQuery.data ?? [];
    const attendeesByEvent = attendeesQuery.data ?? {};
    const participationByEvent = participationQuery.data ?? {};

    // ---------------------------------------------------------------------------
    // THE RAW ROWS, KEYED BY EVENT — NOT YET `SupportEvent`s
    // ---------------------------------------------------------------------------
    // This is the change youth-j turns on. It used to build one `SupportEvent[]` per PROFILE, and
    // that was correct only while a profile was one young person's copy of a team: two players on
    // one team would now share the map and get identical numbers, which is precisely the
    // duplication this slice removes.
    //
    // So the raw material is grouped by profile and the SupportEvents are built PER MEMBERSHIP
    // below, through buildSupportEvents(), which applies each young person's own window.
    const eventsByProfile = new Map<string, typeof events>();
    for (const event of events) {
      if (event.profileId === null) continue;

      const existing = eventsByProfile.get(event.profileId);
      if (existing === undefined) eventsByProfile.set(event.profileId, [event]);
      else existing.push(event);
    }

    // Maps rather than records, because buildSupportEvents takes ReadonlyMaps — one conversion
    // here rather than one per membership inside the loop.
    const attendeeMap = new Map(Object.entries(attendeesByEvent));
    const participationMap = new Map(Object.entries(participationByEvent));

    // ---------------------------------------------------------------------------
    // GROUPED BY **MEMBERSHIP**, NOT BY THE PROFILE'S OWN MEMBER
    // ---------------------------------------------------------------------------
    // `profile.memberId` is gone; a team has a ROSTER, and one young person appears once per team
    // they are on. Everything else about this grouping survives, including the rule below.
    //
    // BUILT FROM **EVERY** PROFILE, CLOSED ONES INCLUDED — THIS IS THE ONE LINE ITER-028 TURNS ON.
    // Filter closed profiles out here and a young person whose every season has finished produces
    // no group at all and VANISHES FROM THE WARD, which is exactly what ITER-028 says must not
    // happen. youthNeed() does the running/closed partition instead, so the pills, the percentage,
    // the badge, the sort AND the finished-season pills all come out of one value.
    const byMember = new Map<
      string,
      {
        name: string;
        entries: { membership: RosterMember; activityName: string; closedAt: string | null }[];
      }
    >();

    for (const profile of profiles) {
      for (const membership of profile.roster) {
        const entry = {
          membership,
          activityName: profile.activityName,
          closedAt: profile.closedAt,
        };

        const existing = byMember.get(membership.memberId);
        if (existing === undefined) {
          byMember.set(membership.memberId, {
            name: membership.memberName,
            entries: [entry],
          });
        } else {
          existing.entries.push(entry);
        }
      }
    }

    return [...byMember.entries()].map(([memberId, group]) => {
      // ONE MAP PER YOUNG PERSON, built through their own window. Two team-mates hand youthNeed()
      // two different maps drawn from ONE set of event rows, which is the whole point of the
      // slice — and youthNeed()'s header says a shared map would silently undo it.
      const supportByProfile = new Map<string, SupportEvent[]>();

      for (const entry of group.entries) {
        supportByProfile.set(
          entry.membership.profileId,
          buildSupportEvents(
            entry.membership,
            entry.closedAt,
            eventsByProfile.get(entry.membership.profileId) ?? [],
            attendeeMap,
            participationMap,
            wardTimeZone,
          ),
        );
      }

      return {
        need: youthNeed(
          { id: memberId, name: group.name },
          group.entries,
          supportByProfile,
          asOfInstant,
        ),
        // THE PROFILE IDS THE EXPANDED CARD FILTERS ON, off the same grouping the pills came from.
        // A card showing "1 of 8" must expand to a list where eight home games are findable
        // (ITER-022, the count-and-list rule).
        //
        // ALL OF THEM, INCLUDING CLOSED SEASONS. The RANKING excludes a closed season; the
        // SCHEDULE is a record of what happened and must not develop a hole.
        profileIds: group.entries.map((entry) => entry.membership.profileId),
        // The member's name AND every activity name, so searching "choir" still finds Maya.
        searchText: normalise(
          [group.name, ...group.entries.map((entry) => entry.activityName)].join(" "),
        ),
      };
    });
  }, [
    profilesQuery.data,
    eventsQuery.data,
    attendeesQuery.data,
    participationQuery.data,
    asOfInstant,
    wardTimeZone,
  ]);

  // WHICH TEAMS THIS YOUNG PERSON IS NOT ALREADY ON. Computed from the SHARED profiles cache, so
  // a team created in another tab reaches this picker too, and recomputed after every roster
  // mutation because ROSTER_MUTATION_INVALIDATES moves that entry.
  //
  // Offering a team they are already on would be a control whose only outcome is the route's 409.
  // The route still answers one — the boundary is the route and not this list (CLAUDE.md rule 2).
  const availableFor = useCallback(
    (memberId: string): ActivityProfile[] =>
      (profilesQuery.data ?? []).filter(
        (profile) => !profile.roster.some((member) => member.memberId === memberId),
      ),
    [profilesQuery.data],
  );

  const visibleRows = useMemo(() => {
    const term = normalise(search);

    const matched =
      term === "" ? [...rows] : rows.filter((row) => row.searchText.includes(term));

    return matched.sort((left, right) =>
      compareYouth(sort, ascending, left.need, right.need),
    );
  }, [rows, search, sort, ascending]);

  const errorMessage =
    rosterError ??
    (profilesQuery.isError
      ? (profilesQuery.error as Error).message
      : eventsQuery.isError
        ? (eventsQuery.error as Error).message
        : attendeesQuery.isError
          ? (attendeesQuery.error as Error).message
          : participationQuery.isError
            ? (participationQuery.error as Error).message
            : undefined);

  return (
    <div className="flex flex-col gap-6">
      {/* AT THE TOP, because it is the one thing on this page waiting on the reader personally —
          everything below it is a list to browse. Moved here from the old /youth unchanged; it is
          also the component ITER-026's leader page must reuse rather than re-derive. */}
      <FollowUpPanel
        initialFollowUps={initialFollowUps}
        initialPastEvents={initialAllEvents}
        initialPastAttendees={initialAllAttendees}
        profiles={initialProfiles}
        currentUserId={currentUserId}
        currentUserRole={currentUserRole}
        currentUserOrgId={currentUserOrgId}
        asOf={asOf}
        canLog={canLog}
        crossOrgVisibility={crossOrgVisibility}
      />

      <div className="flex flex-col gap-3">
        <h2 className="text-base font-semibold text-foreground">The ward&rsquo;s young people</h2>

        <FormError message={errorMessage} />

        <div className="grid gap-3 sm:grid-cols-2">
          <Input
            id="youth-search"
            label="Find a young person"
            type="search"
            placeholder="Name or activity"
            value={search}
            onChange={(input) => setSearch(input.target.value)}
          />

          {/* A LABELLED SELECT, following VisitProgressTable — the shape that survives 375px,
              where a row of sort buttons does not.

              THE DIRECTION BESIDE IT IS A BUTTON, NOT A SECOND SELECT. It has exactly two states,
              and a select for two states is a control asking a question it could answer. It names
              the CURRENT order in a leader's words rather than saying "ascending", which says
              nothing at all about a percentage. */}
          <div className="flex flex-col gap-1.5">
            <label htmlFor="youth-sort" className="text-sm font-medium text-foreground">
              Sort by
            </label>
            <div className="flex flex-wrap items-center gap-2">
              <select
                id="youth-sort"
                className={SELECT_CLASSES}
                value={sort}
                onChange={(input) => setSort(input.target.value as YouthSort)}
              >
                {YOUTH_SORTS.map((option) => (
                  <option key={option} value={option}>
                    {YOUTH_SORT_LABELS[option]}
                  </option>
                ))}
              </select>
              <Button variant="secondary" onClick={() => setAscending((current) => !current)}>
                {YOUTH_SORT_DIRECTION_LABELS[sort][ascending ? "asc" : "desc"]}
              </Button>
            </div>
          </div>
        </div>

        {/* THE COUNT DESCRIBES THE LIST BENEATH IT — one computation, two renderings. */}
        <p className="text-sm text-muted">{youthCount(visibleRows.length)} shown.</p>

        {visibleRows.length === 0 ? (
          <Card>
            {/* TWO DIFFERENT SENTENCES, because they are two different situations and only one of
                them is something the reader can fix here. An empty state that renders nothing
                reads as something that failed to load (youth-c). */}
            <p className="text-sm text-muted">
              {rows.length === 0
                ? "No activities have been entered for this ward yet."
                : "Nothing matches that search. Clear it to see everybody again."}
            </p>
            {rows.length === 0 && canManage ? (
              <p className="mt-2 text-sm">
                <Link
                  href="/youth/profiles"
                  className="text-primary underline underline-offset-4"
                >
                  Add an activity
                </Link>
              </p>
            ) : null}
          </Card>
        ) : (
          <ul className="flex flex-col gap-3">
            {visibleRows.map(({ need, profileIds }) => {
              const isExpanded = expandedMemberId === need.memberId;
              const panelId = `youth-card-${need.memberId}`;
              // OFF THE SAME `need` THE PILLS AND THE SORT CAME FROM. Deriving it from the raw
              // profile list here would be a second answer to "how many of these are finished",
              // and the two could disagree — the summariseCoverage rule, which this module states
              // in five other places.
              const nothingRunning = describeNothingRunning(need);

              return (
                <li key={need.memberId}>
                  {/* A LEFT ACCENT ON THE EXPANDED CARD, so it is obvious where one young
                      person's block ends and the next begins once a card is tall enough to fill
                      the screen.

                      NOT ALTERNATING COLOURS BETWEEN CARDS: position is not information, and a
                      stripe on every other row means nothing except "every other row". This app's
                      left edges already carry meaning — COVERAGE_EDGE_CLASSES marks an uncovered
                      event inside the very list this card expands to show — so the accent uses
                      `primary`, which is the app's "you are here" colour and not one of the
                      coverage tones. */}
                  <Card
                    className={
                      isExpanded ? "border-l-4 border-l-primary" : undefined
                    }
                  >
                    <button
                      type="button"
                      className="flex min-h-11 w-full flex-col items-start gap-1 text-left focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
                      aria-expanded={isExpanded}
                      aria-controls={panelId}
                      onClick={() =>
                        setExpandedMemberId((current) =>
                          current === need.memberId ? null : need.memberId,
                        )
                      }
                    >
                      <span className="flex flex-wrap items-center gap-2">
                        <span className="text-sm font-medium text-foreground">
                          {need.memberName}
                        </span>

                        {/* ONE PILL PER ACTIVITY, each carrying that activity's own percentage.
                            The number, the tooltip and the priority sort all come from the same
                            ActivitySupport, so the three cannot describe different seasons.

                            DELIBERATELY NOT COLOURED. The sort is what surfaces who needs
                            attention, and a second colour system beside the coverage badge would
                            compete with the one signal on this card that already means something
                            — the same reasoning that keeps `awareness` out of the warning tone. */}
                        {need.activities.map((support) => (
                          <span
                            key={support.profileId}
                            className={PILL_CLASSES}
                            title={supportTitle(support)}
                          >
                            {supportPill(support)}
                          </span>
                        ))}

                        {/* A FINISHED SEASON IS STILL A PILL — added after the walk on 2026-08-31
                            answered "does a fully-closed card read as deliberate?" with NO.
                            Without these, such a card was the ONLY one on the page with no pills
                            at all, so beside its neighbours it read as data that had failed to
                            load — and it never said WHICH activity the young person does.

                            THE DIFFERENCE IS THE PILL'S TREATMENT, NOT ITS ABSENCE: a dashed
                            border and the word "Finished". Same shape, same place, same
                            name-order. A state rather than a variant.

                            AND NO PERCENTAGE, DELIBERATELY. Putting a closed season's number back
                            on /youth is exactly what ITER-028 removed. The pill says the season
                            happened; how it went lives on the history page and nowhere else. */}
                        {need.closedActivities.map((closed) => (
                          <span
                            key={closed.profileId}
                            className={CLOSED_PILL_CLASSES}
                            title={`${closed.activityName} has been closed out. Its games and follow-ups are still readable.`}
                          >
                            {closed.activityName} &middot; Finished
                          </span>
                        ))}

                        {/* Renders NOTHING for `not_expected`, so a young person whose only
                            upcoming games are cancelled is quiet rather than badged. */}
                        {need.worstUpcoming === null ? null : (
                          <CoverageBadge
                            coverage={{
                              state: need.worstUpcoming,
                              // Not rendered by the badge — it shows a count, never a countdown.
                              daysUntil: null,
                              // THE REAL COUNT, off the same event the state came from. A literal
                              // zero here made every covered card read "Covered · 0" above an
                              // event card reading "Covered · 1" (found walking scenario 057).
                              attendeeCount: need.worstUpcomingAttendees,
                            }}
                          />
                        )}
                      </span>

                      {/* THE UPCOMING COUNT DESCRIBES THE RUNNING SEASONS, so it is absent
                          rather than "0 events coming up" when there are none. A zero here would
                          be a true number answering a question nobody asked — the sentence below
                          answers the one they did. */}
                      {need.hasRunning ? (
                        <span className="text-sm text-muted">
                          {upcomingCount(need.upcomingCount)}
                        </span>
                      ) : null}

                      {nothingRunning === null ? null : (
                        <span className="text-sm text-muted">{nothingRunning}</span>
                      )}

                      <span className="text-sm text-primary underline underline-offset-4">
                        {isExpanded ? "Hide the events" : "Show the events"}
                      </span>
                    </button>

                    {/* OUTSIDE THE BUTTON, because a link inside a button is invalid HTML and
                        keyboard users get two conflicting activations from one element.

                        IT RENDERS ON EVERY CARD WITH AT LEAST ONE CLOSED SEASON, not only on a
                        fully-closed one: a young person with one season running and one finished
                        has history worth reaching, and hiding it there would make the page's
                        answer to "how was he supported last winter" depend on whether he happens
                        to be playing anything this week. */}
                    {need.closedActivities.length === 0 ? null : (
                      <p className="mt-2 text-sm">
                        <Link
                          href={`/youth/history/${need.memberId}`}
                          className="text-primary underline underline-offset-4"
                        >
                          See {need.memberName}&rsquo;s history
                        </Link>
                      </p>
                    )}

                    {isExpanded ? (
                      <div id={panelId} className="mt-3 border-t border-border pt-3">
                        {/* THE YOUTH-FIRST ASSIGNMENT, at the TOP of the expanded card rather
                            than beneath the schedule. ITER-033's flow is a pass down this page
                            putting each young person on their activities, and burying the control
                            under a list of events would make that pass a scroll per person.

                            ABSENT for somebody without `youth_activities.manage`, rather than
                            present-and-refusing (youth-a-D1's mirror). */}
                        {canManage ? (
                          <AddToActivity
                            memberName={need.memberName}
                            available={availableFor(need.memberId)}
                            pending={rosterMutation.isPending}
                            onAdd={(profileId) =>
                              rosterMutation.mutate({ profileId, memberId: need.memberId })
                            }
                          />
                        ) : null}

                        {/* THE SAME EventList /youth/profiles renders, filtered to this young
                            person's activities — ALL of them, which is why the prop is a list.
                            Not a second event card: EventList carries five permission gates, three
                            cache keys and every invalidation rule, and a copy of it would drift
                            within one slice (visits-c, youth-d).

                            The SEEDS ARE THE WHOLE WARD'S. `profileIds` decides what is RENDERED;
                            seeding a pre-filtered list would poison the shared cache entry for
                            FollowUpPanel and for this component's own widened reads. */}
                        <EventList
                          profileIds={profileIds}
                          // AND WHOSE WINDOW. `profileIds` narrows to this young person's
                          // ACTIVITIES; a team's schedule serves a whole roster, so without this
                          // a youth who left mid-season had their team-mates' later games listed
                          // under their own name — beneath a pill that read "0 events coming up",
                          // because the pill applies the window and the list did not (062-D1).
                          memberId={need.memberId}
                          heading={need.memberName}
                          initialEvents={initialUpcomingEvents}
                          initialProfiles={initialProfiles}
                          initialAttendees={initialUpcomingAttendees}
                          initialFollowUps={{}}
                          // EMPTY BY CONSTRUCTION on first paint, exactly as initialFollowUps is:
                          // this card seeds the NARROW entry, [.., false], and the page fetched
                          // the WIDENED one. The query fills it from one fetch rather than from a
                          // prop that never refetches (youth-a-D2).
                          initialParticipation={{}}
                          canManage={canManage}
                          canLog={canLog}
                          crossOrgVisibility={crossOrgVisibility}
                          asOf={asOf}
                          currentUserId={currentUserId}
                          currentUserRole={currentUserRole}
                          currentUserOrgId={currentUserOrgId}
                          canAssign={canAssign}
                          assignableUsers={assignableUsers}
                          wardTimeZone={wardTimeZone}
                        />
                      </div>
                    ) : null}
                  </Card>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </div>
  );
}
