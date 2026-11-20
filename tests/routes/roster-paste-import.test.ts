// @vitest-environment node
//
// POST /api/roster/import/preview and POST /api/roster/import, with JSON paste bodies.
//
// Only the server client factory is mocked (tests/helpers/routeClient.ts); every query runs
// against the hosted project as the signed-in fixture, so RLS is in force. A refused write is
// asserted by RE-READING rows with the service client.

import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { actAs, errorMessage, jsonRequest, readResponse } from "@/tests/helpers/routeClient";
import { seedFixtures, type Fixtures } from "@/tests/helpers/seed";
import {
  LCR_HEADERS,
  buildPaste,
  toLcrRow,
  type SyntheticPerson,
} from "@/tests/fixtures/roster/lcr-paste-synthetic";

vi.mock("@/lib/supabase/server", async () => {
  const { serverClientMock } = await import("@/tests/helpers/routeClient");
  return serverClientMock();
});

const PREVIEW_URL = "http://localhost/api/roster/import/preview";
const APPLY_URL = "http://localhost/api/roster/import";

const PEOPLE: SyntheticPerson[] = [
  {
    preferredName: "Routetest, Ann",
    fullName: "Routetest, Ann",
    birthDate: "13 Jun 1986",
    household: "Routetest, Ann",
  },
  {
    preferredName: "Routetest, Bo",
    fullName: "Routetest, Bo",
    birthDate: "2 Jan 1984",
    household: "Routetest, Bo",
  },
];

const PASTE = buildPaste(PEOPLE.map(toLcrRow));

type PreviewBody = {
  pasteHash: string;
  review: { newPeople: { id: string; name: string }[] };
};

async function preview(text: string) {
  const { POST } = await import("@/app/api/roster/import/preview/route");
  return readResponse(await POST(jsonRequest(PREVIEW_URL, { body: { text } })));
}

async function applyPaste(body: unknown) {
  const { POST } = await import("@/app/api/roster/import/route");
  return readResponse(await POST(jsonRequest(APPLY_URL, { body })));
}

describe("roster paste import routes", () => {
  let fixtures: Fixtures;

  async function countMembers(): Promise<number> {
    const { count, error } = await fixtures.service
      .from("members")
      .select("id", { count: "exact", head: true })
      .eq("ward_id", fixtures.wardAId);
    if (error) throw new Error(error.message);
    return count ?? 0;
  }

  beforeAll(async () => {
    fixtures = await seedFixtures(["bishop", "wardSecretary"]);
  });

  afterAll(async () => {
    await fixtures?.cleanup();
  });

  it("previews a paste for the bishop and writes nothing", async () => {
    await actAs(fixtures, "bishop");
    const before = await countMembers();

    const { status, body } = await preview(PASTE);

    expect(status).toBe(200);
    const previewBody = body as unknown as PreviewBody;
    expect(previewBody.pasteHash).toMatch(/^[0-9a-f]{64}$/);
    expect(previewBody.review.newPeople.map((item) => item.name)).toEqual([
      "Ann Routetest",
      "Bo Routetest",
    ]);
    expect(await countMembers()).toBe(before);
  });

  // The ward secretary holds roster.view but not roster.import (WARD_SECRETARY_PERMISSIONS in
  // lib/auth/permissions.ts), so the refusal is the permission and not anything earlier.
  it("refuses a ward secretary with a 403", async () => {
    await actAs(fixtures, "wardSecretary");

    const { status } = await preview(PASTE);

    expect(status).toBe(403);
  });

  it("names a missing required column in a 400", async () => {
    await actAs(fixtures, "bishop");
    const withoutBirthDate = LCR_HEADERS.filter((header) => !header.startsWith("Birth"));
    const text = `${withoutBirthDate.join("\t")}\nRoutetest, Ann\tRoutetest, Ann\n`;

    const { status, body } = await preview(text);

    expect(status).toBe(400);
    expect(errorMessage(body)).toContain('"Birth Date"');
  });

  it("refuses an apply whose paste changed after review, and writes nothing", async () => {
    await actAs(fixtures, "bishop");
    const reviewed = (await preview(PASTE)).body as unknown as PreviewBody;
    const before = await countMembers();

    const { status, body } = await applyPaste({
      text: `${PASTE}Extra, Row\tExtra, Row`,
      pasteHash: reviewed.pasteHash,
      selectedIds: reviewed.review.newPeople.map((item) => item.id),
    });

    expect(status).toBe(400);
    expect(errorMessage(body)).toContain("changed since you reviewed it");
    expect(await countMembers()).toBe(before);
  });

  it("applies only the selected ids, and counts an unknown one as stale", async () => {
    await actAs(fixtures, "bishop");
    const reviewed = (await preview(PASTE)).body as unknown as PreviewBody;
    const ann = reviewed.review.newPeople.find((item) => item.name === "Ann Routetest");
    if (!ann) throw new Error("Ann was not offered");

    const { status, body } = await applyPaste({
      text: PASTE,
      pasteHash: reviewed.pasteHash,
      selectedIds: [ann.id, "member:00000000-0000-4000-8000-000000000000"],
    });

    expect(status).toBe(200);
    expect(body.result).toMatchObject({ membersCreated: 1, staleSelections: 1 });

    const { data, error } = await fixtures.service
      .from("members")
      .select("first_name")
      .eq("ward_id", fixtures.wardAId)
      .like("last_name", "Routetest");
    if (error) throw new Error(error.message);
    expect(data.map((row) => row.first_name)).toEqual(["Ann"]);
  });
});

