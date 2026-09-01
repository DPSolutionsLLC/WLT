// @vitest-environment jsdom
//
// THE FOUR CONTROLS ON AN ACTIVITY: which of them render, and what pressing one says.
//
// ---------------------------------------------------------------------------
// WHY THIS SUITE EXISTS
// ---------------------------------------------------------------------------
// `Remove` shipped as a bare `onClick={() => deleteMutation.mutate(profile.id)}` — no confirm, no
// undo, red danger button, fires on one click (050-D1, found walking scenario 050; the walk found
// it, no checklist line asked for it). Migration 009 cascades youth_activity_profiles →
// activity_events → {activity_attendees, activity_logs → activity_private_notes}, so that click
// took a season of games, every sign-up, every follow-up and the private notes rule 5 calls
// private forever.
//
// A confirm was added next, and ITER-031's judgement is that A DIALOG CAN BE CLICKED THROUGH AND
// IS NOT PROTECTION. So `Remove` now renders ONLY when the activity has no events at all, and
// `Close` — which destroys nothing and is reversible — is the ordinary answer to "take this off my
// list".
//
// No server test can catch which controls render: the route behaves correctly when it deletes, and
// the question is whether a person was offered the press. No RLS test can either — the deleter is
// permitted.
//
// ---------------------------------------------------------------------------
// WHAT EACH GROUP BELOW IS GUARDING
// ---------------------------------------------------------------------------
//   * THE REMOVE GATE IS EXACT, NOT APPROXIMATE. Absent at any event count above zero, present at
//     zero. `activity_logs.event_id` has been NOT NULL since migration 057a, so no events implies
//     no follow-ups — the gate and the server's 409 are two expressions of one rule, and both are
//     asserted (roster-c/visits-b: a comment asserting a match is not a test).
//   * ANSWERING NO MUST NOT DELETE. A confirm whose return value is ignored looks identical to a
//     working one until somebody presses Cancel.
//   * THE SENTENCES ARE WORDED BY CONSEQUENCE — DocumentList.tsx's house rule. "Are you sure?"
//     would pass a shallower test and warn nobody.
//   * NEITHER CONTROL RENDERS ON ANOTHER ORGANIZATION'S ACTIVITY. That is youth-a-D1's shape, and
//     `Close` is a fourth control that could repeat it.
//
// Nothing here touches the network: the profiles query is seeded with `initialData`, which is what
// the server does on the real page.

import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ActivityProfileList } from "@/app/(app)/youth/ActivityProfileList";
import { YOUTH_PROFILES_QUERY_KEY } from "@/app/(app)/youth/youthQueries";
import type { ActivityProfile } from "@/lib/youth/queries";
import type { SessionUser } from "@/types/domain";

const YOUNG_MEN = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const YOUNG_WOMEN = "ffffffff-ffff-4fff-8fff-ffffffffffff";
const PROFILE_ID = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";

function profile(overrides: Partial<ActivityProfile> = {}): ActivityProfile {
  return {
    id: PROFILE_ID,
    // A TEAM OF ONE — the shape migration 062b's backfill gives every profile that existed
    // before youth-j, so these fixtures describe the same activities they always described.
    roster: [
      {
        rosterId: "dddddddd-dddd-4ddd-8ddd-dddddddddddd",
        profileId: PROFILE_ID,
        memberId: "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
        memberName: "Ethan Brooks",
        startedOn: null,
        endedOn: null,
      },
    ],
    orgId: YOUNG_MEN,
    activityName: "Varsity basketball",
    schoolOrg: "Lincoln High School",
    activityType: "sport",
    seasonSchedule: "November to February",
    notes: null,
    enteredBy: null,
    // RUNNING AND EMPTY by default, which is the only combination that renders every control at
    // once. Each test below moves exactly one field, so a failure names the field.
    closedAt: null,
    eventCount: 0,
    createdAt: "2026-08-01T00:00:00Z",
    ...overrides,
  };
}

// An org president of the SAME organization, so canManageActivityProfile() returns true and the
// controls are rendered at all. Gating them any other way is youth-a-D1.
const PRESIDENT: SessionUser = {
  id: "dddddddd-dddd-4ddd-8ddd-dddddddddddd",
  wardId: "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee",
  role: "org_president",
  orgId: YOUNG_MEN,
  counselorPosition: null,
  firstName: "Miguel",
  lastName: "Cortez",
  username: null,
  themePreference: "system",
  isActive: true,
};

