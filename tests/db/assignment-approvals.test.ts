// @vitest-environment node
//
// Migration 025's four constraints, against the hosted project. What is asserted here is the part
// no unit test can reach: that the DATABASE refuses these rows, not just that the TypeScript layer
// declines to write them.
//
// The approval gate counts rows and calls them people. assignment_approvals_one_per_user is what
// makes that true — without it, one counselor inserting three rows satisfies a 3-of-3 gate alone,
// and tests/lib/approvalGate.test.ts would still pass.
//
// These run over the network against the shared hosted project (CLAUDE.md §9), so every fixture is
// deleted in afterAll and nothing assumes an empty table.

import { randomUUID } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  clearApprovals,
  listApprovals,
  recordApproval,
} from "@/lib/assignments/queries";
import { asRole } from "@/tests/helpers/asRole";
import { seedFixtures, type Fixtures } from "@/tests/helpers/seed";
import type { Database } from "@/types/database";

describe("assignment constraints", () => {
  let fixtures: Fixtures;
  let bishop: SupabaseClient<Database>;
  let wardId: string;

  let sundayId = "";
  let memberId = "";

  const createdAssignmentIds: string[] = [];

  // Seeded through the SERVICE client so these fixtures do not depend on the create route, and so
  // a constraint refusal is unambiguously the constraint rather than a policy.
  const seedAssignment = async (
    columns: Record<string, unknown> = {},
  ): Promise<{ id: string | null; error: string | null }> => {
    const { data, error } = await fixtures.service
      .from("assignments")
      .insert({
        ward_id: wardId,
        sunday_id: sundayId,
        assignment_type: "sacrament_talk",
        pipeline_stage: "review",
        slot_number: 1,
        ...columns,
      })
      .select("id")
      .maybeSingle();

    if (data?.id) createdAssignmentIds.push(data.id);
    return { id: data?.id ?? null, error: error?.message ?? null };
  };

  beforeAll(async () => {
    fixtures = await seedFixtures(["bishop", "counselor1", "counselor2"]);
    bishop = await asRole(fixtures, "bishop");
    wardId = fixtures.wardAId;

    const { data: sunday, error: sundayError } = await fixtures.service
      .from("sundays")
      .insert({ ward_id: wardId, date: "2027-04-04", type: "standard", speaking_slots: 3 })
      .select("id")
      .single();
    if (sundayError) throw new Error(sundayError.message);
    sundayId = sunday.id;

    const { data: member, error: memberError } = await fixtures.service
      .from("members")
      .insert({
        ward_id: wardId,
        first_name: "Speaker",
        last_name: `Fixture${fixtures.runId}`,
        category: "adult",
      })
      .select("id")
      .single();
    if (memberError) throw new Error(memberError.message);
    memberId = member.id;
  });

  afterAll(async () => {
    // Assignments cascade from the ward, but they are removed explicitly first so a cleanup
    // failure on the ward does not leave rows behind in a shared project.
    if (createdAssignmentIds.length > 0) {
      await fixtures.service.from("assignments").delete().in("id", createdAssignmentIds);
    }
    await fixtures.cleanup();
  });

  describe("assignments_speaker_exactly_one", () => {
    it("accepts a ward member alone", async () => {
      const { id, error } = await seedAssignment({ member_id: memberId });

      expect(error).toBeNull();
      expect(id).not.toBeNull();
    });

    it("accepts an external speaker alone", async () => {
      const { id, error } = await seedAssignment({
        external_speaker_name: "Mark Andersen",
        external_speaker_title: "President",
      });

      expect(error).toBeNull();
      expect(id).not.toBeNull();
    });

    // An assignment at stage `plan` legitimately has no speaker yet, and a decline or a calendar
    // revert returns a filled one to exactly this state.
    it("accepts an empty slot", async () => {
      const { id, error } = await seedAssignment({ pipeline_stage: "plan" });

      expect(error).toBeNull();
      expect(id).not.toBeNull();
    });

    it("refuses a row holding both a member and an external name", async () => {
      const { id, error } = await seedAssignment({
        member_id: memberId,
        external_speaker_name: "Mark Andersen",
      });

      expect(id).toBeNull();
      expect(error).toMatch(/assignments_speaker_exactly_one/);
    });
  });

  describe("the contact waiver", () => {
    it("accepts a waiver on an external speaker", async () => {
      const { id, error } = await seedAssignment({
        external_speaker_name: "Mark Andersen",
        contact_waived_at: new Date().toISOString(),
        contact_waived_by: fixtures.user("bishop").id,
      });

      expect(error).toBeNull();
      expect(id).not.toBeNull();
    });

    // Waiving the contact stages for somebody on the roster would hide a real outstanding task —
    // the precise failure ITER-004 exists to prevent.
    it("refuses a waiver on a ward member", async () => {
      const { id, error } = await seedAssignment({
        member_id: memberId,
        contact_waived_at: new Date().toISOString(),
        contact_waived_by: fixtures.user("bishop").id,
      });

      expect(id).toBeNull();
      expect(error).toMatch(/assignments_waiver_external_only/);
    });

    it("refuses half a waiver — a timestamp with nobody's name on it", async () => {
      const { id, error } = await seedAssignment({
        external_speaker_name: "Mark Andersen",
        contact_waived_at: new Date().toISOString(),
      });

      expect(id).toBeNull();
      expect(error).toMatch(/assignments_waiver_pair/);
    });

    it("refuses a name with no timestamp either", async () => {
      const { id, error } = await seedAssignment({
        external_speaker_name: "Mark Andersen",
        contact_waived_by: fixtures.user("bishop").id,
      });

      expect(id).toBeNull();
      expect(error).toMatch(/assignments_waiver_pair/);
    });
  });

  describe("assignment_approvals_one_per_user", () => {
    let assignmentId = "";

    beforeAll(async () => {
      const { id } = await seedAssignment({ member_id: memberId });
      assignmentId = id!;
    });

    it("refuses a second row for the same person on the same assignment", async () => {
      const first = await fixtures.service.from("assignment_approvals").insert({
        ward_id: wardId,
        assignment_id: assignmentId,
        user_id: fixtures.user("counselor1").id,
        approved: true,
      });
      expect(first.error).toBeNull();

      const second = await fixtures.service.from("assignment_approvals").insert({
        ward_id: wardId,
        assignment_id: assignmentId,
        user_id: fixtures.user("counselor1").id,
        approved: true,
      });

      expect(second.error?.message).toMatch(/assignment_approvals_one_per_user/);
    });

    it("still allows a different person to approve the same assignment", async () => {
      const { error } = await fixtures.service.from("assignment_approvals").insert({
        ward_id: wardId,
        assignment_id: assignmentId,
        user_id: fixtures.user("counselor2").id,
        approved: true,
      });

      expect(error).toBeNull();
    });

    // The upsert path. A bishopric member changing their mind must update their own row rather
    // than stacking a second one — which the constraint above would refuse outright.
    it("lets recordApproval change one person's mind in place", async () => {
      await recordApproval(
        wardId,
        assignmentId,
        fixtures.user("bishop").id,
        true,
        null,
        bishop,
      );

      await recordApproval(
        wardId,
        assignmentId,
        fixtures.user("bishop").id,
        false,
        "The topic overlaps with last week.",
        bishop,
      );

      const approvals = await listApprovals(wardId, assignmentId, bishop);
      const bishopRows = approvals.filter(
        (approval) => approval.userId === fixtures.user("bishop").id,
      );

      expect(bishopRows).toHaveLength(1);
      expect(bishopRows[0].approved).toBe(false);
      expect(bishopRows[0].comment).toBe("The topic overlaps with last week.");
    });
  });

  describe("clearApprovals", () => {
    let assignmentId = "";

    beforeAll(async () => {
      const { id } = await seedAssignment({ member_id: memberId });
      assignmentId = id!;

      await fixtures.service.from("assignment_approvals").insert(
        (["bishop", "counselor1", "counselor2"] as const).map((handle) => ({
          ward_id: wardId,
          assignment_id: assignmentId,
          user_id: fixtures.user(handle).id,
          approved: true,
        })),
      );
    });

    // The change-request path. The refusing member's row carries the comment saying WHAT to
    // change — it is the only explanation the planner gets, so it must survive the clear.
    it("spares one person's row when asked to", async () => {
      const cleared = await clearApprovals(
        wardId,
        assignmentId,
        { exceptUserId: fixtures.user("counselor2").id },
        bishop,
      );

      expect(cleared).toBe(2);

      const remaining = await listApprovals(wardId, assignmentId, bishop);
      expect(remaining).toHaveLength(1);
      expect(remaining[0].userId).toBe(fixtures.user("counselor2").id);
    });

    // The edit path. An approval is a decision about the plan AS IT STOOD; editing the plan
    // invalidates every one of them.
    it("clears every row when no exception is named", async () => {
      const cleared = await clearApprovals(wardId, assignmentId, undefined, bishop);

      expect(cleared).toBe(1);
      expect(await listApprovals(wardId, assignmentId, bishop)).toEqual([]);
    });
  });

  describe("assignment_history", () => {
    // ITER-004's "speaker history is not distorted", enforced by the schema rather than by
    // everybody remembering to check. writeAssignmentHistory() skips an external speaker entirely
    // BECAUSE this column cannot be null — do not relax it to make that function simpler.
    it("cannot record a history row with no member", async () => {
      const { error } = await fixtures.service.from("assignment_history").insert({
        ward_id: wardId,
        member_id: null as unknown as string,
        outcome: "completed",
      });

      expect(error).not.toBeNull();
    });

    it("records one for a ward member", async () => {
      const historyId = randomUUID();

      const { error } = await fixtures.service.from("assignment_history").insert({
        id: historyId,
        ward_id: wardId,
        member_id: memberId,
        outcome: "completed",
      });

      expect(error).toBeNull();

      await fixtures.service.from("assignment_history").delete().eq("id", historyId);
    });
  });
});
