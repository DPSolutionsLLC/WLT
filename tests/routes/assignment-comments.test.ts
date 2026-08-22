// @vitest-environment node
//
// GET and POST /api/assignment-comments. One table serves both comment levels, so one route
// serves both and `level` is the discriminant — the server sets the column from it and never
// takes the client's word for which id to trust.
//
// The assertion this suite exists for is the last one: the audit row records the comment's id
// and level and NEVER its body. A comment is free text somebody typed about a member, and an
// audit row is bishopric-readable (CLAUDE.md rule 8).
//
// See tests/helpers/routeClient.ts for why this needs no server. Runs over the network against
// the shared hosted project (CLAUDE.md §9).

import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import {
  actAs,
  errorMessage,
  jsonRequest,
  readResponse,
} from "@/tests/helpers/routeClient";
import { seedFixtures, type Fixtures } from "@/tests/helpers/seed";

vi.mock("@/lib/supabase/server", async () => {
  const { serverClientMock } = await import("@/tests/helpers/routeClient");
  return serverClientMock();
});

const ROUTE = "http://localhost/api/assignment-comments";
const SUNDAY_DATE = "2027-06-06";

async function callGet(query: string) {
  const { GET } = await import("@/app/api/assignment-comments/route");
  return readResponse(await GET(jsonRequest(`${ROUTE}?${query}`)));
}

async function callPost(body: unknown) {
  const { POST } = await import("@/app/api/assignment-comments/route");
  return readResponse(await POST(jsonRequest(ROUTE, { method: "POST", body })));
}

type CommentRow = { id: string; level: string | null; comment: string };

