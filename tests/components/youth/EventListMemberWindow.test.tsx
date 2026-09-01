// @vitest-environment jsdom
//
// An expanded card on /youth lists the YOUNG PERSON's games, not the TEAM's.
//
// ---------------------------------------------------------------------------
// WHY THIS SUITE EXISTS — DEFECT 062-D1, FOUND WALKING SCENARIO 062
// ---------------------------------------------------------------------------
// `profileIds` narrows EventList to a young person's ACTIVITIES, and before youth-j that was the
// whole of the question: a profile was one young person's copy of a team, so their activities and
// their games were the same set of rows. A team's schedule now serves a whole ROSTER, and the two
// came apart.
//
// Maya left the team on 7 August. Her pill on /youth read "0 events coming up" — the percentage
// applies `memberIsExpectedAt()` and always did. The heading immediately below it, inside the
// same card, read "Maya Alvarez (4 upcoming events)", and with past shown "(12 events)", seven of
// them played after she left. One card, two numbers, both about her.
//
// That is the ITER-022 count-and-list defect, and YouthOverview's own comment at the `profileIds`
// build site states the rule it broke: "A card showing '1 of 8' must expand to a list where eight
// home games are findable." A card showing 0 expanded to a list of 4.
//
// ---------------------------------------------------------------------------
// THE BRANCH A FUTURE TIDY-UP WILL REMOVE
// ---------------------------------------------------------------------------
// `memberId` is OPTIONAL and is absent on /youth/profiles, where the unit is the TEAM and the
// whole season is the right answer — including the games a departed youth did not play. The last
// test here asserts that, because "narrow it everywhere for consistency" is the obvious tidy-up
// and it would hide a team's own season from the page that manages it.
//
// Nothing here touches the network: every query is seeded with `initialData`, as the server does.

import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { EventList } from "@/app/(app)/youth/EventList";
import type { ActivityEvent, ActivityProfile } from "@/lib/youth/queries";

const TEAM = "22222222-2222-4222-8222-222222222222";

const MAYA = "member-maya";
const TYLER = "member-tyler";
const ETHAN = "member-ethan";

// THE BOUNDARY DAY, and the reason every date below is written out rather than computed.
//
// Maya's last day on the team and Tyler's first are the SAME day, and the game on it is at
// 7:30pm in America/Denver — which is 01:30Z the FOLLOWING day. That is the case a
// `slice(0, 10)` comparison gets wrong in both directions at once, so it is the case worth
// pinning on a screen as well as in lib/youth/roster.ts.
const BOUNDARY_DAY = "2027-02-10";

const GAMES = {
  beforeBoth: { id: "g-early", date: "2027-02-03T19:30:00-07:00", title: "Game G01" },
  boundary: { id: "g-boundary", date: "2027-02-10T19:30:00-07:00", title: "Game G05" },
  afterBoth: { id: "g-late", date: "2027-02-17T19:30:00-07:00", title: "Game G09" },
  laterStill: { id: "g-latest", date: "2027-02-24T19:30:00-07:00", title: "Game G12" },
};

function team(closedAt: string | null = null): ActivityProfile {
  return {
    id: TEAM,
    // ONE TEAM, THREE WINDOWS — the shape scenario 062 seeds and the whole point of youth-j.
    roster: [
      // The control: on the team for the whole schedule.
      {
        rosterId: "roster-ethan",
        profileId: TEAM,
        memberId: ETHAN,
        memberName: "Ethan Brooks",
        startedOn: null,
        endedOn: null,
      },
      // LEFT on the boundary day. The game that day is still hers.
      {
        rosterId: "roster-maya",
        profileId: TEAM,
        memberId: MAYA,
        memberName: "Maya Alvarez",
        startedOn: null,
        endedOn: BOUNDARY_DAY,
      },
      // JOINED on the boundary day. The mirror — that same game is his too.
      {
        rosterId: "roster-tyler",
        profileId: TEAM,
        memberId: TYLER,
        memberName: "Tyler Nash",
        startedOn: BOUNDARY_DAY,
        endedOn: null,
      },
    ],
    orgId: null,
    activityName: "Varsity basketball",
    schoolOrg: "Lincoln High School",
    activityType: "sport",
    seasonSchedule: null,
    notes: null,
    enteredBy: null,
    closedAt,
    eventCount: 4,
    createdAt: "2027-01-01T00:00:00Z",
  };
}

function event(game: { id: string; date: string; title: string }): ActivityEvent {
  return {
    id: game.id,
    profileId: TEAM,
    calendarId: null,
    title: game.title,
    eventType: "home",
    eventDate: game.date,
    location: "Lincoln High School",
    status: "upcoming",
    allDay: false,
    sourceUid: null,
    sourceRecurrenceId: null,
    occasionId: null,
    createdAt: "2027-01-01T00:00:00Z",
  };
}

const ALL_GAMES = [
  event(GAMES.beforeBoth),
  event(GAMES.boundary),
  event(GAMES.afterBoth),
  event(GAMES.laterStill),
];

