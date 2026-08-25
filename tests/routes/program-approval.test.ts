// @vitest-environment node
//
// The four program routes, called as functions.
//
// See tests/helpers/routeClient.ts for why this needs no server, and read its header comment
// before editing the vi.mock below — the hoisting trap is the likeliest hour to lose. Only
// @/lib/supabase/server is mocked, so every query still runs against the hosted project as a
// genuinely authenticated user and a passing test proves RLS allowed it.
//
// The property this suite exists for: A SECRETARY CAN DO EVERY STEP EXCEPT APPROVE. That is the
// division 06-program-music.md describes and the one a ward will feel — the secretary builds the
// program all week and a member of the bishopric signs it off. A 403 in the wrong place makes the
// feature unusable; a missing 403 on approve makes the sign-off meaningless.

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

const SUNDAY_DATE = "2027-08-01";
const NO_MEETING_DATE = "2027-08-08";

async function callBuild(body: unknown) {
  const { POST } = await import("@/app/api/programs/route");
  return readResponse(
    await POST(jsonRequest("http://localhost/api/programs", { method: "POST", body })),
  );
}

async function callView(sundayId: string) {
  const { GET } = await import("@/app/api/programs/by-sunday/[sunday_id]/route");
  return readResponse(
    await GET(jsonRequest(`http://localhost/api/programs/by-sunday/${sundayId}`), {
      params: Promise.resolve({ sunday_id: sundayId }),
    }),
  );
}

async function callApprove(programId: string, body: unknown) {
  const { POST } = await import("@/app/api/programs/[id]/approve/route");
  return readResponse(
    await POST(
      jsonRequest(`http://localhost/api/programs/${programId}/approve`, {
        method: "POST",
        body,
      }),
      { params: Promise.resolve({ id: programId }) },
    ),
  );
}

async function callRefresh(programId: string, body: unknown) {
  const { POST } = await import("@/app/api/programs/[id]/refresh/route");
  return readResponse(
    await POST(
      jsonRequest(`http://localhost/api/programs/${programId}/refresh`, {
        method: "POST",
        body,
      }),
      { params: Promise.resolve({ id: programId }) },
    ),
  );
}

