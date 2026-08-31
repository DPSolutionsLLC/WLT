// @vitest-environment jsdom
//
// "+N others at this game" — the marker that says two rows are one evening.
//
// ---------------------------------------------------------------------------
// WHY THIS SUITE EXISTS, AND IT IS ONE ASSERTION
// ---------------------------------------------------------------------------
// THE COUNT IS COMPUTED FROM THE UNFILTERED LIST. `EventList` narrows to one young person inside
// an expanded card on /youth, and their team-mate's row is exactly what the narrowing removes —
// so a count built from the rendered rows would read "+0 others" on the one screen where the
// question matters most. That is roster-b, restated by visits-b and visits-f: a count beside a
// list must answer the list's question, and here the words claim to answer a WIDER one.
//
// This is the ONLY place that defect can be caught by a test rather than by a walk, because both
// numbers are plausible and only the filtered case distinguishes them. So the filtered render is
// the headline case here.
//
// The other two assertions are the ones a green suite has shipped past before:
//   * NOTHING AT ALL at zero — talks-c's render-nothing-rather-than-"Never" rule. Nearly every
//     card in a ward has no occasion.
//   * SINGULAR AND PLURAL, both read as sentences. youth-b's walk found "1 events updated" ship
//     past a full suite, because a plural bug is invisible to every test that does not read the
//     words.
//
// Nothing here touches the network: every query is seeded with `initialData`, which is what the
// server does on the real page.

import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { EventList } from "@/app/(app)/youth/EventList";
import type { ActivityEvent, ActivityProfile } from "@/lib/youth/queries";

const OCCASION = "11111111-1111-4111-8111-111111111111";

const ETHAN_PROFILE = "22222222-2222-4222-8222-222222222222";
const JOSH_PROFILE = "33333333-3333-4333-8333-333333333333";
const AVA_PROFILE = "44444444-4444-4444-8444-444444444444";

function profile(id: string, memberName: string): ActivityProfile {
  return {
    id,
    memberId: `member-${id}`,
    memberName,
    orgId: null,
    activityName: "Varsity basketball",
    schoolOrg: null,
    activityType: "sport",
    seasonSchedule: null,
    notes: null,
    enteredBy: null,
    closedAt: null,
    eventCount: 0,
    createdAt: "2027-01-01T00:00:00Z",
  };
}

function event(
  id: string,
  profileId: string,
  occasionId: string | null,
): ActivityEvent {
  return {
    id,
    profileId,
    calendarId: null,
    title: `Game against Roosevelt (${id})`,
    eventType: "home",
    // Far enough out that the suite does not start failing on a particular Tuesday.
    eventDate: "2099-11-14T19:30:00-07:00",
    location: "Lincoln High School",
    status: "upcoming",
    allDay: false,
    sourceUid: null,
    sourceRecurrenceId: null,
    occasionId,
    // Migration 061. Null means nobody has said, which is what every fixture here is about — an
    // absence is not part of the "+N others" count in either direction.
    youthAttended: null,
    createdAt: "2027-01-01T00:00:00Z",
  };
}

function renderList(options: {
  events: ActivityEvent[];
  profiles: ActivityProfile[];
  profileIds?: readonly string[];
}) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });

  return render(
    <QueryClientProvider client={queryClient}>
      <EventList
        initialEvents={options.events}
        initialProfiles={options.profiles}
        initialAttendees={{}}
        initialFollowUps={{}}
        canManage={false}
        canLog={false}
        crossOrgVisibility={false}
        asOf="2027-01-15T12:00:00Z"
        currentUserId="user-1"
        currentUserRole="org_president"
        currentUserOrgId={null}
        canAssign={false}
        assignableUsers={[]}
        profileIds={options.profileIds}
        wardTimeZone="America/Denver"
      />
    </QueryClientProvider>,
  );
}

describe("the +N others marker", () => {
  it("renders nothing at all on a card with no occasion", () => {
    renderList({
      events: [event("solo", ETHAN_PROFILE, null)],
      profiles: [profile(ETHAN_PROFILE, "Ethan Brooks")],
    });

    expect(screen.queryByText(/others at this game/)).toBeNull();
    // AND NOT "+0 others" EITHER, which is the wrong repair for an over-eager marker.
    expect(screen.queryByText(/\+0/)).toBeNull();
  });

  it("reads in the singular for one other young person", () => {
    renderList({
      events: [
        event("ethan", ETHAN_PROFILE, OCCASION),
        event("josh", JOSH_PROFILE, OCCASION),
      ],
      profiles: [profile(ETHAN_PROFILE, "Ethan Brooks"), profile(JOSH_PROFILE, "Josh Kim")],
    });

    expect(screen.getAllByText("+1 other at this game")).toHaveLength(2);
    expect(screen.queryByText(/others at this game/)).toBeNull();
  });

  it("reads in the plural for two", () => {
    renderList({
      events: [
        event("ethan", ETHAN_PROFILE, OCCASION),
        event("josh", JOSH_PROFILE, OCCASION),
        event("ava", AVA_PROFILE, OCCASION),
      ],
      profiles: [
        profile(ETHAN_PROFILE, "Ethan Brooks"),
        profile(JOSH_PROFILE, "Josh Kim"),
        profile(AVA_PROFILE, "Ava Reyes"),
      ],
    });

    expect(screen.getAllByText("+2 others at this game")).toHaveLength(3);
  });

  // ---------------------------------------------------------------------------
  // THE ASSERTION THIS FILE EXISTS FOR
  // ---------------------------------------------------------------------------
  // Filtered to Ethan alone: one card is rendered, and the two rows the filter removed are
  // exactly the ones the marker is counting. "+2 others" is the honest answer; "+0 others" is
  // what a count computed after the filter would say, and it is a different question from the one
  // the words claim to answer.
  it("counts from the unfiltered list when the list is narrowed to one young person", () => {
    renderList({
      events: [
        event("ethan", ETHAN_PROFILE, OCCASION),
        event("josh", JOSH_PROFILE, OCCASION),
        event("ava", AVA_PROFILE, OCCASION),
      ],
      profiles: [
        profile(ETHAN_PROFILE, "Ethan Brooks"),
        profile(JOSH_PROFILE, "Josh Kim"),
        profile(AVA_PROFILE, "Ava Reyes"),
      ],
      profileIds: [ETHAN_PROFILE],
    });

    // One card only — the filter genuinely applied.
    expect(screen.getAllByText("+2 others at this game")).toHaveLength(1);
    expect(screen.queryByText(/\+0/)).toBeNull();
  });

  // THE MARKER IS THE WAY IN. ITER-020's crossing: any card → the event → the occasion's young
  // people. The title carries the same link, so a reader who taps either lands in the same place.
  it("links to the event detail page", () => {
    renderList({
      events: [
        event("ethan", ETHAN_PROFILE, OCCASION),
        event("josh", JOSH_PROFILE, OCCASION),
      ],
      profiles: [profile(ETHAN_PROFILE, "Ethan Brooks"), profile(JOSH_PROFILE, "Josh Kim")],
      profileIds: [ETHAN_PROFILE],
    });

    expect(screen.getByText("+1 other at this game").closest("a")).toHaveAttribute(
      "href",
      "/youth/events/ethan",
    );
  });
});
