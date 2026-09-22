import { describe, expect, it } from "vitest";
import {
  NAVIGATION_ITEMS,
  NAVIGATION_SECTIONS,
  visibleNavigationItems,
} from "@/lib/auth/navigation";
import {
  PERMISSIONS,
  ROLE_PERMISSIONS,
  can,
  mergeRoleAccess,
} from "@/lib/auth/permissions";
import { ROLES, type Role, type SessionUser } from "@/types/domain";

function sessionUser(role: Role): SessionUser {
  return {
    id: "00000000-0000-4000-8000-0000000000aa",
    wardId: "00000000-0000-4000-8000-000000000001",
    // A session at HOME: the effective ward and the home ward are the same and
    // nothing is switched. lib/auth/session.ts reads all of these from session_context().
    homeWardId: "00000000-0000-4000-8000-000000000001",
    activeWardId: null,
    // The CALLING this session is acting under (migration 068). `role` and `orgId` below
    // are ITS facts, not the person\'s — a fixed id is enough here because nothing in
    // these tests reads it.
    callingId: "00000000-0000-4000-8000-00000000ca11",
    role,
    orgId: null,
  orgType: null,
    counselorPosition: null,
    firstName: "Test",
    lastName: "User",
    username: null,
    themePreference: "system",
    isActive: true,
  };
}

function hrefsFor(role: Role): string[] {
  return visibleNavigationItems(sessionUser(role), ROLE_PERMISSIONS).map(
    (item) => item.href,
  );
}

describe("navigation items", () => {
  it("names only permissions that exist", () => {
    const known = new Set<string>(PERMISSIONS);
    const unknown = NAVIGATION_ITEMS.filter((item) => !known.has(item.permission));

    expect(unknown.map((item) => item.href)).toEqual([]);
  });

  it("has no duplicate hrefs", () => {
    const hrefs = NAVIGATION_ITEMS.map((item) => item.href);

    expect(hrefs.length).toBe(new Set(hrefs).size);
  });

  it("produces a list for every role", () => {
    for (const role of ROLES) {
      expect(
        Array.isArray(visibleNavigationItems(sessionUser(role), ROLE_PERMISSIONS)),
      ).toBe(true);
    }
  });

  it("gives every item a section that NAVIGATION_SECTIONS knows about", () => {
    const known = new Set(NAVIGATION_SECTIONS.map((section) => section.id));
    const unknown = NAVIGATION_ITEMS.filter((item) => !known.has(item.section));

    expect(unknown.map((item) => item.href)).toEqual([]);
  });

  it("gives every item a blurb somebody could read", () => {
    const blank = NAVIGATION_ITEMS.filter((item) => item.blurb.trim().length === 0);

    expect(blank.map((item) => item.href)).toEqual([]);
  });

  it("gives every item an icon", () => {
    const missing = NAVIGATION_ITEMS.filter((item) => item.icon === undefined);

    expect(missing.map((item) => item.href)).toEqual([]);
  });

  // The accent is DUPLICATED onto each item so a tile rendered outside the grid carries its
  // colour without the caller looking the section up. This is what stops the duplicate drifting.
  it("gives every item its own section's accent", () => {
    const accents = new Map(
      NAVIGATION_SECTIONS.map((section) => [section.id, section.accent]),
    );
    const mismatched = NAVIGATION_ITEMS.filter(
      (item) => item.accent !== accents.get(item.section),
    );

    expect(mismatched.map((item) => item.href)).toEqual([]);
  });
});

