// @vitest-environment node
//
// PATCH /api/assignments/[id] `{ action: "remove" }` — Delete on a talk (Topics rebuild t3,
// migration 087). The talk is CANCELLED and kept, the later talks move up one slot, the Sunday has
// one fewer speaker, and the people are told by the same reconcile a calendar edit runs (f2c).
//
// Only the client factory is mocked (tests/helpers/routeClient.ts), so remove_talk() runs as a
// genuinely authenticated user under RLS. Every refusal is asserted by RE-READING the rows: an
// RLS-refused write is a zero-row success, not an error (CLAUDE.md §8).
//
// Every refused request is otherwise valid — a real, uncancelled talk on a Sunday with three
// slots — so it is refused for the reason under test and no earlier one (the global rule).

import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { actAs, errorMessage, jsonRequest, readResponse } from "@/tests/helpers/routeClient";
import { seedFixtures, type Fixtures } from "@/tests/helpers/seed";
import type { Json } from "@/types/database";

vi.mock("@/lib/supabase/server", async () => {
  const { serverClientMock } = await import("@/tests/helpers/routeClient");
  return serverClientMock();
});

const BASE = "http://localhost/api";
// Not the first Sunday of their months, which are seeded as pinned Fast Sundays.
const SUNDAY_DATE = "2027-08-15";
const REFUSAL_SUNDAY_DATE = "2027-08-22";
const LAST_TALK_SUNDAY_DATE = "2027-08-29";

async function removeTalk(assignmentId: string) {
  const { PATCH } = await import("@/app/api/assignments/[id]/route");
  return readResponse(
    await PATCH(
      jsonRequest(`${BASE}/assignments/${assignmentId}`, {
        method: "PATCH",
        body: { action: "remove" },
      }),
      { params: Promise.resolve({ id: assignmentId }) },
    ),
  );
}

async function sendAsks(sundayId: string) {
  const { POST } = await import("@/app/api/sundays/[id]/asks/route");
  return readResponse(
    await POST(jsonRequest(`${BASE}/sundays/${sundayId}/asks`, { method: "POST" }), {
      params: Promise.resolve({ id: sundayId }),
    }),
  );
}