// ITER-058 cr3. The tests run in order and share one roster; each names the state it inherits. The
// paste swaps the two counselors and leaves the ward clerk off. Every calling is asserted by
// RE-READING `ward_role_assignments` with the service client.
describe("calling changes on a roster paste", () => {
  type CallingRow = {
    id: string;
    sentence: string;
    isRelease: boolean;
    canApply: boolean;
    moveOutId: string | null;
  };
  type CallingPreview = {
    pasteHash: string;
    review: { callingChanges: { rows: CallingRow[]; reviewedByBishopric: boolean } };
  };

  const HOUSEHOLD = "Swaptest, Home";
  const person = (first: string, birthDate: string, callings: string): SyntheticPerson => ({
    preferredName: `Swaptest, ${first}`,
    fullName: `Swaptest, ${first}`,
    birthDate,
    household: HOUSEHOLD,
    callings,
  });

  const SWAP_PASTE = buildPaste(
    [
      person("Mark", "1 Mar 1970", "Bishop"),
      person("Cal", "2 Apr 1975", "Bishopric Second Counselor"),
      person("Dee", "3 May 1978", "Bishopric First Counselor"),
    ].map(toLcrRow),
  );

  let fixtures: Fixtures;
  let clerkMemberId: string;

  async function callingOf(handle: "counselor1" | "counselor2" | "wardSecretary") {
    const { data, error } = await fixtures.service
      .from("ward_role_assignments")
      .select("counselor_position, is_active, source")
      .eq("user_id", fixtures.user(handle).id)
      .eq("ward_id", fixtures.wardAId)
      .single();
    if (error) throw new Error(error.message);
    return data;
  }

  async function storedCallings(firstName: string) {
    const { data, error } = await fixtures.service
      .from("members")
      .select("callings, status")
      .eq("ward_id", fixtures.wardAId)
      .eq("first_name", firstName)
      .eq("last_name", "Swaptest")
      .single();
    if (error) throw new Error(error.message);
    return data;
  }

  async function reviewed() {
    const { status, body } = await preview(SWAP_PASTE);
    expect(status).toBe(200);
    return body as unknown as CallingPreview;
  }

  beforeAll(async () => {
    fixtures = await seedFixtures([
      "bishop",
      "counselor1",
      "counselor2",
      "wardSecretary",
      "executiveSecretary",
    ]);

    const { data: household, error: householdError } = await fixtures.service
      .from("households")
      .insert({ ward_id: fixtures.wardAId, family_name: HOUSEHOLD })
      .select("id")
      .single();
    if (householdError) throw new Error(householdError.message);

    const people = [
      { handle: "bishop", first: "Mark", birth: "1970-03-01", callings: "Bishop" },
      { handle: "counselor1", first: "Cal", birth: "1975-04-02", callings: "Bishopric First Counselor" },
      { handle: "counselor2", first: "Dee", birth: "1978-05-03", callings: "Bishopric Second Counselor" },
      { handle: "wardSecretary", first: "Rae", birth: "1980-06-04", callings: "Ward Clerk" },
    ] as const;

    for (const entry of people) {
      const { data: member, error: memberError } = await fixtures.service
        .from("members")
        .insert({
          ward_id: fixtures.wardAId,
          household_id: household.id,
          first_name: entry.first,
          last_name: "Swaptest",
          preferred_name: `Swaptest, ${entry.first}`,
          full_name: `Swaptest, ${entry.first}`,
          birth_date: entry.birth,
          callings: entry.callings,
        })
        .select("id")
        .single();
      if (memberError) throw new Error(memberError.message);
      if (entry.handle === "wardSecretary") clerkMemberId = member.id;

      const { error: linkError } = await fixtures.service.from("user_member_links").insert({
        user_id: fixtures.user(entry.handle).id,
        ward_id: fixtures.wardAId,
        member_id: member.id,
        status: "active",
        method: "admin",
        linked_by: fixtures.user("bishop").id,
        decided_by: fixtures.user("bishop").id,
        decided_at: new Date().toISOString(),
      });
      if (linkError) throw new Error(linkError.message);
    }

    // An importer who is not the bishopric: every check before the calling gate passes for them.
    const { error: settingsError } = await fixtures.service
      .from("wards")
      .update({
        settings: { role_access: { executive_secretary: { add: ["roster.import"] } } },
      })
      .eq("id", fixtures.wardAId);
    if (settingsError) throw new Error(settingsError.message);
  }, 180_000);

  afterAll(async () => {
    await fixtures?.cleanup();
  });

  it("offers the swap and the release, and changes nothing by previewing", async () => {
    await actAs(fixtures, "bishop");

    const { rows } = (await reviewed()).review.callingChanges;

    expect(rows.filter((row) => !row.isRelease)).toHaveLength(2);
    const release = rows.find((row) => row.isRelease);
    expect(release?.moveOutId).toBe(`moveout:${clerkMemberId}`);
    expect((await callingOf("counselor1")).counselor_position).toBe(1);
    expect((await storedCallings("Cal")).callings).toBe("Bishopric First Counselor");
  });

  it("stores the pasted callings text and moves no calling when nothing is ticked", async () => {
    await actAs(fixtures, "bishop");
    const { pasteHash } = await reviewed();

    const { status, body } = await applyPaste({ text: SWAP_PASTE, pasteHash, selectedIds: [] });

    expect(status).toBe(200);
    expect(body.result).toMatchObject({ callingsApplied: 0, callingsStale: 0, callingsFailed: false });
    expect((await storedCallings("Cal")).callings).toBe("Bishopric Second Counselor");
    expect(await callingOf("counselor1")).toMatchObject({ counselor_position: 1, source: "manual" });
    expect(await callingOf("counselor2")).toMatchObject({ counselor_position: 2, source: "manual" });
  });

  it("shows an importer outside the bishopric no calling rows, and refuses their calling ids", async () => {
    await actAs(fixtures, "bishop");
    const swapIds = (await reviewed()).review.callingChanges.rows
      .filter((row) => !row.isRelease)
      .map((row) => row.id);

    await actAs(fixtures, "executiveSecretary");
    const { pasteHash, review } = await reviewed();
    expect(review.callingChanges).toEqual({ rows: [], reviewedByBishopric: true });

    const { status } = await applyPaste({ text: SWAP_PASTE, pasteHash, selectedIds: swapIds });

    expect(status).toBe(403);
    expect((await callingOf("counselor1")).counselor_position).toBe(1);
  });

  it("counts a release as out of date while its person is still listed", async () => {
    await actAs(fixtures, "bishop");
    const { pasteHash, review } = await reviewed();
    const release = review.callingChanges.rows.find((row) => row.isRelease);
    if (!release) throw new Error("The release was not offered");

    const { body } = await applyPaste({
      text: SWAP_PASTE,
      pasteHash,
      selectedIds: [release.id],
    });

    expect(body.result).toMatchObject({ callingsApplied: 0, callingsStale: 1 });
    expect((await callingOf("wardSecretary")).is_active).toBe(true);
  });

  it("swaps both counselors once they are ticked", async () => {
    await actAs(fixtures, "bishop");
    const { pasteHash, review } = await reviewed();
    const swapIds = review.callingChanges.rows.filter((row) => !row.isRelease).map((row) => row.id);

    const { status, body } = await applyPaste({ text: SWAP_PASTE, pasteHash, selectedIds: swapIds });

    expect(status).toBe(200);
    expect(body.result).toMatchObject({ callingsApplied: 2, staleSelections: 0, callingsStale: 0 });
    expect(await callingOf("counselor1")).toMatchObject({ counselor_position: 2, source: "roster" });
    expect(await callingOf("counselor2")).toMatchObject({ counselor_position: 1, source: "roster" });
  });

  it("releases somebody the paste leaves off when the move-out is ticked with it", async () => {
    await actAs(fixtures, "bishop");
    const { pasteHash, review } = await reviewed();
    const release = review.callingChanges.rows.find((row) => row.isRelease);
    if (!release?.moveOutId) throw new Error("The release was not tied to its move-out");

    const { body } = await applyPaste({
      text: SWAP_PASTE,
      pasteHash,
      selectedIds: [release.moveOutId, release.id],
    });

    expect(body.result).toMatchObject({ membersMovedOut: 1, callingsApplied: 1, callingsStale: 0 });
    expect((await storedCallings("Rae")).status).toBe("moved_out");
    expect((await callingOf("wardSecretary")).is_active).toBe(false);
  });
});