function renderList(options: { memberId?: string; closedAt?: string | null }) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });

  return render(
    <QueryClientProvider client={queryClient}>
      <EventList
        initialEvents={ALL_GAMES}
        initialProfiles={[team(options.closedAt ?? null)]}
        initialAttendees={{}}
        initialFollowUps={{}}
        initialParticipation={{}}
        canManage={false}
        canLog={false}
        crossOrgVisibility={false}
        // BEFORE THE WHOLE SCHEDULE, so every game is upcoming and the default view shows them
        // all. The window is what this suite is about; the clock is not.
        asOf="2027-01-15T12:00:00Z"
        currentUserId="user-1"
        currentUserRole="org_president"
        currentUserOrgId={null}
        canAssign={false}
        assignableUsers={[]}
        profileIds={[TEAM]}
        memberId={options.memberId}
        heading="Schedule"
        wardTimeZone="America/Denver"
      />
    </QueryClientProvider>,
  );
}

function renderedGameTitles(): string[] {
  return Object.values(GAMES)
    .filter((game) => screen.queryByText(game.title) !== null)
    .map((game) => game.title);
}

describe("an expanded card lists one young person's games", () => {
  // ---------------------------------------------------------------------------
  // THE ASSERTION THIS FILE EXISTS FOR
  // ---------------------------------------------------------------------------
  it("leaves out the games played after a young person left the team", () => {
    renderList({ memberId: MAYA });

    expect(renderedGameTitles()).toEqual([GAMES.beforeBoth.title, GAMES.boundary.title]);

    // The games her team-mates played after she left — the rows that made her card read
    // "(4 upcoming events)" beneath a pill saying "0 events coming up".
    expect(screen.queryByText(GAMES.afterBoth.title)).toBeNull();
    expect(screen.queryByText(GAMES.laterStill.title)).toBeNull();
  });

  // THE COUNT FOLLOWS THE LIST, and that is the half of the defect a reader actually saw.
  // `eventCount()` reads `events.length`, so this passes only while the filter above is the one
  // the heading is counting — which is the property worth pinning, not the number.
  it("counts in the heading what it renders in the list", () => {
    renderList({ memberId: MAYA });

    expect(screen.getByRole("heading", { name: "Schedule (2 upcoming events)" })).toBeDefined();
  });

  // THE INCLUSIVE BOUNDARY, ON A 7:30pm GAME WEST OF UTC. Stored as 01:30Z the following day, so
  // a date-string comparison would drop it from her list and keep it out of his.
  it("counts the game on the day she left and the day he joined for both of them", () => {
    renderList({ memberId: MAYA });
    expect(screen.queryByText(GAMES.boundary.title)).not.toBeNull();

    screen.getByRole("heading", { name: "Schedule (2 upcoming events)" });

    renderList({ memberId: TYLER });
    // Rendered twice now — once in each tree — which is itself the proof that the same game is
    // in both windows.
    expect(screen.getAllByText(GAMES.boundary.title)).toHaveLength(2);
  });

  it("leaves out the games played before a young person joined", () => {
    renderList({ memberId: TYLER });

    expect(renderedGameTitles()).toEqual([
      GAMES.boundary.title,
      GAMES.afterBoth.title,
      GAMES.laterStill.title,
    ]);
    expect(screen.queryByText(GAMES.beforeBoth.title)).toBeNull();
  });

  // ONE WINDOW FUNCTION, THREE INPUTS. `closedAt` is not a second rule here and must not become
  // one: it reaches `memberIsExpectedAt()` through the same call, so a closed season truncates
  // the list for a youth with no dates of their own.
  //
  // NOON UTC, NOT MIDNIGHT, and the first draft of this test got it wrong in a way worth keeping
  // a note of. A closing instant of `2027-02-11T00:00:00Z` sits BETWEEN the boundary game's 7:30pm
  // Denver start and the UTC midnight that follows it, so the game is genuinely after the close
  // and the list correctly dropped it. `closedAt` is an INSTANT compared directly — never a day —
  // which is exactly what lib/youth/roster.ts says it is, and the trap is that a date-shaped
  // string reads like a day to whoever writes the fixture.
  it("stops at the closing instant for a season that has been closed out", () => {
    renderList({ memberId: ETHAN, closedAt: "2027-02-11T12:00:00Z" });

    expect(renderedGameTitles()).toEqual([GAMES.beforeBoth.title, GAMES.boundary.title]);
  });

  // ---------------------------------------------------------------------------
  // THE BRANCH A TIDY-UP WILL INVERT
  // ---------------------------------------------------------------------------
  // /youth/profiles passes no `memberId`, because there the unit is the TEAM. Narrowing it there
  // "for consistency" would hide a team's own season from the page that manages it — and the
  // games a departed youth did not play are exactly the record the next presidency needs
  // (youth-h's reasoning, confirmed by the user when walking scenario 062).
  it("renders the team's whole schedule when no young person is named", () => {
    renderList({});

    expect(renderedGameTitles()).toEqual([
      GAMES.beforeBoth.title,
      GAMES.boundary.title,
      GAMES.afterBoth.title,
      GAMES.laterStill.title,
    ]);
  });
});
