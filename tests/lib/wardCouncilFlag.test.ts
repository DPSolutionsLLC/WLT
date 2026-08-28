// @vitest-environment node
//
// The SHARED ward-council flag helper, and the two module wrappers that now sit on top of it.
//
// ---------------------------------------------------------------------------
// WHAT THIS SUITE EXISTS FOR
// ---------------------------------------------------------------------------
// youth-d moved the recipient resolution out of lib/visits/flagNotification.ts and into
// lib/notifications/notifyWardCouncilFlag.ts so Phase 8 could reuse it rather than copy it. Three
// things had to survive that move, and none of them is visible from a type signature:
//
//   1. THE TRIGGER KEY IS THE CALLER'S. The opt-out lookup inside emitNotification is keyed on the
//      trigger, so a hardcoded key would deliver a youth follow-up to somebody who had switched
//      visit flags off — the exact bug notifyOrgLeadership's header records having avoided.
//   2. A WARD WITH NO EXECUTIVE SECRETARY GETS NOTHING, and does NOT fall back to the bishopric.
//      Widening an audience is a product decision and quietly is the wrong way to take it.
//   3. THE BODY IS THE ONE-LINER. Not the shared notes, not a summary of them, and never the
//      private note (CLAUDE.md rule 5).
//
// It runs over the network against the shared hosted project, so it cleans up after itself and
// never assumes an empty table (CLAUDE.md §9).

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { notifyWardCouncilFlag as notifyShared } from "@/lib/notifications/notifyWardCouncilFlag";
import {
  notifyWardCouncilFlag as notifyVisitFlag,
  wardCouncilFlagBody,
} from "@/lib/visits/flagNotification";
import {
  YOUTH_FLAG_TRIGGER_KEY,
  notifyYouthWardCouncilFlag,
  youthWardCouncilFlagBody,
} from "@/lib/youth/flagNotification";
import { seedFixtures, type Fixtures } from "@/tests/helpers/seed";

const VISIT_TRIGGER = "visit_flagged_for_ward_council";