describe("/api/assignment-comments", () => {
  let fixtures: Fixtures;

  let sundayId = "";
  let assignmentId = "";
  let wardBSundayId = "";
  let wardBAssignmentId = "";

  beforeAll(async () => {
    fixtures = await seedFixtures([
      "bishop",
      "musicCoordinator",
      "eqPresident",
      "wardBBishop",
    ]);

    const seedSunday = async (wardId: string) => {
      const { data, error } = await fixtures.service
        .from("sundays")
        .insert({
          ward_id: wardId,
          date: SUNDAY_DATE,
          type: "standard",
          speaking_slots: 3,
        })
        .select("id")
        .single();
      if (error) throw new Error(`Could not seed a Sunday: ${error.message}`);
      return data.id;
    };

    const seedAssignment = async (wardId: string, wardSundayId: string) => {
      const { data, error } = await fixtures.service
        .from("assignments")
        .insert({
          ward_id: wardId,
          sunday_id: wardSundayId,
          assignment_type: "sacrament_talk",
          slot_number: 1,
          pipeline_stage: "plan",
        })
        .select("id")
        .single();
      if (error) throw new Error(`Could not seed an assignment: ${error.message}`);
      return data.id;
    };

    sundayId = await seedSunday(fixtures.wardAId);
    wardBSundayId = await seedSunday(fixtures.wardBId);
    assignmentId = await seedAssignment(fixtures.wardAId, sundayId);
    wardBAssignmentId = await seedAssignment(fixtures.wardBId, wardBSundayId);
  });

  afterAll(async () => {
    await fixtures?.cleanup();
  });

  describe("POST", () => {
    it("posts an assignment-level comment", async () => {
      await actAs(fixtures, "bishop");

      const { status, body } = await callPost({
        level: "assignment",
        assignmentId,
        comment: "Ask them to keep it to ten minutes.",
      });

      expect(status).toBe(201);

      const comment = body.comment as {
        id: string;
        level: string;
        assignmentId: string | null;
        sundayId: string | null;
      };
      expect(comment.level).toBe("assignment");
      expect(comment.assignmentId).toBe(assignmentId);

      // A month comment can never carry an assignment_id and vice versa: the id column is
      // chosen by the same discriminant that sets `level`.
      expect(comment.sundayId).toBeNull();
    });

    it("posts a month-level comment", async () => {
      await actAs(fixtures, "bishop");

      const { status, body } = await callPost({
        level: "month",
        sundayId,
        comment: "We still need a third speaker for this week.",
      });

      expect(status).toBe(201);

      const comment = body.comment as {
        level: string;
        assignmentId: string | null;
        sundayId: string | null;
      };
      expect(comment.level).toBe("month");
      expect(comment.sundayId).toBe(sundayId);
      expect(comment.assignmentId).toBeNull();
    });

    it("refuses an empty comment", async () => {
      await actAs(fixtures, "bishop");

      const { status, body } = await callPost({
        level: "assignment",
        assignmentId,
        comment: "   ",
      });

      expect(status).toBe(400);
      expect(errorMessage(body)).toBe("Type a comment first.");
    });

    // RLS would refuse the insert anyway through the composite foreign key, but a 404 naming
    // what was not found is a far better answer than a constraint violation — and it must not
    // confirm that the assignment exists somewhere else.
    it("answers 404 for an assignment in another ward", async () => {
      await actAs(fixtures, "bishop");

      const { status, body } = await callPost({
        level: "assignment",
        assignmentId: wardBAssignmentId,
        comment: "written from ward A",
      });

      expect(status).toBe(404);
      expect(errorMessage(body)).toBe("That assignment is not in your ward.");
    });

    it("answers 404 for a Sunday in another ward", async () => {
      await actAs(fixtures, "bishop");

      const { status, body } = await callPost({
        level: "month",
        sundayId: wardBSundayId,
        comment: "written from ward A",
      });

      expect(status).toBe(404);
      expect(errorMessage(body)).toBe("That Sunday is not on your ward's calendar.");
    });

    it("refuses a role without talks.plan", async () => {
      await actAs(fixtures, "musicCoordinator");

      const { status, body } = await callPost({
        level: "assignment",
        assignmentId,
        comment: "should not land",
      });

      expect(status).toBe(403);
      expect(errorMessage(body)).toBe("You do not have permission to do that.");

      const { count } = await fixtures.service
        .from("assignment_comments")
        .select("id", { count: "exact", head: true })
        .eq("comment", "should not land");

      expect(count).toBe(0);
    });

    // The whole reason this suite exists. `detail` carries the id and the level so an auditor
    // can find the row; it must never carry the text, because an audit row is readable by the
    // whole bishopric and a comment is free text about a member (CLAUDE.md rule 8).
    it("audits the comment's id and level and never its body", async () => {
      await actAs(fixtures, "bishop");

      const secret = `Brother Andersen is struggling ${fixtures.runId}`;

      const { status, body } = await callPost({
        level: "assignment",
        assignmentId,
        comment: secret,
      });

      expect(status).toBe(201);
      const commentId = (body.comment as { id: string }).id;

      const { data, error } = await fixtures.service
        .from("audit_log")
        .select("action, module, detail")
        .eq("ward_id", fixtures.wardAId)
        .eq("action", "assignment_comment_created")
        .order("created_at", { ascending: false })
        .limit(1);

      if (error) throw new Error(`Could not read the audit row: ${error.message}`);
      expect(data).toHaveLength(1);

      const detail = data![0].detail as Record<string, unknown>;
      expect(detail.commentId).toBe(commentId);
      expect(detail.level).toBe("assignment");
      expect(detail.assignmentId).toBe(assignmentId);

      // Checked over the WHOLE serialised row, not just the fields named above — a body that
      // leaked through some other key would still be a leak.
      expect(JSON.stringify(data![0])).not.toContain(secret);
      expect(JSON.stringify(data![0])).not.toContain("struggling");
    });
  });

  describe("GET", () => {
    it("returns only the assignment's own thread", async () => {
      await actAs(fixtures, "bishop");

      const { status, body } = await callGet(`assignmentId=${assignmentId}`);

      expect(status).toBe(200);

      const comments = body.comments as CommentRow[];
      expect(comments.length).toBeGreaterThan(0);
      expect(comments.every((row) => row.level === "assignment")).toBe(true);
    });

    it("returns only the month thread", async () => {
      await actAs(fixtures, "bishop");

      const { status, body } = await callGet(`sundayId=${sundayId}`);

      expect(status).toBe(200);

      const comments = body.comments as CommentRow[];
      expect(comments.length).toBeGreaterThan(0);
      expect(comments.every((row) => row.level === "month")).toBe(true);
    });

    it("refuses a request with neither filter, and says what it wanted", async () => {
      await actAs(fixtures, "bishop");

      const { status, body } = await callGet("");

      expect(status).toBe(400);
      expect(errorMessage(body)).toBe(
        "Ask for one assignment with ?assignmentId=, or one Sunday with ?sundayId=.",
      );
      expect(errorMessage(body)).not.toBe("Invalid input");
    });

    it("refuses a role without talks.view", async () => {
      // eqPresident, NOT musicCoordinator: music_coordinator HOLDS talks.view
      // (lib/auth/permissions.ts) and is refused on POST by talks.plan instead — see the test
      // below for what it actually gets here.
      await actAs(fixtures, "eqPresident");

      const { status, body } = await callGet(`assignmentId=${assignmentId}`);

      expect(status).toBe(403);
      expect(errorMessage(body)).toBe("You do not have permission to do that.");
    });

    // talks.view lets the music coordinator past assertCan; migration 019's bishopric-only
    // policy then returns no rows. Two boundaries, and the database is the one that holds.
    it("lets the music coordinator in, and RLS still returns nothing", async () => {
      await actAs(fixtures, "musicCoordinator");

      const { status, body } = await callGet(`assignmentId=${assignmentId}`);

      expect(status).toBe(200);
      expect(body.comments).toEqual([]);
    });

    it("never shows one ward another ward's comments", async () => {
      await actAs(fixtures, "wardBBishop");

      const { status, body } = await callGet(`assignmentId=${assignmentId}`);

      expect(status).toBe(200);
      expect(body.comments).toEqual([]);
    });
  });
});
