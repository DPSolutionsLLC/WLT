// @vitest-environment node
//
// Speaker history is the most sensitive read talks-d adds: it is pastoral data about named people,
// and 04-talks-pipeline.md's stated pitfall is that it leaks. `assignment_history` sits in
// migration 019's BISHOPRIC-ONLY policy loop, which is the real boundary — the route's bishopric
// check only turns a silent empty result into an honest 403.
//
// A DENIED READ RETURNS AN EMPTY SET, NOT AN ERROR (plans/retros/foundation-c-services.md). So
// every negative assertion here is paired with a POSITIVE one over the same seeded row in the same
// fixture: the bishop reads it, the secretary does not. Without the pair, an empty result proves
// only that the seed failed.
//
// Runs over the network against the shared hosted project (CLAUDE.md §9): every fixture is deleted
// in afterAll and nothing assumes an empty table.

import type { SupabaseClient } from "@supabase/supabase-js";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { asRole } from "@/tests/helpers/asRole";
import { seedFixtures, type Fixtures } from "@/tests/helpers/seed";
import type { Database } from "@/types/database";

// Every role in ward A that is NOT bishopric. The list is the point: three of them hold
// talks.view, and none of them may read a history row.
const REFUSED_HANDLES = [
  "wardSecretary",
  "executiveSecretary",
  "eqPresident",
  "musicCoordinator",
  "sacramentManager",
] as const;

