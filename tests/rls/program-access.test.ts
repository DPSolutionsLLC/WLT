// @vitest-environment node
//
// Who may read and write a program, enforced by the DATABASE rather than by the route.
//
// Two migrations meet here:
//
//   037 — narrows `programs` writes below migration 019's ward-wide loop to bishop, counselor and
//         ward_secretary. SELECT stays ward-wide: a program is read aloud on Sunday, and nothing
//         in it is private to the bishopric. WRITE was the boundary that was missing.
//
//   038 — widens SELECT on `assignments` and `topics` to the roles that already hold `talks.view`.
//         019 had left those two tables bishopric-only, so a ward_secretary holding program.build
//         assembled a program with every slot empty and got a 200. Writes stay bishopric-only.
//
// Every negative UPDATE and DELETE assertion RE-READS the row with the service client. An
// RLS-denied UPDATE or DELETE is a zero-row SUCCESS, not an error; only INSERT raises
// (plans/retros/foundation-c-services.md). A suite that only checked `error` would pass while the
// app leaked.
//
// Runs over the network against the shared hosted project (CLAUDE.md §9): every fixture is
// deleted in afterAll and nothing assumes an empty table.

import type { SupabaseClient } from "@supabase/supabase-js";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { asRole } from "@/tests/helpers/asRole";
import { seedFixtures, type Fixtures } from "@/tests/helpers/seed";
import type { Database } from "@/types/database";

const SUNDAY_DATE = "2027-07-04";

