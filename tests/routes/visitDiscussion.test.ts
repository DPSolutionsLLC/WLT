// @vitest-environment node
//
// "Discuss in bishopric meeting" (ITER-055 bv7, P15, P-B, migration 108b).
//
// What is held here, against the hosted project:
//   - only the bishopric may ask (visits.assign AND a bishopric calling);
//   - no agenda is ever created: with no upcoming draft the visit waits, and the next BISHOPRIC
//     agenda created gathers its one line — a ward council agenda never does;
//   - the line names the family and carries none of the report;
//   - the executive secretary, who reads no Bishopric visit, still gets the line when building
//     the agenda (the gatherer runs on the service role);
//   - asking while a draft exists puts the line on it at once; withdrawing takes it off;
//   - publishing stamps the visit discussed and does NOT touch a ward-council flag on the same
//     visit — the reason the line has its own `visit_discussion` source;
//   - the next agenda does not repeat it.
//
// The PDF render and the storage upload are mocked in the publish step: they are not what is under
// test, and the database client is NOT mocked, so every read and write still runs as a real user.

import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { actAs, jsonRequest, readResponse } from "@/tests/helpers/routeClient";
import { seedFixtures, type Fixtures } from "@/tests/helpers/seed";
import type { AgendaSections } from "@/lib/agendas/sections";

vi.mock("@/lib/supabase/server", async () => {
  const { serverClientMock } = await import("@/tests/helpers/routeClient");
  return serverClientMock();
});

vi.mock("@/lib/pdf/renderAgenda", () => ({
  renderAgendaPdf: async () => Buffer.from("%PDF-test"),
}));

vi.mock("@/lib/agendas/storage", () => ({
  storeAgendaPdf: async () => ({ signedUrl: "https://example.test/agenda.pdf", byteLength: 9 }),
}));

const SHARED_REPORT = "Brother Ellis is out of work and asked us to keep it quiet.";

function futureDate(days: number): string {
  return new Date(Date.now() + days * 86_400_000).toISOString().slice(0, 10);
}

async function setDiscussion(visitId: string, discuss: boolean) {
  const { POST } = await import("@/app/api/visits/[id]/discussion/route");
  const url = `http://localhost/api/visits/${visitId}/discussion`;
  return readResponse(
    await POST(jsonRequest(url, { method: "POST", body: { discuss } }), {
      params: Promise.resolve({ id: visitId }),
    }),
  );
}

type CreatedAgenda = { agenda: { id: string; sections: AgendaSections } };

async function createAgenda(body: unknown) {
  const { POST } = await import("@/app/api/agendas/route");
  const { status, body: payload } = await readResponse(
    await POST(jsonRequest("http://localhost/api/agendas", { method: "POST", body })),
  );
  return { status, body: payload as CreatedAgenda };
}

async function publishAgenda(id: string) {
  const { POST } = await import("@/app/api/agendas/[id]/publish/route");
  return readResponse(
    await POST(jsonRequest(`http://localhost/api/agendas/${id}/publish`, { method: "POST" }), {
      params: Promise.resolve({ id }),
    }),
  );
}

// A bishopric agenda with NO flagged-items heading, so the ward-council flag on the same visit is
// never gathered onto it: publishing must not stamp that flag by itself.
const SECTIONS_WITHOUT_FLAGS = () => [
  { id: crypto.randomUUID(), title: "Opening and prayer", items: [], carryForward: false },
  { id: crypto.randomUUID(), title: "Action items", items: [], carryForward: true },
];

function discussionLines(sections: AgendaSections) {
  return sections
    .flatMap((section) => section.items.map((item) => ({ ...item, section: section.title })))
    .filter((item) => item.source === "visit_discussion");
}

