// @vitest-environment node
//
// Migration 027's CHECK, and the TypeScript-side rule that sunday_org_conducting is guarded by
// instead of a constraint.
//
// The asymmetry is deliberate (migration 027, Part 3): a constraint on sunday_org_conducting
// cannot see the Sunday's type, so it would have to be a trigger, and this repo has no triggers.
// That makes lib/calendar/queries.ts and the org-conducting route the only things keeping that
// half of the rule — which is exactly why it is tested here rather than assumed.
//
// A CHECK violation RAISES, unlike an RLS refusal, which comes back as a zero-row success. So the
// constraint assertions look for an error rather than re-reading the row.
//
// The tests run in order and share one generated month. November 2026 has five Sundays — the 1st,
// 8th, 15th, 22nd and 29th — and generation puts Fast Sunday on the 1st, which is why no test
// below uses it.

import type { SupabaseClient } from "@supabase/supabase-js";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { lastDayOfMonth } from "@/lib/calendar/dates";
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

describe("Sundays that hold no meeting", () => {
  let fixtures: Fixtures;
  let bishop: SupabaseClient<Database>;
  let wardId: string;
  let november: Sunday[];

  const readMonth = (month: string) =>
    listSundays(wardId, { from: `${month}-01`, to: lastDayOfMonth(`${month}-01`) }, bishop);

  const onDate = (sundays: Sunday[], date: string) =>
    sundays.find((sunday) => sunday.date === date)!;

  beforeAll(async () => {
    fixtures = await seedFixtures([
      "bishop",
      "counselor1",
      "counselor2",
      "eqPresident",
      "eqCounselor",
      "eqSecretary",
    ]);
    bishop = await asRole(fixtures, "bishop");
    wardId = fixtures.wardAId;

    await replaceConductingRotation(
      wardId,
      {
        effectiveFrom: "2026-11-01",
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

    // A rotation has exactly three positions (lib/validation/calendar.ts), organizations
    // included.
    await replaceConductingRotation(
      wardId,
      {
        effectiveFrom: "2026-11-01",
        orgId: fixtures.eldersQuorumId,
        cadence: "weekly",
        positions: [
          { position: 1, userId: fixtures.user("eqPresident").id },
          { position: 2, userId: fixtures.user("eqCounselor").id },
          { position: 3, userId: fixtures.user("eqSecretary").id },
        ],
      },
      bishop,
    );

    await generateSundayRange(wardId, "2026-11-01", "2026-11-30", bishop);
    november = await readMonth("2026-11");
  });

  afterAll(async () => {
    await fixtures.cleanup();
  });

  it("generated a month with a conductor on every Sunday that holds a meeting", async () => {
    expect(november).toHaveLength(5);
    expect(november.every((sunday) => sunday.conductingUserId !== null)).toBe(true);
  });

  describe("the CHECK constraint", () => {
    it("refuses a conductor on a stake conference row", async () => {
      const target = onDate(november, "2026-11-15");

      // The type is set through updateSunday() first, on its own, so the raw UPDATE below is the
      // only thing under test.
      const applied = await updateSunday(
        wardId,
        target.id,
        { type: "stake_conference" },
        { confirm: true },
        bishop,
      );
      expect(applied?.status).toBe("applied");

      const { error } = await fixtures.service
        .from("sundays")
        .update({ conducting_user_id: fixtures.user("bishop").id })
        .eq("ward_id", wardId)
        .eq("id", target.id);

      // A CHECK violation raises. This is the loud failure migration 027 chose over a silent
      // wrong answer.
      expect(error).not.toBeNull();
      expect(error?.message).toContain("sundays_no_conductor_without_meeting");
    });

    // The reason updateSunday() has to clear the conductor in the SAME statement that changes the
    // type: doing it in two statements looks like this.
    it("refuses a type change that leaves a conductor behind", async () => {
      const target = onDate(november, "2026-11-22");

      const { error } = await fixtures.service
        .from("sundays")
        .update({ type: "general_conference" })
        .eq("ward_id", wardId)
        .eq("id", target.id);

      expect(error).not.toBeNull();
      expect(error?.message).toContain("sundays_no_conductor_without_meeting");

      // And the row is untouched, so the next test can still use it.
      expect(onDate(await readMonth("2026-11"), "2026-11-22").type).toBe("standard");
    });

    // The types that cannot be Fast Sunday but DO hold a meeting. If the constraint ever names
    // these, the two lists have merged back into one in SQL.
    it.each(["holiday", "ward_conference"] as const)(
      "allows a conductor on %s",
      async (type) => {
        const target = onDate(november, "2026-11-29");

        const { error } = await fixtures.service
          .from("sundays")
          .update({ type, conducting_user_id: fixtures.user("bishop").id })
          .eq("ward_id", wardId)
          .eq("id", target.id);

        expect(error).toBeNull();
      },
    );
  });

  describe("updateSunday clears the conductor in the same statement", () => {
    it("succeeds where a two-statement patch would have raised", async () => {
      const target = onDate(november, "2026-11-08");
      expect(target.conductingUserId).not.toBeNull();
      expect(target.speakingSlots).toBeGreaterThan(0);

      const result = await updateSunday(
        wardId,
        target.id,
        { type: "general_conference" },
        { confirm: true },
        bishop,
      );

      expect(result?.status).toBe("applied");
      if (result?.status !== "applied") return;

      expect(result.sunday.type).toBe("general_conference");
      expect(result.sunday.conductingUserId).toBeNull();
      expect(result.sunday.speakingSlots).toBe(0);
    });

    it("deletes the organization conducting rows rather than nulling them", async () => {
      const target = onDate(november, "2026-11-08");

      const { data, error } = await bishop
        .from("sunday_org_conducting")
        .select("id, user_id")
        .eq("ward_id", wardId)
        .eq("sunday_id", target.id);

      expect(error).toBeNull();

      // Gone entirely. A null user_id already means "the rotation reaches this Sunday but the
      // position is unfilled" (migration 024, Part 4), which is a different fact from "there is
      // no meeting".
      expect(data).toHaveLength(0);
    });

    // general_conference -> ward_conference is the no-meeting-to-meeting direction, and the only
    // reason it exists as a real case is that ward_conference holds an ordinary meeting.
    it("restores the conductor, the slots and the organization rows when a meeting comes back", async () => {
      const target = onDate(november, "2026-11-08");

      const result = await updateSunday(
        wardId,
        target.id,
        { type: "ward_conference" },
        { confirm: true },
        bishop,
      );

      expect(result?.status).toBe("applied");

      const after = onDate(await readMonth("2026-11"), "2026-11-08");
      expect(after.type).toBe("ward_conference");
      expect(after.conductingUserId).not.toBeNull();
      expect(after.speakingSlots).toBeGreaterThan(0);

      const { data } = await bishop
        .from("sunday_org_conducting")
        .select("id")
        .eq("ward_id", wardId)
        .eq("sunday_id", target.id);

      expect(data?.length).toBeGreaterThan(0);
    });
  });

  // THE SHAPE THE REAL FORM SENDS.
  //
  // Every other test in this file patches `{ type }` on its own, and all of them passed while the
  // app was broken. SundayEditor submits the WHOLE form on every save, so a type change arrives
  // with `conductingUserId` still set to whoever the dropdown was showing — and a patch that
  // spread the submitted conductor after the no-meeting clear silently put it back and hit the
  // CHECK. A user could not work around it by choosing "Nobody" first, because the type and the
  // conductor travel in the same request.
  describe("a patch carrying BOTH the type and a conductor", () => {
    it("clears the conductor anyway when the new type holds no meeting", async () => {
      const target = onDate(await readMonth("2026-11"), "2026-11-29");
      expect(target.conductingUserId).not.toBeNull();

      const result = await updateSunday(
        wardId,
        target.id,
        {
          type: "stake_conference",
          // Exactly what the form sends: the conductor who is still selected on screen.
          conductingUserId: fixtures.user("bishop").id,
        },
        { confirm: true },
        bishop,
      );

      expect(result?.status).toBe("applied");
      if (result?.status !== "applied") return;

      // The no-meeting rule OUTRANKS the submitted value. A Sunday that holds no sacrament
      // meeting has no conductor, whatever the form happened to be showing.
      expect(result.sunday.type).toBe("stake_conference");
      expect(result.sunday.conductingUserId).toBeNull();
    });

    it("still honours a submitted conductor when the type does hold a meeting", async () => {
      const target = onDate(await readMonth("2026-11"), "2026-11-29");

      const result = await updateSunday(
        wardId,
        target.id,
        {
          type: "ward_conference",
          conductingUserId: fixtures.user("counselor1").id,
        },
        { confirm: true },
        bishop,
      );

      expect(result?.status).toBe("applied");
      if (result?.status !== "applied") return;

      expect(result.sunday.type).toBe("ward_conference");
      expect(result.sunday.conductingUserId).toBe(fixtures.user("counselor1").id);
    });
  });

  // The other half of the split. `holiday` used to share one list with the conference types, so
  // marking Christmas Sunday a holiday warned that its speakers were being orphaned and blanked
  // its conductor. A ward that marks a holiday still meets.
  describe("a holiday still holds a meeting", () => {
    it("keeps its conductor and its speaking slots", async () => {
      const before = onDate(await readMonth("2026-11"), "2026-11-22");
      expect(before.type).toBe("standard");
      expect(before.conductingUserId).not.toBeNull();
      expect(before.speakingSlots).toBeGreaterThan(0);

      const result = await updateSunday(
        wardId,
        before.id,
        { type: "holiday" },
        { confirm: true },
        bishop,
      );

      expect(result?.status).toBe("applied");
      if (result?.status !== "applied") return;

      expect(result.sunday.type).toBe("holiday");
      expect(result.sunday.conductingUserId).toBe(before.conductingUserId);
      expect(result.sunday.speakingSlots).toBe(before.speakingSlots);
    });

    it("keeps its organization conducting rows", async () => {
      const target = onDate(await readMonth("2026-11"), "2026-11-22");

      const { data } = await bishop
        .from("sunday_org_conducting")
        .select("id")
        .eq("ward_id", wardId)
        .eq("sunday_id", target.id);

      expect(data?.length).toBeGreaterThan(0);
    });
  });
});