describe("speaker history access", () => {
  let fixtures: Fixtures;
  let bishopA: SupabaseClient<Database>;
  let counselorA: SupabaseClient<Database>;
  let bishopB: SupabaseClient<Database>;

  let wardAMemberId = "";
  let wardAHistoryId = "";
  let wardBHistoryId = "";
  let externalAssignmentId = "";

  beforeAll(async () => {
    fixtures = await seedFixtures([
      "bishop",
      "counselor1",
      ...REFUSED_HANDLES,
      "wardBBishop",
    ]);

    bishopA = await asRole(fixtures, "bishop");
    counselorA = await asRole(fixtures, "counselor1");
    bishopB = await asRole(fixtures, "wardBBishop");

    const seedSunday = async (wardId: string) => {
      const { data, error } = await fixtures.service
        .from("sundays")
        .insert({ ward_id: wardId, date: "2027-06-06", type: "standard", speaking_slots: 3 })
        .select("id")
        .single();
      if (error) throw new Error(error.message);
      return data.id;
    };

    const seedMember = async (wardId: string) => {
      const { data, error } = await fixtures.service
        .from("members")
        .insert({
          ward_id: wardId,
          first_name: "History",
          last_name: `Fixture${fixtures.runId}`,
          category: "adult",
        })
        .select("id")
        .single();
      if (error) throw new Error(error.message);
      return data.id;
    };

    const wardASundayId = await seedSunday(fixtures.wardAId);
    const wardBSundayId = await seedSunday(fixtures.wardBId);

    wardAMemberId = await seedMember(fixtures.wardAId);
    const wardBMemberId = await seedMember(fixtures.wardBId);

    const seedAssignment = async (
      wardId: string,
      sundayId: string,
      memberId: string | null,
      slotNumber: number,
      externalName: string | null,
    ) => {
      const { data, error } = await fixtures.service
        .from("assignments")
        .insert({
          ward_id: wardId,
          sunday_id: sundayId,
          member_id: memberId,
          external_speaker_name: externalName,
          assignment_type: "sacrament_talk",
          slot_number: slotNumber,
          pipeline_stage: "complete",
        })
        .select("id")
        .single();
      if (error) throw new Error(error.message);
      return data.id;
    };

    const wardAAssignmentId = await seedAssignment(
      fixtures.wardAId,
      wardASundayId,
      wardAMemberId,
      1,
      null,
    );

    // ITER-004 / talks-a Decision 3: an EXTERNAL speaker writes no history row, because
    // `assignment_history.member_id` is `not null`. Asserted rather than assumed, so relaxing
    // that column later breaks a test instead of quietly distorting speaker history.
    externalAssignmentId = await seedAssignment(
      fixtures.wardAId,
      wardASundayId,
      null,
      2,
      `Visiting Authority ${fixtures.runId}`,
    );

    const wardBAssignmentId = await seedAssignment(
      fixtures.wardBId,
      wardBSundayId,
      wardBMemberId,
      1,
      null,
    );

    const seedHistory = async (wardId: string, memberId: string, assignmentId: string) => {
      const { data, error } = await fixtures.service
        .from("assignment_history")
        .insert({
          ward_id: wardId,
          member_id: memberId,
          assignment_id: assignmentId,
          outcome: "completed",
          notes: "seeded",
        })
        .select("id")
        .single();
      if (error) throw new Error(error.message);
      return data.id;
    };

    wardAHistoryId = await seedHistory(fixtures.wardAId, wardAMemberId, wardAAssignmentId);
    wardBHistoryId = await seedHistory(fixtures.wardBId, wardBMemberId, wardBAssignmentId);
  });

  afterAll(async () => {
    await fixtures.cleanup();
  });

  describe("the row exists and the bishopric can read it", () => {
    // THE CONTROL. Every refusal below is only meaningful because this passes in the same
    // fixture — otherwise "nothing came back" would also be the shape of a seed that failed.
    it("lets ward A's bishop read the seeded history row", async () => {
      const { data, error } = await bishopA
        .from("assignment_history")
        .select("id, outcome, notes")
        .eq("id", wardAHistoryId);

      expect(error).toBeNull();
      expect(data).toHaveLength(1);
      expect(data?.[0]?.notes).toBe("seeded");
    });

    // CLAUDE.md §7: bishopric admin authority is shared, and a counselor sees exactly what the
    // bishop sees. Never build a check that grants the bishop something a counselor lacks.
    it("gives a counselor the identical row", async () => {
      const { data, error } = await counselorA
        .from("assignment_history")
        .select("id, outcome, notes")
        .eq("id", wardAHistoryId);

      expect(error).toBeNull();
      expect(data).toHaveLength(1);
      expect(data?.[0]?.notes).toBe("seeded");
    });
  });

  describe("non-bishopric roles read nothing", () => {
    it.each(REFUSED_HANDLES)("refuses %s the seeded row", async (handle) => {
      const client = await asRole(fixtures, handle);

      const { data, error } = await client
        .from("assignment_history")
        .select("id, outcome, notes")
        .eq("id", wardAHistoryId);

      // An RLS refusal is a zero-row SUCCESS, not an error.
      expect(error).toBeNull();
      expect(data).toEqual([]);
    });

    it.each(REFUSED_HANDLES)("refuses %s the whole table", async (handle) => {
      const client = await asRole(fixtures, handle);

      const { data, error } = await client
        .from("assignment_history")
        .select("id")
        .eq("ward_id", fixtures.wardAId);

      expect(error).toBeNull();
      expect(data).toEqual([]);
    });

    it("refuses a non-bishopric INSERT", async () => {
      const secretary = await asRole(fixtures, "wardSecretary");

      const { error } = await secretary.from("assignment_history").insert({
        ward_id: fixtures.wardAId,
        member_id: wardAMemberId,
        outcome: "declined",
      });

      // INSERT is the one verb that RAISES on refusal.
      expect(error).not.toBeNull();
    });

    it("refuses a non-bishopric UPDATE, proven by re-reading the row", async () => {
      const secretary = await asRole(fixtures, "wardSecretary");

      const { data, error } = await secretary
        .from("assignment_history")
        .update({ notes: "written by the secretary" })
        .eq("id", wardAHistoryId)
        .select("id");

      expect(error).toBeNull();
      expect(data).toEqual([]);

      // The assertion that matters. A denied UPDATE returns zero rows rather than raising, so
      // "no error and no rows" alone would also be the shape of a successful write to nothing.
      const { data: untouched } = await fixtures.service
        .from("assignment_history")
        .select("notes")
        .eq("id", wardAHistoryId)
        .single();

      expect(untouched?.notes).toBe("seeded");
    });
  });

  describe("cross-ward isolation", () => {
    it("hides ward B's history from ward A's bishop", async () => {
      const { data, error } = await bishopA
        .from("assignment_history")
        .select("id")
        .eq("id", wardBHistoryId);

      expect(error).toBeNull();
      expect(data).toEqual([]);
    });

    it("hides ward A's history from ward B's bishop", async () => {
      const { data, error } = await bishopB
        .from("assignment_history")
        .select("id")
        .eq("id", wardAHistoryId);

      expect(error).toBeNull();
      expect(data).toEqual([]);
    });

    it("refuses ward A's bishop a delete of ward B's row", async () => {
      const { data, error } = await bishopA
        .from("assignment_history")
        .delete()
        .eq("id", wardBHistoryId)
        .select("id");

      expect(error).toBeNull();
      expect(data).toEqual([]);

      const { data: survivor } = await fixtures.service
        .from("assignment_history")
        .select("id")
        .eq("id", wardBHistoryId)
        .maybeSingle();

      expect(survivor?.id).toBe(wardBHistoryId);
    });
  });

  describe("external speakers", () => {
    it("wrote no history row for the completed external assignment", async () => {
      // The schema, not a remembered rule: `assignment_history.member_id` is `not null`, so an
      // external speaker cannot have a row (talks-a Decision 3). Read with the SERVICE client so
      // this proves the row does not exist rather than that RLS hid it.
      const { data, error } = await fixtures.service
        .from("assignment_history")
        .select("id")
        .eq("assignment_id", externalAssignmentId);

      expect(error).toBeNull();
      expect(data).toEqual([]);
    });

    it("refuses a history row that names no member", async () => {
      const { error } = await fixtures.service.from("assignment_history").insert({
        ward_id: fixtures.wardAId,
        // @ts-expect-error member_id is `not null` — this insert must fail, and the type says so
        member_id: null,
        assignment_id: externalAssignmentId,
        outcome: "completed",
      });

      expect(error).not.toBeNull();
    });
  });
});
