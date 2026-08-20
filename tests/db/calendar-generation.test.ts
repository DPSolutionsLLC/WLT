// @vitest-environment node
//
// Run against the hosted database on purpose. Idempotency lives in one PostgREST option
// (`ignoreDuplicates`) and fast-Sunday re-resolution lives in a plpgsql function, so a mocked
// client here would test the mock and prove nothing about the guarantees that matter. Unit tests
// of the pure rules pass either way — roster-a shipped a search bug that every unit test passed
// and only a suite like this one caught (plans/retros/roster-a-data-and-pages.md).
//
// Assertions run through a BISHOP client, not the service client, so RLS applies exactly as it
// will in the app. Fixtures clean up after themselves and never assume an empty table — these run
// against the shared project (CLAUDE.md §9).
//
// The tests in this file run in order and share one generated calendar. Each one names the state
// it expects to inherit.

import type { SupabaseClient } from "@supabase/supabase-js";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  readDefaultSpeakingSlots,
  writeDefaultSpeakingSlots,
} from "@/lib/calendar/wardCalendarSettings";
import {
  ensureMonthGenerated,
  generateSundayRange,
  listSundays,
  replaceConductingRotation,
  updateSunday,
  type Sunday,
} from "@/lib/calendar/queries";
import { lastDayOfMonth } from "@/lib/calendar/dates";
import { asRole } from "@/tests/helpers/asRole";
import { seedFixtures, type Fixtures } from "@/tests/helpers/seed";
import type { Database } from "@/types/database";

const FROM = "2026-01-01";
const TO = "2026-03-31";

// January has 4 Sundays, February 4, March 5.
const EXPECTED_SUNDAYS = 13;

