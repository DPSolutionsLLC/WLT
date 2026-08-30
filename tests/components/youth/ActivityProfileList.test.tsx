// @vitest-environment jsdom
//
// REMOVING AN ACTIVITY ASKS FIRST, AND THE SENTENCE IS THE WHOLE POINT.
//
// ---------------------------------------------------------------------------
// WHY THIS SUITE EXISTS
// ---------------------------------------------------------------------------
// `Remove` shipped as a bare `onClick={() => deleteMutation.mutate(profile.id)}` — no confirm, no
// undo, red danger button, fires on one click (050-D1, found walking scenario 050; the walk found
// it, no checklist line asked for it). Migration 009 cascades youth_activity_profiles →
// activity_events → {activity_attendees, activity_logs → activity_private_notes}, so that click
// took a season of games, every sign-up, every follow-up and the private notes rule 5 calls
// private forever. The audit row records three ids and says nothing about what went with them.
//
// No server test can catch this: the route is behaving correctly when it deletes: the question is
// whether a person was asked. And no RLS test can, either — the deleter is permitted.
//
// window.confirm is STUBBED rather than driven, following
// tests/components/knowledge/DocumentList.test.tsx: it is the browser's dialog, and what needs
// locking down is the sentence handed to it, not that jsdom can raise one.
//
// The three assertions are the three ways this regresses:
//   * ANSWERING NO MUST NOT DELETE. A confirm whose return value is ignored is the failure mode
//     that looks identical to a working one until somebody presses Cancel.
//   * THE SENTENCE NAMES WHAT ELSE GOES. Worded by consequence — DocumentList.tsx:133's house
//     rule. A dialog reading "Are you sure?" would pass a shallower test and warn nobody.
//   * IT SAYS WHAT IS NOT AFFECTED. "Other young people at the same events are not affected" is
//     the half a reader cannot work out alone: profile_id is a single foreign key, so two
//     team-mates at one game are two rows, and a youth-g occasion links them without joining them.
//     Not knowing that is exactly what the scenario 050 review surfaced.
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
const PROFILE_ID = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";

const PROFILE: ActivityProfile = {
  id: PROFILE_ID,
  memberId: "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
  memberName: "Ethan Brooks",
  orgId: YOUNG_MEN,
  activityName: "Varsity basketball",
  schoolOrg: "Lincoln High School",
  activityType: "sport",
  seasonSchedule: "November to February",
  notes: null,
  enteredBy: null,
  createdAt: "2026-08-01T00:00:00Z",
};

// An org president of the SAME organization, so canManageActivityProfile() returns true and the
// Remove button is rendered at all. Gating it any other way is youth-a-D1.
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

function renderList() {
  // staleTime Infinity so the seeded profiles are not refetched on mount. Without it the list
  // query fires its own `fetch`, which has nothing to do with the delete and would sit in the same
  // spy — see deleteCalls() below, which is written not to care either way.
  const client = new QueryClient({
    defaultOptions: {
      queries: { retry: false, staleTime: Infinity },
      mutations: { retry: false },
    },
  });

  client.setQueryData([YOUTH_PROFILES_QUERY_KEY], [PROFILE]);

  render(
    <QueryClientProvider client={client}>
      <ActivityProfileList
        initialProfiles={[PROFILE]}
        user={PRESIDENT}
        canManage
        organizations={[{ id: YOUNG_MEN, label: "Young Men" }]}
        canChooseOrganization={false}
      />
    </QueryClientProvider>,
  );
}

function pressRemove(): void {
  fireEvent.click(screen.getByRole("button", { name: "Remove" }));
}

// The DELETE calls ONLY. Asserting `fetch` was never called at all would also catch the list
// query's own request, which would make this suite pass or fail for reasons that have nothing to
// do with the confirm.
function deleteCalls(): unknown[][] {
  const calls = (fetch as unknown as { mock: { calls: unknown[][] } }).mock.calls;

  return calls.filter(
    ([, init]) => (init as RequestInit | undefined)?.method === "DELETE",
  );
}

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
    pressRemove();

    expect(confirmSpy).toHaveBeenCalledOnce();
    // The assertion that matters: a confirm whose answer is ignored looks exactly like a working
    // one until somebody presses Cancel, and then it is unrecoverable.
    expect(deleteCalls()).toHaveLength(0);
  });

  it("sends the DELETE when the confirm is accepted", async () => {
    vi.spyOn(window, "confirm").mockReturnValue(true);

    renderList();
    pressRemove();

    // `mutate` schedules rather than awaits, so the request is not in the spy on the next tick.
    await waitFor(() =>
      expect(deleteCalls()).toEqual([
        [`/api/youth/profiles/${PROFILE_ID}`, { method: "DELETE" }],
      ]),
    );
  });

  it("names the young person, the activity, and everything the cascade takes", () => {
    const confirmSpy = vi.spyOn(window, "confirm").mockReturnValue(false);

    renderList();
    pressRemove();

    const text = confirmSpy.mock.calls[0][0] as string;

    expect(text).toContain("Remove Varsity basketball from Ethan Brooks?");

    // The cascade, in the reader's words rather than the schema's. "past ones included" is
    // load-bearing: the page loads upcoming events only, so a leader looking at an empty schedule
    // would otherwise reasonably believe there is nothing to lose.
    expect(text).toContain("every game and concert on it, past ones included");
    expect(text).toContain("signed up");
    expect(text).toContain("follow-ups");

    // What is NOT affected — the half that lets somebody actually answer the question.
    expect(text).toContain("Other young people at the same events are not affected.");
    expect(text).toContain("cannot be undone");

    // Worded by consequence, never by action. This is the shape the house rule exists to refuse.
    expect(text).not.toContain("Are you sure");
  });
});
