import { describe, expect, it } from "vitest";
import { visitSharingSchema } from "@/lib/validation/visit";
import {
  checkVisitSharingGrants,
  describeVisitSharingForReader,
  diffVisitSharing,
  orgIdsSharedWith,
} from "@/lib/visits/sharing";

const EQ = "11111111-1111-4111-8111-111111111111";
const RS = "22222222-2222-4222-8222-222222222222";
const PRIMARY = "33333333-3333-4333-8333-333333333333";
const BISHOPRIC = "44444444-4444-4444-8444-444444444444";

const ORGANIZATIONS = [
  { id: EQ, type: "elders_quorum" },
  { id: RS, type: "relief_society" },
  { id: PRIMARY, type: "primary" },
  { id: BISHOPRIC, type: "bishopric" },
];

describe("orgIdsSharedWith", () => {
  it("returns the owners shared with this viewer, and only those", () => {
    const grants = [
      { ownerOrgId: EQ, viewerOrgId: RS },
      { ownerOrgId: BISHOPRIC, viewerOrgId: RS },
      { ownerOrgId: RS, viewerOrgId: EQ },
    ];
    expect(orgIdsSharedWith(grants, RS)).toEqual([EQ, BISHOPRIC]);
  });

  it("returns nothing for a reader with no organization", () => {
    expect(orgIdsSharedWith([{ ownerOrgId: EQ, viewerOrgId: RS }], null)).toEqual([]);
  });
});

describe("diffVisitSharing", () => {
  it("names what was added and what was removed", () => {
    const current = [
      { ownerOrgId: EQ, viewerOrgId: RS },
      { ownerOrgId: RS, viewerOrgId: EQ },
    ];
    const next = [
      { ownerOrgId: EQ, viewerOrgId: RS },
      { ownerOrgId: BISHOPRIC, viewerOrgId: EQ },
    ];
    expect(diffVisitSharing(current, next)).toEqual({
      added: [{ ownerOrgId: BISHOPRIC, viewerOrgId: EQ }],
      removed: [{ ownerOrgId: RS, viewerOrgId: EQ }],
    });
  });

  it("treats a repeated grant in the new set as one", () => {
    const grant = { ownerOrgId: EQ, viewerOrgId: RS };
    expect(diffVisitSharing([], [grant, grant]).added).toEqual([grant]);
  });
});

describe("checkVisitSharingGrants", () => {
  it("accepts grants between the ward's organizations, the Bishopric as an owner included", () => {
    expect(() =>
      checkVisitSharingGrants(
        [
          { ownerOrgId: BISHOPRIC, viewerOrgId: EQ },
          { ownerOrgId: EQ, viewerOrgId: PRIMARY },
        ],
        ORGANIZATIONS,
      ),
    ).not.toThrow();
  });

  it("refuses the Bishopric as a viewer, with a sentence", () => {
    expect(() =>
      checkVisitSharingGrants([{ ownerOrgId: EQ, viewerOrgId: BISHOPRIC }], ORGANIZATIONS),
    ).toThrow("already sees every organization");
  });

  it("refuses an organization that is not in the ward", () => {
    const outsider = "55555555-5555-4555-8555-555555555555";
    expect(() =>
      checkVisitSharingGrants([{ ownerOrgId: outsider, viewerOrgId: EQ }], ORGANIZATIONS),
    ).toThrow("not in this ward");
  });
});

describe("visitSharingSchema", () => {
  it("refuses an organization shared with itself", () => {
    const result = visitSharingSchema.safeParse({ grants: [{ ownerOrgId: EQ, viewerOrgId: EQ }] });
    expect(result.success).toBe(false);
  });

  it("accepts an empty set, which means nothing is shared", () => {
    expect(visitSharingSchema.safeParse({ grants: [] }).success).toBe(true);
  });
});

describe("describeVisitSharingForReader", () => {
  it("tells the bishopric they see everything", () => {
    expect(describeVisitSharingForReader(true, [])).toContain("sees every organization");
  });

  it("tells a leader with nothing shared that the bishopric decides", () => {
    expect(describeVisitSharingForReader(false, [])).toContain("The bishopric decides");
  });

  it("names the organizations shared with the reader, in order", () => {
    expect(describeVisitSharingForReader(false, ["Relief Society", "Bishopric", "Primary"])).toBe(
      "You see your own organization's visits, and the visits of the Bishopric, Primary and " +
        "Relief Society, which the bishopric has shared with yours.",
    );
  });
});