function renderList(row: ActivityProfile = profile()) {
  // staleTime Infinity so the seeded profiles are not refetched on mount. Without it the list
  // query fires its own `fetch`, which has nothing to do with the mutations and would sit in the
  // same spy — see callsWithMethod() below, which is written not to care either way.
  const client = new QueryClient({
    defaultOptions: {
      queries: { retry: false, staleTime: Infinity },
      mutations: { retry: false },
    },
  });

  client.setQueryData([YOUTH_PROFILES_QUERY_KEY], [row]);

  render(
    <QueryClientProvider client={client}>
      <ActivityProfileList
        initialProfiles={[row]}
        user={PRESIDENT}
        canManage
        organizations={[
          { id: YOUNG_MEN, label: "Young Men" },
          { id: YOUNG_WOMEN, label: "Young Women" },
        ]}
        canChooseOrganization={false}
      />
    </QueryClientProvider>,
  );
}

function button(name: string): HTMLElement | null {
  return screen.queryByRole("button", { name });
}

function press(name: string): void {
  fireEvent.click(screen.getByRole("button", { name }));
}

// The calls of ONE method. Asserting `fetch` was never called at all would also catch the list
// query's own request, which would make this suite pass or fail for reasons that have nothing to
// do with the control being pressed.
function callsWithMethod(method: string): unknown[][] {
  const calls = (fetch as unknown as { mock: { calls: unknown[][] } }).mock.calls;

  return calls.filter(([, init]) => (init as RequestInit | undefined)?.method === method);
}

describe("ActivityProfileList — which controls render", () => {
  beforeEach(() => {
    vi.stubGlobal("fetch", vi.fn());
  });

  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  // ---------------------------------------------------------------------------
  // THE REMOVE GATE
  // ---------------------------------------------------------------------------
  it("does NOT offer Remove on an activity that has events", () => {
    renderList(profile({ eventCount: 12 }));

    expect(button("Remove")).toBeNull();
    // The alternative is offered in its place, which is what stops the refusal reading as a dead
    // end: there is still a way to take this off the list.
    expect(button("Close the season")).not.toBeNull();
  });

  // A SINGLE EVENT IS ENOUGH. The gate is `=== 0`, not "not many".
  it("does NOT offer Remove on an activity with one event", () => {
    renderList(profile({ eventCount: 1 }));

    expect(button("Remove")).toBeNull();
  });

  it("offers Remove on an activity with nothing recorded against it", () => {
    renderList(profile({ eventCount: 0 }));

    expect(button("Remove")).not.toBeNull();
  });

  // ---------------------------------------------------------------------------
  // CLOSE AND REOPEN ARE ONE CONTROL IN TWO STATES
  // ---------------------------------------------------------------------------
  it("offers Close on a running season and Reopen on a closed one", () => {
    renderList(profile({ closedAt: null }));
    expect(button("Close the season")).not.toBeNull();
    expect(button("Reopen")).toBeNull();

    cleanup();

    renderList(profile({ closedAt: "2027-03-01T12:00:00Z" }));
    expect(button("Reopen")).not.toBeNull();
    expect(button("Close the season")).toBeNull();
  });

  // A STATE A READER HAS TO INFER FROM A CONTROL IS NOT A STATE THEY HAVE BEEN TOLD ABOUT.
  it("says on the card that the season is closed", () => {
    renderList(profile({ closedAt: "2027-03-01T12:00:00Z" }));

    expect(screen.getByText("Season closed")).toBeTruthy();
  });

  // ---------------------------------------------------------------------------
  // youth-a-D1, NOW WITH A FOURTH CONTROL THAT COULD REPEAT IT
  // ---------------------------------------------------------------------------
  // Reads are ward-wide by design, so without canManageActivityProfile() every org leader was
  // handed Edit and Remove on every other presidency's work. Close must be inside the same gate:
  // a control the policy refuses is still a bug, even one that destroys nothing.
  it("offers no control at all on another organization's activity", () => {
    renderList(profile({ orgId: YOUNG_WOMEN, eventCount: 0 }));

    expect(button("Edit")).toBeNull();
    expect(button("Close the season")).toBeNull();
    expect(button("Remove")).toBeNull();
  });
});

