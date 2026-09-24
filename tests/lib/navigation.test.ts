import { describe, expect, it } from "vitest";
import {
  NAVIGATION_ITEMS,
  NAVIGATION_SECTIONS,
  shortcutNavigationItems,
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

  // BUILT *and* PERMITTED *and* ON THE DASHBOARD. This compares against the FILTERED list rather
  // than against all of NAVIGATION_ITEMS, because `built: false` rows are withheld from everybody
  // including a bishop — and since p4-sacrament-b1, so are `onDashboard: false` rows.
  it("gives the bishop every BUILT item that belongs on the dashboard", () => {
    expect(hrefsFor("bishop")).toEqual(
      NAVIGATION_ITEMS.filter((item) => item.built && item.onDashboard !== false).map(
        (item) => item.href,
      ),
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
  // UNFILTERED list, because the ordinance row is `built: false` — P11 has not built the adult
  // screen, and the youth account's own page lives at app/(youth)/ordinances/, whose layout is
  // where a sacrament_manager actually lands. They never render the app shell at all
  // (app/(app)/layout.tsx redirects them), so an empty app-shell list for that role is correct
  // rather than a regression, and the invariant worth pinning is the one below.
  //
  // THE HREF IS ASSERTED EXACTLY, NOT BY PREFIX. `startsWith("/sacrament")` passed both before
  // and after p4-sacrament-a moved this row from /sacrament to /sacrament/ordinances — and the
  // hub that took the old path is a DIFFERENT module on a DIFFERENT permission. A prefix that
  // cannot tell those apart is not pinning anything.
  it("gives a sacrament_manager exactly one item — P11's ordinance screen", () => {
    const permitted = NAVIGATION_ITEMS.filter((item) =>
      can(sessionUser("sacrament_manager"), item.permission, ROLE_PERMISSIONS),
    );

    expect(permitted).toHaveLength(1);
    expect(permitted[0].href).toBe("/sacrament/ordinances");
    expect(permitted[0].permission).toBe("sacrament.view_assignments");
  });

  // The other side of the collision p4-sacrament-a settled: /sacrament is now the sacrament
  // MEETING hub, gated on talks.view, and a youth account must not be able to reach it. The two
  // rows are one path segment apart, so this is asserted rather than assumed.
  it("keeps a sacrament_manager out of the sacrament MEETING hub", () => {
    const hub = NAVIGATION_ITEMS.find((item) => item.href === "/sacrament");

    expect(hub, "/sacrament has left NAVIGATION_ITEMS").toBeDefined();
    expect(hub?.permission).toBe("talks.view");
    expect(can(sessionUser("sacrament_manager"), "talks.view", ROLE_PERMISSIONS)).toBe(false);
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

  // ---------------------------------------------------------------------------
  // ONE TILE FOR THE MEETING — p4-sacrament-a
  // ---------------------------------------------------------------------------
  // These two used to assert a `Talks` row pointing at /assignments, added by talks-b so the one
  // link every planner uses did not point at SPEC.md's never-built /talks/pipeline kanban. The
  // route is untouched and still works; what changed is that it is no longer a DASHBOARD ENTRY
  // POINT. /sacrament is, and a Sunday's Topics and Talks pills are how /assignments is reached.
  // Three tiles for one module is what the hub exists to undo.
  it("points the Sacrament hub at /sacrament, gated on talks.view", () => {
    const hub = NAVIGATION_ITEMS.find((item) => item.href === "/sacrament");

    expect(hub).toBeDefined();
    expect(hub?.label).toBe("Sacrament");
    expect(hub?.permission).toBe("talks.view");
    expect(hub?.built).toBe(true);
  });

  it("shows the hub to every role that holds talks.view and to no other", () => {
    for (const role of ROLES) {
      const canSeeHub = hrefsFor(role).includes("/sacrament");
      const expected = can(sessionUser(role), "talks.view", ROLE_PERMISSIONS);

      expect(canSeeHub, `role "${role}" disagrees on /sacrament`).toBe(expected);
    }
  });

  // The other half of the same change, asserted so the absorbed tiles cannot quietly return. A
  // second dashboard route into a module the hub already owns is the drift this pins.
  it("offers no separate Talks or Prayers tile", () => {
    const hrefs = NAVIGATION_ITEMS.map((item) => item.href);

    expect(hrefs).not.toContain("/assignments");
    expect(hrefs).not.toContain("/prayers");
  });

  // KEPT AS A ROW, AND NO LONGER A TILE — p4-sacrament-b1. /talks/topics is the ward-level topic
  // LIBRARY a slot's topic is chosen FROM — not a per-Sunday view — so the hub links to it rather
  // than absorbing it (plans/prototype/module-map.md §2.1, correction b). The user decided on
  // 2026-09-23 that the link belongs in the hub's shortcut row rather than on the dashboard.
  //
  // THE ROW ITSELF IS ASSERTED TO SURVIVE, because deleting it is the instinct `onDashboard`
  // exists to head off: the label, the icon and the permission would then be re-typed into the
  // component that links to it.
  it("keeps the topic library in the list, gated on topics.view, and off the dashboard", () => {
    const topics = NAVIGATION_ITEMS.find((item) => item.href === "/talks/topics");

    expect(topics).toBeDefined();
    expect(topics?.permission).toBe("topics.view");
    expect(topics?.built).toBe(true);
    expect(topics?.onDashboard).toBe(false);
  });

  it("offers the topic library to nobody on the dashboard, not even a bishop", () => {
    for (const role of ROLES) {
      expect(hrefsFor(role)).not.toContain("/talks/topics");
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

    // `/todos` survives: `personal_tools.use` is non-overridable (P5), so no ward override can
    // take a leader's own list away.
    expect(hrefs).toEqual(["/music", "/todos"]);
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

// ---------------------------------------------------------------------------
// THE SHORTCUT ROW — p4-sacrament-b1
// ---------------------------------------------------------------------------
// The dashboard grid and a page's row of links to other modules are two VIEWS of one list. They
// differ in exactly ONE flag, and these assertions are what keeps the difference to one flag: an
// unbuilt or unpermitted href must be absent from BOTH, and only `onDashboard` may separate them.
describe("shortcut navigation", () => {
  const SACRAMENT_ROW = ["/roster", "/talks/topics", "/music", "/program"] as const;

  function shortcutsFor(role: Role, hrefs: readonly string[] = SACRAMENT_ROW): string[] {
    return shortcutNavigationItems(sessionUser(role), ROLE_PERMISSIONS, hrefs).map(
      (item) => item.href,
    );
  }

  // The whole point of the slice: Topics left the dashboard and has exactly one entry point now.
  it("offers the topic library to a bishop", () => {
    expect(shortcutsFor("bishop")).toContain("/talks/topics");
  });

  // THE OFFERED-THEN-REFUSED NEGATIVE. A music_coordinator holds `talks.view`, so they open the
  // Sacrament hub, and does NOT hold `topics.view`, which is bishopric-only — so the link must be
  // ABSENT rather than rendered and refused on arrival (youth-a-D1).
  it("withholds the topic library from a music coordinator, who can open the hub", () => {
    expect(can(sessionUser("music_coordinator"), "talks.view", ROLE_PERMISSIONS)).toBe(true);
    expect(can(sessionUser("music_coordinator"), "topics.view", ROLE_PERMISSIONS)).toBe(false);

    const hrefs = shortcutsFor("music_coordinator");

    expect(hrefs).not.toContain("/talks/topics");
    // Not empty — the row still renders, which is what makes the absence a filter rather than a
    // broken read.
    expect(hrefs).toContain("/music");
  });

  it("withholds the roster from a music coordinator too", () => {
    expect(shortcutsFor("music_coordinator")).not.toContain("/roster");
  });

  // BUILT *and* permitted, the same rule and in the same order as the grid. `/admin/audit-log` is
  // permitted to a bishop and has no page, which is the standing broken-link bug CLAUDE.md §9
  // records — a shortcut row must not be a second way to reach it.
  it("never offers an unbuilt item, even to somebody who holds its permission", () => {
    const unbuilt = NAVIGATION_ITEMS.filter((item) => !item.built);

    expect(unbuilt.length).toBeGreaterThan(0);

    for (const item of unbuilt) {
      expect(
        shortcutsFor("bishop", [item.href]),
        `"${item.href}" is unbuilt and must not be offered`,
      ).toEqual([]);
    }
  });

  // An href naming no row at all is silently absent rather than throwing. A page's row is a
  // constant somebody edits; a typo in it must cost one missing link, not a 500 on the hub.
  it("ignores an href that names no navigation item", () => {
    expect(shortcutsFor("bishop", ["/nothing-here"])).toEqual([]);
  });

  // THE CALLER'S ORDER, NOT NAVIGATION_ITEMS'. The prototype's row has its own order and the page
  // is the only thing that knows it.
  it("keeps the order it was given", () => {
    expect(shortcutsFor("bishop", ["/program", "/music", "/talks/topics"])).toEqual([
      "/program",
      "/music",
      "/talks/topics",
    ]);
  });

  // The flag separates the two views and nothing else does. If this fails, the two filters have
  // drifted apart.
  it("offers a bishop everything the dashboard does, plus the off-dashboard rows", () => {
    const everyHref = NAVIGATION_ITEMS.map((item) => item.href);
    const shortcuts = shortcutsFor("bishop", everyHref);

    for (const href of hrefsFor("bishop")) {
      expect(shortcuts, `"${href}" is on the dashboard but not offerable as a shortcut`).toContain(
        href,
      );
    }

    expect(shortcuts).toContain("/talks/topics");
  });

  it("honours a ward override that narrows a role", () => {
    const roleAccess = mergeRoleAccess({ bishop: { remove: ["topics.view"] } });

    const hrefs = shortcutNavigationItems(
      sessionUser("bishop"),
      roleAccess,
      SACRAMENT_ROW,
    ).map((item) => item.href);

    expect(hrefs).not.toContain("/talks/topics");
    expect(hrefs).toContain("/music");
  });
});