describe("the program routes", () => {
  let fixtures: Fixtures;

  let sundayId = "";
  let noMeetingSundayId = "";
  let memberId = "";
  let programId = "";

  async function readStatus(id: string): Promise<string> {
    const { data, error } = await fixtures.service
      .from("programs")
      .select("status")
      .eq("id", id)
      .single();

    if (error) throw new Error(`Could not re-read the program: ${error.message}`);
    return data.status;
  }

  async function setStatus(id: string, status: string): Promise<void> {
    const { error } = await fixtures.service
      .from("programs")
      .update({ status })
      .eq("id", id);

    if (error) throw new Error(`Could not set the status: ${error.message}`);
  }

  beforeAll(async () => {
    fixtures = await seedFixtures(
      ["bishop", "counselor1", "wardSecretary", "musicCoordinator", "eqPresident"],
      {
        notificationTriggers: [
          { triggerKey: "program_pending_approval", defaultRoles: ["bishop", "counselor"] },
          {
            triggerKey: "program_approved",
            defaultRoles: ["bishop", "counselor", "ward_secretary"],
          },
          {
            triggerKey: "program_changes_requested",
            defaultRoles: ["bishop", "counselor", "ward_secretary"],
          },
        ],
      },
    );

    const seedSunday = async (date: string, type: string) => {
      const { data, error } = await fixtures.service
        .from("sundays")
        .insert({
          ward_id: fixtures.wardAId,
          date,
          type,
          speaking_slots: type === "standard" ? 3 : 0,
          conducting_user_id: type === "standard" ? fixtures.user("bishop").id : null,
        })
        .select("id")
        .single();
      if (error) throw new Error(`Could not seed a Sunday: ${error.message}`);
      return data.id;
    };

    sundayId = await seedSunday(SUNDAY_DATE, "standard");
    noMeetingSundayId = await seedSunday(NO_MEETING_DATE, "stake_conference");

    const { data: household, error: householdError } = await fixtures.service
      .from("households")
      .insert({ ward_id: fixtures.wardAId, family_name: "Whitfield" })
      .select("id")
      .single();
    if (householdError) throw new Error(householdError.message);

    const { data: member, error: memberError } = await fixtures.service
      .from("members")
      .insert({
        ward_id: fixtures.wardAId,
        household_id: household.id,
        first_name: "Sarah",
        last_name: "Whitfield",
        status: "active",
        category: "adult",
      })
      .select("id")
      .single();
    if (memberError) throw new Error(memberError.message);
    memberId = member.id;

    const { error: assignmentError } = await fixtures.service.from("assignments").insert({
      ward_id: fixtures.wardAId,
      sunday_id: sundayId,
      member_id: memberId,
      assignment_type: "sacrament_talk",
      slot_number: 1,
      pipeline_stage: "notify",
    });
    if (assignmentError) throw new Error(assignmentError.message);
  });

  afterAll(async () => {
    await fixtures.cleanup();
  });

  describe("POST /api/programs — build", () => {
    it("lets a ward secretary build a draft with real speakers in it", async () => {
      await actAs(fixtures, "wardSecretary");
      const { status, body } = await callBuild({ action: "build", sundayId });

      expect(status).toBe(201);

      const program = body.program as Record<string, unknown>;
      const draft = program.draft as Record<string, unknown>;
      const speakers = draft.speakers as Record<string, unknown>[];

      programId = program.id as string;

      // The assertion migration 038 exists for. Before it, this was `empty` with a 200.
      expect(speakers[0]).toMatchObject({
        slotNumber: 1,
        kind: "member",
        printedName: "Sarah Whitfield",
        publicName: "Sarah W.",
      });
      expect(draft.date).toBe(SUNDAY_DATE);
    });

    it("reports what is missing rather than refusing to build", async () => {
      await actAs(fixtures, "wardSecretary");
      const { body } = await callBuild({ action: "build", sundayId });

      const draft = (body.program as Record<string, unknown>).draft as Record<string, unknown>;
      const missing = draft.missing as string[];

      // A Thursday program with gaps is the normal case, not the error case.
      expect(missing).toContain("speaker_slot");
      expect(missing).toContain("announcements");
      expect(missing).toContain("invocation");
    });

    it("answers 422 for a Sunday that holds no sacrament meeting", async () => {
      await actAs(fixtures, "wardSecretary");
      const { status, body } = await callBuild({
        action: "build",
        sundayId: noMeetingSundayId,
      });

      expect(status).toBe(422);
      expect(errorMessage(body)).toContain("no sacrament meeting");
    });

    it("refuses a build from a role without program.build", async () => {
      // music_coordinator holds music.view and music.manage, not program.build. Checked against
      // lib/auth/permissions.ts rather than guessed — the matrix is not always intuitive.
      await actAs(fixtures, "musicCoordinator");
      const { status } = await callBuild({ action: "build", sundayId });

      expect(status).toBe(403);
    });

    it("rejects a body that mixes a save with a status move", async () => {
      // The discriminated union is what makes implicit status advancement unrepresentable rather
      // than merely discouraged.
      await actAs(fixtures, "wardSecretary");
      const { status } = await callBuild({
        action: "save",
        programId,
        to: "pending_approval",
      });

      expect(status).toBe(400);
    });
  });

  describe("GET /api/programs/by-sunday/[sunday_id]", () => {
    it("returns the STORED draft and its missing list", async () => {
      await actAs(fixtures, "wardSecretary");
      const { status, body } = await callView(sundayId);

      expect(status).toBe(200);
      expect(Array.isArray(body.missing)).toBe(true);
      expect((body.program as Record<string, unknown>).id).toBe(programId);
    });

    it("lets the bishop read it too", async () => {
      await actAs(fixtures, "bishop");
      const { status } = await callView(sundayId);

      expect(status).toBe(200);
    });

    it("answers 404 for a Sunday with no program yet", async () => {
      await actAs(fixtures, "wardSecretary");
      const { status } = await callView(noMeetingSundayId);

      expect(status).toBe(404);
    });

    it("refuses a role without program.view", async () => {
      // org_president holds neither program.view nor talks.view.
      await actAs(fixtures, "eqPresident");
      const { status } = await callView(sundayId);

      expect(status).toBe(403);
    });
  });

  describe("POST /api/programs/[id]/refresh", () => {
    it("lets a ward secretary see a diff and writes nothing", async () => {
      const { error } = await fixtures.service
        .from("assignments")
        .update({ member_id: null, external_speaker_name: "Mark Andersen", external_speaker_title: "President" })
        .eq("ward_id", fixtures.wardAId)
        .eq("sunday_id", sundayId)
        .eq("slot_number", 1);
      if (error) throw new Error(error.message);

      await actAs(fixtures, "wardSecretary");
      const { status, body } = await callRefresh(programId, { apply: false });

      expect(status).toBe(200);
      expect(body.applied).toBe(false);

      const changes = body.changes as Record<string, unknown>[];
      expect(changes).toContainEqual({
        field: "speakers.1.printedName",
        label: "First speaker",
        before: "Sarah Whitfield",
        after: "President Mark Andersen",
      });

      // Wrote nothing: the stored draft still names the member.
      const stored = await callView(sundayId);
      const draft = (stored.body.program as Record<string, unknown>).draft as Record<
        string,
        unknown
      >;
      expect((draft.speakers as Record<string, unknown>[])[0].printedName).toBe(
        "Sarah Whitfield",
      );
    });

    it("takes the change only when apply is true", async () => {
      await actAs(fixtures, "wardSecretary");
      const { status, body } = await callRefresh(programId, { apply: true });

      expect(status).toBe(200);
      expect(body.applied).toBe(true);

      const stored = await callView(sundayId);
      const draft = (stored.body.program as Record<string, unknown>).draft as Record<
        string,
        unknown
      >;
      expect((draft.speakers as Record<string, unknown>[])[0].printedName).toBe(
        "President Mark Andersen",
      );
    });

    it("refuses a refresh from a role without program.build", async () => {
      await actAs(fixtures, "musicCoordinator");
      const { status } = await callRefresh(programId, { apply: false });

      expect(status).toBe(403);
    });
  });

  describe("POST /api/programs/[id]/approve", () => {
    it("refuses a ward secretary — this is the one step they cannot take", async () => {
      await setStatus(programId, "pending_approval");

      await actAs(fixtures, "wardSecretary");
      const { status } = await callApprove(programId, { approved: true });

      expect(status).toBe(403);
      expect(await readStatus(programId)).toBe("pending_approval");
    });

    it("lets a counselor approve — bishopric authority is shared", async () => {
      await actAs(fixtures, "counselor1");
      const { status, body } = await callApprove(programId, { approved: true });

      expect(status).toBe(200);
      expect(body.approved).toBe(true);
      expect(await readStatus(programId)).toBe("approved");
    });

    it("stamps who approved it and when", async () => {
      const { data, error } = await fixtures.service
        .from("programs")
        .select("approved_by, approved_at")
        .eq("id", programId)
        .single();
      if (error) throw new Error(error.message);

      expect(data.approved_by).toBe(fixtures.user("counselor1").id);
      expect(data.approved_at).not.toBeNull();
    });

    it("refuses a second approval of an already-approved program", async () => {
      // ONE approval, not three. The expected-status filter in the UPDATE is what makes a double
      // approval impossible without a lock.
      await actAs(fixtures, "bishop");
      const { status, body } = await callApprove(programId, { approved: true });

      expect(status).toBe(409);
      expect(errorMessage(body)).toContain("approved");
    });

    it("refuses to approve a program that is still a draft", async () => {
      await setStatus(programId, "draft");

      await actAs(fixtures, "bishop");
      const { status, body } = await callApprove(programId, { approved: true });

      expect(status).toBe(409);
      expect(errorMessage(body)).toContain("not waiting for approval");
      expect(await readStatus(programId)).toBe("draft");
    });

    it("requires a comment when sending a program back", async () => {
      await setStatus(programId, "pending_approval");

      await actAs(fixtures, "bishop");
      const { status, body } = await callApprove(programId, { approved: false });

      expect(status).toBe(400);
      expect(errorMessage(body)).toContain("Say what needs changing");
    });

    it("sends a program back to draft with its comment", async () => {
      await actAs(fixtures, "bishop");
      const { status, body } = await callApprove(programId, {
        approved: false,
        comment: "The sacrament hymn is missing.",
      });

      expect(status).toBe(200);
      expect(body.approved).toBe(false);
      expect(await readStatus(programId)).toBe("draft");
    });
  });

  describe("an approved program refuses an edit until it is reopened", () => {
    it("refuses a save while approved, naming what to do instead", async () => {
      await setStatus(programId, "approved");

      await actAs(fixtures, "wardSecretary");
      const stored = await callView(sundayId);
      const draft = (stored.body.program as Record<string, unknown>).draft;

      const { status, body } = await callBuild({ action: "save", programId, draft });

      expect(status).toBe(409);
      expect(errorMessage(body)).toContain("Reopen it as a draft");
    });

    it("refuses a refresh while approved", async () => {
      await actAs(fixtures, "wardSecretary");
      const { status } = await callRefresh(programId, { apply: false });

      expect(status).toBe(409);
    });

    it("lets the secretary reopen it, and then the save succeeds", async () => {
      await actAs(fixtures, "wardSecretary");

      const reopened = await callBuild({ action: "status", programId, to: "draft" });
      expect(reopened.status).toBe(200);
      expect(await readStatus(programId)).toBe("draft");

      const stored = await callView(sundayId);
      const draft = (stored.body.program as Record<string, unknown>).draft;

      const { status } = await callBuild({ action: "save", programId, draft });
      expect(status).toBe(200);
    });

    it("refuses an illegal status move rather than performing it", async () => {
      // draft -> approved is not a builder's to make, and the enum refuses it before the status
      // machine is ever consulted.
      await actAs(fixtures, "wardSecretary");
      const { status } = await callBuild({ action: "status", programId, to: "approved" });

      expect(status).toBe(400);
      expect(await readStatus(programId)).toBe("draft");
    });

    it("submits for approval and notifies the bishopric", async () => {
      await actAs(fixtures, "wardSecretary");
      const { status } = await callBuild({
        action: "status",
        programId,
        to: "pending_approval",
      });

      expect(status).toBe(200);
      expect(await readStatus(programId)).toBe("pending_approval");

      const { data, error } = await fixtures.service
        .from("notifications")
        .select("recipient_user_id, title")
        .eq("ward_id", fixtures.wardAId)
        .eq("trigger_key", "program_pending_approval");
      if (error) throw new Error(error.message);

      // A trigger key nothing fires is indistinguishable from a broken one, which is why the
      // notification is asserted rather than assumed.
      expect(data?.length ?? 0).toBeGreaterThan(0);
      expect(
        data?.some((row) => row.recipient_user_id === fixtures.user("bishop").id),
      ).toBe(true);
    });
  });

  describe("the audit trail", () => {
    it("records every program write", async () => {
      const { data, error } = await fixtures.service
        .from("audit_log")
        .select("action")
        .eq("ward_id", fixtures.wardAId)
        .eq("module", "program");
      if (error) throw new Error(error.message);

      const actions = new Set((data ?? []).map((row) => row.action));

      expect(actions).toContain("program_draft_created");
      expect(actions).toContain("program_draft_refreshed");
      expect(actions).toContain("program_approved");
      expect(actions).toContain("program_changes_requested");
      expect(actions).toContain("program_status_changed");
    });
  });
});
