// @vitest-environment node
//
// POST /api/youth/calendars/import/preview and POST /api/youth/calendars/import.
//
// ---------------------------------------------------------------------------
// WHAT THIS SUITE EXISTS FOR, AND WHY EACH ASSERTION IS SHAPED THE WAY IT IS
// ---------------------------------------------------------------------------
// 1. THE PREVIEW WRITES NOTHING. Asserted by RE-READING activity_events and activity_calendars
//    with the service client afterwards, not by trusting the response. A preview that quietly
//    created its calendar row would return an identical body.
//
// 2. THE SECOND IMPORT OF THE SAME FILE CREATES NOTHING. Asserted by COUNTING ROWS, for the same
//    reason: `created: 0` in the response and zero rows in the table are different claims, and
//    only one of them is the guarantee.
//
// 3. `org_secretary` GETS A 403. Checked against lib/auth/permissions.ts first — that role holds
//    `youth_activities.view` and `.log` and NOT `.manage`, which CLAUDE.md §8 warns is not always
//    the intuitive answer.
//
// Only @/lib/supabase/server is mocked. Every query still runs against the hosted project as a
// genuinely authenticated user, so a passing test here proves RLS allowed the query — see
// tests/helpers/routeClient.ts, whose header documents the vi.mock hoisting trap.

import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { actAs, errorMessage, readResponse } from "@/tests/helpers/routeClient";
import { seedFixtures, type Fixtures } from "@/tests/helpers/seed";

vi.mock("@/lib/supabase/server", async () => {
  const { serverClientMock } = await import("@/tests/helpers/routeClient");
  return serverClientMock();
});

const PREVIEW_URL = "http://localhost/api/youth/calendars/import/preview";
const IMPORT_URL = "http://localhost/api/youth/calendars/import";

// Far enough out that the suite does not start failing on a particular Tuesday, and inside the
// twelve-month recurrence horizon so an RRULE in a fixture expands rather than being cut.
function nextYear(month: number, day: number): string {
  const year = new Date().getUTCFullYear() + 1;
  return `${year}${String(month).padStart(2, "0")}${String(day).padStart(2, "0")}`;
}

function icsFile(events: string[]): string {
  return [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//Lincoln High//Athletics//EN",
    ...events,
    "END:VCALENDAR",
  ].join("\r\n");
}

function vevent(uid: string, summary: string, dtstart: string): string {
  return [
    "BEGIN:VEVENT",
    `UID:${uid}`,
    `SUMMARY:${summary}`,
    `DTSTART:${dtstart}`,
    "LOCATION:Lincoln High",
    "END:VEVENT",
  ].join("\r\n");
}

// A multipart Request built by hand, because the routes read `request.formData()` and the helper
// in routeClient.ts only speaks JSON.
function formRequest(
  url: string,
  fields: { text: string; fileName?: string; type?: string; profileId?: string; fileHash?: string },
): Request {
  const body = new FormData();
  body.set(
    "file",
    new File([fields.text], fields.fileName ?? "schedule.ics", {
      type: fields.type ?? "text/calendar",
    }),
  );
  if (fields.profileId !== undefined) body.set("profileId", fields.profileId);
  if (fields.fileHash !== undefined) body.set("fileHash", fields.fileHash);

  return new Request(url, { method: "POST", body });
}

type PreviewBody = {
  calendarExists: boolean;
  fileHash: string;
  toCreate: { uid: string; title: string; localTime: string; allDay: boolean }[];
  toUpdate: { existingId: string; changedFields: string[] }[];
  unchanged: number;
  notInFile: { uid: string }[];
  problems: { summary: string | null; message: string }[];
};

type ResultBody = {
  calendarId: string;
  created: number;
  updated: number;
  unchanged: number;
  notInFile: unknown[];
  lastSyncedAt: string;
};

