// @vitest-environment node
//
// `topic_candidates` is BISHOPRIC-ONLY under migration 028's own four policies — it is not in
// migration 019's ward-wide loop, and it is not in 019's bishopric loop either, because the table
// did not exist when either was written. That makes this suite the only thing standing behind
// the queue, so it proves the policies rather than assuming them.
//
// This is the table CLAUDE.md rule 3 rests on: it exists so there is NOWHERE for an AI-generated
// topic to land except a queue a person reviews. A leak here is not a privacy problem, it is the
// rule being unenforceable.
//
// Every negative UPDATE and DELETE assertion RE-READS the row with the service client. An
// RLS-denied UPDATE or DELETE is a zero-row SUCCESS, not an error; only INSERT raises
// (plans/retros/foundation-c-services.md). A suite that only checked `error` would pass while
// the app leaked.
//
// Runs over the network against the shared hosted project (CLAUDE.md §9): every fixture is
// deleted in afterAll and nothing assumes an empty table.

import type { SupabaseClient } from "@supabase/supabase-js";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { asRole } from "@/tests/helpers/asRole";
import { seedFixtures, type Fixtures } from "@/tests/helpers/seed";
import type { Database } from "@/types/database";

// `topics.view` and `topics.manage` are bishopric-only in lib/auth/permissions.ts, and the RLS
// policy agrees. Both halves are asserted: the permission matrix and the database say the same
// thing here, unlike `sundays` where the route is the real write boundary.
const REFUSED_HANDLES = [
  "wardSecretary",
  "executiveSecretary",
  "eqPresident",
  "musicCoordinator",
  "sacramentManager",
] as const;