describe("calendar generation", () => {
  let fixtures: Fixtures;
  let bishop: SupabaseClient<Database>;
  let wardId: string;

  const readRange = () => listSundays(wardId, { from: FROM, to: TO }, bishop);

  const readMonth = (month: string) =>
    listSundays(
      wardId,
      { from: `${month}-01`, to: lastDayOfMonth(`${month}-01`) },
      bishop,
    );

  const fastSundayOf = (sundays: Sunday[]) =>
    sundays.find((sunday) => sunday.type === "fast_sunday") ?? null;

  beforeAll(async () => {
    fixtures = await seedFixtures(["bishop", "counselor1", "counselor2"]);
    bishop = await asRole(fixtures, "bishop");
    wardId = fixtures.wardAId;
  });

  afterAll(async () => {
    await fixtures.cleanup();
  });

  it("creates every Sunday in the range", async () => {
    const result = await generateSundayRange(wardId, FROM, TO, bishop);

    expect(result.created).toBe(EXPECTED_SUNDAYS);
    expect(result.monthsResolved).toBe(3);

    const sundays = await readRange();
    expect(sundays).toHaveLength(EXPECTED_SUNDAYS);
    expect(sundays[0].date).toBe("2026-01-04");
    expect(sundays.at(-1)?.date).toBe("2026-03-29");
  });

  it("puts Fast Sunday on the first Sunday of each generated month", async () => {
    expect(fastSundayOf(await readMonth("2026-01"))?.date).toBe("2026-01-04");
    expect(fastSundayOf(await readMonth("2026-02"))?.date).toBe("2026-02-01");
    expect(fastSundayOf(await readMonth("2026-03"))?.date).toBe("2026-03-01");
  });

  // The single most important assertion in the phase. Full rows are compared, not a count: a
  // generation that overwrote `notes` or reset `speaking_slots` would keep the count identical
  // while destroying every bishopric edit in the range.
  it("changes nothing at all when the same range is generated again", async () => {
    const before = await readRange();

    const result = await generateSundayRange(wardId, FROM, TO, bishop);
    expect(result.created).toBe(0);

    const after = await readRange();
    expect(after).toEqual(before);
  });

  it("leaves a hand-edited Sunday alone when its range is regenerated", async () => {
    const target = (await readMonth("2026-02")).find(
      (sunday) => sunday.date === "2026-02-15",
    );
    expect(target).toBeDefined();

    const edited = await updateSunday(
      wardId,
      target!.id,
      { type: "special", notes: "Primary program", speakingSlots: 1 },
      { confirm: true },
      bishop,
    );
    expect(edited?.status).toBe("applied");

    await generateSundayRange(wardId, FROM, TO, bishop);

    const after = (await readMonth("2026-02")).find(
      (sunday) => sunday.date === "2026-02-15",
    );
    expect(after?.type).toBe("special");
    expect(after?.notes).toBe("Primary program");
    expect(after?.speakingSlots).toBe(1);
  });

  it("moves Fast Sunday forward when a stake conference lands on it", async () => {
    const january = await readMonth("2026-01");
    const first = january.find((sunday) => sunday.date === "2026-01-04");

    const result = await updateSunday(
      wardId,
      first!.id,
      { type: "stake_conference" },
      undefined,
      bishop,
    );
    expect(result?.status).toBe("applied");

    const after = await readMonth("2026-01");
    expect(fastSundayOf(after)?.date).toBe("2026-01-11");
    expect(after.find((sunday) => sunday.date === "2026-01-11")?.speakingSlots).toBe(0);
    expect(after.find((sunday) => sunday.date === "2026-01-04")?.type).toBe(
      "stake_conference",
    );
  });

  // The direction 03-calendar.md warns is easiest to forget.
  it("moves Fast Sunday back when the stake conference is cleared", async () => {
    const january = await readMonth("2026-01");
    const first = january.find((sunday) => sunday.date === "2026-01-04");

    const result = await updateSunday(
      wardId,
      first!.id,
      { type: "standard" },
      undefined,
      bishop,
    );
    expect(result?.status).toBe("applied");

    const after = await readMonth("2026-01");
    expect(fastSundayOf(after)?.date).toBe("2026-01-04");
    expect(after.find((sunday) => sunday.date === "2026-01-04")?.speakingSlots).toBe(0);

    // The Sunday that was temporarily fast is restored to the documented default of 3 — a
    // hand-set value would have been discarded here, which migration 023 documents.
    const eleventh = after.find((sunday) => sunday.date === "2026-01-11");
    expect(eleventh?.type).toBe("standard");
    expect(eleventh?.speakingSlots).toBe(3);
  });

  it("populates who conducts from the rotation, cycling 1 to 2 to 3", async () => {
    await replaceConductingRotation(
      wardId,
      {
        effectiveFrom: "2026-01-01",
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

    const january = await readMonth("2026-01");
    const conductorOn = (date: string) =>
      january.find((sunday) => sunday.date === date)?.conductingUserId;

    expect(conductorOn("2026-01-04")).toBe(fixtures.user("bishop").id);
    expect(conductorOn("2026-01-11")).toBe(fixtures.user("counselor1").id);
    expect(conductorOn("2026-01-18")).toBe(fixtures.user("counselor2").id);
    expect(conductorOn("2026-01-25")).toBe(fixtures.user("bishop").id);
  });

  it("never overwrites a conducting override with a later generation", async () => {
    const january = await readMonth("2026-01");
    const eighteenth = january.find((sunday) => sunday.date === "2026-01-18");

    await updateSunday(
      wardId,
      eighteenth!.id,
      { conductingUserId: fixtures.user("bishop").id },
      undefined,
      bishop,
    );

    await generateSundayRange(wardId, FROM, TO, bishop);

    const after = await readMonth("2026-01");
    expect(after.find((sunday) => sunday.date === "2026-01-18")?.conductingUserId).toBe(
      fixtures.user("bishop").id,
    );
  });

  it("generates a whole month on demand and is a no-op the second time", async () => {
    const generated = await ensureMonthGenerated(wardId, "2026-07-19", bishop);

    expect(generated.map((sunday) => sunday.date)).toEqual([
      "2026-07-05",
      "2026-07-12",
      "2026-07-19",
      "2026-07-26",
    ]);
    expect(generated.find((sunday) => sunday.date === "2026-07-05")?.type).toBe(
      "fast_sunday",
    );

    const again = await ensureMonthGenerated(wardId, "2026-07-01", bishop);
    expect(again).toEqual(generated);
  });

  // Repairing a half-finished generation.
  //
  // generateSundayRange() inserts the Sunday rows, resolves Fast Sunday, and assigns conductors
  // in three separate statements — supabase-js has no transaction API — so anything that abandons
  // the request in between leaves the month partly built. A cancelled Next.js prefetch of the
  // prev/next month link does exactly that. ensureMonthGenerated() used to return early on "this
  // month has rows", which made the damage permanent: no action in the UI could repair it.
  //
  // These run on their own months, generated here. The rest of this file shares one calendar and
  // inherits state in order; a repair test that mutated those months would break its neighbours.
  describe("repairing a half-finished generation", () => {
    const CONDUCTOR_GAP = "2027-02";
    const FAST_SUNDAY_GAP = "2027-03";
    const ALL_DISPLACED = "2027-05";
    const HAND_SET = "2027-06";

    beforeAll(async () => {
      for (const month of [CONDUCTOR_GAP, FAST_SUNDAY_GAP, ALL_DISPLACED, HAND_SET]) {
        await ensureMonthGenerated(wardId, `${month}-01`, bishop);
      }
    });

    // The wreckage is simulated rather than produced by breaking generation, because its SHAPE is
    // what ensureMonthGenerated has to recognise, not the failure that caused it.
    it("fills conductors on a month whose Sundays exist but never got one", async () => {
      const before = await readMonth(CONDUCTOR_GAP);
      expect(before.every((sunday) => sunday.conductingUserId !== null)).toBe(true);

      const { error } = await fixtures.service
        .from("sundays")
        .update({ conducting_user_id: null })
        .eq("ward_id", wardId)
        .gte("date", `${CONDUCTOR_GAP}-01`)
        // lastDayOfMonth, never a pasted "-31": February has no 31st and Postgres answers
        // "date/time field value out of range" rather than an empty result.
        .lte("date", lastDayOfMonth(`${CONDUCTOR_GAP}-01`));
      expect(error).toBeNull();

      const repaired = await ensureMonthGenerated(wardId, `${CONDUCTOR_GAP}-15`, bishop);

      expect(repaired.map((sunday) => sunday.conductingUserId)).toEqual(
        before.map((sunday) => sunday.conductingUserId),
      );
      // Gap-filling, not regeneration: nothing else about the month moves.
      expect(repaired.map((sunday) => sunday.date)).toEqual(before.map((s) => s.date));
      expect(repaired.map((sunday) => sunday.type)).toEqual(before.map((s) => s.type));
    });

    // The other kind of wreckage the same abort leaves: apply_fast_sunday() never ran, so the
    // month has no Fast Sunday at all.
    it("restores a Fast Sunday to a month that lost it", async () => {
      const before = await readMonth(FAST_SUNDAY_GAP);
      const originalFastSunday = fastSundayOf(before);
      expect(originalFastSunday).not.toBeNull();

      const { error } = await fixtures.service
        .from("sundays")
        .update({ type: "standard", speaking_slots: 3 })
        .eq("ward_id", wardId)
        .eq("id", originalFastSunday!.id);
      expect(error).toBeNull();

      const repaired = await ensureMonthGenerated(wardId, `${FAST_SUNDAY_GAP}-15`, bishop);

      expect(fastSundayOf(repaired)?.date).toBe(originalFastSunday!.date);
      expect(fastSundayOf(repaired)?.speakingSlots).toBe(0);
    });

    // A month that genuinely has no Fast Sunday — a stake conference weekend — must be left
    // alone. Without the second half of the condition this would force one onto a Sunday the
    // bishopric had deliberately displaced, on every page view.
    it("leaves a month with every Sunday displaced without a Fast Sunday", async () => {
      const month = await readMonth(ALL_DISPLACED);

      for (const sunday of month) {
        const { error } = await fixtures.service
          .from("sundays")
          .update({ type: "stake_conference" })
          .eq("ward_id", wardId)
          .eq("id", sunday.id);
        expect(error).toBeNull();
      }

      const after = await ensureMonthGenerated(wardId, `${ALL_DISPLACED}-15`, bishop);

      expect(fastSundayOf(after)).toBeNull();
      expect(after.every((sunday) => sunday.type === "stake_conference")).toBe(true);
    });

    // The guarantee that makes it safe to repair on a READ at all: a conductor a human set is
    // never overwritten (03-calendar.md Step 3).
    it("leaves a hand-set conductor alone while filling its neighbours", async () => {
      const month = await readMonth(HAND_SET);
      const [first, second] = month;

      const { error } = await fixtures.service
        .from("sundays")
        .update({ conducting_user_id: null })
        .eq("ward_id", wardId)
        .eq("id", second.id);
      expect(error).toBeNull();

      const overridden = fixtures.user("counselor2").id;
      const { error: overrideError } = await fixtures.service
        .from("sundays")
        .update({ conducting_user_id: overridden })
        .eq("ward_id", wardId)
        .eq("id", first.id);
      expect(overrideError).toBeNull();

      const repaired = await ensureMonthGenerated(wardId, `${HAND_SET}-15`, bishop);

      expect(repaired.find((sunday) => sunday.id === first.id)?.conductingUserId).toBe(
        overridden,
      );
      expect(repaired.find((sunday) => sunday.id === second.id)?.conductingUserId).toBe(
        second.conductingUserId,
      );
    });
  });

  // The ward's default speaker count is a setting, and it has TWO readers that must agree: the
  // TypeScript generator and apply_fast_sunday() in migration 023. A test that only checked
  // generation would miss a SQL function still restoring a hard-coded 3.
  describe("ward default speaking slots", () => {
    it("defaults to three for a ward that has never set one", async () => {
      expect(await readDefaultSpeakingSlots(wardId, bishop)).toBe(3);
    });

    it("generates new Sundays with the ward's number of speakers", async () => {
      const saved = await writeDefaultSpeakingSlots(wardId, 5, bishop);
      expect(saved).toBe(5);

      const september = await ensureMonthGenerated(wardId, "2026-09-01", bishop);

      expect(september.find((sunday) => sunday.date === "2026-09-06")?.type).toBe(
        "fast_sunday",
      );
      expect(
        september.find((sunday) => sunday.date === "2026-09-13")?.speakingSlots,
      ).toBe(5);
      expect(
        september.find((sunday) => sunday.date === "2026-09-20")?.speakingSlots,
      ).toBe(5);
    });

    it("restores the ward's default, not a hard-coded three, when a Sunday stops being fast", async () => {
      const september = await readMonth("2026-09");
      const sixth = september.find((sunday) => sunday.date === "2026-09-06");

      // Fast Sunday moves off the 6th...
      await updateSunday(
        wardId,
        sixth!.id,
        { type: "stake_conference" },
        { confirm: true },
        bishop,
      );

      // ...and back onto it, which is the path that restores the 13th.
      await updateSunday(
        wardId,
        sixth!.id,
        { type: "standard" },
        { confirm: true },
        bishop,
      );

      const after = await readMonth("2026-09");
      expect(after.find((sunday) => sunday.date === "2026-09-06")?.type).toBe(
        "fast_sunday",
      );

      const thirteenth = after.find((sunday) => sunday.date === "2026-09-13");
      expect(thirteenth?.type).toBe("standard");
      expect(thirteenth?.speakingSlots).toBe(5);
    });

    it("does not rewrite Sundays already on the calendar", async () => {
      // January was generated before the default changed and keeps what it had.
      const january = await readMonth("2026-01");

      expect(january.find((sunday) => sunday.date === "2026-01-25")?.speakingSlots).toBe(
        3,
      );
    });

    it("falls back to three when the stored setting is malformed", async () => {
      const { error } = await fixtures.service
        .from("wards")
        .update({ settings: { default_speaking_slots: "several" } })
        .eq("id", wardId);
      expect(error).toBeNull();

      expect(await readDefaultSpeakingSlots(wardId, bishop)).toBe(3);

      const october = await ensureMonthGenerated(wardId, "2026-10-01", bishop);
      expect(
        october.find((sunday) => sunday.date === "2026-10-18")?.speakingSlots,
      ).toBe(3);
    });
  });

  it("refuses a second rotation on a date that already has one", async () => {
    await expect(
      replaceConductingRotation(
        wardId,
        {
          effectiveFrom: "2026-01-01",
          orgId: null,
          cadence: "weekly",
          positions: [
            { position: 1, userId: fixtures.user("counselor1").id },
            { position: 2, userId: fixtures.user("counselor2").id },
            { position: 3, userId: fixtures.user("bishop").id },
          ],
        },
        bishop,
      ),
    ).rejects.toThrow(/already takes effect/);
  });
});
