import { describe, expect, it } from "vitest";
import {
  deriveCalling,
  LCR_CALLING_MAP,
  parseLcrCallings,
  ROLE_PRECEDENCE,
  type OrganizationForMapping,
} from "@/lib/callings/lcrCallingMap";
import type { Role } from "@/types/domain";

// ITER-058: which LCR calling grants which app calling. Exact, case-sensitive, against a known
// list (D5); the higher-ranked calling wins (D4); the organization is found by type and never
// guessed (P8).

const ORGANIZATIONS: OrganizationForMapping[] = [
  { id: "eq", type: "elders_quorum" },
  { id: "rs", type: "relief_society" },
  { id: "pr", type: "primary" },
  { id: "yw", type: "young_women" },
  { id: "ss", type: "sunday_school" },
  { id: "ym", type: "young_men" },
];

const TITLE_FOR_ROLE: Record<string, string> = {
  bishop: "Bishop",
  counselor: "Bishopric First Counselor",
  ward_secretary: "Ward Clerk",
  executive_secretary: "Ward Executive Secretary",
  org_president: "Elders Quorum President",
  org_counselor: "Relief Society Second Counselor",
  org_secretary: "Primary Secretary",
  music_coordinator: "Music Coordinator",
  resource_center_specialist: "Resource Center Specialist",
};

describe("parseLcrCallings", () => {
  it("splits on line breaks, trims, collapses spaces and drops blanks", () => {
    expect(parseLcrCallings("  Ward   Clerk \n\n Sunday School Teacher\n")).toEqual([
      "Ward Clerk",
      "Sunday School Teacher",
    ]);
  });

  it("strips a trailing date group, so the sustained and set-apart columns parse too", () => {
    expect(parseLcrCallings("Ward Clerk (12 Jan 2025)\nBishop")).toEqual(["Ward Clerk", "Bishop"]);
  });

  it("reads null and empty as no callings", () => {
    expect(parseLcrCallings(null)).toEqual([]);
    expect(parseLcrCallings("")).toEqual([]);
  });
});

describe("deriveCalling", () => {
  it("maps an exact title, with the counselor's position", () => {
    expect(deriveCalling(["Bishopric Second Counselor"], ORGANIZATIONS)).toMatchObject({
      kind: "calling",
      role: "counselor",
      counselorPosition: 2,
      orgId: null,
    });
  });

  it("finds the organization by type", () => {
    expect(deriveCalling(["Young Women Secretary"], ORGANIZATIONS)).toMatchObject({
      kind: "calling",
      role: "org_secretary",
      orgId: "yw",
    });
  });

  it("collapses inner whitespace before matching", () => {
    expect(deriveCalling(["Ward   Executive  Secretary"], ORGANIZATIONS)).toMatchObject({
      kind: "calling",
      role: "executive_secretary",
    });
  });

  it("is case-sensitive, so a wording change grants nothing and is listed", () => {
    expect(deriveCalling(["ward clerk"], ORGANIZATIONS)).toEqual({ kind: "none", unrecognised: ["ward clerk"] });
  });

  it("grants nothing for a title it does not know, and lists it beside a real calling", () => {
    const derived = deriveCalling(["Temple Worker", "Ward Clerk"], ORGANIZATIONS);
    expect(derived).toMatchObject({ kind: "calling", role: "ward_secretary", unrecognised: ["Temple Worker"] });
  });

  it.each([
    "Young Men President",
    "Elders Quorum Ministering Secretary",
    "Ward Assistant Clerk",
    "Ward Mission Leader",
    "Stake President",
    "Deacons Quorum President",
  ])("maps %s to nothing (agreed 2026-11-16)", (title) => {
    expect(deriveCalling([title], ORGANIZATIONS).kind).toBe("none");
  });

  it("maps no title to ward_council_member", () => {
    expect([...LCR_CALLING_MAP.values()].some((mapped) => mapped.role === "ward_council_member")).toBe(false);
  });

  const mappedRoles = ROLE_PRECEDENCE.filter((role) => TITLE_FOR_ROLE[role] !== undefined);
  const pairs: Array<[Role, Role]> = mappedRoles.flatMap((higher, index) =>
    mappedRoles.slice(index + 1).map((lower): [Role, Role] => [higher, lower]),
  );

  it.each(pairs)("prefers %s over %s, in either order, and names the one set aside", (higher, lower) => {
    for (const titles of [
      [TITLE_FOR_ROLE[higher], TITLE_FOR_ROLE[lower]],
      [TITLE_FOR_ROLE[lower], TITLE_FOR_ROLE[higher]],
    ]) {
      const derived = deriveCalling(titles, ORGANIZATIONS);
      expect(derived).toMatchObject({ kind: "calling", role: higher });
      if (derived.kind === "calling") {
        expect(derived.setAside).toEqual([{ title: TITLE_FOR_ROLE[lower], role: lower }]);
      }
    }
  });

  it("is unresolvable, never guessed, when the ward has no organization of that type", () => {
    const withoutPrimary = ORGANIZATIONS.filter((organization) => organization.type !== "primary");
    expect(deriveCalling(["Primary President"], withoutPrimary)).toMatchObject({
      kind: "unresolvable",
      reason: "no_organization",
      orgType: "primary",
    });
  });

  it("is unresolvable when the ward has two organizations of that type", () => {
    const twoQuorums = [...ORGANIZATIONS, { id: "eq2", type: "elders_quorum" as const }];
    expect(deriveCalling(["Elders Quorum Secretary"], twoQuorums)).toMatchObject({
      kind: "unresolvable",
      reason: "several_organizations",
    });
  });

  it("does not fall back to a lower calling when the higher one is unresolvable", () => {
    const withoutPrimary = ORGANIZATIONS.filter((organization) => organization.type !== "primary");
    expect(deriveCalling(["Primary President", "Music Coordinator"], withoutPrimary).kind).toBe("unresolvable");
  });
});