describe("ActivityProfileList — closing a season", () => {
  beforeEach(() => {
    vi.stubGlobal("fetch", vi.fn());
  });

  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it("sends nothing when the confirm is declined", () => {
    const confirmSpy = vi.spyOn(window, "confirm").mockReturnValue(false);

    renderList();
    press("Close the season");

    expect(confirmSpy).toHaveBeenCalledOnce();
    expect(callsWithMethod("PATCH")).toHaveLength(0);
  });

  it("PATCHes the close route with { closed: true } when accepted", async () => {
    vi.spyOn(window, "confirm").mockReturnValue(true);

    renderList();
    press("Close the season");

    // `mutate` schedules rather than awaits, so the request is not in the spy on the next tick.
    await waitFor(() => expect(callsWithMethod("PATCH")).toHaveLength(1));

    const [url, init] = callsWithMethod("PATCH")[0] as [string, RequestInit];
    expect(url).toBe(`/api/youth/profiles/${PROFILE_ID}/close`);
    expect(JSON.parse(init.body as string)).toEqual({ closed: true });
  });

  // A MILD CONFIRM, BECAUSE CLOSING DESTROYS NOTHING — but still worded by consequence, and the
  // last clause is what makes it mild rather than a warning.
  it("names the consequence and says it can be undone", () => {
    const confirmSpy = vi.spyOn(window, "confirm").mockReturnValue(false);

    renderList();
    press("Close the season");

    const text = confirmSpy.mock.calls[0][0] as string;

    // IT NAMES HOW MANY YOUNG PEOPLE IT AFFECTS (youth-j), which is the one thing a leader
    // cannot see from the button now that closing ends a whole TEAM's season rather than one
    // young person's. The singular case is asserted because a fixture with one of everything
    // cannot catch a missing one.
    expect(text).toContain("Close Varsity basketball? It affects 1 young person.");
    expect(text).toContain("stay readable");
    expect(text).toContain("stops counting towards how well they are supported");
    expect(text).toContain("You can reopen it.");
    expect(text).not.toContain("Are you sure");

    // "THEY", NEVER "HE OR SHE" — defect 060-D1, found by the walk on 2026-08-31. `ActivityProfile`
    // carries no gender, so the app has no pronoun for a member and must not imply one; the old
    // wording both guessed and excluded. Asserted as an ABSENCE so the phrase cannot come back.
    expect(text).not.toContain("he or she");
  });

  // NO CONFIRM ON REOPENING. It restores a state, destroys nothing, and is itself undone by the
  // button beside it — a dialog there would be the "Are you sure?" the house rule refuses.
  it("reopens without asking, sending { closed: false }", async () => {
    const confirmSpy = vi.spyOn(window, "confirm").mockReturnValue(false);

    renderList(profile({ closedAt: "2027-03-01T12:00:00Z" }));
    press("Reopen");

    expect(confirmSpy).not.toHaveBeenCalled();
    await waitFor(() => expect(callsWithMethod("PATCH")).toHaveLength(1));

    const [, init] = callsWithMethod("PATCH")[0] as [string, RequestInit];
    expect(JSON.parse(init.body as string)).toEqual({ closed: false });
  });
});

describe("ActivityProfileList — removing an activity", () => {
  beforeEach(() => {
    vi.stubGlobal("fetch", vi.fn());
  });

  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it("deletes NOTHING when the confirm is declined", () => {
    const confirmSpy = vi.spyOn(window, "confirm").mockReturnValue(false);

    renderList();
    press("Remove");

    expect(confirmSpy).toHaveBeenCalledOnce();
    // The assertion that matters: a confirm whose answer is ignored looks exactly like a working
    // one until somebody presses Cancel, and then it is unrecoverable.
    expect(callsWithMethod("DELETE")).toHaveLength(0);
  });

  it("sends the DELETE when the confirm is accepted", async () => {
    vi.spyOn(window, "confirm").mockReturnValue(true);

    renderList();
    press("Remove");

    await waitFor(() =>
      expect(callsWithMethod("DELETE")).toEqual([
        [`/api/youth/profiles/${PROFILE_ID}`, { method: "DELETE" }],
      ]),
    );
  });

  // THE SENTENCE IS NOW WRITTEN FOR THE EMPTY CASE AND NO OTHER, because the control only renders
  // there. The old paragraph — "every game and concert on it, past ones included, along with anyone
  // signed up and any follow-ups" — described a press that can no longer happen from this page, and
  // a warning about a consequence that cannot occur is roster-c/visits-b's stale-comment defect
  // wearing a dialog.
  it("says that nothing has been recorded against it yet", () => {
    const confirmSpy = vi.spyOn(window, "confirm").mockReturnValue(false);

    renderList();
    press("Remove");

    const text = confirmSpy.mock.calls[0][0] as string;

    // NO MEMBER NAME. A profile is a TEAM now, so there is no single young person to remove it
    // "from" — and the roster's own removal control is a separate action with its own confirm.
    expect(text).toContain("Remove Varsity basketball?");
    expect(text).toContain("Nothing has been recorded against it yet.");
    expect(text).toContain("cannot be undone");

    // Worded by consequence, never by action. This is the shape the house rule exists to refuse.
    expect(text).not.toContain("Are you sure");
  });
});