describe("the ward council flag notification", () => {
  let fixtures: Fixtures;

  async function rowsFor(triggerKey: string, wardId: string) {
    const { data, error } = await fixtures.service
      .from("notifications")
      .select("recipient_user_id, title, body")
      .eq("ward_id", wardId)
      .eq("trigger_key", triggerKey);

    if (error) throw new Error(error.message);
    return data ?? [];
  }

  beforeAll(async () => {
    // WARD B TAKES NO EXECUTIVE SECRETARY, deliberately: it is how the "nobody to tell" branch is
    // reachable at all. Ward A has one, so the two wards are the two sides of the same assertion.
    fixtures = await seedFixtures(["bishop", "executiveSecretary", "wardBBishop"], {
      notificationTriggers: [
        { triggerKey: VISIT_TRIGGER, defaultRoles: ["executive_secretary"] },
        { triggerKey: YOUTH_FLAG_TRIGGER_KEY, defaultRoles: ["executive_secretary"] },
      ],
    });
  }, 180_000);

  afterAll(async () => {
    await fixtures?.cleanup();
  });

  describe("the shared helper", () => {
    it("addresses the executive secretary and nobody else", async () => {
      await notifyShared(
        {
          wardId: fixtures.wardAId,
          triggerKey: VISIT_TRIGGER,
          title: "Visit flagged for ward council",
          body: wardCouncilFlagBody("Elders Quorum", "Brooks"),
        },
        fixtures.service,
      );

      const rows = await rowsFor(VISIT_TRIGGER, fixtures.wardAId);

      // Exactly one row. The bishop is not on it, even though he could read the visit — the flag
      // is a request for an AGENDA ITEM, and the agenda is one person's.
      expect(rows.map((row) => row.recipient_user_id)).toEqual([
        fixtures.user("executiveSecretary").id,
      ]);
    });

    // The one-liner and nothing else. A notification row is read by somebody who cannot open the
    // record, so anything more would carry note text out past every boundary Phases 7 and 8 built.
    it("carries the caller's body verbatim and adds nothing of its own", async () => {
      const rows = await rowsFor(VISIT_TRIGGER, fixtures.wardAId);

      expect(rows[0]?.body).toBe("Elders Quorum — Brooks — requested for ward council discussion");
      expect(rows[0]?.title).toBe("Visit flagged for ward council");
    });

    // ---------------------------------------------------------------------
    // NO EXECUTIVE SECRETARY, NO NOTIFICATION, AND NO FALLBACK
    // ---------------------------------------------------------------------
    // Ward B has a bishop and no executive secretary. A helper that fell back to the bishopric
    // would produce a row here — which is why the assertion is on ward B's rows being EMPTY
    // rather than on the absence of an error.
    it("emits nothing for a ward with no executive secretary, and does not fall back", async () => {
      await notifyShared(
        {
          wardId: fixtures.wardBId,
          triggerKey: VISIT_TRIGGER,
          title: "Visit flagged for ward council",
          body: wardCouncilFlagBody("Ward", "A household"),
        },
        fixtures.service,
      );

      expect(await rowsFor(VISIT_TRIGGER, fixtures.wardBId)).toEqual([]);
    });

    // Never throws — the write it follows has already committed, and a notification failure must
    // degrade the message rather than fail the edit the leader just made.
    it("does not throw for a ward that does not exist", async () => {
      await expect(
        notifyShared(
          {
            wardId: "00000000-0000-4000-8000-00000000dead",
            triggerKey: VISIT_TRIGGER,
            title: "Visit flagged for ward council",
            body: "nothing",
          },
          fixtures.service,
        ),
      ).resolves.toBeUndefined();
    });
  });

  // ---------------------------------------------------------------------------
  // THE TRIGGER KEY IS THE CALLER'S, WHICH IS THE WHOLE REASON THE PARAMETER EXISTS
  // ---------------------------------------------------------------------------
  // Both wrappers are called against the same ward. If the shared helper hardcoded a key, one of
  // these two assertions would find the other module's row under its own trigger.
  describe("the two module wrappers", () => {
    it("files a youth follow-up under the youth trigger, not the visits one", async () => {
      await notifyYouthWardCouncilFlag(
        {
          wardId: fixtures.wardAId,
          activityName: "Varsity basketball",
          eventTitle: "Game against Roosevelt",
        },
        fixtures.service,
      );

      const youthRows = await rowsFor(YOUTH_FLAG_TRIGGER_KEY, fixtures.wardAId);

      expect(youthRows.map((row) => row.recipient_user_id)).toEqual([
        fixtures.user("executiveSecretary").id,
      ]);
      expect(youthRows[0]?.body).toBe(
        "Varsity basketball — Game against Roosevelt — requested for ward council discussion",
      );
      expect(youthRows[0]?.title).toBe("Youth activity follow-up flagged for ward council");
    });

    it("leaves the visits trigger holding only the visits rows", async () => {
      const visitRows = await rowsFor(VISIT_TRIGGER, fixtures.wardAId);

      for (const row of visitRows) {
        expect(row.body).not.toContain("Varsity basketball");
      }
    });

    // The visits call site did not change at all when the helper moved — this is the assertion
    // that says so from the outside, by exercising the wrapper's own signature.
    it("keeps the visits wrapper's own signature and body", async () => {
      await notifyVisitFlag(
        { wardId: fixtures.wardAId, orgName: "Relief Society", familyName: "Chen" },
        fixtures.service,
      );

      const bodies = (await rowsFor(VISIT_TRIGGER, fixtures.wardAId)).map((row) => row.body);

      expect(bodies).toContain(
        "Relief Society — Chen — requested for ward council discussion",
      );
    });
  });

  // The body builders are pure, so these need no database at all — and they are what the two
  // wrappers hand to the shared helper.
  describe("the body builders", () => {
    it("names the organization and the family for a visit", () => {
      expect(wardCouncilFlagBody("Elders Quorum", "Brooks")).toBe(
        "Elders Quorum — Brooks — requested for ward council discussion",
      );
    });

    // THE ACTIVITY AND THE EVENT, AND NO YOUTH'S NAME. A young person's name in a notification
    // addressed to somebody who cannot open the record is a fact travelling further than the
    // record it came from.
    it("names the activity and the event for a youth follow-up", () => {
      const body = youthWardCouncilFlagBody("Varsity basketball", "Game against Roosevelt");

      expect(body).toBe(
        "Varsity basketball — Game against Roosevelt — requested for ward council discussion",
      );
      expect(body).not.toContain("Ethan");
    });
  });
});
