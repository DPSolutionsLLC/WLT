// @vitest-environment node
//
// PUT and DELETE /api/sacrament-planner/documents — every save the Sacrament Planner makes
// (ITER-045). Only the server client factory is mocked, so each write really runs as the acting
// user and RLS decides. See tests/helpers/routeClient.ts.

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

const URL = "http://localhost/api/sacrament-planner/documents";

async function put(body: unknown) {
  const { PUT } = await import("@/app/api/sacrament-planner/documents/route");
  return readResponse(await PUT(jsonRequest(URL, { method: "PUT", body })));
}

async function remove(body: unknown) {
  const { DELETE } = await import("@/app/api/sacrament-planner/documents/route");
  return readResponse(await DELETE(jsonRequest(URL, { method: "DELETE", body })));
}

describe("/api/sacrament-planner/documents", () => {
  let fixtures: Fixtures;
  const documentId = (suffix: string) => `route-${fixtures.runId}-${suffix}`;

  async function stored(layer: string, suffix: string) {
    const { data, error } = await fixtures.service
      .from("planner_documents")
      .select("data, updated_by")
      .eq("ward_id", fixtures.wardAId)
      .eq("layer", layer)
      .eq("collection", "marks")
      .eq("document_id", documentId(suffix))
      .maybeSingle();
    if (error) throw new Error(error.message);
    return data;
  }

  async function auditRows(action: string) {
    const { data, error } = await fixtures.service
      .from("audit_log")
      .select("detail, user_id")
      .eq("ward_id", fixtures.wardAId)
      .eq("action", action);
    if (error) throw new Error(error.message);
    return data ?? [];
  }

  const mark = (suffix: string, layer = "real") => ({
    layer,
    collection: "marks",
    documentId: documentId(suffix),
    data: { name: "Doe, Jane", by: "Avery Stone", extra: { kept: true } },
  });

  beforeAll(async () => {
    fixtures = await seedFixtures(["bishop", "counselor2", "musicCoordinator", "superAdmin"]);
  });

  afterAll(async () => {
    await fixtures?.cleanup();
  });

  it("saves a document as the bishop, keeping every field, and audits it with ids only", async () => {
    await actAs(fixtures, "bishop");
    const { status, body } = await put(mark("saved"));

    expect(status).toBe(200);
    expect(body).toEqual({ ok: true });
    expect(await stored("real", "saved")).toEqual({
      data: { name: "Doe, Jane", by: "Avery Stone", extra: { kept: true } },
      updated_by: fixtures.user("bishop").id,
    });

    const audit = (await auditRows("planner.document_saved")).find(
      (row) => (row.detail as { documentId?: string }).documentId === documentId("saved"),
    );
    expect(audit?.detail).toEqual({
      collection: "marks",
      documentId: documentId("saved"),
      layer: "real",
    });
  });

  it("overwrites the same document on a second save, as a counselor", async () => {
    await actAs(fixtures, "counselor2");
    const { status } = await put({ ...mark("saved"), data: { name: "Doe, Jane", by: "Casey" } });

    expect(status).toBe(200);
    expect((await stored("real", "saved"))?.data).toEqual({ name: "Doe, Jane", by: "Casey" });
  });

  it("keeps a practice save in the practice layer only, and audits it as practice", async () => {
    await actAs(fixtures, "bishop");
    const { status } = await put(mark("practice", "practice"));

    expect(status).toBe(200);
    expect(await stored("practice", "practice")).not.toBeNull();
    expect(await stored("real", "practice")).toBeNull();
    expect(
      (await auditRows("planner.document_saved")).some(
        (row) =>
          (row.detail as { documentId?: string; layer?: string }).documentId ===
            documentId("practice") && (row.detail as { layer?: string }).layer === "practice",
      ),
    ).toBe(true);
  });

  it("deletes a document and audits it, and deleting it again still succeeds", async () => {
    await actAs(fixtures, "bishop");
    await put(mark("doomed"));

    const target = { layer: "real", collection: "marks", documentId: documentId("doomed") };
    expect((await remove(target)).status).toBe(200);
    expect(await stored("real", "doomed")).toBeNull();
    expect((await remove(target)).status).toBe(200);

    expect(
      (await auditRows("planner.document_deleted")).some(
        (row) => (row.detail as { documentId?: string }).documentId === documentId("doomed"),
      ),
    ).toBe(true);
  });

  it("refuses a malformed record with a sentence, and stores nothing", async () => {
    await actAs(fixtures, "bishop");
    const { status, body } = await put({ ...mark("no-author"), data: { name: "Doe, Jane" } });

    expect(status).toBe(400);
    expect(errorMessage(body)).toBe(
      "This marks record is missing by, so the Planner could not read it.",
    );
    expect(await stored("real", "no-author")).toBeNull();
  });

  it("refuses an unknown collection with a 400", async () => {
    await actAs(fixtures, "bishop");
    const { status } = await put({ ...mark("x"), collection: "agendas" });
    expect(status).toBe(400);
  });

  it("refuses the music coordinator with a 403 and writes nothing", async () => {
    await actAs(fixtures, "musicCoordinator");
    const { status } = await put(mark("music"));

    expect(status).toBe(403);
    expect(await stored("real", "music")).toBeNull();
  });

  it("refuses a super admin whose calling here is not bishopric", async () => {
    await actAs(fixtures, "superAdmin");
    expect((await put(mark("super"))).status).toBe(403);
    expect(
      (await remove({ layer: "real", collection: "marks", documentId: documentId("saved") }))
        .status,
    ).toBe(403);
    expect(await stored("real", "saved")).not.toBeNull();
    expect(await stored("real", "super")).toBeNull();
  });
});
