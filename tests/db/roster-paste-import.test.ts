// @vitest-environment node
//
// The roster paste import against the hosted database. The transaction and the ward check live in
// apply_roster_paste (migration 090), so a mocked client would prove nothing about them.
//
// Everything runs through a BISHOP client, so RLS applies exactly as in the app. The tests run in
// order and share one roster; each names the state it inherits.

import type { SupabaseClient } from "@supabase/supabase-js";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { applyRosterPaste } from "@/lib/roster/paste/applyRosterPaste";
import { defaultSelectedIds, toReviewView } from "@/lib/roster/paste/buildRosterDiff";
import { runPastePipeline } from "@/lib/roster/paste/pasteRequest";
import { asRole } from "@/tests/helpers/asRole";
import { seedFixtures, type Fixtures } from "@/tests/helpers/seed";
import {
  buildPaste,
  toLcrRow,
  type SyntheticPerson,
} from "@/tests/fixtures/roster/lcr-paste-synthetic";
import type { Database } from "@/types/database";

const AS_OF = "2026-10-14";

const ANN: SyntheticPerson = {
  preferredName: "Pastetest, Ann",
  fullName: "Pastetest, Ann Marie",
  phone: "555-0101",
  email: "ann@example.com",
  address: "1 Test Lane",
  birthDate: "13 Jun 1986",
  gender: "F",
  household: "Pastetest, Bo & Ann",
  callings: "Primary Teacher\nWard Activities Committee Member",
};

const BO: SyntheticPerson = {
  preferredName: "Pastetest, Bo",
  fullName: "Pastetest, Bo James",
  phone: "555-0102",
  address: "1 Test Lane",
  birthDate: "2 Jan 1984",
  gender: "M",
  household: "Pastetest, Bo & Ann",
};

const CY: SyntheticPerson = {
  preferredName: "Pastetest, Cy",
  fullName: "Pastetest, Cy",
  address: "22 Fake Street",
  birthDate: "30 Sep 2010",
  gender: "M",
  household: "Pastetest, Dee",
};

const FIRST_PASTE = buildPaste([ANN, BO, CY].map(toLcrRow));

