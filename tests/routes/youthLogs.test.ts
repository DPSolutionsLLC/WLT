// @vitest-environment node
//
// POST /api/youth/logs and PATCH /api/youth/logs/[id] — filing a follow-up, and the flag.
//
// ---------------------------------------------------------------------------
// THE ASSERTIONS THIS SUITE EXISTS FOR
// ---------------------------------------------------------------------------
// 1. THE FLAG TRANSITION, ALL THREE ROWS OF THE TABLE. A re-flag that notified again would spam
//    the executive secretary; an unflag that left `flag_sent_at` stamped would make the next
//    genuine raise SILENT, and an agenda item nobody was told about is the same as no agenda item.
//    Both `flag_sent_at` and the notification rows are asserted, because the first alone would
//    pass against a route that stamped the column and never emitted.
//
// 2. A SECOND FOLLOW-UP IS A 409 WITH A SENTENCE NAMING THE ALTERNATIVE, not a 500 and not a
//    duplicate row. That is deliberately DIFFERENT from a second self-add, which is a quiet 200:
//    being already down for an event is the state the caller wanted, and a second follow-up is
//    not — they meant to change the one they wrote.
//
// 3. TWO REFUSALS THAT LOOK ALIKE AND ARE NOT. An event the caller CANNOT SEE is a 404 — a 403
//    there would confirm it exists. An event they CAN see but may not write against (migration
//    057c's parent scope) is a 403 with a sentence naming the boundary, because there is nothing
//    left to conceal and a 404 would only confuse. The second case answered 500 on this suite's
//    first run, which is what the `refused` sentinel in lib/youth/activityLogs.ts exists for.
//
// 4. `loggedBy` CANNOT BE NAMED BY A BODY. Migration 058's header explains why the POLICY cannot
//    hold that guarantee on an UPDATE — WITH CHECK sees only the resulting row — so it is held
//    here, by a schema with no such field and a patch that never assigns the column. This is where
//    that assertion belongs, and this suite is the reason it is safe to have left it out of RLS.
//
// 5. A ROLE WITHOUT `youth_activities.log` IS REFUSED. Checked against lib/auth/permissions.ts
//    rather than guessed (CLAUDE.md §8): `music_coordinator` holds none of the three youth keys,
//    and `ward_council_member` holds all three.
//
// See tests/helpers/routeClient.ts for why this needs no server and what exactly is mocked — only
// the client factory, so every query below still runs as a genuinely authenticated user against
// the hosted project and a pass means RLS allowed it.

import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { actAs, errorMessage, jsonRequest, readResponse } from "@/tests/helpers/routeClient";
import { seedFixtures, type Fixtures } from "@/tests/helpers/seed";

vi.mock("@/lib/supabase/server", async () => {
  const { serverClientMock } = await import("@/tests/helpers/routeClient");
  return serverClientMock();
});

const BASE_URL = "http://localhost/api/youth/logs";

const FLAG_TRIGGER = "youth_activity_flagged_for_ward_council";
const SUBMITTED_TRIGGER = "youth_followup_submitted";

async function createLog(body: unknown) {
  const { POST } = await import("@/app/api/youth/logs/route");
  return readResponse(await POST(jsonRequest(BASE_URL, { method: "POST", body })));
}

async function patchLog(logId: string, body: unknown) {
  // `params` is a Promise in Next 16.
  const { PATCH } = await import("@/app/api/youth/logs/[id]/route");
  return readResponse(
    await PATCH(jsonRequest(`${BASE_URL}/${logId}`, { method: "PATCH", body }), {
      params: Promise.resolve({ id: logId }),
    }),
  );
}

async function listOwnLogs(includePast: boolean) {
  const { GET } = await import("@/app/api/youth/logs/route");
  const url = `${BASE_URL}${includePast ? "?includePast=true" : ""}`;
  return readResponse(await GET(jsonRequest(url)));
}

