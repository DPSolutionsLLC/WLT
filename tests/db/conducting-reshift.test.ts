// @vitest-environment node
//
// Decision 2: marking a Sunday cancelled after its month was generated RE-RESOLVES who conducts
// on the later Sundays. Without this the skip would only ever work for general conference — which
// generateSundays() predicts ahead of time — and never for stake conference, which is always
// hand-set after the fact and is the case that started ITER-002.
//
// The three things this suite exists to pin:
//
//   1. The later Sundays really do shift.
//   2. THE PAST IS NEVER REWRITTEN. Who conducted last March stays what it says.
//   3. The count in the 409 warning equals the number of rows the confirmed write changes. The
//      count that warns and the rows that change come from one computation, so a test that lets
//      them drift is the one that would catch a regression here.
//
// `today` is passed explicitly rather than being read off the clock, which is what makes "the
// past" a fixed thing this suite can assert about.

import type { SupabaseClient } from "@supabase/supabase-js";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  generateSundayRange,
  listSundays,
  replaceConductingRotation,
  updateSunday,
  type Sunday,
} from "@/lib/calendar/queries";
import { asRole } from "@/tests/helpers/asRole";
import { seedFixtures, type Fixtures } from "@/tests/helpers/seed";
import type { Database } from "@/types/database";

// The whole window this suite generates. 2027 so that "today" can sit inside it without the real
// clock ever mattering.
const FROM = "2027-01-01";
const TO = "2027-06-30";

// Mid-March. Sundays before this are "the past" and must survive untouched.
const TODAY = "2027-03-15";