describe("program access", () => {
  let fixtures: Fixtures;
  let bishopA: SupabaseClient<Database>;
  let secretaryA: SupabaseClient<Database>;
  let musicA: SupabaseClient<Database>;
  let eqPresidentA: SupabaseClient<Database>;
  let bishopB: SupabaseClient<Database>;

  let wardASundayId = "";
  let wardBSundayId = "";
  let wardAProgramId = "";
  let wardBProgramId = "";
  let wardATopicId = "";
  let wardAAssignmentId = "";

  async function readProgramStatus(programId: string): Promise<string> {
    const { data, error } = await fixtures.service
      .from("programs")
      .select("status")
      .eq("id", programId)
      .single();

    if (error) throw new Error(`Could not re-read the program: ${error.message}`);
    return data.status;
  }

  beforeAll(async () => {
    fixtures = await seedFixtures([
      "bishop",
      "wardSecretary",
      "executiveSecretary",
      "musicCoordinator",
      "eqPresident",
      "wardBBishop",
    ]);

    bishopA = await asRole(fixtures, "bishop");
    secretaryA = await asRole(fixtures, "wardSecretary");
    musicA = await asRole(fixtures, "musicCoordinator");
    eqPresidentA = await asRole(fixtures, "eqPresident");
    bishopB = await asRole(fixtures, "wardBBishop");

    const seedSunday = async (wardId: string) => {
      const { data, error } = await fixtures.service
        .from("sundays")
        .insert({ ward_id: wardId, date: SUNDAY_DATE, type: "standard", speaking_slots: 2 })
        .select("id")
        .single();
      if (error) throw new Error(error.message);
      return data.id;
    };

    wardASundayId = await seedSunday(fixtures.wardAId);
    wardBSundayId = await seedSunday(fixtures.wardBId);

    const seedProgram = async (wardId: string, sundayId: string) => {
      const { data, error } = await fixtures.service
        .from("programs")
        .insert({ ward_id: wardId, sunday_id: sundayId, status: "draft" })
        .select("id")
        .single();
      if (error) throw new Error(error.message);
      return data.id;
    };

    wardAProgramId = await seedProgram(fixtures.wardAId, wardASundayId);
    wardBProgramId = await seedProgram(fixtures.wardBId, wardBSundayId);

    const { data: topic, error: topicError } = await fixtures.service
      .from("topics")
      .insert({ ward_id: fixtures.wardAId, title: "Charity Never Faileth", source: "manual" })
      .select("id")
      .single();
    if (topicError) throw new Error(topicError.message);
    wardATopicId = topic.id;

    const { data: assignment, error: assignmentError } = await fixtures.service
      .from("assignments")
      .insert({
        ward_id: fixtures.wardAId,
        sunday_id: wardASundayId,
        assignment_type: "sacrament_talk",
        slot_number: 1,
        pipeline_stage: "notify",
        external_speaker_name: "Mark Andersen",
        external_speaker_title: "President",
      })
      .select("id")
      .single();
    if (assignmentError) throw new Error(assignmentError.message);
    wardAAssignmentId = assignment.id;
  });

  afterAll(async () => {
    await fixtures.cleanup();
  });

  describe("ward isolation", () => {
    it("cannot read another ward's program", async () => {
      const { data, error } = await bishopA
        .from("programs")
        .select("id")
        .eq("id", wardBProgramId);

      expect(error).toBeNull();
      expect(data).toEqual([]);
    });

    it("cannot update another ward's program", async () => {
      const { error } = await bishopA
        .from("programs")
        .update({ status: "approved" })
        .eq("id", wardBProgramId);

      // Zero rows, not an error. The proof is the re-read.
      expect(error).toBeNull();
      expect(await readProgramStatus(wardBProgramId)).toBe("draft");
    });

    it("cannot delete another ward's program", async () => {
      const { error } = await bishopA.from("programs").delete().eq("id", wardBProgramId);

      expect(error).toBeNull();
      expect(await readProgramStatus(wardBProgramId)).toBe("draft");
    });

    it("cannot insert a program into another ward", async () => {
      const { error } = await bishopB
        .from("programs")
        .insert({ ward_id: fixtures.wardAId, sunday_id: wardASundayId, status: "draft" });

      // Only INSERT raises.
      expect(error).not.toBeNull();
    });
  });

  describe("who may write a program (migration 037)", () => {
    it("lets a ward secretary insert one", async () => {
      const { data, error } = await secretaryA
        .from("programs")
        .insert({ ward_id: fixtures.wardAId, sunday_id: null, status: "draft" })
        .select("id")
        .single();

      expect(error).toBeNull();
      expect(data?.id).toBeTruthy();
    });

    it("lets a ward secretary update one", async () => {
      const { error } = await secretaryA
        .from("programs")
        .update({ status: "pending_approval" })
        .eq("id", wardAProgramId);

      expect(error).toBeNull();
      expect(await readProgramStatus(wardAProgramId)).toBe("pending_approval");
    });

    it("refuses an insert from the music coordinator", async () => {
      const { error } = await musicA
        .from("programs")
        .insert({ ward_id: fixtures.wardAId, sunday_id: null, status: "draft" });

      expect(error).not.toBeNull();
    });

    it("refuses an insert from an organization president", async () => {
      const { error } = await eqPresidentA
        .from("programs")
        .insert({ ward_id: fixtures.wardAId, sunday_id: null, status: "draft" });

      expect(error).not.toBeNull();
    });

    it("refuses an update from the music coordinator", async () => {
      const { error } = await musicA
        .from("programs")
        .update({ status: "approved" })
        .eq("id", wardAProgramId);

      // A zero-row success. Without the re-read this assertion would pass on a leak.
      expect(error).toBeNull();
      expect(await readProgramStatus(wardAProgramId)).toBe("pending_approval");
    });

    it("refuses a delete from the music coordinator", async () => {
      const { error } = await musicA.from("programs").delete().eq("id", wardAProgramId);

      expect(error).toBeNull();
      expect(await readProgramStatus(wardAProgramId)).toBe("pending_approval");
    });
  });

  describe("who may READ a program (still ward-wide)", () => {
    it("lets the music coordinator read one", async () => {
      // Nothing in a program is private to the bishopric — it is read aloud on Sunday. 037
      // narrowed writes only, and a select that had been narrowed with them would have broken
      // program-e's music screen before it was written.
      const { data, error } = await musicA
        .from("programs")
        .select("id")
        .eq("id", wardAProgramId);

      expect(error).toBeNull();
      expect(data).toHaveLength(1);
    });

    it("lets an organization president read one", async () => {
      const { data, error } = await eqPresidentA
        .from("programs")
        .select("id")
        .eq("id", wardAProgramId);

      expect(error).toBeNull();
      expect(data).toHaveLength(1);
    });
  });

  describe("reading the talk pipeline a program is built from (migration 038)", () => {
    it("lets a ward secretary read assignments", async () => {
      // The defect 038 fixes: without this the secretary's program assembles with every speaking
      // slot empty and the route answers 200.
      const { data, error } = await secretaryA
        .from("assignments")
        .select("id, external_speaker_name")
        .eq("id", wardAAssignmentId);

      expect(error).toBeNull();
      expect(data).toHaveLength(1);
      expect(data?.[0].external_speaker_name).toBe("Mark Andersen");
    });

    it("lets a ward secretary read topics", async () => {
      const { data, error } = await secretaryA
        .from("topics")
        .select("id")
        .eq("id", wardATopicId);

      expect(error).toBeNull();
      expect(data).toHaveLength(1);
    });

    it("lets the music coordinator and executive secretary read assignments too", async () => {
      // Both hold talks.view. 038 is the read half of that permission, not a program-specific
      // grant, so it must not be narrower than the matrix it implements.
      const executiveA = await asRole(fixtures, "executiveSecretary");

      for (const client of [musicA, executiveA]) {
        const { data, error } = await client
          .from("assignments")
          .select("id")
          .eq("id", wardAAssignmentId);

        expect(error).toBeNull();
        expect(data).toHaveLength(1);
      }
    });

    it("still refuses an organization president, who does not hold talks.view", async () => {
      const { data, error } = await eqPresidentA
        .from("assignments")
        .select("id")
        .eq("id", wardAAssignmentId);

      expect(error).toBeNull();
      expect(data).toEqual([]);
    });

    it("still refuses a ward secretary WRITING an assignment", async () => {
      // 038 grants reading only. Planning a speaker and running the pipeline stay the
      // bishopric's, exactly as before.
      const { error } = await secretaryA.from("assignments").insert({
        ward_id: fixtures.wardAId,
        sunday_id: wardASundayId,
        assignment_type: "sacrament_talk",
        slot_number: 2,
        pipeline_stage: "plan",
      });

      expect(error).not.toBeNull();
    });

    it("still refuses a ward secretary UPDATING an assignment", async () => {
      const { error } = await secretaryA
        .from("assignments")
        .update({ pipeline_stage: "complete" })
        .eq("id", wardAAssignmentId);

      expect(error).toBeNull();

      const { data } = await fixtures.service
        .from("assignments")
        .select("pipeline_stage")
        .eq("id", wardAAssignmentId)
        .single();

      expect(data?.pipeline_stage).toBe("notify");
    });

    it("still refuses a ward secretary reading approvals or comments", async () => {
      // Untouched by 038. Approvals and comments are the bishopric deliberating about a person,
      // which is a different thing from the resulting assignment, and no part of a program is
      // built from them.
      const { data: approvals } = await secretaryA
        .from("assignment_approvals")
        .select("id")
        .eq("assignment_id", wardAAssignmentId);
      expect(approvals).toEqual([]);

      const { data: comments } = await secretaryA
        .from("assignment_comments")
        .select("id")
        .eq("assignment_id", wardAAssignmentId);
      expect(comments).toEqual([]);
    });

    it("does not let a ward secretary read ANOTHER ward's assignments", async () => {
      const { data: wardBAssignment, error: seedError } = await fixtures.service
        .from("assignments")
        .insert({
          ward_id: fixtures.wardBId,
          sunday_id: wardBSundayId,
          assignment_type: "sacrament_talk",
          slot_number: 1,
          pipeline_stage: "notify",
        })
        .select("id")
        .single();
      if (seedError) throw new Error(seedError.message);

      const { data, error } = await secretaryA
        .from("assignments")
        .select("id")
        .eq("id", wardBAssignment.id);

      expect(error).toBeNull();
      expect(data).toEqual([]);
    });
  });
});
