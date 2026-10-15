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