describe("role-filtered navigation", () => {
  // CLAUDE.md §7: bishopric admin authority is shared. Compare the full arrays — equal
  // lengths with different contents is exactly the drift this is meant to catch.
  it("gives the bishop and a counselor identical lists", () => {
    expect(hrefsFor("counselor")).toEqual(hrefsFor("bishop"));
  });

  // BUILT *and* PERMITTED. This compares against the FILTERED list rather than against all of
  // NAVIGATION_ITEMS, because `built: false` rows are withheld from everybody including a bishop.
  it("gives the bishop every BUILT item", () => {
    expect(hrefsFor("bishop")).toEqual(
      NAVIGATION_ITEMS.filter((item) => item.built).map((item) => item.href),
    );
  });

  // The sibling that stops the assertion above going green the day somebody marks everything
  // unbuilt — two assertions, not one (plans/retros/notification-trigger-drift.md).
  it("offers the bishop none of the unbuilt items", () => {
    const unbuilt = NAVIGATION_ITEMS.filter((item) => !item.built).map((item) => item.href);
    const offered = hrefsFor("bishop");

    expect(unbuilt.length).toBeGreaterThan(0);
    for (const href of unbuilt) {
      expect(offered, `"${href}" is unbuilt and must not be offered`).not.toContain(href);
    }
  });

  // FEATURES.md §Module 17: a youth account reaches exactly one module. Asserted against the
  // UNFILTERED list, because /sacrament is `built: false` FOR THE APP SHELL — the page lives in
  // app/(youth)/, whose layout is where a sacrament_manager actually lands. They never render the
  // app shell at all (app/(app)/layout.tsx redirects them), so an empty app-shell list for that
  // role is correct rather than a regression, and the invariant worth pinning is the one below.
  it("gives a sacrament_manager exactly one item, under /sacrament", () => {
    const permitted = NAVIGATION_ITEMS.filter((item) =>
      can(sessionUser("sacrament_manager"), item.permission, ROLE_PERMISSIONS),
    );

    expect(permitted).toHaveLength(1);
    expect(permitted[0].href.startsWith("/sacrament")).toBe(true);
  });

  it("renders no app-shell navigation for a sacrament_manager", () => {
    expect(hrefsFor("sacrament_manager")).toEqual([]);
  });

  it("keeps the music coordinator out of visits, tithing, and admin", () => {
    const hrefs = hrefsFor("music_coordinator");

    expect(hrefs.filter((href) => href.startsWith("/visits"))).toEqual([]);
    expect(hrefs.filter((href) => href.startsWith("/tithing"))).toEqual([]);
    expect(hrefs.filter((href) => href.startsWith("/admin"))).toEqual([]);
    expect(hrefs).toContain("/music");
  });

  it("keeps an org secretary out of admin", () => {
    expect(hrefsFor("org_secretary").filter((href) => href.startsWith("/admin"))).toEqual([]);
  });

  // The roster is the module every other one browses through, so it is first in the list and
  // reaches everyone with roster.view.
  //
  // The expectation is DERIVED from can() rather than hardcoded as a list of exceptions, the way
  // the /assignments case below already does. It used to read "every role except the music
  // coordinator and the youth account", which was a true sentence about ten roles and became
  // false the moment `resource_center_specialist` landed holding nothing at all — a role added
  // deliberately with an empty list is not a bug in this file.
  it("shows the roster to every role that holds roster.view and to no other", () => {
    for (const role of ROLES) {
      const canSeeRoster = hrefsFor(role).includes("/roster");
      const expected = can(sessionUser(role), "roster.view", ROLE_PERMISSIONS);

      expect(canSeeRoster, `role "${role}" disagrees on /roster`).toBe(expected);
    }
  });

  // The named exceptions the sentence above used to carry, kept as their own assertion so the
  // derived test cannot go green by everybody losing the permission at once.
  it("keeps the roster from the music coordinator and the youth account", () => {
    expect(hrefsFor("music_coordinator")).not.toContain("/roster");
    expect(hrefsFor("sacrament_manager")).not.toContain("/roster");
    expect(hrefsFor("ward_council_member")).toContain("/roster");
  });

  // talks-b pointed the Talks entry at /assignments rather than SPEC.md's /talks/pipeline
  // kanban, which was never built. A sidebar link to an unbuilt route 404s, and the one link
  // every planner uses is the wrong one to leave pointing at a guess.
  it("points Talks at the month planner, gated on talks.view", () => {
    const talks = NAVIGATION_ITEMS.find((item) => item.label === "Talks");

    expect(talks).toBeDefined();
    expect(talks?.href).toBe("/assignments");
    expect(talks?.permission).toBe("talks.view");
  });

  it("shows the planner to every role that holds talks.view and to no other", () => {
    for (const role of ROLES) {
      const canSeePlanner = hrefsFor(role).includes("/assignments");
      const expected = can(sessionUser(role), "talks.view", ROLE_PERMISSIONS);

      expect(canSeePlanner, `role "${role}" disagrees on /assignments`).toBe(expected);
    }
  });

  // The bishopric, and the super admin — who reaches it for the ordinary reason that they hold
  // every permission there is (CLAUDE.md §7), not through a special case. A STAKE OFFICER does
  // NOT: `audit.view` is deliberately absent from STAKE_OFFICER_PERMISSIONS, because a visiting
  // officer reading the record of who changed what in a ward that is not theirs is a different
  // promise from reading how the ward is doing.
  //
  // It is asserted on `can()` rather than on the rendered list, because /admin/audit-log is
  // `built: false` until P12 builds the viewer — so the list withholds it from EVERY role today,
  // and asserting on the list would quietly stop checking the permission rule at all.
  it("grants the audit log to the bishopric and the super admin, and to nobody else", () => {
    for (const role of ROLES) {
      const auditLog = NAVIGATION_ITEMS.find((item) => item.href === "/admin/audit-log");
      const granted = can(sessionUser(role), auditLog!.permission, ROLE_PERMISSIONS);
      const expected =
        role === "bishop" || role === "counselor" || role === "super_admin";

      expect(granted, `role "${role}" disagrees on /admin/audit-log`).toBe(expected);
    }
  });

  it("offers the audit log to nobody, because it is not built", () => {
    for (const role of ROLES) {
      expect(hrefsFor(role)).not.toContain("/admin/audit-log");
    }
  });

  // The override is a per-role add/remove DELTA, not a replacement list (ITER-005). Under the
  // old replace shape this read { music_coordinator: ["music.view"] }; a delta names only what
  // the ward changed, so the defaults it does not mention still stand.
  it("honours a ward override that narrows a role", () => {
    const roleAccess = mergeRoleAccess({
      music_coordinator: { remove: ["calendar.view", "talks.view"] },
    });

    const hrefs = visibleNavigationItems(sessionUser("music_coordinator"), roleAccess).map(
      (item) => item.href,
    );

    expect(hrefs).toEqual(["/music"]);
  });

  it("honours a ward override that widens a role", () => {
    const roleAccess = mergeRoleAccess({
      music_coordinator: { add: ["visits.view"] },
    });

    const hrefs = visibleNavigationItems(sessionUser("music_coordinator"), roleAccess).map(
      (item) => item.href,
    );

    expect(hrefs).toContain("/visits");
    // The defaults it never mentioned are still there — the point of deltas.
    expect(hrefs).toContain("/music");
    expect(hrefs).toContain("/calendar");
  });
});
