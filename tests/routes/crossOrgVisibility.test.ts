// @vitest-environment node
//
// GET and PATCH /api/ward-settings/cross-org-visibility, and what the setting actually does to
// the feed.
//
// ---------------------------------------------------------------------------
// THE ASSERTION THIS SUITE EXISTS FOR
// ---------------------------------------------------------------------------
// THE MERGE. `wards.settings` is one jsonb column holding role_access, timezone,
// default_speaking_slots and this boolean. A wholesale write here would silently delete the
// ward's permission overrides — a switch about visibility quietly changing who may do what. The
// bug is invisible without a ward that already HAS an override, which is why one is seeded.
//
// And the shared bishopric authority (CLAUDE.md §7): a counselor can do everything the bishop can.
// Never build a check that grants the bishop something a counselor lacks.
//
// See tests/helpers/routeClient.ts for why this needs no server and what exactly is mocked — only
// the client factory, so every query below still runs as a genuinely authenticated user against
// the hosted project and a pass means RLS allowed it.

import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { asRole } from "@/tests/helpers/asRole";
import { actAs, jsonRequest, readResponse } from "@/tests/helpers/routeClient";
import { seedFixtures, setCrossOrgVisibility, type Fixtures } from "@/tests/helpers/seed";

vi.mock("@/lib/supabase/server", async () => {
  const { serverClientMock } = await import("@/tests/helpers/routeClient");
  return serverClientMock();
});

const SETTINGS_URL = "http://localhost/api/ward-settings/cross-org-visibility";
const FEED_URL = "http://localhost/api/visits/feed";

const EQ_SHARED = "EQ shared: brought a meal round.";
const RS_SHARED = "RS shared: sister is recovering well.";
const EQ_PRIVATE = "EQ private: a confidence the family asked us to keep.";
const RS_PRIVATE = "RS private: a confidence the family asked us to keep.";

// A non-default override, seeded before the toggle is ever touched. `music_coordinator` gaining
// visits.view is a change nothing else in this suite would notice going missing — which is
// exactly why it is the right canary.
const ROLE_ACCESS_OVERRIDE = {
  music_coordinator: { add: ["visits.view"] },
};

const DEFAULT_SPEAKING_SLOTS_OVERRIDE = 5;

async function getSettings() {
  const { GET } = await import("@/app/api/ward-settings/cross-org-visibility/route");
  return readResponse(await GET());
}

async function patchSettings(body: unknown) {
  const { PATCH } = await import("@/app/api/ward-settings/cross-org-visibility/route");
  return readResponse(await PATCH(jsonRequest(SETTINGS_URL, { method: "PATCH", body })));
}

async function getFeed(contextId?: string) {
  const { GET } = await import("@/app/api/visits/feed/route");
  const url = contextId === undefined ? FEED_URL : `${FEED_URL}?context=${contextId}`;
  return readResponse(await GET(jsonRequest(url)));
}

type FeedContext = { id: string; label: string; tone: string };

type FeedTile = {
  reportId: string;
  contextId: string | null;
  contextLabel: string;
  contextTone: string;
  previewText: string | null;
};