describe("/api/youth/calendars/import", () => {
  let fixtures: Fixtures;
  let wardId: string;

  let profileId: string;
  let wardBProfileId: string;

  const SEASON = () =>
    icsFile([
      vevent("g1@lincoln", "Game against Roosevelt", `${nextYear(1, 15)}T023000Z`),
      vevent("g2@lincoln", "Game against Jefferson", `${nextYear(1, 22)}T023000Z`),
      vevent("g3@lincoln", "Game against Madison", `${nextYear(1, 29)}T023000Z`),
    ]);

  async function callPreview(request: Request) {
    const { POST } = await import("@/app/api/youth/calendars/import/preview/route");
    return readResponse(await POST(request));
  }

  async function callImport(request: Request) {
    const { POST } = await import("@/app/api/youth/calendars/import/route");
    return readResponse(await POST(request));
  }

  // GROUND TRUTH. The service client bypasses RLS, so this is what a refusal and a silent write
  // are both measured against.
  const countEvents = async (): Promise<number> => {
    const { count, error } = await fixtures.service
      .from("activity_events")
      .select("id", { count: "exact", head: true })
      .eq("ward_id", wardId);

    if (error) throw new Error(error.message);
    return count ?? 0;
  };

  const calendarRows = async () => {
    const { data, error } = await fixtures.service
      .from("activity_calendars")
      .select("id, profile_id, source_type, source_url, last_synced_at")
      .eq("ward_id", wardId);

    if (error) throw new Error(error.message);
    return data ?? [];
  };

  const storedEvents = async () => {
    const { data, error } = await fixtures.service
      .from("activity_events")
      .select("id, title, event_date, status, event_type, all_day, source_uid, source_recurrence_id, calendar_id")
      .eq("ward_id", wardId)
      .order("event_date");

    if (error) throw new Error(error.message);
    return data ?? [];
  };

  const countAuditRows = async (): Promise<number> => {
    const { count, error } = await fixtures.service
      .from("audit_log")
      .select("id", { count: "exact", head: true })
      .eq("ward_id", wardId)
      .eq("action", "youth_calendar_imported");

    if (error) throw new Error(error.message);
    return count ?? 0;
  };

  const countNotifications = async (): Promise<number> => {
    const { count, error } = await fixtures.service
      .from("notifications")
      .select("id", { count: "exact", head: true })
      .eq("ward_id", wardId);

    if (error) throw new Error(error.message);
    return count ?? 0;
  };

  beforeAll(async () => {
    fixtures = await seedFixtures(["bishop", "eqPresident", "eqSecretary", "wardBBishop"]);
    wardId = fixtures.wardAId;

    const { data: members, error: memberError } = await fixtures.service
      .from("members")
      .insert([
        {
          ward_id: wardId,
          first_name: "Ethan",
          last_name: `Brooks${fixtures.runId}`,
          category: "youth",
          status: "active",
        },
        {
          ward_id: fixtures.wardBId,
          first_name: "Bo",
          last_name: `YouthB${fixtures.runId}`,
          category: "youth",
          status: "active",
        },
      ])
      .select("id, ward_id");
    if (memberError) throw new Error(memberError.message);

    const { data: profiles, error: profileError } = await fixtures.service
      .from("youth_activity_profiles")
      .insert([
        {
          ward_id: wardId,
          org_id: fixtures.eldersQuorumId,
          member_id: members!.find((row) => row.ward_id === wardId)!.id,
          activity_name: `Varsity Basketball ${fixtures.runId}`,
          activity_type: "sport",
        },
        {
          ward_id: fixtures.wardBId,
          org_id: fixtures.wardBOrgId,
          member_id: members!.find((row) => row.ward_id === fixtures.wardBId)!.id,
          activity_name: `Ward B track ${fixtures.runId}`,
          activity_type: "sport",
        },
      ])
      .select("id, ward_id");
    if (profileError) throw new Error(profileError.message);

    profileId = profiles!.find((row) => row.ward_id === wardId)!.id;
    wardBProfileId = profiles!.find((row) => row.ward_id === fixtures.wardBId)!.id;
  }, 180_000);

  afterAll(async () => {
    await fixtures?.cleanup();
  });

  // ---------------------------------------------------------------------------
  // The preview, and the guarantee that gives it its name
  // ---------------------------------------------------------------------------
  describe("preview", () => {
    it("describes the file and writes absolutely nothing", async () => {
      await actAs(fixtures, "eqPresident");

      const eventsBefore = await countEvents();
      const calendarsBefore = await calendarRows();

      const { status, body } = await callPreview(
        formRequest(PREVIEW_URL, { text: SEASON(), profileId }),
      );

      const preview = body.preview as PreviewBody;

      expect(status).toBe(200);
      expect(preview.calendarExists).toBe(false);
      expect(preview.toCreate).toHaveLength(3);
      expect(preview.toUpdate).toEqual([]);
      expect(preview.unchanged).toBe(0);
      expect(preview.notInFile).toEqual([]);
      expect(preview.fileHash).toMatch(/^[0-9a-f]{64}$/);

      // THE HOUR, ALREADY FORMATTED. A count alone would not tell a leader anything about
      // whether the import is right.
      expect(preview.toCreate[0].localTime).toMatch(/\d/);

      // The half that matters. A preview that created its calendar row would look identical
      // above.
      expect(await countEvents()).toBe(eventsBefore);
      expect(await calendarRows()).toHaveLength(calendarsBefore.length);
    });

    it("refuses a profile in another ward with a sentence, not a constraint violation", async () => {
      await actAs(fixtures, "eqPresident");

      const { status, body } = await callPreview(
        formRequest(PREVIEW_URL, { text: SEASON(), profileId: wardBProfileId }),
      );

      expect(status).toBe(404);
      expect(errorMessage(body)).toContain("not in your ward");
    });

    it("refuses a file of prose with a sentence naming the likely cause", async () => {
      await actAs(fixtures, "eqPresident");

      const { status, body } = await callPreview(
        formRequest(PREVIEW_URL, {
          text: "Dear parents, the basketball season begins in January. Kick-off is at 7:30pm.",
          fileName: "letter.ics",
          type: "text/plain",
          profileId,
        }),
      );

      // A 400 with a sentence, never a 500 blaming the server for somebody's bad upload.
      expect(status).toBe(400);
      expect(errorMessage(body)).not.toBe("");
    });

    it("refuses a calendar with no events at all", async () => {
      await actAs(fixtures, "eqPresident");

      const { status, body } = await callPreview(
        formRequest(PREVIEW_URL, { text: icsFile([]), profileId }),
      );

      expect(status).toBe(400);
      expect(errorMessage(body)).toContain("no events");
    });

    it("refuses a file that is not a .ics before reading a byte of it", async () => {
      await actAs(fixtures, "eqPresident");

      const { status, body } = await callPreview(
        formRequest(PREVIEW_URL, { text: SEASON(), fileName: "schedule.csv", profileId }),
      );

      expect(status).toBe(400);
      expect(errorMessage(body)).toContain(".ics");
    });

    it("refuses a file over the size limit with a 413", async () => {
      await actAs(fixtures, "eqPresident");

      // Padded past 1MB with a comment property, so the refusal is about SIZE rather than about
      // the file being unreadable.
      const padding = `\r\nCOMMENT:${"x".repeat(1024 * 1024)}`;
      const { status, body } = await callPreview(
        formRequest(PREVIEW_URL, { text: SEASON() + padding, profileId }),
      );

      expect(status).toBe(413);
      expect(errorMessage(body)).toContain("larger than");
    });

    it("refuses a request with no profileId", async () => {
      await actAs(fixtures, "eqPresident");

      const { status, body } = await callPreview(formRequest(PREVIEW_URL, { text: SEASON() }));

      expect(status).toBe(400);
      expect(errorMessage(body)).toContain("activity");
    });

    // org_secretary holds `.view` and `.log` and NOT `.manage` — checked in
    // lib/auth/permissions.ts, which CLAUDE.md §8 warns is not always the intuitive answer.
    it("refuses an org secretary, who may read the schedule but not write to it", async () => {
      await actAs(fixtures, "eqSecretary");

      const { status } = await callPreview(
        formRequest(PREVIEW_URL, { text: SEASON(), profileId }),
      );

      expect(status).toBe(403);
    });
  });

  // ---------------------------------------------------------------------------
  // The confirm
  // ---------------------------------------------------------------------------
  describe("confirm", () => {
    it("refuses without a fileHash", async () => {
      await actAs(fixtures, "eqPresident");

      const { status, body } = await callImport(
        formRequest(IMPORT_URL, { text: SEASON(), profileId }),
      );

      expect(status).toBe(400);
      expect(errorMessage(body)).toContain("Preview the file");
      expect(await countEvents()).toBe(0);
    });

    it("refuses a file that changed since the preview", async () => {
      await actAs(fixtures, "eqPresident");

      const { body: previewBody } = await callPreview(
        formRequest(PREVIEW_URL, { text: SEASON(), profileId }),
      );
      const fileHash = (previewBody.preview as PreviewBody).fileHash;

      // ACTUALLY EDITED, not merely claimed to be. Trusting the route to compare two hashes it
      // computed itself would prove nothing about the hash covering the events.
      const edited = icsFile([
        vevent("g1@lincoln", "Game against Roosevelt", `${nextYear(1, 15)}T023000Z`),
        vevent("g9@lincoln", "A game nobody previewed", `${nextYear(2, 5)}T023000Z`),
      ]);

      const { status, body } = await callImport(
        formRequest(IMPORT_URL, { text: edited, profileId, fileHash }),
      );

      expect(status).toBe(400);
      expect(errorMessage(body)).toContain("changed since you previewed it");
      expect(await countEvents()).toBe(0);
    });

    it("refuses an org secretary", async () => {
      await actAs(fixtures, "eqSecretary");

      const { status } = await callImport(
        formRequest(IMPORT_URL, { text: SEASON(), profileId, fileHash: "a".repeat(64) }),
      );

      expect(status).toBe(403);
      expect(await countEvents()).toBe(0);
    });

    it("creates the calendar and the events, and writes one audit row and no notification", async () => {
      await actAs(fixtures, "eqPresident");

      const notificationsBefore = await countNotifications();

      const { body: previewBody } = await callPreview(
        formRequest(PREVIEW_URL, { text: SEASON(), profileId }),
      );
      const fileHash = (previewBody.preview as PreviewBody).fileHash;

      const { status, body } = await callImport(
        formRequest(IMPORT_URL, { text: SEASON(), profileId, fileHash }),
      );

      const result = body.result as ResultBody;

      expect(status).toBe(201);
      expect(result.created).toBe(3);
      expect(result.updated).toBe(0);
      expect(result.unchanged).toBe(0);
      expect(result.notInFile).toEqual([]);

      const calendars = await calendarRows();
      expect(calendars).toHaveLength(1);
      expect(calendars[0].profile_id).toBe(profileId);
      expect(calendars[0].source_type).toBe("ics_upload");
      // No server-side URL fetch in this slice; the column stays null to say nothing has.
      expect(calendars[0].source_url).toBeNull();
      expect(calendars[0].last_synced_at).not.toBeNull();

      const events = await storedEvents();
      expect(events).toHaveLength(3);
      for (const event of events) {
        expect(event.calendar_id).toBe(calendars[0].id);
        expect(event.source_uid).not.toBeNull();
        expect(event.source_recurrence_id).toBeNull();
        expect(event.status).toBe("upcoming");
        // Classification is slice C's job; the import must not guess it.
        expect(event.event_type).toBe("tbd");
        expect(event.all_day).toBe(false);
      }

      expect(await countAuditRows()).toBe(1);
      // Decision 7: an import has more events than a season has, so nothing is emitted.
      expect(await countNotifications()).toBe(notificationsBefore);
    });

    // Asserted by COUNTING ROWS. `created: 0` in the response and zero new rows in the table are
    // different claims, and only the second one is the guarantee.
    it("creates nothing on a second import of the identical file", async () => {
      await actAs(fixtures, "eqPresident");

      const before = await countEvents();
      const calendarsBefore = await calendarRows();
      const syncedBefore = calendarsBefore[0].last_synced_at;

      const { body: previewBody } = await callPreview(
        formRequest(PREVIEW_URL, { text: SEASON(), profileId }),
      );
      const preview = previewBody.preview as PreviewBody;

      expect(preview.calendarExists).toBe(true);
      expect(preview.toCreate).toEqual([]);
      expect(preview.unchanged).toBe(3);

      const { status, body } = await callImport(
        formRequest(IMPORT_URL, { text: SEASON(), profileId, fileHash: preview.fileHash }),
      );

      const result = body.result as ResultBody;

      expect(status).toBe(201);
      expect(result.created).toBe(0);
      expect(result.updated).toBe(0);
      expect(result.unchanged).toBe(3);

      expect(await countEvents()).toBe(before);

      const calendarsAfter = await calendarRows();
      // A SECOND CALENDAR ROW WAS NOT CREATED — Decision 5 is what makes "re-import" mean
      // something rather than becoming a third feed.
      expect(calendarsAfter).toHaveLength(1);
      expect(calendarsAfter[0].id).toBe(calendarsBefore[0].id);
      expect(
        new Date(calendarsAfter[0].last_synced_at!).getTime(),
      ).toBeGreaterThanOrEqual(new Date(syncedBefore!).getTime());

      expect(await countAuditRows()).toBe(2);
    });

    it("updates a moved game in place and leaves hand-made changes alone", async () => {
      await actAs(fixtures, "eqPresident");

      const before = await storedEvents();
      const jefferson = before.find((event) => event.source_uid === "g2@lincoln")!;
      const madison = before.find((event) => event.source_uid === "g3@lincoln")!;

      // What a leader did by hand, and what a re-import must never undo.
      const { error: cancelError } = await fixtures.service
        .from("activity_events")
        .update({ status: "cancelled", event_type: "away" })
        .eq("id", madison.id);
      if (cancelError) throw new Error(cancelError.message);

      const march = icsFile([
        vevent("g1@lincoln", "Game against Roosevelt", `${nextYear(1, 15)}T023000Z`),
        // Moved a week later.
        vevent("g2@lincoln", "Game against Jefferson", `${nextYear(2, 5)}T023000Z`),
        vevent("g3@lincoln", "Game against Madison", `${nextYear(1, 29)}T023000Z`),
        vevent("g4@lincoln", "Game against Lincoln", `${nextYear(2, 12)}T023000Z`),
      ]);

      const { body: previewBody } = await callPreview(
        formRequest(PREVIEW_URL, { text: march, profileId }),
      );
      const preview = previewBody.preview as PreviewBody;

      expect(preview.toCreate).toHaveLength(1);
      expect(preview.toUpdate).toHaveLength(1);
      expect(preview.toUpdate[0].existingId).toBe(jefferson.id);
      expect(preview.toUpdate[0].changedFields).toEqual(["date and time"]);

      const { status, body } = await callImport(
        formRequest(IMPORT_URL, { text: march, profileId, fileHash: preview.fileHash }),
      );

      const result = body.result as ResultBody;

      expect(status).toBe(201);
      expect(result.created).toBe(1);
      expect(result.updated).toBe(1);

      const after = await storedEvents();
      const movedGame = after.find((event) => event.source_uid === "g2@lincoln")!;
      const cancelledGame = after.find((event) => event.source_uid === "g3@lincoln")!;

      // THE SAME ROW, MOVED. A different id would mean it was replaced, which loses everything
      // hanging off it.
      expect(movedGame.id).toBe(jefferson.id);
      expect(new Date(movedGame.event_date).toISOString()).toBe(
        new Date(`${nextYear(2, 5).replace(/(\d{4})(\d{2})(\d{2})/, "$1-$2-$3")}T02:30:00Z`)
          .toISOString(),
      );

      // Decision 6, and the two assertions this whole slice's trust depends on.
      expect(cancelledGame.status).toBe("cancelled");
      expect(cancelledGame.event_type).toBe("away");
    });

    it("leaves an event absent from the file exactly as it was", async () => {
      await actAs(fixtures, "eqPresident");

      const before = await storedEvents();
      const beforeCount = before.length;
      const roosevelt = before.find((event) => event.source_uid === "g1@lincoln")!;

      // The same file with Roosevelt removed, and nothing else changed.
      const shortened = icsFile([
        vevent("g2@lincoln", "Game against Jefferson", `${nextYear(2, 5)}T023000Z`),
        vevent("g3@lincoln", "Game against Madison", `${nextYear(1, 29)}T023000Z`),
        vevent("g4@lincoln", "Game against Lincoln", `${nextYear(2, 12)}T023000Z`),
      ]);

      const { body: previewBody } = await callPreview(
        formRequest(PREVIEW_URL, { text: shortened, profileId }),
      );
      const preview = previewBody.preview as PreviewBody;

      // Roosevelt is outside the shortened file's window (it is the earliest game), so it is
      // correctly NOT listed — the window is the file's own span. What matters is what happens
      // to the row, asserted below.
      const { status } = await callImport(
        formRequest(IMPORT_URL, { text: shortened, profileId, fileHash: preview.fileHash }),
      );

      expect(status).toBe(201);

      const after = await storedEvents();
      const survivor = after.find((event) => event.id === roosevelt.id);

      // NO DELETE AND NO STATUS CHANGE, EVER. A feed that briefly publishes a short file must
      // not be able to cancel a season.
      expect(after).toHaveLength(beforeCount);
      expect(survivor).toBeDefined();
      expect(survivor!.status).toBe("upcoming");
      expect(survivor!.event_date).toBe(roosevelt.event_date);
    });
  });

  describe("recurring and all-day entries reach the database intact", () => {
    it("writes one row per occurrence with a shared uid and distinct recurrence ids", async () => {
      await actAs(fixtures, "eqPresident");

      const withSeries = icsFile([
        [
          "BEGIN:VEVENT",
          "UID:practice@lincoln",
          "SUMMARY:Practice",
          `DTSTART:${nextYear(3, 2)}T230000Z`,
          "RRULE:FREQ=WEEKLY;COUNT=4",
          "END:VEVENT",
        ].join("\r\n"),
        [
          "BEGIN:VEVENT",
          "UID:tourney@lincoln",
          "SUMMARY:District tournament",
          `DTSTART;VALUE=DATE:${nextYear(3, 20)}`,
          "END:VEVENT",
        ].join("\r\n"),
      ]);

      const { body: previewBody } = await callPreview(
        formRequest(PREVIEW_URL, { text: withSeries, profileId }),
      );
      const preview = previewBody.preview as PreviewBody;

      expect(preview.toCreate).toHaveLength(5);
      expect(preview.toCreate.filter((event) => event.allDay)).toHaveLength(1);

      const { status } = await callImport(
        formRequest(IMPORT_URL, { text: withSeries, profileId, fileHash: preview.fileHash }),
      );
      expect(status).toBe(201);

      const events = await storedEvents();
      const practices = events.filter((event) => event.source_uid === "practice@lincoln");
      const tournament = events.find((event) => event.source_uid === "tourney@lincoln")!;

      // Four rows, one uid, four distinct recurrence ids. This is what proves the unique index
      // cannot collapse a series into one row.
      expect(practices).toHaveLength(4);
      expect(new Set(practices.map((event) => event.source_recurrence_id)).size).toBe(4);

      expect(tournament.all_day).toBe(true);
      expect(tournament.source_recurrence_id).toBeNull();
    });
  });
});