describe("/api/youth/logs", () => {
  let fixtures: Fixtures;

  let eqEventId: string;
  let eqPastEventId: string;
  let rsEventId: string;

  const rowFor = async (logId: string) => {
    const { data, error } = await fixtures.service
      .from("activity_logs")
      .select("id, event_id, logged_by, shared_notes, flagged_for_ward_council, flag_sent_at")
      .eq("id", logId)
      .maybeSingle();

    if (error) throw new Error(error.message);
    return data;
  };

  const notificationsFor = async (triggerKey: string) => {
    const { data, error } = await fixtures.service
      .from("notifications")
      .select("recipient_user_id, body")
      .eq("ward_id", fixtures.wardAId)
      .eq("trigger_key", triggerKey);

    if (error) throw new Error(error.message);
    return data ?? [];
  };

  const attendanceFor = async (eventId: string, userId: string) => {
    const { data, error } = await fixtures.service
      .from("activity_attendees")
      .select("confirmed_attendance")
      .eq("event_id", eventId)
      .eq("user_id", userId)
      .maybeSingle();

    if (error) throw new Error(error.message);
    return data?.confirmed_attendance ?? null;
  };

  beforeAll(async () => {
    fixtures = await seedFixtures(
      [
        "bishop",
        "eqPresident",
        "eqSecretary",
        "rsPresident",
        "executiveSecretary",
        "musicCoordinator",
      ],
      {
        notificationTriggers: [
          { triggerKey: FLAG_TRIGGER, defaultRoles: ["executive_secretary"] },
          {
            triggerKey: SUBMITTED_TRIGGER,
            defaultRoles: ["org_president", "org_counselor"],
          },
        ],
      },
    );

    const { data: member, error: memberError } = await fixtures.service
      .from("members")
      .insert({
        ward_id: fixtures.wardAId,
        first_name: "Ada",
        last_name: `Youth${fixtures.runId}`,
        category: "youth",
        status: "active",
      })
      .select("id")
      .single();
    if (memberError) throw new Error(memberError.message);

    const { data: profiles, error: profileError } = await fixtures.service
      .from("youth_activity_profiles")
      .insert([
        {
          ward_id: fixtures.wardAId,
          org_id: fixtures.eldersQuorumId,
          member_id: member.id,
          activity_name: `EQ basketball ${fixtures.runId}`,
          activity_type: "sport",
        },
        {
          ward_id: fixtures.wardAId,
          org_id: fixtures.reliefSocietyId,
          member_id: member.id,
          activity_name: `RS choir ${fixtures.runId}`,
          activity_type: "performance",
        },
      ])
      .select("id, org_id");
    if (profileError) throw new Error(profileError.message);

    const eqProfileId = profiles.find((row) => row.org_id === fixtures.eldersQuorumId)!.id;
    const rsProfileId = profiles.find((row) => row.org_id === fixtures.reliefSocietyId)!.id;

    const { data: events, error: eventError } = await fixtures.service
      .from("activity_events")
      .insert([
        {
          ward_id: fixtures.wardAId,
          profile_id: eqProfileId,
          title: `EQ game ${fixtures.runId}`,
          event_type: "home",
          event_date: "2026-11-14T19:30:00-07:00",
          status: "upcoming",
        },
        {
          ward_id: fixtures.wardAId,
          profile_id: eqProfileId,
          // In the PAST, so GET /api/youth/logs' `includePast` half has something to find and its
          // default has something to leave out.
          title: `EQ past game ${fixtures.runId}`,
          event_type: "home",
          event_date: "2020-02-01T19:30:00-07:00",
          status: "upcoming",
        },
        {
          ward_id: fixtures.wardAId,
          profile_id: rsProfileId,
          title: `RS concert ${fixtures.runId}`,
          event_type: "home",
          event_date: "2026-11-15T19:30:00-07:00",
          status: "upcoming",
        },
      ])
      .select("id, title");
    if (eventError) throw new Error(eventError.message);

    eqEventId = events.find((row) => row.title.startsWith("EQ game"))!.id;
    eqPastEventId = events.find((row) => row.title.startsWith("EQ past"))!.id;
    rsEventId = events.find((row) => row.title.startsWith("RS concert"))!.id;

    // The author is down for the event, so `attended` has a row to write to.
    const { error: attendeeError } = await fixtures.service
      .from("activity_attendees")
      .insert({
        ward_id: fixtures.wardAId,
        event_id: eqEventId,
        user_id: fixtures.user("eqPresident").id,
        assigned_by: null,
      });
    if (attendeeError) throw new Error(attendeeError.message);
  }, 180_000);

  afterAll(async () => {
    await fixtures?.cleanup();
  });

  describe("POST", () => {
    it("records a follow-up and the author's attendance together", async () => {
      await actAs(fixtures, "eqPresident");

      const { status, body } = await createLog({
        eventId: eqEventId,
        sharedNotes: "They played well and the whole family came.",
        attended: true,
      });

      expect(status).toBe(201);

      const log = body.log as { id: string; loggedBy: string; sharedNotes: string };

      // The AUTHOR IS THE SESSION, never the body — the route does not read one and the INSERT
      // policy would refuse it anyway.
      expect(log.loggedBy).toBe(fixtures.user("eqPresident").id);
      expect(log.sharedNotes).toBe("They played well and the whole family came.");

      // Written only AFTER the log is known to have been written, mirroring how the visit PATCH
      // replaces participants.
      expect(await attendanceFor(eqEventId, fixtures.user("eqPresident").id)).toBe(true);
    });

    it("notifies the owning organization's leadership and carries no note text", async () => {
      const rows = await notificationsFor(SUBMITTED_TRIGGER);

      expect(rows.length).toBeGreaterThan(0);

      for (const row of rows) {
        // The activity and the event, and nothing the leader typed. These recipients CAN read the
        // follow-up; a notification body is still the wrong place for its contents.
        expect(row.body).toContain("EQ basketball");
        expect(row.body).not.toContain("They played well");
      }
    });

    // A SENTENCE NAMING THE ALTERNATIVE, not a 500 and not a second row. Migration 057a's
    // `unique (event_id, logged_by)` is what turns the second save into this.
    it("refuses a second follow-up with a 409 and offers the edit path", async () => {
      await actAs(fixtures, "eqPresident");

      const { status, body } = await createLog({
        eventId: eqEventId,
        sharedNotes: "A second attempt.",
      });

      expect(status).toBe(409);
      expect(errorMessage(body)).toContain("already recorded a follow-up");
      expect(errorMessage(body)).toContain("Open it");

      const { count, error } = await fixtures.service
        .from("activity_logs")
        .select("id", { count: "exact", head: true })
        .eq("event_id", eqEventId)
        .eq("logged_by", fixtures.user("eqPresident").id);

      if (error) throw new Error(error.message);
      expect(count).toBe(1);
    });

    // ---------------------------------------------------------------------
    // THE PARENT-SCOPE REFUSAL IS A SENTENCE, NOT A 500
    // ---------------------------------------------------------------------
    // `activity_events` keeps its ward-wide SELECT, so this event IS readable to an Elders Quorum
    // president — the refusal comes from migration 057c's INSERT policy, which is the visits-d
    // parent-scope rule in its second module. An INSERT is the one operation RLS refuses loudly
    // (42501), and a route that let that become a thrown error would answer a caller's mistake
    // with the server's own fault (CLAUDE.md rule 7).
    //
    // This suite's first run DID return 500 here, which is why the sentinel exists.
    it("answers 403 with a sentence for another organization's event", async () => {
      await actAs(fixtures, "eqPresident");

      const { status, body } = await createLog({
        eventId: rsEventId,
        sharedNotes: "Filed against somebody else's event.",
      });

      expect(status).toBe(403);
      expect(errorMessage(body)).toContain("belongs to another organization");

      const { count } = await fixtures.service
        .from("activity_logs")
        .select("id", { count: "exact", head: true })
        .eq("event_id", rsEventId)
        .eq("logged_by", fixtures.user("eqPresident").id);

      expect(count).toBe(0);
    });

    it("answers 404 for an event id that does not exist", async () => {
      await actAs(fixtures, "eqPresident");

      const { status, body } = await createLog({
        eventId: "00000000-0000-4000-8000-00000000dead",
        sharedNotes: "Nowhere.",
      });

      expect(status).toBe(404);
      expect(errorMessage(body)).toBe("That event is not in your ward.");
    });

    // `music_coordinator` holds NONE of the youth permissions — checked against
    // lib/auth/permissions.ts rather than assumed, because the matrix is not always the intuitive
    // answer (CLAUDE.md §8).
    it("refuses a role without youth_activities.log", async () => {
      await actAs(fixtures, "musicCoordinator");

      const { status } = await createLog({
        eventId: eqPastEventId,
        sharedNotes: "Not mine to write.",
      });

      expect(status).toBe(403);
    });

    // `attended` ABSENT MEANS THE ATTENDEE ROW IS LEFT ALONE. A default would make "the control
    // was never shown" and "they answered no" the same value, and the second is a fact somebody
    // stated.
    it("leaves the attendee row untouched when `attended` is absent", async () => {
      await actAs(fixtures, "eqSecretary");

      const { error: seedError } = await fixtures.service
        .from("activity_attendees")
        .insert({
          ward_id: fixtures.wardAId,
          event_id: eqPastEventId,
          user_id: fixtures.user("eqSecretary").id,
          assigned_by: null,
          confirmed_attendance: null,
        });
      if (seedError) throw new Error(seedError.message);

      const { status } = await createLog({
        eventId: eqPastEventId,
        sharedNotes: "Said nothing about whether I went.",
      });

      expect(status).toBe(201);
      expect(await attendanceFor(eqPastEventId, fixtures.user("eqSecretary").id)).toBeNull();
    });

    // Decision 5: being a recorded attendee is not required. The prompt is for attendees; the
    // WRITE is for anybody holding `youth_activities.log` on an event their organization owns.
    it("lets somebody with no attendee row file a follow-up anyway", async () => {
      await actAs(fixtures, "bishop");

      const { status, body } = await createLog({
        eventId: eqPastEventId,
        sharedNotes: "I turned up without putting myself down.",
      });

      expect(status).toBe(201);
      expect((body.log as { loggedBy: string }).loggedBy).toBe(fixtures.user("bishop").id);
    });
  });

  describe("GET", () => {
    it("returns only the caller's own follow-ups, keyed by event", async () => {
      await actAs(fixtures, "eqPresident");

      const { status, body } = await listOwnLogs(true);

      expect(status).toBe(200);

      const logs = body.logs as Record<string, { loggedBy: string }>;

      for (const log of Object.values(logs)) {
        expect(log.loggedBy).toBe(fixtures.user("eqPresident").id);
      }

      // The bishop's follow-up on the past event is readable to this caller through the feed —
      // same organization — and must NOT appear here, because this answers "what do I still owe".
      expect(logs[eqPastEventId]).toBeUndefined();
      expect(logs[eqEventId]?.loggedBy).toBe(fixtures.user("eqPresident").id);
    });

    it("leaves past events out of the default view", async () => {
      await actAs(fixtures, "bishop");

      const upcoming = await listOwnLogs(false);
      const everything = await listOwnLogs(true);

      expect((upcoming.body.logs as Record<string, unknown>)[eqPastEventId]).toBeUndefined();
      expect((everything.body.logs as Record<string, unknown>)[eqPastEventId]).toBeDefined();
    });
  });

  // ---------------------------------------------------------------------------
  // THE FLAG TRANSITION — ALL THREE ROWS OF THE TABLE
  // ---------------------------------------------------------------------------
  describe("PATCH — the ward-council flag", () => {
    let logId: string;

    beforeAll(async () => {
      const { data, error } = await fixtures.service
        .from("activity_logs")
        .select("id")
        .eq("event_id", eqEventId)
        .eq("logged_by", fixtures.user("eqPresident").id)
        .single();
      if (error) throw new Error(error.message);
      logId = data.id;
    });

    it("stamps flag_sent_at and notifies on the first raise", async () => {
      await actAs(fixtures, "eqPresident");

      const before = (await notificationsFor(FLAG_TRIGGER)).length;

      const { status } = await patchLog(logId, { flaggedForWardCouncil: true });
      expect(status).toBe(200);

      const row = await rowFor(logId);
      expect(row?.flagged_for_ward_council).toBe(true);
      expect(row?.flag_sent_at).not.toBeNull();

      const after = await notificationsFor(FLAG_TRIGGER);
      expect(after.length).toBe(before + 1);

      // The executive secretary and nobody else, and a one-liner carrying no note text.
      expect(after[after.length - 1]?.recipient_user_id).toBe(
        fixtures.user("executiveSecretary").id,
      );
      expect(after[after.length - 1]?.body).not.toContain("played well");
    });

    // RE-FLAGGING WITHOUT UNFLAGGING DOES NOT NOTIFY AGAIN.
    it("does not notify a second time while flag_sent_at is still stamped", async () => {
      await actAs(fixtures, "eqPresident");

      const before = (await notificationsFor(FLAG_TRIGGER)).length;

      const { status } = await patchLog(logId, { flaggedForWardCouncil: true });
      expect(status).toBe(200);

      expect((await notificationsFor(FLAG_TRIGGER)).length).toBe(before);
    });

    // CLEARING flag_sent_at ON UNFLAG IS WHAT LETS A GENUINE RE-RAISE NOTIFY AGAIN. Leaving it
    // stamped would make the second raise silent, and an agenda item nobody was told about is the
    // same as no agenda item.
    it("clears flag_sent_at on unflag, and the next raise notifies again", async () => {
      await actAs(fixtures, "eqPresident");

      const { status: unflagStatus } = await patchLog(logId, {
        flaggedForWardCouncil: false,
      });
      expect(unflagStatus).toBe(200);

      const cleared = await rowFor(logId);
      expect(cleared?.flagged_for_ward_council).toBe(false);
      expect(cleared?.flag_sent_at).toBeNull();

      const before = (await notificationsFor(FLAG_TRIGGER)).length;

      const { status } = await patchLog(logId, { flaggedForWardCouncil: true });
      expect(status).toBe(200);

      expect((await notificationsFor(FLAG_TRIGGER)).length).toBe(before + 1);
    });

    it("edits the shared note without touching the flag", async () => {
      await actAs(fixtures, "eqPresident");

      const { status } = await patchLog(logId, { sharedNotes: "Rewritten." });
      expect(status).toBe(200);

      const row = await rowFor(logId);
      expect(row?.shared_notes).toBe("Rewritten.");
      expect(row?.flagged_for_ward_council).toBe(true);
    });

    // ---------------------------------------------------------------------
    // `loggedBy` CANNOT BE NAMED BY A BODY — WHERE THAT GUARANTEE ACTUALLY LIVES
    // ---------------------------------------------------------------------
    // Migration 058's header argues why a policy cannot hold it on an UPDATE: WITH CHECK sees
    // only the row that would result, never the row that was. `visit_logs.recorded_by` is
    // protected the same way and by nothing else. This is the assertion that makes that safe.
    it("ignores a loggedBy field in the body and leaves the author alone", async () => {
      await actAs(fixtures, "bishop");

      const { status } = await patchLog(logId, {
        sharedNotes: "Bishop edited this.",
        loggedBy: fixtures.user("bishop").id,
      });

      expect(status).toBe(200);
      expect((await rowFor(logId))?.logged_by).toBe(fixtures.user("eqPresident").id);
    });

    it("refuses a body that changes nothing", async () => {
      await actAs(fixtures, "eqPresident");

      const { status } = await patchLog(logId, {});
      expect(status).toBe(400);
    });

    // 404 for a follow-up the caller cannot see, for the reason the POST gives — a 403 would
    // confirm it exists.
    it("answers 404 for a follow-up that is not in the caller's ward", async () => {
      await actAs(fixtures, "eqPresident");

      const { status, body } = await patchLog("00000000-0000-4000-8000-00000000dead", {
        sharedNotes: "Nowhere.",
      });

      expect(status).toBe(404);
      expect(errorMessage(body)).toBe("That follow-up is not in your ward.");
    });

    it("refuses a role without youth_activities.log", async () => {
      await actAs(fixtures, "musicCoordinator");

      const { status } = await patchLog(logId, { sharedNotes: "Not mine." });
      expect(status).toBe(403);
    });
  });
});