describe("/api/ward-settings/cross-org-visibility", () => {
  let fixtures: Fixtures;
  let wardId: string;
  let eqLogId: string;
  let rsLogId: string;

  const readSettings = async (): Promise<Record<string, unknown>> => {
    const { data, error } = await fixtures.service
      .from("wards")
      .select("settings")
      .eq("id", wardId)
      .single();

    if (error) throw new Error(error.message);
    return (data.settings ?? {}) as Record<string, unknown>;
  };

  // Keyed by id so a test can diff "before this call" against "after it" — see the notification
  // test below for why counting is not enough.
  const notificationIds = async (): Promise<
    Map<string, { recipientUserId: string; title: string | null }>
  > => {
    const { data, error } = await fixtures.service
      .from("notifications")
      .select("id, recipient_user_id, title")
      .eq("ward_id", wardId);

    if (error) throw new Error(error.message);

    return new Map(
      (data ?? []).map((row) => [
        row.id,
        { recipientUserId: row.recipient_user_id, title: row.title },
      ]),
    );
  };

  const countNotifications = async (): Promise<number> => {
    const { count, error } = await fixtures.service
      .from("notifications")
      .select("id", { count: "exact", head: true })
      .eq("ward_id", wardId);

    if (error) throw new Error(error.message);
    return count ?? 0;
  };

  const countAuditRows = async (): Promise<number> => {
    const { count, error } = await fixtures.service
      .from("audit_log")
      .select("id", { count: "exact", head: true })
      .eq("ward_id", wardId)
      .eq("action", "cross_org_visibility_updated");

    if (error) throw new Error(error.message);
    return count ?? 0;
  };

  beforeAll(async () => {
    fixtures = await seedFixtures(
      ["bishop", "counselor1", "counselor2", "eqPresident", "rsPresident"],
      {
        crossOrgVisibility: false,
        roleAccess: ROLE_ACCESS_OVERRIDE,
        // Without a seeded trigger row emitNotification() warns and sends nothing, and the
        // notification assertions below would pass for the wrong reason.
        notificationTriggers: [
          { triggerKey: "admin_setting_changed", defaultRoles: ["bishop", "counselor"] },
        ],
      },
    );
    wardId = fixtures.wardAId;

    // The second half of the merge canary. A number, not a boolean, so a wholesale write that
    // happened to preserve booleans would still be caught.
    const existing = await readSettings();
    const { error: settingsError } = await fixtures.service
      .from("wards")
      .update({
        settings: {
          ...existing,
          default_speaking_slots: DEFAULT_SPEAKING_SLOTS_OVERRIDE,
        },
      })
      .eq("id", wardId);
    if (settingsError) throw new Error(settingsError.message);

    const { data: logs, error: logError } = await fixtures.service
      .from("visit_logs")
      .insert([
        {
          ward_id: wardId,
          org_id: fixtures.eldersQuorumId,
          recorded_by: fixtures.user("eqPresident").id,
          visit_date: "2026-04-05",
          visit_type: "in_home",
          shared_notes: EQ_SHARED,
        },
        {
          ward_id: wardId,
          org_id: fixtures.reliefSocietyId,
          recorded_by: fixtures.user("rsPresident").id,
          visit_date: "2026-04-12",
          visit_type: "in_home",
          shared_notes: RS_SHARED,
        },
      ])
      .select("id, org_id");
    if (logError) throw new Error(logError.message);

    eqLogId = logs.find((row) => row.org_id === fixtures.eldersQuorumId)!.id;
    rsLogId = logs.find((row) => row.org_id === fixtures.reliefSocietyId)!.id;

    // Each president writes their OWN private note through their OWN authenticated client, so the
    // INSERT policy is exercised too rather than only SELECT.
    const eq = await asRole(fixtures, "eqPresident");
    const rs = await asRole(fixtures, "rsPresident");

    const { error: eqNoteError } = await eq.from("visit_private_notes").insert({
      ward_id: wardId,
      visit_log_id: eqLogId,
      user_id: fixtures.user("eqPresident").id,
      notes: EQ_PRIVATE,
    });
    if (eqNoteError) throw new Error(eqNoteError.message);

    const { error: rsNoteError } = await rs.from("visit_private_notes").insert({
      ward_id: wardId,
      visit_log_id: rsLogId,
      user_id: fixtures.user("rsPresident").id,
      notes: RS_PRIVATE,
    });
    if (rsNoteError) throw new Error(rsNoteError.message);
  }, 60_000);

  afterAll(async () => {
    await fixtures?.cleanup();
  });

  beforeEach(async () => {
    await setCrossOrgVisibility(fixtures, false);
  });

  describe("permissions", () => {
    it("lets the bishop turn it on", async () => {
      await actAs(fixtures, "bishop");

      const { status, body } = await patchSettings({ crossOrgVisibility: true });

      expect(status).toBe(200);
      expect(body.crossOrgVisibility).toBe(true);
    });

    // SHARED BISHOPRIC AUTHORITY. Identical rights, not similar ones.
    it("lets a counselor turn it on, exactly as the bishop can", async () => {
      await actAs(fixtures, "counselor1");

      const { status, body } = await patchSettings({ crossOrgVisibility: true });

      expect(status).toBe(200);
      expect(body.crossOrgVisibility).toBe(true);
    });

    it("refuses an org president", async () => {
      await actAs(fixtures, "eqPresident");

      const { status } = await patchSettings({ crossOrgVisibility: true });

      expect(status).toBe(403);
      expect(await readSettings()).toMatchObject({ cross_org_visibility: false });
    });

    // visits.view, not admin: every leader who reads the feed needs to know which mode they are
    // in, and "why can I see the Relief Society's visits?" should be answered by the page.
    it("lets an org president READ the setting", async () => {
      await actAs(fixtures, "eqPresident");

      const { status, body } = await getSettings();

      expect(status).toBe(200);
      expect(body.crossOrgVisibility).toBe(false);
    });

    it("refuses a body that is not a boolean", async () => {
      await actAs(fixtures, "bishop");

      const { status } = await patchSettings({ crossOrgVisibility: "true" });

      expect(status).toBe(400);
    });
  });

  describe("writing the setting", () => {
    // THE MERGE ASSERTION. This is the test that catches the wholesale-write bug.
    it("leaves the ward's other settings untouched", async () => {
      await actAs(fixtures, "bishop");

      const before = await readSettings();
      expect(before.role_access).toEqual(ROLE_ACCESS_OVERRIDE);

      await patchSettings({ crossOrgVisibility: true });

      const after = await readSettings();

      expect(after.cross_org_visibility).toBe(true);
      expect(after.role_access).toEqual(ROLE_ACCESS_OVERRIDE);
      expect(after.default_speaking_slots).toBe(DEFAULT_SPEAKING_SLOTS_OVERRIDE);
      expect(after.timezone).toBe(before.timezone);
    });

    // A JSON boolean, not the string "true". Both satisfy migration 019's
    // `(settings ->> 'cross_org_visibility') = 'true'`, but only one of them is the type the
    // column is documented to hold.
    it("stores a JSON boolean", async () => {
      await actAs(fixtures, "bishop");

      await patchSettings({ crossOrgVisibility: true });

      expect(typeof (await readSettings()).cross_org_visibility).toBe("boolean");
    });

    it("writes an audit row carrying the before and after values", async () => {
      await actAs(fixtures, "bishop");

      const before = await countAuditRows();
      await patchSettings({ crossOrgVisibility: true });

      expect(await countAuditRows()).toBe(before + 1);

      const { data, error } = await fixtures.service
        .from("audit_log")
        .select("detail, user_id")
        .eq("ward_id", wardId)
        .eq("action", "cross_org_visibility_updated")
        .order("created_at", { ascending: false })
        .limit(1)
        .single();

      expect(error).toBeNull();
      expect(data?.user_id).toBe(fixtures.user("bishop").id);
      expect(data?.detail).toMatchObject({
        crossOrgVisibility: true,
        previousCrossOrgVisibility: false,
      });
    });

    // Scoped to the rows THIS call produced. Earlier tests in this file toggle the same setting
    // as a counselor, so a query over every row with this title includes notifications the bishop
    // legitimately received a moment ago — and the assertion would fail for the wrong reason.
    it("notifies the other two bishopric members and not the acting user", async () => {
      await actAs(fixtures, "bishop");

      const before = await notificationIds();
      await patchSettings({ crossOrgVisibility: true });
      const after = await notificationIds();

      const created = [...after].filter(([id]) => !before.has(id));

      expect(created).toHaveLength(2);

      const recipients = created.map(([, row]) => row.recipientUserId);
      expect(recipients).toContain(fixtures.user("counselor1").id);
      expect(recipients).toContain(fixtures.user("counselor2").id);
      expect(recipients).not.toContain(fixtures.user("bishop").id);

      for (const [, row] of created) {
        expect(row.title).toBe("Visit report visibility changed");
      }
    });

    // The calendar route guards on before !== after and so must this. Re-saving the switch at the
    // value it already holds is not news, and a notification for it would teach the other two to
    // ignore the ones that matter.
    it("writes no notification when the value did not change", async () => {
      await actAs(fixtures, "bishop");

      const before = await countNotifications();
      const { status } = await patchSettings({ crossOrgVisibility: false });

      expect(status).toBe(200);
      expect(await countNotifications()).toBe(before);
    });

    // The audit row IS still written on a no-op. Somebody pressed the control, and "who touched
    // this setting" is the question the audit trail answers.
    it("still writes an audit row when the value did not change", async () => {
      await actAs(fixtures, "bishop");

      const before = await countAuditRows();
      await patchSettings({ crossOrgVisibility: false });

      expect(await countAuditRows()).toBe(before + 1);
    });
  });

  // ---------------------------------------------------------------------------
  // What the setting actually does, end to end
  // ---------------------------------------------------------------------------
  // Through the FEED ROUTE, not through a direct table read: this is what proves the route adds
  // no org filter of its own and lets the policy decide. And private notes stay absent in BOTH
  // modes — cross-org visibility is a setting about an organization's shared work, and a private
  // note was never the organization's (CLAUDE.md rule 5).
  describe("the feed it governs", () => {
    const tilesFrom = (body: Record<string, unknown>): FeedTile[] =>
      body.tiles as FeedTile[];

    it("excludes another organization's reports when it is off", async () => {
      await actAs(fixtures, "eqPresident");

      const { status, body } = await getFeed();
      const ids = tilesFrom(body).map((tile) => tile.reportId);

      expect(status).toBe(200);
      expect(ids).toContain(eqLogId);
      expect(ids).not.toContain(rsLogId);
    });

    it("includes another organization's reports when it is on", async () => {
      await actAs(fixtures, "bishop");
      await patchSettings({ crossOrgVisibility: true });

      await actAs(fixtures, "eqPresident");
      const { body } = await getFeed();
      const ids = tilesFrom(body).map((tile) => tile.reportId);

      expect(ids).toContain(eqLogId);
      expect(ids).toContain(rsLogId);
    });

    it("names the other organization on the tile rather than leaving it blank", async () => {
      await actAs(fixtures, "bishop");
      await patchSettings({ crossOrgVisibility: true });

      await actAs(fixtures, "eqPresident");
      const { body } = await getFeed();

      const rsTile = tilesFrom(body).find((tile) => tile.reportId === rsLogId);
      expect(rsTile?.contextLabel).toBe("Relief Society");
      expect(rsTile?.previewText).toBe(RS_SHARED);
    });

    // Asserted on the SERIALIZED body, so a future widening is caught even if the types were
    // changed to allow it — the same reason tests/routes/visits.test.ts reads the JSON.
    it.each([
      ["off", false],
      ["on", true],
    ])("carries no private note text with visibility %s", async (_label, enabled) => {
      await actAs(fixtures, "bishop");
      await patchSettings({ crossOrgVisibility: enabled });

      await actAs(fixtures, "eqPresident");
      const { body } = await getFeed();
      const serialized = JSON.stringify(body);

      expect(serialized).not.toContain(EQ_PRIVATE);
      expect(serialized).not.toContain(RS_PRIVATE);
      // The author's OWN private note is not in the feed either. A tile is a shared-notes surface,
      // and a private note appearing on one would be a leak into an export, a screenshot and a
      // shoulder-surf all at once.
      expect(serialized).not.toContain("private");
    });

    it("counts unread over everything the caller can see", async () => {
      await actAs(fixtures, "bishop");
      await patchSettings({ crossOrgVisibility: true });

      await actAs(fixtures, "eqPresident");
      const { body } = await getFeed();

      expect(body.unreadCount).toBe(tilesFrom(body).length);
    });
  });

  // ---------------------------------------------------------------------------
  // The reader's organization filter
  // ---------------------------------------------------------------------------
  // A query parameter the handler does not read gets no error — just a filter that is silently
  // ignored (plans/retros/roster-b-picker-and-orgs.md). These prove `?context=` reaches the query
  // rather than being dropped, which from the browser would look exactly like a working control.
  //
  // It is a DISPLAY PREFERENCE, never a permission: RLS has already decided which reports exist,
  // so naming an organization the caller cannot read returns an empty page rather than a 403.
  describe("filtering the feed by organization", () => {
    const tilesFrom = (body: Record<string, unknown>): FeedTile[] => body.tiles as FeedTile[];

    beforeEach(async () => {
      await actAs(fixtures, "bishop");
      await patchSettings({ crossOrgVisibility: true });
      await actAs(fixtures, "eqPresident");
    });

    it("narrows the tiles to the named organization", async () => {
      const { status, body } = await getFeed(fixtures.reliefSocietyId);
      const tiles = tilesFrom(body);

      expect(status).toBe(200);
      expect(tiles).toHaveLength(1);
      expect(tiles[0]?.reportId).toBe(rsLogId);
      expect(tiles[0]?.contextLabel).toBe("Relief Society");
    });

    // The badge has to describe what is on screen. Unfiltered it reads 2; filtered to one
    // organization it must read 1, not 2 over a single tile.
    it("counts unread under the filter, not over the whole feed", async () => {
      const all = await getFeed();
      const filtered = await getFeed(fixtures.eldersQuorumId);

      expect(all.body.unreadCount).toBe(2);
      expect(filtered.body.unreadCount).toBe(1);
      expect(tilesFrom(filtered.body)).toHaveLength(1);
    });

    // The dropdown's options must not change as the reader uses it, or the filter becomes one you
    // cannot undo — and it must not offer an organization that has never logged a visit, which
    // would answer with an empty feed.
    it("offers exactly the organizations that have reports, whichever filter is applied", async () => {
      const all = (await getFeed()).body.contexts as FeedContext[];
      const filtered = (await getFeed(fixtures.eldersQuorumId)).body.contexts as FeedContext[];

      expect(all.map((context) => context.label)).toEqual([
        "Elders Quorum",
        "Relief Society",
      ]);
      expect(filtered).toEqual(all);
    });

    // With visibility off an Elders Quorum leader reads only their own reports, so there is only
    // one context and ReportFeed hides the filter entirely — a control with one option cannot do
    // anything.
    it("offers only the caller's own organization when visibility is off", async () => {
      await actAs(fixtures, "bishop");
      await patchSettings({ crossOrgVisibility: false });

      await actAs(fixtures, "eqPresident");
      const contexts = (await getFeed()).body.contexts as FeedContext[];

      expect(contexts.map((context) => context.label)).toEqual(["Elders Quorum"]);
    });

    it("gives each organization a tone the tile can render", async () => {
      const { body } = await getFeed();
      const byLabel = new Map(tilesFrom(body).map((tile) => [tile.contextLabel, tile]));

      expect(byLabel.get("Elders Quorum")?.contextTone).toBe("blue");
      expect(byLabel.get("Relief Society")?.contextTone).toBe("violet");
      expect(byLabel.get("Elders Quorum")?.contextId).toBe(fixtures.eldersQuorumId);
    });

    // Not a 403. The policy already returns nothing for another ward's organization, so the
    // honest answer is an empty feed rather than a refusal that confirms the id exists.
    it("returns an empty page for an organization the caller cannot read", async () => {
      const { status, body } = await getFeed(fixtures.wardBOrgId);

      expect(status).toBe(200);
      expect(tilesFrom(body)).toHaveLength(0);
      expect(body.unreadCount).toBe(0);
    });

    it("refuses a context that is not a uuid", async () => {
      const { status } = await getFeed("not-an-organization");

      expect(status).toBe(400);
    });
  });
});
