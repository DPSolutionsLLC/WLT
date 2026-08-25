// @vitest-environment node
//
// The four talk-pipeline tables are BISHOPRIC-ONLY under migration 019's second policy loop —
// `ward_id = current_ward_id() and is_bishopric()` on all four verbs. That makes them the
// opposite of `sundays`, where the route's assertCan is the real write boundary
// (tests/rls/calendar-access.test.ts documents that gap). Here the database genuinely is the
// boundary, and this suite proves it rather than assuming it.
//
// Migration 025 adds no policies. It is asserted here, not written here — the plan for this slice
// says explicitly not to add new policies for these tables.
//
// Every negative UPDATE and DELETE assertion RE-READS the row with the service client. An
// RLS-denied UPDATE or DELETE is a zero-row SUCCESS, not an error; only INSERT raises
// (plans/retros/foundation-c-services.md). A suite that only checked `error` would pass while the
// app leaked.
//
// Runs over the network against the shared hosted project (CLAUDE.md §9): every fixture is deleted
// in afterAll and nothing assumes an empty table.

import type { SupabaseClient } from "@supabase/supabase-js";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { asRole } from "@/tests/helpers/asRole";
import { seedFixtures, type Fixtures } from "@/tests/helpers/seed";
import type { Database } from "@/types/database";

const BISHOPRIC_ONLY_TABLES = [
  "assignments",
  "assignment_approvals",
  "assignment_comments",
  "assignment_history",
] as const;

