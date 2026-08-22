import { describe, expect, it } from "vitest";
import { NAVIGATION_ITEMS, visibleNavigationItems } from "@/lib/auth/navigation";
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
    role,
    orgId: null,
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
});

describe("role-filtered navigation", () => {
  // CLAUDE.md §7: bishopric admin authority is shared. Compare the full arrays — equal
  // lengths with different contents is exactly the drift this is meant to catch.
  it("gives the bishop and a counselor identical lists", () => {
    expect(hrefsFor("counselor")).toEqual(hrefsFor("bishop"));
  });

  it("gives the bishop every item", () => {
    expect(hrefsFor("bishop")).toEqual(NAVIGATION_ITEMS.map((item) => item.href));
  });

  // FEATURES.md §Module 17: a youth account reaches exactly one module.
  it("gives a sacrament_manager exactly one item, under /sacrament", () => {
    const hrefs = hrefsFor("sacrament_manager");

    expect(hrefs).toHaveLength(1);
    expect(hrefs[0].startsWith("/sacrament")).toBe(true);
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
  // reaches everyone with roster.view — which is every role except the music coordinator and
  // the youth account.
  it("shows the roster to every role that holds roster.view", () => {
    for (const role of ROLES) {
      const canSeeRoster = hrefsFor(role).includes("/roster");
      const expected = role !== "music_coordinator" && role !== "sacrament_manager";

      expect(canSeeRoster, `role "${role}" disagrees on /roster`).toBe(expected);
    }
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

  it("shows the audit log to the bishopric and to nobody else", () => {
    for (const role of ROLES) {
      const canSeeAuditLog = hrefsFor(role).includes("/admin/audit-log");
      const isBishopric = role === "bishop" || role === "counselor";

      expect(canSeeAuditLog, `role "${role}" disagrees on /admin/audit-log`).toBe(isBishopric);
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