describe("Delete on a talk — cancel it and move the rest up", () => {
  let fixtures: Fixtures;
  let wardId = "";
  let sundayId = "";
  let firstTalkId = "";
  let middleTalkId = "";
  let lastTalkId = "";
  let refusalSundayId = "";
  let refusalTalkId = "";
  let lastTalkSundayId = "";
  let onlyTalkId = "";
  let wardBTalkId = "";

  async function readTalk(id: string) {
    const { data, error } = await fixtures.service
      .from("assignments")
      .select("slot_number, cancelled_at, cancelled_reason")
      .eq("id", id)
      .single();
    if (error) throw new Error(error.message);
    return data;
  }

  async function readSunday(id: string) {
    const { data, error } = await fixtures.service
      .from("sundays")
      .select("speaking_slots, topics_finalized_at, references_finalized_at")
      .eq("id", id)
      .single();
    if (error) throw new Error(error.message);
    return data;
  }

  beforeAll(async () => {
    fixtures = await seedFixtures(["bishop", "counselor1", "counselor2", "musicCoordinator"]);
    wardId = fixtures.wardAId;
    const service = fixtures.service;

    const { error: fastError } = await service.from("sundays").insert({
      ward_id: wardId,
      date: "2027-08-01",
      type: "fast_sunday",
      speaking_slots: 0,
      fast_sunday_pinned: true,
    });
    if (fastError) throw new Error(fastError.message);

    const seedSunday = async (ward: string, date: string, slots: number) => {
      const { data, error } = await service
        .from("sundays")
        .insert({
          ward_id: ward,
          date,
          type: "standard",
          speaking_slots: slots,
          conducting_user_id: ward === wardId ? fixtures.user("counselor1").id : null,
          topics_finalized_at: new Date().toISOString(),
          references_skipped_at: new Date().toISOString(),
        })
        .select("id")
        .single();
      if (error) throw new Error(error.message);
      return data.id;
    };
    sundayId = await seedSunday(wardId, SUNDAY_DATE, 3);
    refusalSundayId = await seedSunday(wardId, REFUSAL_SUNDAY_DATE, 3);
    lastTalkSundayId = await seedSunday(wardId, LAST_TALK_SUNDAY_DATE, 1);
    const wardBSundayId = await seedSunday(fixtures.wardBId, SUNDAY_DATE, 3);

    const { data: member, error: memberError } = await service
      .from("members")
      .insert({
        ward_id: wardId,
        first_name: "Maria",
        last_name: `Remove${fixtures.runId}`,
        category: "adult",
        phone: "801-555-0101",
      })
      .select("id")
      .single();
    if (memberError) throw new Error(memberError.message);

    const seedTalk = async (
      ward: string,
      sunday: string,
      slotNumber: number,
      memberId: string | null = null,
    ) => {
      const { data, error } = await service
        .from("assignments")
        .insert({
          ward_id: ward,
          sunday_id: sunday,
          assignment_type: "sacrament_talk",
          slot_number: slotNumber,
          member_id: memberId,
          external_speaker_name: memberId === null ? `Visitor ${slotNumber}` : null,
          topic_title: `Topic ${slotNumber}`,
          pipeline_stage: "plan",
        })
        .select("id")
        .single();
      if (error) throw new Error(error.message);
      return data.id;
    };
    firstTalkId = await seedTalk(wardId, sundayId, 1);
    middleTalkId = await seedTalk(wardId, sundayId, 2, member.id);
    lastTalkId = await seedTalk(wardId, sundayId, 3);
    refusalTalkId = await seedTalk(wardId, refusalSundayId, 2);
    await seedTalk(wardId, refusalSundayId, 1);
    await seedTalk(wardId, refusalSundayId, 3);
    onlyTalkId = await seedTalk(wardId, lastTalkSundayId, 1);
    wardBTalkId = await seedTalk(fixtures.wardBId, wardBSundayId, 2);

    // Maria is ASKED: the conductor holds an open ask for her talk.
    await actAs(fixtures, "bishop");
    const sent = await sendAsks(sundayId);
    if (sent.status !== 201) throw new Error(`Send asks answered ${sent.status}`);
  });

  afterAll(async () => {
    await fixtures?.cleanup();
  });

  describe("removing the middle talk", () => {
    it("answers 200", async () => {
      await actAs(fixtures, "bishop");
      const { status, body } = await removeTalk(middleTalkId);

      expect(status).toBe(200);
      expect(body.removed).toEqual({ sundayId, shiftedCount: 1 });
      expect(body.warning).toBeNull();
    });

    it("cancels the talk and keeps it, with reason slot_removed", async () => {
      const row = await readTalk(middleTalkId);
      expect(row.cancelled_at).not.toBeNull();
      expect(row.cancelled_reason).toBe("slot_removed");
      expect(row.slot_number).toBe(2);
    });

    it("moves the later talk up one slot, and leaves the earlier one", async () => {
      expect((await readTalk(lastTalkId)).slot_number).toBe(2);
      expect((await readTalk(firstTalkId)).slot_number).toBe(1);
    });

    it("gives the Sunday one fewer speaker, and un-finalizes its topics", async () => {
      expect(await readSunday(sundayId)).toEqual({
        speaking_slots: 2,
        topics_finalized_at: null,
        references_finalized_at: null,
      });
    });

    it("writes a cancelled speaker-history row for the member", async () => {
      const { data } = await fixtures.service
        .from("assignment_history")
        .select("outcome, cancellation_days_notice")
        .eq("assignment_id", middleTalkId);
      expect(data).toEqual([{ outcome: "cancelled", cancellation_days_notice: null }]);
    });

    // An open (unanswered) ask is not closed: it stays with its owner, marked as off, so they can
    // let the speaker know and press Told them (Sacrament slice f2b/f2c).
    it("marks the conductor's open ask as off, so they let the speaker know", async () => {
      const { data } = await fixtures.service
        .from("todos")
        .select("user_id, completed_at, talk_off_at")
        .eq("ask_assignment_id", middleTalkId);
      expect(data).toHaveLength(1);
      expect(data![0].user_id).toBe(fixtures.user("counselor1").id);
      expect(data![0].completed_at).toBeNull();
      expect(data![0].talk_off_at).not.toBeNull();
    });

    it("writes an audit row with no name and no topic in it", async () => {
      const { data } = await fixtures.service
        .from("audit_log")
        .select("detail")
        .eq("ward_id", wardId)
        .eq("action", "assignment_removed");
      expect(data).toHaveLength(1);
      const detail = data![0].detail as Record<string, unknown>;
      expect(detail).toMatchObject({ sundayId, slotNumber: 2, shiftedCount: 1 });
      expect(JSON.stringify(detail)).not.toContain("Maria");
      expect(JSON.stringify(detail)).not.toContain("Topic");
    });
  });

  describe("refusals", () => {
    it("refuses a talk that has already been removed", async () => {
      await actAs(fixtures, "bishop");
      const { status } = await removeTalk(middleTalkId);

      expect(status).toBe(409);
      expect((await readSunday(sundayId)).speaking_slots).toBe(2);
      expect((await readTalk(lastTalkId)).slot_number).toBe(2);
    });

    it("refuses the Sunday's only talk, with a sentence naming the alternative", async () => {
      await actAs(fixtures, "bishop");
      const { status, body } = await removeTalk(onlyTalkId);

      expect(status).toBe(409);
      expect(errorMessage(body)).toContain("Clear its speaker and topic instead");
      expect((await readTalk(onlyTalkId)).cancelled_at).toBeNull();
      expect((await readSunday(lastTalkSundayId)).speaking_slots).toBe(1);
    });

    it("refuses a role without talks.plan", async () => {
      await actAs(fixtures, "musicCoordinator");
      const { status } = await removeTalk(refusalTalkId);

      expect(status).toBe(403);
      expect((await readTalk(refusalTalkId)).cancelled_at).toBeNull();
      expect((await readSunday(refusalSundayId)).speaking_slots).toBe(3);
    });

    // No built-in role holds talks.plan without calendar.manage, so the ward takes calendar.manage
    // away from the bishopric for this one request — the honest way that combination arises.
    it("refuses somebody with talks.plan but not calendar.manage", async () => {
      const { data: ward } = await fixtures.service
        .from("wards")
        .select("settings")
        .eq("id", wardId)
        .single();
      const settings = (ward?.settings ?? {}) as { [key: string]: Json | undefined };

      await fixtures.service
        .from("wards")
        .update({
          settings: { ...settings, role_access: { counselor: { remove: ["calendar.manage"] } } },
        })
        .eq("id", wardId);

      try {
        await actAs(fixtures, "counselor2");
        const { status } = await removeTalk(refusalTalkId);
        expect(status).toBe(403);
      } finally {
        await fixtures.service.from("wards").update({ settings }).eq("id", wardId);
      }

      expect((await readTalk(refusalTalkId)).cancelled_at).toBeNull();
      expect((await readSunday(refusalSundayId)).speaking_slots).toBe(3);
    });

    it("answers 404 for a talk in another ward", async () => {
      await actAs(fixtures, "bishop");
      const { status } = await removeTalk(wardBTalkId);

      expect(status).toBe(404);
      expect((await readTalk(wardBTalkId)).cancelled_at).toBeNull();
    });
  });
});