describe("topic candidate access", () => {
  let fixtures: Fixtures;
  let bishopA: SupabaseClient<Database>;
  let bishopB: SupabaseClient<Database>;

  let wardACandidateId = "";
  let wardBCandidateId = "";

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

    const seedCandidate = async (wardId: string, title: string) => {
      const { data, error } = await fixtures.service
        .from("topic_candidates")
        .insert({
          ward_id: wardId,
          title: `${title} ${fixtures.runId}`,
          category: "doctrinal",
          description: "seeded",
          status: "pending",
        })
        .select("id")
        .single();
      if (error) throw new Error(error.message);
      return data.id;
    };

    wardACandidateId = await seedCandidate(fixtures.wardAId, "Ward A suggestion");
    wardBCandidateId = await seedCandidate(fixtures.wardBId, "Ward B suggestion");
  });

  afterAll(async () => {
    await fixtures.cleanup();
  });

  describe("cross-ward isolation", () => {
    it("hides another ward's candidates", async () => {
      const { data, error } = await bishopA
        .from("topic_candidates")
        .select("id")
        .eq("ward_id", fixtures.wardBId);

      // An RLS refusal is a zero-row success, not an error.
      expect(error).toBeNull();
      expect(data, "ward A's bishop saw ward B's candidates").toEqual([]);
    });

    it("lets each ward's own bishop read its own candidates", async () => {
      const own = await bishopA
        .from("topic_candidates")
        .select("id")
        .eq("id", wardACandidateId);

      expect(own.error).toBeNull();
      expect(own.data).toHaveLength(1);

      const theirs = await bishopB
        .from("topic_candidates")
        .select("id")
        .eq("id", wardBCandidateId);

      expect(theirs.error).toBeNull();
      expect(theirs.data).toHaveLength(1);
    });

    it("refuses an update into another ward's candidate", async () => {
      const { data, error } = await bishopA
        .from("topic_candidates")
        .update({ description: "written from ward A" })
        .eq("id", wardBCandidateId)
        .select("id");

      expect(error).toBeNull();
      expect(data).toEqual([]);

      // The assertion that matters. A denied UPDATE returns zero rows rather than raising, so
      // "no error and no rows" alone would also be the shape of a successful write to nothing.
      const { data: untouched } = await fixtures.service
        .from("topic_candidates")
        .select("description")
        .eq("id", wardBCandidateId)
        .single();

      expect(untouched?.description).toBe("seeded");
    });

    it("refuses a delete of another ward's candidate", async () => {
      const { data, error } = await bishopA
        .from("topic_candidates")
        .delete()
        .eq("id", wardBCandidateId)
        .select("id");

      expect(error).toBeNull();
      expect(data).toEqual([]);

      const { data: survivor } = await fixtures.service
        .from("topic_candidates")
        .select("id")
        .eq("id", wardBCandidateId)
        .maybeSingle();

      expect(survivor?.id).toBe(wardBCandidateId);
    });

    it("refuses an insert naming another ward", async () => {
      const { error } = await bishopA
        .from("topic_candidates")
        .insert({
          ward_id: fixtures.wardBId,
          title: `Smuggled ${fixtures.runId}`,
          status: "pending",
        })
        .select("id");

      // An INSERT that fails its WITH CHECK is a hard error, unlike a filtered UPDATE.
      expect(error).not.toBeNull();
    });
  });

  describe("non-bishopric roles inside the ward", () => {
    it("hides the queue from every non-bishopric role", async () => {
      for (const handle of REFUSED_HANDLES) {
        const client = await asRole(fixtures, handle);

        const { data, error } = await client
          .from("topic_candidates")
          .select("id")
          .eq("ward_id", fixtures.wardAId);

        expect(error, `${handle} errored reading topic_candidates`).toBeNull();
        expect(data, `${handle} could read topic_candidates`).toEqual([]);
      }
    });

    it("refuses every non-bishopric role an insert", async () => {
      for (const handle of REFUSED_HANDLES) {
        const client = await asRole(fixtures, handle);

        const { error } = await client
          .from("topic_candidates")
          .insert({
            ward_id: fixtures.wardAId,
            title: `Inserted by ${handle} ${fixtures.runId}`,
            status: "pending",
          })
          .select("id");

        expect(error, `${handle} inserted a candidate`).not.toBeNull();
      }
    });

    it("refuses every non-bishopric role an update, proven by re-read", async () => {
      for (const handle of REFUSED_HANDLES) {
        const client = await asRole(fixtures, handle);

        const { data, error } = await client
          .from("topic_candidates")
          .update({ description: `written by ${handle}` })
          .eq("id", wardACandidateId)
          .select("id");

        expect(error, `${handle} errored updating`).toBeNull();
        expect(data, `${handle} updated a candidate`).toEqual([]);

        const { data: untouched } = await fixtures.service
          .from("topic_candidates")
          .select("description")
          .eq("id", wardACandidateId)
          .single();

        expect(untouched?.description, `${handle} changed the description`).toBe("seeded");
      }
    });

    it("refuses every non-bishopric role a delete, proven by re-read", async () => {
      for (const handle of REFUSED_HANDLES) {
        const client = await asRole(fixtures, handle);

        const { data, error } = await client
          .from("topic_candidates")
          .delete()
          .eq("id", wardACandidateId)
          .select("id");

        expect(error, `${handle} errored deleting`).toBeNull();
        expect(data, `${handle} deleted a candidate`).toEqual([]);

        const { data: survivor } = await fixtures.service
          .from("topic_candidates")
          .select("id")
          .eq("id", wardACandidateId)
          .maybeSingle();

        expect(survivor?.id, `${handle} removed the candidate`).toBe(wardACandidateId);
      }
    });

    // A counselor holds exactly what the bishop holds. CLAUDE.md §7: bishopric admin authority
    // is shared, and a check that grants the bishop something a counselor lacks is a bug.
    it("gives a counselor the same access as the bishop", async () => {
      const counselor = await asRole(fixtures, "counselor1");

      const { data, error } = await counselor
        .from("topic_candidates")
        .select("id")
        .eq("id", wardACandidateId);

      expect(error).toBeNull();
      expect(data).toHaveLength(1);

      const { data: updated, error: updateError } = await counselor
        .from("topic_candidates")
        .update({ description: "a counselor may write here" })
        .eq("id", wardACandidateId)
        .select("id");

      expect(updateError).toBeNull();
      expect(updated).toHaveLength(1);
    });
  });

  describe("the review-pair constraint", () => {
    // A reviewed candidate always names WHO reviewed it and WHEN. Rule 3 is only meaningful if
    // the accept is attributable, so the constraint makes an unattributed accept impossible
    // rather than merely discouraged.
    it("refuses an accepted candidate with no reviewer", async () => {
      const { error } = await fixtures.service
        .from("topic_candidates")
        .update({ status: "accepted" })
        .eq("id", wardACandidateId)
        .select("id");

      expect(error).not.toBeNull();
    });

    it("refuses a pending candidate that names a reviewer", async () => {
      const { error } = await fixtures.service
        .from("topic_candidates")
        .update({
          status: "pending",
          reviewed_by: fixtures.user("bishop").id,
          reviewed_at: new Date().toISOString(),
        })
        .eq("id", wardACandidateId)
        .select("id");

      expect(error).not.toBeNull();
    });

    it("accepts a reviewed candidate that names both", async () => {
      const { data, error } = await fixtures.service
        .from("topic_candidates")
        .update({
          status: "rejected",
          reviewed_by: fixtures.user("bishop").id,
          reviewed_at: new Date().toISOString(),
        })
        .eq("id", wardACandidateId)
        .select("id");

      expect(error).toBeNull();
      expect(data).toHaveLength(1);
    });
  });
});