describe("apply_roster_paste", () => {
  let fixtures: Fixtures;
  let bishop: SupabaseClient<Database>;

  let legacyBoId: string;
  let movedOutCyId: string;
  let doNotContactId: string;

  async function countMembers(wardId: string): Promise<number> {
    const { count, error } = await fixtures.service
      .from("members")
      .select("id", { count: "exact", head: true })
      .eq("ward_id", wardId);
    if (error) throw new Error(error.message);
    return count ?? 0;
  }

  async function readMember(id: string) {
    const { data, error } = await fixtures.service
      .from("members")
      .select("*")
      .eq("id", id)
      .single();
    if (error) throw new Error(error.message);
    return data;
  }

  async function paste(text: string) {
    return runPastePipeline(text, fixtures.wardAId, bishop, AS_OF);
  }

  async function apply(text: string, selectedIds: readonly string[]) {
    const pipeline = await paste(text);
    return applyRosterPaste(
      {
        wardId: fixtures.wardAId,
        userId: fixtures.user("bishop").id,
        diff: pipeline.diff,
        selectedIds: new Set(selectedIds),
        rowsRead: pipeline.rowsRead,
        problemCount: pipeline.problems.length,
      },
      bishop,
    );
  }

  async function insertMember(row: Database["public"]["Tables"]["members"]["Insert"]) {
    const { data, error } = await fixtures.service.from("members").insert(row).select("id").single();
    if (error) throw new Error(error.message);
    return data.id;
  }

  beforeAll(async () => {
    fixtures = await seedFixtures(["bishop", "wardBBishop"], {
      notificationTriggers: [
        { triggerKey: "new_household_added", defaultRoles: ["bishop", "counselor"] },
      ],
    });
    bishop = await asRole(fixtures, "bishop");

    const { data: household, error } = await fixtures.service
      .from("households")
      .insert({ ward_id: fixtures.wardAId, family_name: "Pastetest" })
      .select("id")
      .single();
    if (error) throw new Error(error.message);

    // A legacy member: created before any paste, so no full name. Matches Bo on first + last.
    legacyBoId = await insertMember({
      ward_id: fixtures.wardAId,
      household_id: household.id,
      first_name: "Bo",
      last_name: "Pastetest",
      phone: "555-9999",
    });
    // Moved out, and back in the paste: must match and return, never be created twice.
    movedOutCyId = await insertMember({
      ward_id: fixtures.wardAId,
      household_id: household.id,
      first_name: "Cy",
      last_name: "Pastetest",
      status: "moved_out",
    });
    // Not in the paste: offered as no longer listed, unticked.
    doNotContactId = await insertMember({
      ward_id: fixtures.wardAId,
      household_id: household.id,
      first_name: "Dee",
      last_name: "Gonetest",
      status: "do_not_contact",
    });

    await insertMember({
      ward_id: fixtures.wardBId,
      first_name: "Ward",
      last_name: "Bee",
    });
  });

  afterAll(async () => {
    await fixtures?.cleanup();
  });

  it("builds the first checklist: one new person, two matched, one no longer listed", async () => {
    const { diff, problems } = await paste(FIRST_PASTE);
    const review = toReviewView(diff);

    expect(problems).toEqual([]);
    expect(review.newPeople.map((item) => item.name)).toEqual(["Ann Pastetest"]);
    expect(diff.changedPeople.map((item) => item.memberId).sort()).toEqual(
      [legacyBoId, movedOutCyId].sort(),
    );
    expect(diff.changedPeople.find((item) => item.memberId === movedOutCyId)?.returning).toBe(true);
    expect(review.movedOut.map((item) => item.id)).toEqual([`moveout:${doNotContactId}`]);
  });

  it("applies the default ticks and creates the households the paste names", async () => {
    const before = await countMembers(fixtures.wardAId);
    const { diff } = await paste(FIRST_PASTE);

    const result = await apply(FIRST_PASTE, defaultSelectedIds(toReviewView(diff)));

    expect(result).toMatchObject({
      householdsCreated: 2,
      membersCreated: 1,
      membersChanged: 2,
      membersReturned: 1,
      membersMovedOut: 0,
      staleSelections: 0,
    });
    expect(await countMembers(fixtures.wardAId)).toBe(before + 1);

    const bo = await readMember(legacyBoId);
    expect(bo).toMatchObject({
      full_name: "Pastetest, Bo James",
      birth_date: "1984-01-02",
      phone: "555-0102",
      status: "active",
    });
    expect((await readMember(movedOutCyId)).status).toBe("active");
    expect((await readMember(movedOutCyId)).category).toBe("youth");
    expect((await readMember(doNotContactId)).status).toBe("do_not_contact");
  });

  it("stores a multi-line callings cell with its line break", async () => {
    const { data, error } = await fixtures.service
      .from("members")
      .select("callings")
      .eq("ward_id", fixtures.wardAId)
      .eq("full_name", "Pastetest, Ann Marie")
      .single();
    if (error) throw new Error(error.message);

    expect(data.callings).toBe("Primary Teacher\nWard Activities Committee Member");
  });

  it("shows nothing to change when the same paste comes again", async () => {
    const { diff } = await paste(FIRST_PASTE);

    expect(diff.newPeople).toEqual([]);
    expect(diff.changedPeople).toEqual([]);
    expect(diff.householdAddresses).toEqual([]);
    expect(diff.silentUpdates).toEqual([]);
    expect(diff.movedOut.map((item) => item.memberId)).toEqual([doNotContactId]);
    expect(diff.unchangedCount).toBe(3);
  });

  it("applies only the ticked items and leaves the unticked ones alone", async () => {
    const edited = buildPaste(
      [{ ...ANN, phone: "555-7777" }, { ...BO, email: "bo@example.com" }, CY].map(toLcrRow),
    );
    const { diff } = await paste(edited);
    const ann = diff.changedPeople.find((item) => item.name === "Ann Pastetest");
    if (!ann) throw new Error("Ann's change was not offered");

    await apply(edited, [ann.id]);

    const { data, error } = await fixtures.service
      .from("members")
      .select("phone")
      .eq("id", ann.memberId)
      .single();
    if (error) throw new Error(error.message);
    expect(data.phone).toBe("555-7777");
    expect((await readMember(legacyBoId)).email).toBeNull();
  });

  it("marks a ticked no-longer-listed member moved out, and deletes nobody", async () => {
    const before = await countMembers(fixtures.wardAId);

    const result = await apply(FIRST_PASTE, [`moveout:${doNotContactId}`]);

    expect(result.membersMovedOut).toBe(1);
    expect((await readMember(doNotContactId)).status).toBe("moved_out");
    expect(await countMembers(fixtures.wardAId)).toBe(before);
  });

  it("refuses another ward's id and writes nothing there", async () => {
    const before = await countMembers(fixtures.wardBId);

    const { error } = await bishop.rpc("apply_roster_paste", {
      p_ward_id: fixtures.wardBId,
      p_plan: {
        households: [{ key: "household:trespass", family_name: "Trespass", address: null }],
        creates: [{ household_key: "household:trespass", first_name: "Not", last_name: "Allowed" }],
        move_outs: [],
      },
    });

    expect(error?.code).toBe("42501");
    expect(await countMembers(fixtures.wardBId)).toBe(before);
    const { count } = await fixtures.service
      .from("households")
      .select("id", { count: "exact", head: true })
      .eq("ward_id", fixtures.wardBId);
    expect(count).toBe(0);
  });

  it("writes one audit row per apply, with counts and no names", async () => {
    const { data, error } = await fixtures.service
      .from("audit_log")
      .select("detail")
      .eq("ward_id", fixtures.wardAId)
      .eq("action", "roster_imported");
    if (error) throw new Error(error.message);

    expect(data).toHaveLength(3);
    for (const row of data) {
      const detail = JSON.stringify(row.detail);
      expect(detail).not.toContain("Pastetest");
      expect(detail).toContain("membersCreated");
    }
  });

  it("sends one new-household notification for the paste that created households", async () => {
    const { data, error } = await fixtures.service
      .from("notifications")
      .select("title, body, recipient_user_id")
      .eq("ward_id", fixtures.wardAId)
      .eq("trigger_key", "new_household_added");
    if (error) throw new Error(error.message);

    expect(data).toHaveLength(1);
    expect(data[0].title).toBe("2 new households added");
    expect(data[0].recipient_user_id).toBe(fixtures.user("bishop").id);
  });
});