describe("the forward conducting re-shift", () => {
  let fixtures: Fixtures;
  let bishop: SupabaseClient<Database>;
  let wardId: string;

  const readRange = () => listSundays(wardId, { from: FROM, to: TO }, bishop);

  const onDate = (sundays: Sunday[], date: string) =>
    sundays.find((sunday) => sunday.date === date)!;

  const conductorsByDate = async () => {
    const map = new Map<string, string | null>();
    for (const sunday of await readRange()) map.set(sunday.date, sunday.conductingUserId);
    return map;
  };

  beforeAll(async () => {
    fixtures = await seedFixtures(["bishop", "counselor1", "counselor2"]);
    bishop = await asRole(fixtures, "bishop");
    wardId = fixtures.wardAId;

    await replaceConductingRotation(
      wardId,
      {
        effectiveFrom: FROM,
        orgId: null,
        cadence: "weekly",
        positions: [
          { position: 1, userId: fixtures.user("bishop").id },
          { position: 2, userId: fixtures.user("counselor1").id },
          { position: 3, userId: fixtures.user("counselor2").id },
        ],
      },
      bishop,
    );

    await generateSundayRange(wardId, FROM, TO, bishop);
  });

  afterAll(async () => {
    await fixtures.cleanup();
  });

  it("generated a conductor for every Sunday that holds a meeting", async () => {
    const sundays = await readRange();

    for (const sunday of sundays) {
      if (sunday.type === "general_conference") {
        expect(sunday.conductingUserId, sunday.date).toBeNull();
      } else {
        expect(sunday.conductingUserId, sunday.date).not.toBeNull();
      }
    }
  });

  describe("a stake conference set after generation", () => {
    // A Sunday comfortably after TODAY, so every consequence is in the future.
    const EDITED = "2027-04-18";

    let before: Map<string, string | null>;
    let promisedCount: number;

    beforeAll(async () => {
      before = await conductorsByDate();
    });

    it("warns with a count before writing anything", async () => {
      const target = onDate(await readRange(), EDITED);

      const result = await updateSunday(
        wardId,
        target.id,
        { type: "stake_conference" },
        { today: TODAY },
        bishop,
      );

      expect(result?.status).toBe("needs_confirmation");
      if (result?.status !== "needs_confirmation") return;

      // Nothing on this Sunday is at risk — it has no speakers — so the re-shift stands alone
      // under its own reason rather than riding on another warning.
      expect(result.warning.reason).toBe("conducting_reshuffled");
      expect(result.warning.conductingReshiftCount).toBeGreaterThan(0);
      expect(result.warning.message).toContain("Who conducts will also change on");
      expect(result.warning.message).toContain("Sundays already past are left alone");

      promisedCount = result.warning.conductingReshiftCount;
    });

    it("wrote nothing at all while warning", async () => {
      const after = await conductorsByDate();

      expect(onDate(await readRange(), EDITED).type).toBe("standard");
      expect([...after.entries()]).toEqual([...before.entries()]);
    });

    it("applies exactly the number of changes it promised", async () => {
      const target = onDate(await readRange(), EDITED);

      const result = await updateSunday(
        wardId,
        target.id,
        { type: "stake_conference" },
        { confirm: true, today: TODAY },
        bishop,
      );

      expect(result?.status).toBe("applied");
      if (result?.status !== "applied") return;

      expect(result.conductingReshiftCount).toBe(promisedCount);

      // The promise and the outcome, counted independently. This is the assertion that fails if
      // the warning is ever computed from a different walk than the write.
      const after = await conductorsByDate();
      const actuallyChanged = [...after.entries()].filter(
        ([date, userId]) => before.get(date) !== userId,
      );

      // The edited Sunday itself lost its conductor to the CHECK, which is not part of the
      // re-shift count.
      expect(after.get(EDITED)).toBeNull();

      const laterChanged = actuallyChanged.filter(([date]) => date !== EDITED);
      expect(laterChanged).toHaveLength(promisedCount);
    });

    it("never rewrote a Sunday in the past", async () => {
      const after = await conductorsByDate();

      for (const [date, userId] of after) {
        if (date >= TODAY) continue;

        // Who conducted before today stays exactly what it said. This is the doctrine
        // conducting_user_id is a stored column for at all (03-calendar.md Step 3).
        expect(userId, date).toBe(before.get(date));
      }
    });

    it("moved the turn forward rather than losing it", async () => {
      const after = await readRange();
      const later = after.filter((sunday) => sunday.date > EDITED);

      // Whoever the cancelled Sunday would have spent now conducts the next real meeting.
      expect(later[0].conductingUserId).toBe(before.get(EDITED));
    });
  });

  // A cancelled Sunday in the PAST changes nothing at all, in either direction. The horizon is
  // "after the edited date AND on or after today", so an edit to a past Sunday has an empty plan.
  describe("an edit to a Sunday already past", () => {
    const EDITED = "2027-02-14";

    it("re-shifts nothing and needs no confirmation", async () => {
      const before = await conductorsByDate();
      const target = onDate(await readRange(), EDITED);

      const result = await updateSunday(
        wardId,
        target.id,
        { type: "holiday" },
        { today: TODAY },
        bishop,
      );

      expect(result?.status).toBe("applied");
      if (result?.status !== "applied") return;

      expect(result.conductingReshiftCount).toBe(0);
      expect(result.orgConductingReshiftCount).toBe(0);

      // `holiday` holds a meeting, so this Sunday keeps its own conductor too.
      const after = await conductorsByDate();
      expect([...after.entries()]).toEqual([...before.entries()]);
    });
  });

  // The MONTHLY cadence end to end, which is the half no unit test can reach: a month generated
  // AFTER a monthly rotation takes effect, with a Sunday cancelled inside it.
  //
  // Decision 1, stated on real rows: a month spends a turn unless EVERY Sunday in it is cancelled,
  // so one cancelled Sunday inside a month changes nobody. Under a monthly cadence one person
  // already holds the whole month and there is no turn to skip — the exact opposite of what the
  // weekly cycle does above, which is why both belong in the same file.
  //
  // It also pins the FORWARD-ONLY rule that scenario 015's step 9 has to be written around: the
  // cadence is only observable on a month generated after the switch, because a rotation change
  // never rewrites a conductor that is already stored.
  describe("a monthly rotation, on a month generated after the switch", () => {
    // July 2027 — outside the FROM..TO range this suite generated, so it has no rows yet.
    const JULY = ["2027-07-04", "2027-07-11", "2027-07-18", "2027-07-25"];
    const CANCELLED = "2027-07-18";

    beforeAll(async () => {
      await replaceConductingRotation(
        wardId,
        {
          effectiveFrom: "2027-07-01",
          orgId: null,
          cadence: "monthly",
          positions: [
            { position: 1, userId: fixtures.user("bishop").id },
            { position: 2, userId: fixtures.user("counselor1").id },
            { position: 3, userId: fixtures.user("counselor2").id },
          ],
        },
        bishop,
      );

      await generateSundayRange(wardId, "2027-07-01", "2027-07-31", bishop);
    });

    const readJuly = () =>
      listSundays(wardId, { from: "2027-07-01", to: "2027-07-31" }, bishop);

    it("gives one person the whole month", async () => {
      const july = await readJuly();

      expect(july.map((sunday) => sunday.date)).toEqual(JULY);

      const conductors = new Set(july.map((sunday) => sunday.conductingUserId));
      expect(conductors.size).toBe(1);
      expect([...conductors][0]).toBe(fixtures.user("bishop").id);
    });

    it("leaves everybody else alone when one Sunday inside the month is cancelled", async () => {
      const before = await readJuly();
      const target = before.find((sunday) => sunday.date === CANCELLED)!;

      const result = await updateSunday(
        wardId,
        target.id,
        { type: "stake_conference" },
        { confirm: true, today: TODAY },
        bishop,
      );

      expect(result?.status).toBe("applied");

      const after = await readJuly();

      // The cancelled Sunday itself has no conductor at all.
      expect(after.find((sunday) => sunday.date === CANCELLED)?.conductingUserId).toBeNull();

      // And every other Sunday of the month is untouched — one cancelled Sunday costs nobody a
      // turn under a monthly cadence.
      for (const sunday of after) {
        if (sunday.date === CANCELLED) continue;
        expect(sunday.conductingUserId, sunday.date).toBe(fixtures.user("bishop").id);
      }
    });
  });

  // Un-cancelling is the other direction, and it has to work or a bishopric can never undo a
  // mistake without hand-editing every later Sunday.
  describe("clearing a cancellation", () => {
    const EDITED = "2027-04-18";

    it("shifts the later Sundays back and gives the Sunday its own conductor", async () => {
      const before = await conductorsByDate();
      const target = onDate(await readRange(), EDITED);
      expect(target.type).toBe("stake_conference");

      const result = await updateSunday(
        wardId,
        target.id,
        { type: "standard" },
        { confirm: true, today: TODAY },
        bishop,
      );

      expect(result?.status).toBe("applied");
      if (result?.status !== "applied") return;

      const after = await readRange();
      expect(onDate(after, EDITED).conductingUserId).not.toBeNull();

      // Back to where it started, because the rotation is a pure function of the meeting history.
      const restored = await conductorsByDate();
      for (const [date, userId] of restored) {
        if (date < TODAY) expect(userId, date).toBe(before.get(date));
      }
    });
  });
});
