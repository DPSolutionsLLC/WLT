import { describe, expect, it } from "vitest";
import { pageViewSchema } from "@/lib/validation/pageView";
import {
  DEFAULT_VISITS_VIEW,
  initialVisitsTab,
  parseVisitsTabParam,
  parseVisitsView,
  visibleVisitsTabs,
} from "@/lib/visits/visitsView";

// How /visits remembers the tab and the household sort (ITER-055 bv2).

describe("visibleVisitsTabs", () => {
  it("gives the bishopric every tab, in order", () => {
    expect(visibleVisitsTabs({ isBishopric: true, canManageSharing: true })).toEqual([
      "households",
      "feed",
      "all_organizations",
      "goal_history",
      "sharing",
    ]);
  });

  // Past goals is the bishopric's alone (decided at ITER-055 bv4 start), even for a reader who
  // could otherwise manage sharing.
  it("keeps Past goals to the bishopric", () => {
    expect(visibleVisitsTabs({ isBishopric: false, canManageSharing: true })).not.toContain(
      "goal_history",
    );
  });

  it("gives an organization leader Households and Feed only", () => {
    expect(visibleVisitsTabs({ isBishopric: false, canManageSharing: false })).toEqual([
      "households",
      "feed",
    ]);
  });
});

describe("initialVisitsTab", () => {
  const leaderTabs = ["households", "feed"] as const;

  it("keeps a stored tab the reader can see", () => {
    expect(initialVisitsTab("feed", leaderTabs)).toBe("feed");
  });

  it("falls back to Households for a stored tab the reader cannot see", () => {
    expect(initialVisitsTab("sharing", leaderTabs)).toBe("households");
  });

  it("lets an address ask for a visible tab over the remembered one", () => {
    expect(initialVisitsTab("households", leaderTabs, "feed")).toBe("feed");
  });

  it("ignores an address asking for a tab the reader cannot see", () => {
    expect(initialVisitsTab("feed", leaderTabs, "all_organizations")).toBe("feed");
  });
});

describe("parseVisitsView", () => {
  it("reads a stored view", () => {
    expect(parseVisitsView({ tab: "feed", sort: "dueOn" })).toEqual({ tab: "feed", sort: "dueOn" });
  });

  it("falls back field by field, keeping the part it can read", () => {
    expect(parseVisitsView({ tab: "my_visits", sort: "dueOn" })).toEqual({
      tab: "households",
      sort: "dueOn",
    });
    expect(parseVisitsView(undefined)).toEqual(DEFAULT_VISITS_VIEW);
    expect(parseVisitsView("nonsense")).toEqual(DEFAULT_VISITS_VIEW);
  });
});

describe("parseVisitsTabParam", () => {
  it("reads the tab the old addresses redirect with", () => {
    expect(parseVisitsTabParam("feed")).toBe("feed");
    expect(parseVisitsTabParam(["all_organizations", "feed"])).toBe("all_organizations");
  });

  it("ignores anything else", () => {
    expect(parseVisitsTabParam("everything")).toBeUndefined();
    expect(parseVisitsTabParam(undefined)).toBeUndefined();
  });
});

describe("the page-view route accepts the visits view", () => {
  it("parses a visits save and refuses an unknown sort", () => {
    expect(
      pageViewSchema.safeParse({ page: "visits", view: { tab: "feed", sort: "priority" } }).success,
    ).toBe(true);
    expect(
      pageViewSchema.safeParse({ page: "visits", view: { tab: "goal_history", sort: "priority" } })
        .success,
    ).toBe(true);
    expect(
      pageViewSchema.safeParse({ page: "visits", view: { tab: "feed", sort: "loudest" } }).success,
    ).toBe(false);
  });
});