describe("POST /api/visits/[id]/discussion and the bishopric agenda", () => {
  let fixtures: Fixtures;
  let visitId: string;
  let familyName: string;

  const readVisit = async () => {
    const { data, error } = await fixtures.service
      .from("visit_logs")
      .select("discuss_in_bishopric, bishopric_discussed_at, flag_sent_at")
      .eq("id", visitId)
      .single();
    if (error) throw new Error(error.message);
    return data;
  };

  const readAgendaSections = async (id: string): Promise<AgendaSections> => {
    const { data, error } = await fixtures.service
      .from("agendas")
      .select("sections")
      .eq("id", id)
      .single();
    if (error) throw new Error(error.message);
    return data.sections as unknown as AgendaSections;
  };

  beforeAll(async () => {
    fixtures = await seedFixtures(["bishop", "counselor1", "executiveSecretary", "eqPresident"]);
    familyName = `Ellis ${fixtures.runId}`;

    const { data: household, error: householdError } = await fixtures.service
      .from("households")
      .insert({ ward_id: fixtures.wardAId, family_name: familyName })
      .select("id")
      .single();
    if (householdError) throw new Error(householdError.message);

    // Flagged for the ward council with the flag still unsent, so a publish that wrongly treated the
    // discussion line as a flag would visibly stamp it.
    const { data: visit, error: visitError } = await fixtures.service
      .from("visit_logs")
      .insert({
        ward_id: fixtures.wardAId,
        org_id: null,
        household_id: household.id,
        recorded_by: fixtures.user("bishop").id,
        visit_date: "2026-11-01",
        visit_type: "in_home",
        shared_notes: SHARED_REPORT,
        flagged_for_ward_council: true,
        flag_sent_at: null,
      })
      .select("id")
      .single();
    if (visitError) throw new Error(visitError.message);
    visitId = visit.id;
  }, 90_000);

  afterAll(async () => {
    await fixtures?.cleanup();
  });

  it("refuses somebody outside the bishopric", async () => {
    await actAs(fixtures, "eqPresident");
    const { status } = await setDiscussion(visitId, true);
    expect(status).toBe(403);
    expect((await readVisit()).discuss_in_bishopric).toBe(false);
  });

  it("with no draft bishopric agenda, the request waits and no agenda is created", async () => {
    await actAs(fixtures, "bishop");
    const { status, body } = await setDiscussion(visitId, true);

    expect(status).toBe(200);
    expect(body.placedOn).toBeNull();
    expect((await readVisit()).discuss_in_bishopric).toBe(true);

    const { data: agendas } = await fixtures.service
      .from("agendas")
      .select("id")
      .eq("ward_id", fixtures.wardAId);
    expect(agendas ?? []).toHaveLength(0);
  });

  it("a ward council agenda never carries the line", async () => {
    await actAs(fixtures, "bishop");
    const { status, body } = await createAgenda({
      meetingType: "ward_council",
      meetingDate: futureDate(5),
    });
    expect(status).toBe(201);
    expect(discussionLines(body.agenda.sections)).toHaveLength(0);
  });

  let firstAgendaId: string;

  it("the next bishopric agenda — built by the executive secretary — gathers one line, and no report", async () => {
    await actAs(fixtures, "executiveSecretary");
    const { status, body } = await createAgenda({
      meetingType: "bishopric",
      meetingDate: futureDate(6),
      sections: SECTIONS_WITHOUT_FLAGS(),
    });

    expect(status).toBe(201);
    firstAgendaId = body.agenda.id;
    const lines = discussionLines(await readAgendaSections(firstAgendaId));
    expect(lines).toEqual([
      expect.objectContaining({
        sourceId: visitId,
        text: `Visit — ${familyName} family — to discuss`,
        section: "Visits to discuss",
      }),
    ]);
    expect(JSON.stringify(await readAgendaSections(firstAgendaId))).not.toContain("out of work");
  });

  it("a second draft does not take the same line again", async () => {
    await actAs(fixtures, "bishop");
    const { body } = await createAgenda({
      meetingType: "bishopric",
      meetingDate: futureDate(13),
      sections: SECTIONS_WITHOUT_FLAGS(),
    });
    expect(discussionLines(await readAgendaSections(body.agenda.id))).toHaveLength(0);

    const { error } = await fixtures.service.from("agendas").delete().eq("id", body.agenda.id);
    if (error) throw new Error(error.message);
  });

  it("withdrawing takes the line off the draft, and asking again puts it back at once", async () => {
    await actAs(fixtures, "counselor1");
    const off = await setDiscussion(visitId, false);
    expect(off.status).toBe(200);
    expect(discussionLines(await readAgendaSections(firstAgendaId))).toHaveLength(0);
    expect((await readVisit()).discuss_in_bishopric).toBe(false);

    const on = await setDiscussion(visitId, true);
    expect(on.status).toBe(200);
    expect(on.body.placedOn).toBe(futureDate(6));
    expect(discussionLines(await readAgendaSections(firstAgendaId))).toHaveLength(1);
  });

  it("publishing marks the visit discussed and leaves its ward-council flag alone", async () => {
    await actAs(fixtures, "bishop");
    const { status } = await publishAgenda(firstAgendaId);
    expect(status).toBe(200);

    const visit = await readVisit();
    expect(visit.bishopric_discussed_at).not.toBeNull();
    expect(visit.flag_sent_at).toBeNull();
  });

  it("the agenda after it does not repeat the line", async () => {
    await actAs(fixtures, "bishop");
    const { body } = await createAgenda({
      meetingType: "bishopric",
      meetingDate: futureDate(20),
      sections: SECTIONS_WITHOUT_FLAGS(),
    });
    expect(discussionLines(await readAgendaSections(body.agenda.id))).toHaveLength(0);
  });

  it("'Discuss again' clears the stamp and raises it onto the upcoming draft", async () => {
    await actAs(fixtures, "bishop");
    const { body } = await setDiscussion(visitId, true);
    expect(body.placedOn).toBe(futureDate(20));
    expect((await readVisit()).bishopric_discussed_at).toBeNull();
  });
});