describe("assignment access", () => {
  let fixtures: Fixtures;
  let bishopA: SupabaseClient<Database>;
  let bishopB: SupabaseClient<Database>;

  let wardASundayId = "";
  let wardBSundayId = "";
  let wardAMemberId = "";
  let wardBMemberId = "";
  let wardAAssignmentId = "";
  let wardBAssignmentId = "";
  let wardBApprovalId = "";
  let wardBCommentId = "";
  let wardBHistoryId = "";

  beforeAll(async () => {
    fixtures = await seedFixtures([
      "bishop",
      "counselor1",
      "wardSecretary",
      "executiveSecretary",
      "eqPresident",
      "musicCoordinator",
      "sacramentManager",
      "wardBBishop",
    ]);

    bishopA = await asRole(fixtures, "bishop");
    bishopB = await asRole(fixtures, "wardBBishop");

    const seedSunday = async (wardId: string) => {
      const { data, error } = await fixtures.service
        .from("sundays")
        .insert({ ward_id: wardId, date: "2027-05-02", type: "standard", speaking_slots: 3 })
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
          first_name: "Speaker",
          last_name: `Fixture${fixtures.runId}`,
          category: "adult",
        })
        .select("id")
        .single();
      if (error) throw new Error(error.message);
      return data.id;
    };

    const seedAssignment = async (
      wardId: string,
      sundayId: string,
      memberId: string,
    ) => {
      const { data, error } = await fixtures.service
        .from("assignments")
        .insert({
          ward_id: wardId,
          sunday_id: sundayId,
          member_id: memberId,
          assignment_type: "sacrament_talk",
          slot_number: 1,
          pipeline_stage: "review",
          request_notes: "seeded",
        })
        .select("id")
        .single();
      if (error) throw new Error(error.message);
      return data.id;
    };

    wardASundayId = await seedSunday(fixtures.wardAId);
    wardBSundayId = await seedSunday(fixtures.wardBId);
    wardAMemberId = await seedMember(fixtures.wardAId);
    wardBMemberId = await seedMember(fixtures.wardBId);

    wardAAssignmentId = await seedAssignment(
      fixtures.wardAId,
      wardASundayId,
      wardAMemberId,
    );
    wardBAssignmentId = await seedAssignment(
      fixtures.wardBId,
      wardBSundayId,
      wardBMemberId,
    );

    const { data: approval, error: approvalError } = await fixtures.service
      .from("assignment_approvals")
      .insert({
        ward_id: fixtures.wardBId,
        assignment_id: wardBAssignmentId,
        user_id: fixtures.user("wardBBishop").id,
        approved: true,
        comment: "ward B only",
      })
      .select("id")
      .single();
    if (approvalError) throw new Error(approvalError.message);
    wardBApprovalId = approval.id;

    const { data: comment, error: commentError } = await fixtures.service
      .from("assignment_comments")
      .insert({
        ward_id: fixtures.wardBId,
        assignment_id: wardBAssignmentId,
        user_id: fixtures.user("wardBBishop").id,
        comment: "ward B only",
        level: "assignment",
      })
      .select("id")
      .single();
    if (commentError) throw new Error(commentError.message);
    wardBCommentId = comment.id;

    const { data: history, error: historyError } = await fixtures.service
      .from("assignment_history")
      .insert({
        ward_id: fixtures.wardBId,
        member_id: wardBMemberId,
        assignment_id: wardBAssignmentId,
        outcome: "completed",
      })
      .select("id")
      .single();
    if (historyError) throw new Error(historyError.message);
    wardBHistoryId = history.id;
  });

  afterAll(async () => {
    await fixtures.cleanup();
  });

  describe("cross-ward isolation", () => {
    it("hides another ward's rows on all four tables", async () => {
      for (const table of BISHOPRIC_ONLY_TABLES) {
        const { data, error } = await bishopA
          .from(table)
          .select("id")
          .eq("ward_id", fixtures.wardBId);

        // An RLS refusal is a zero-row success, not an error.
        expect(error, `${table} errored instead of filtering`).toBeNull();
        expect(data, `ward A's bishop saw ward B's ${table}`).toEqual([]);
      }
    });

    it("refuses an update into another ward's assignment", async () => {
      const { data, error } = await bishopA
        .from("assignments")
        .update({ request_notes: "written from ward A" })
        .eq("id", wardBAssignmentId)
        .select("id");

      expect(error).toBeNull();
      expect(data).toEqual([]);

      // The assertion that matters. A denied UPDATE returns zero rows rather than raising, so
      // "no error and no rows" alone would also be the shape of a successful write to nothing.
      const { data: untouched } = await fixtures.service
        .from("assignments")
        .select("request_notes")
        .eq("id", wardBAssignmentId)
        .single();

      expect(untouched?.request_notes).toBe("seeded");
    });

    it("refuses a delete of another ward's approval", async () => {
      const { data, error } = await bishopA
        .from("assignment_approvals")
        .delete()
        .eq("id", wardBApprovalId)
        .select("id");

      expect(error).toBeNull();
      expect(data).toEqual([]);

      const { data: survivor } = await fixtures.service
        .from("assignment_approvals")
        .select("id, comment")
        .eq("id", wardBApprovalId)
        .maybeSingle();

      expect(survivor?.comment).toBe("ward B only");
    });

    it("refuses a delete of another ward's comment", async () => {
      const { data, error } = await bishopA
        .from("assignment_comments")
        .delete()
        .eq("id", wardBCommentId)
        .select("id");

      expect(error).toBeNull();
      expect(data).toEqual([]);

      const { data: survivor } = await fixtures.service
        .from("assignment_comments")
        .select("id")
        .eq("id", wardBCommentId)
        .maybeSingle();

      expect(survivor?.id).toBe(wardBCommentId);
    });

    it("refuses a delete of another ward's history row", async () => {
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

    it("refuses an insert naming another ward", async () => {
      const { error } = await bishopA
        .from("assignments")
        .insert({
          ward_id: fixtures.wardBId,
          sunday_id: wardBSundayId,
          assignment_type: "sacrament_talk",
          slot_number: 2,
        })
        .select("id");

      // An INSERT that fails its WITH CHECK is a hard error, unlike a filtered UPDATE.
      expect(error).not.toBeNull();
    });

    it("lets ward B's own bishop read ward B's rows", async () => {
      const { data, error } = await bishopB
        .from("assignments")
        .select("id")
        .eq("id", wardBAssignmentId);

      expect(error).toBeNull();
      expect(data).toHaveLength(1);
    });
  });

  describe("non-bishopric roles inside the ward", () => {
    // MIGRATION 038 SPLIT THIS LIST IN TWO, and the reason is worth reading before editing it.
    //
    // This suite used to assert that ALL FOUR tables were hidden from EVERY non-bishopric role,
    // with a comment saying the database was deliberately stricter than the permission matrix.
    // It was not deliberate. `talks.view` is granted to ward_secretary, executive_secretary and
    // music_coordinator in lib/auth/permissions.ts, and migration 019 refused all three at the
    // database — so the permission was dead, with no symptom, because nothing read `assignments`
    // on behalf of a non-bishopric user until Phase 6.
    //
    // program-a found it: a ward_secretary holding `program.build` assembled a sacrament program
    // with every speaking slot silently empty. Migration 038 makes SELECT follow `talks.view`.
    //
    // `assignments` moved. The other three did NOT: approvals and comments are the bishopric
    // deliberating about a person, history is the record of it, and no program is built from any
    // of them.
    const TALKS_VIEW_HANDLES = ["wardSecretary", "executiveSecretary", "musicCoordinator"] as const;

    const REFUSED_HANDLES = [
      "wardSecretary",
      "executiveSecretary",
      "eqPresident",
      "sacramentManager",
    ] as const;

    // Everything except `assignments`, which TALKS_VIEW_HANDLES may now read.
    const STILL_BISHOPRIC_ONLY = BISHOPRIC_ONLY_TABLES.filter(
      (table) => table !== "assignments",
    );

    it("hides deliberation and history from every non-bishopric role in the ward", async () => {
      for (const handle of REFUSED_HANDLES) {
        const client = await asRole(fixtures, handle);

        for (const table of STILL_BISHOPRIC_ONLY) {
          const { data, error } = await client
            .from(table)
            .select("id")
            .eq("ward_id", fixtures.wardAId);

          expect(error, `${handle} errored reading ${table}`).toBeNull();
          expect(data, `${handle} could read ${table}`).toEqual([]);
        }
      }
    });

    it("hides assignments from a role that does NOT hold talks.view", async () => {
      for (const handle of ["eqPresident", "sacramentManager"] as const) {
        const client = await asRole(fixtures, handle);

        const { data, error } = await client
          .from("assignments")
          .select("id")
          .eq("ward_id", fixtures.wardAId);

        expect(error, `${handle} errored reading assignments`).toBeNull();
        expect(data, `${handle} could read assignments`).toEqual([]);
      }
    });

    it("shows assignments to every role that DOES hold talks.view (migration 038)", async () => {
      for (const handle of TALKS_VIEW_HANDLES) {
        const client = await asRole(fixtures, handle);

        const { data, error } = await client
          .from("assignments")
          .select("id")
          .eq("id", wardAAssignmentId);

        expect(error, `${handle} errored reading assignments`).toBeNull();
        expect(data, `${handle} could not read assignments`).toHaveLength(1);
      }
    });

    it("refuses every non-bishopric role an insert into all four tables", async () => {
      for (const handle of REFUSED_HANDLES) {
        const client = await asRole(fixtures, handle);

        const attempts = [
          client.from("assignments").insert({
            ward_id: fixtures.wardAId,
            sunday_id: wardASundayId,
            assignment_type: "sacrament_talk",
            slot_number: 3,
          }),
          client.from("assignment_approvals").insert({
            ward_id: fixtures.wardAId,
            assignment_id: wardAAssignmentId,
            user_id: fixtures.user(handle).id,
            approved: true,
          }),
          client.from("assignment_comments").insert({
            ward_id: fixtures.wardAId,
            assignment_id: wardAAssignmentId,
            user_id: fixtures.user(handle).id,
            comment: "should not land",
            level: "assignment",
          }),
          client.from("assignment_history").insert({
            ward_id: fixtures.wardAId,
            member_id: wardAMemberId,
            assignment_id: wardAAssignmentId,
            outcome: "completed",
          }),
        ];

        for (const [index, attempt] of attempts.entries()) {
          const { error } = await attempt;
          expect(
            error,
            `${handle} inserted into ${BISHOPRIC_ONLY_TABLES[index]}`,
          ).not.toBeNull();
        }
      }
    });

    it("refuses every non-bishopric role an update, proven by re-reading the row", async () => {
      for (const handle of REFUSED_HANDLES) {
        const client = await asRole(fixtures, handle);

        const { data, error } = await client
          .from("assignments")
          .update({ request_notes: `written by ${handle}` })
          .eq("id", wardAAssignmentId)
          .select("id");

        expect(error, `${handle} errored instead of being filtered`).toBeNull();
        expect(data, `${handle} updated an assignment`).toEqual([]);

        const { data: untouched } = await fixtures.service
          .from("assignments")
          .select("request_notes")
          .eq("id", wardAAssignmentId)
          .single();

        expect(untouched?.request_notes, `${handle} changed the row`).toBe("seeded");
      }
    });

    it("refuses every non-bishopric role a delete, proven by re-reading the row", async () => {
      for (const handle of REFUSED_HANDLES) {
        const client = await asRole(fixtures, handle);

        const { data, error } = await client
          .from("assignments")
          .delete()
          .eq("id", wardAAssignmentId)
          .select("id");

        expect(error, `${handle} errored instead of being filtered`).toBeNull();
        expect(data, `${handle} deleted an assignment`).toEqual([]);

        const { data: survivor } = await fixtures.service
          .from("assignments")
          .select("id")
          .eq("id", wardAAssignmentId)
          .maybeSingle();

        expect(survivor?.id, `${handle} removed the row`).toBe(wardAAssignmentId);
      }
    });
  });

  describe("the ward's own bishopric", () => {
    it("lets a counselor read and write the same rows the bishop can", async () => {
      const counselor = await asRole(fixtures, "counselor1");

      const { data, error } = await counselor
        .from("assignments")
        .select("id")
        .eq("id", wardAAssignmentId);

      expect(error).toBeNull();
      expect(data).toHaveLength(1);

      // CLAUDE.md §7: bishopric admin authority is SHARED. A policy that granted the bishop
      // something a counselor lacks would be a bug, not a safety measure.
      const { data: updated, error: updateError } = await counselor
        .from("assignments")
        .update({ request_notes: "seeded" })
        .eq("id", wardAAssignmentId)
        .select("id");

      expect(updateError).toBeNull();
      expect(updated).toHaveLength(1);
    });
  });
});
