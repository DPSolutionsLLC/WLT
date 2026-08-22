// @vitest-environment node
//
// The 409 path, end to end against the hosted database. What is asserted here is the part no unit
// test can reach: that on "needs_confirmation" NOTHING was written, and that on confirm the
// assignment still exists rather than having been deleted.
//
// Assertions run through a BISHOP client — `assignments` is a bishopric-only table under
// migration 019, so a non-bishopric client would read zero assignments and every collision
// assertion here would pass while proving nothing.

import type { SupabaseClient } from "@supabase/supabase-js";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  generateSundayRange,
  listSundays,
  updateSunday,
  type Sunday,
} from "@/lib/calendar/queries";
import { lastDayOfMonth } from "@/lib/calendar/dates";
import { asRole } from "@/tests/helpers/asRole";
import { seedFixtures, type Fixtures } from "@/tests/helpers/seed";
import type { Database } from "@/types/database";

describe("fast Sunday collision", () => {
  let fixtures: Fixtures;
  let bishop: SupabaseClient<Database>;
  let secretary: SupabaseClient<Database>;
  let wardId: string;

  let march: Sunday[];
  let assignmentId: string;

  const readMonth = async (month: string) =>
    listSundays(
      wardId,
      { from: `${month}-01`, to: lastDayOfMonth(`${month}-01`) },
      bishop,
    );

  const onDate = (sundays: Sunday[], date: string) =>
    sundays.find((sunday) => sunday.date === date)!;

  beforeAll(async () => {
    fixtures = await seedFixtures(["bishop", "wardSecretary"]);
    bishop = await asRole(fixtures, "bishop");
    secretary = await asRole(fixtures, "wardSecretary");
    wardId = fixtures.wardAId;

    await generateSundayRange(wardId, "2026-03-01", "2026-05-31", bishop);
    march = await readMonth("2026-03");

    // Seeded through the service client so the fixture does not depend on the assignment-creation
    // route, which Phase 4 has not built yet.
    const { data, error } = await fixtures.service
      .from("assignments")
      .insert({
        ward_id: wardId,
        sunday_id: onDate(march, "2026-03-08").id,
        assignment_type: "sacrament_talk",
        pipeline_stage: "approve",
        slot_number: 1,
      })
      .select("id")
      .single();

    if (error) throw new Error(`Could not seed the assignment: ${error.message}`);
    assignmentId = data.id;
  });

  afterAll(async () => {
    await fixtures.cleanup();
  });

  it("warns instead of applying when re-resolution would land on assigned speakers", async () => {
    const result = await updateSunday(
      wardId,
      onDate(march, "2026-03-01").id,
      { type: "stake_conference" },
      undefined,
      bishop,
    );

    expect(result?.status).toBe("needs_confirmation");

    if (result?.status !== "needs_confirmation") return;

    expect(result.warning.reason).toBe("fast_sunday_moved");
    expect(result.warning.sundayId).toBe(onDate(march, "2026-03-08").id);
    expect(result.warning.date).toBe("2026-03-08");
    expect(result.warning.fromDate).toBe("2026-03-01");
    expect(result.warning.monthStart).toBe("2026-03-01");
    expect(result.warning.assignmentCount).toBe(1);
    expect(result.warning.prayerCount).toBe(0);
    // Pitfall 4: the number in the message is the number that blocked, not a second count.
    expect(result.warning.message).toContain("1 speaking assignment");
  });

  it("wrote nothing at all while warning", async () => {
    const after = await readMonth("2026-03");

    // The Sunday the user asked to change, not only the one Fast Sunday would have moved to. A
    // half-applied patch would show up here first.
    expect(onDate(after, "2026-03-01").type).toBe("fast_sunday");
    expect(onDate(after, "2026-03-01").speakingSlots).toBe(0);
    expect(onDate(after, "2026-03-08").type).toBe("standard");
    expect(onDate(after, "2026-03-08").speakingSlots).toBe(3);
  });

  it("applies on confirm and reverts the assignment rather than deleting it", async () => {
    const result = await updateSunday(
      wardId,
      onDate(march, "2026-03-01").id,
      { type: "stake_conference" },
      { confirm: true },
      bishop,
    );

    expect(result?.status).toBe("applied");
    if (result?.status !== "applied") return;
    expect(result.assignmentsReverted).toBe(1);

    const after = await readMonth("2026-03");
    expect(onDate(after, "2026-03-01").type).toBe("stake_conference");
    expect(onDate(after, "2026-03-08").type).toBe("fast_sunday");
    expect(onDate(after, "2026-03-08").speakingSlots).toBe(0);

    // Still there. Reverted to the first pipeline stage, never deleted — the planning work behind
    // an assignment is somebody's (03-calendar.md §Pitfall 5).
    const { data, error } = await bishop
      .from("assignments")
      .select("id, pipeline_stage")
      .eq("ward_id", wardId)
      .eq("id", assignmentId)
      .maybeSingle();

    expect(error).toBeNull();
    expect(data?.id).toBe(assignmentId);
    expect(data?.pipeline_stage).toBe("plan");
  });

  it("does not block when the target Sunday holds no assignments", async () => {
    const april = await readMonth("2026-04");

    // April 2026 already has Fast Sunday on the 12th, because the 5th is general conference.
    expect(onDate(april, "2026-04-12").type).toBe("fast_sunday");

    const result = await updateSunday(
      wardId,
      onDate(april, "2026-04-12").id,
      { type: "holiday" },
      undefined,
      bishop,
    );

    expect(result?.status).toBe("applied");

    const after = await readMonth("2026-04");
    expect(after.find((sunday) => sunday.type === "fast_sunday")?.date).toBe("2026-04-19");
  });

  // The split, proved end to end. `holiday` and `ward_conference` both DISPLACE Fast Sunday and
  // both HOLD a sacrament meeting — the combination that forced FAST_SUNDAY_DISPLACING_TYPES and
  // NO_MEETING_SUNDAY_TYPES apart.
  // This suite seeds no conducting rotation, so every conducting_user_id in it is null and
  // there is nothing to assert about conductors here. That a holiday KEEPS its conductor and a
  // ward conference GETS one is proved in tests/db/no-meeting-sundays.test.ts, which seeds one.
  describe("types that displace Fast Sunday without cancelling a meeting", () => {
    let july: Sunday[];

    beforeAll(async () => {
      await generateSundayRange(wardId, "2026-07-01", "2026-07-31", bishop);
      july = await readMonth("2026-07");
    });

    const seedSpeaker = async (sundayId: string, slotNumber: number) => {
      const { error } = await fixtures.service.from("assignments").insert({
        ward_id: wardId,
        sunday_id: sundayId,
        assignment_type: "sacrament_talk",
        pipeline_stage: "confirm",
        slot_number: slotNumber,
      });
      if (error) throw new Error(error.message);
    };

    // Before the split this warned that the ward's speakers were being orphaned, on a Sunday the
    // ward still meets on. That false alarm is what ITER-002 opened with.
    it("does not warn about a cancelled meeting when a Sunday becomes a holiday", async () => {
      const target = onDate(july, "2026-07-19");
      await seedSpeaker(target.id, 1);

      const result = await updateSunday(
        wardId,
        target.id,
        { type: "holiday" },
        undefined,
        bishop,
      );

      // Applied outright: nothing is at risk, so there is nothing to confirm.
      expect(result?.status).toBe("applied");
      if (result?.status !== "applied") return;

      expect(result.sunday.type).toBe("holiday");
      expect(result.sunday.speakingSlots).toBeGreaterThan(0);

      // And the speaker is untouched — still at `confirm`, not reverted to `plan`.
      const { data } = await bishop
        .from("assignments")
        .select("pipeline_stage")
        .eq("ward_id", wardId)
        .eq("sunday_id", target.id);

      expect(data?.every((row) => row.pipeline_stage === "confirm")).toBe(true);
    });

    // ward_conference is the type that proved the split was needed: it cannot BE Fast Sunday, and
    // it holds a completely ordinary meeting.
    it("moves Fast Sunday off a ward conference without cancelling its meeting", async () => {
      const first = onDate(july, "2026-07-05");
      expect(first.type).toBe("fast_sunday");

      const result = await updateSunday(
        wardId,
        first.id,
        { type: "ward_conference" },
        { confirm: true },
        bishop,
      );

      expect(result?.status).toBe("applied");

      const after = await readMonth("2026-07");

      // Fast Sunday moved to the second Sunday...
      expect(onDate(after, "2026-07-12").type).toBe("fast_sunday");

      // ...and the ward conference kept everything a meeting-holding Sunday has.
      const wardConference = onDate(after, "2026-07-05");
      expect(wardConference.type).toBe("ward_conference");
      expect(wardConference.speakingSlots).toBeGreaterThan(0);
    });
  });

  it("never clears a pinned Fast Sunday", async () => {
    const may = await readMonth("2026-05");
    expect(onDate(may, "2026-05-03").type).toBe("fast_sunday");

    const pinned = await updateSunday(
      wardId,
      onDate(may, "2026-05-17").id,
      { type: "fast_sunday", fastSundayPinned: true },
      { confirm: true },
      bishop,
    );
    expect(pinned?.status).toBe("applied");

    const afterPin = await readMonth("2026-05");
    expect(onDate(afterPin, "2026-05-17").type).toBe("fast_sunday");
    expect(onDate(afterPin, "2026-05-03").type).toBe("standard");

    // A change elsewhere in the month re-runs the rule, and the pin still wins.
    const later = await updateSunday(
      wardId,
      onDate(may, "2026-05-03").id,
      { type: "stake_conference" },
      { confirm: true },
      bishop,
    );
    expect(later?.status).toBe("applied");

    const afterChange = await readMonth("2026-05");
    expect(onDate(afterChange, "2026-05-17").type).toBe("fast_sunday");
    expect(onDate(afterChange, "2026-05-17").fastSundayPinned).toBe(true);
    expect(onDate(afterChange, "2026-05-17").speakingSlots).toBe(0);
  });

  // Three ways a calendar change voids work that had NO warning at all before this suite existed.
  // The original check only ever looked at the Sunday Fast Sunday was moving ONTO, never at the
  // Sunday being edited.
  describe("changes that void work on the Sunday being edited", () => {
    let june: Sunday[];

    const seedAssignment = async (sundayId: string, slotNumber: number) => {
      const { data, error } = await fixtures.service
        .from("assignments")
        .insert({
          ward_id: wardId,
          sunday_id: sundayId,
          assignment_type: "sacrament_talk",
          pipeline_stage: "confirm",
          slot_number: slotNumber,
        })
        .select("id")
        .single();
      if (error) throw new Error(error.message);
      return data.id;
    };

    beforeAll(async () => {
      await generateSundayRange(wardId, "2026-06-01", "2026-06-30", bishop);
      june = await readMonth("2026-06");
    });

    it("warns before cancelling a meeting that already has speakers", async () => {
      const target = onDate(june, "2026-06-21");
      await seedAssignment(target.id, 1);
      await seedAssignment(target.id, 2);

      const result = await updateSunday(
        wardId,
        target.id,
        { type: "stake_conference" },
        undefined,
        bishop,
      );

      expect(result?.status).toBe("needs_confirmation");
      if (result?.status !== "needs_confirmation") return;

      expect(result.warning.reason).toBe("meeting_cancelled");
      expect(result.warning.sundayId).toBe(target.id);
      expect(result.warning.assignmentCount).toBe(2);
      expect(result.warning.message).toContain("no longer hold a sacrament meeting");
      expect(result.warning.message).toContain("not count as a talk that was given");

      // Nothing written.
      expect(onDate(await readMonth("2026-06"), "2026-06-21").type).toBe("standard");
    });

    it("reverts those speakers to planning on confirm, and never deletes them", async () => {
      const target = onDate(june, "2026-06-21");

      const result = await updateSunday(
        wardId,
        target.id,
        { type: "stake_conference" },
        { confirm: true },
        bishop,
      );

      expect(result?.status).toBe("applied");
      if (result?.status !== "applied") return;
      expect(result.assignmentsReverted).toBe(2);

      const { data } = await bishop
        .from("assignments")
        .select("id, pipeline_stage")
        .eq("ward_id", wardId)
        .eq("sunday_id", target.id);

      expect(data).toHaveLength(2);
      expect(data?.every((row) => row.pipeline_stage === "plan")).toBe(true);
    });

    it("warns before cutting speaking slots below the speakers already in them", async () => {
      const target = onDate(june, "2026-06-28");
      await seedAssignment(target.id, 1);
      await seedAssignment(target.id, 3);

      const result = await updateSunday(
        wardId,
        target.id,
        { speakingSlots: 2 },
        undefined,
        bishop,
      );

      expect(result?.status).toBe("needs_confirmation");
      if (result?.status !== "needs_confirmation") return;

      expect(result.warning.reason).toBe("slots_reduced");
      // Only the speaker in slot 3 is at risk; slot 1 still fits.
      expect(result.warning.assignmentCount).toBe(1);
    });

    it("reverts only the speakers that no longer fit", async () => {
      const target = onDate(june, "2026-06-28");

      const result = await updateSunday(
        wardId,
        target.id,
        { speakingSlots: 2 },
        { confirm: true },
        bishop,
      );

      expect(result?.status).toBe("applied");
      if (result?.status !== "applied") return;
      expect(result.assignmentsReverted).toBe(1);

      const { data } = await bishop
        .from("assignments")
        .select("slot_number, pipeline_stage")
        .eq("ward_id", wardId)
        .eq("sunday_id", target.id)
        .order("slot_number");

      expect(data?.[0].pipeline_stage).toBe("confirm");
      expect(data?.[1].pipeline_stage).toBe("plan");
    });

    it("does not warn on a change that voids nothing", async () => {
      const target = onDate(june, "2026-06-14");

      const result = await updateSunday(
        wardId,
        target.id,
        { notes: "Ward conference planning" },
        undefined,
        bishop,
      );

      expect(result?.status).toBe("applied");
    });

    // The gap this whole suite exists for. `assignments` is bishopric-only under migration 019,
    // so counting through the caller's client returned zero for a secretary — they saw no warning
    // and silently orphaned somebody's speakers. The count and the revert use the service client.
    // `stake_conference`, not `holiday`. This test used to cancel the meeting with `holiday`,
    // which worked only while FAST_SUNDAY_DISPLACING_TYPES answered both questions. A holiday now
    // holds a sacrament meeting and correctly warns about nothing, so the vehicle changes to a
    // type that genuinely cancels one. What is being tested — that a ward_secretary sees the same
    // warning a bishop does — is unchanged.
    it("gives a ward_secretary the same warning a bishop gets", async () => {
      const target = onDate(june, "2026-06-07");
      await seedAssignment(target.id, 1);

      const result = await updateSunday(
        wardId,
        target.id,
        { type: "stake_conference" },
        undefined,
        secretary,
      );

      expect(result?.status).toBe("needs_confirmation");
      if (result?.status !== "needs_confirmation") return;

      expect(result.warning.reason).toBe("meeting_cancelled");
      expect(result.warning.assignmentCount).toBe(1);
    });

    it("reverts for a ward_secretary too, not only for a bishop", async () => {
      const target = onDate(june, "2026-06-07");

      const result = await updateSunday(
        wardId,
        target.id,
        { type: "stake_conference" },
        { confirm: true },
        secretary,
      );

      expect(result?.status).toBe("applied");
      if (result?.status !== "applied") return;
      expect(result.assignmentsReverted).toBe(1);

      const { data } = await bishop
        .from("assignments")
        .select("pipeline_stage")
        .eq("ward_id", wardId)
        .eq("sunday_id", target.id)
        .single();

      expect(data?.pipeline_stage).toBe("plan");
    });
  });
});
