import type { SupabaseClient } from "@supabase/supabase-js";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  DOCUMENTS_ENDPOINT,
  DRAFT_ENDPOINT,
  createPlannerBridge,
  type PlannerBridge,
  type PlannerDbApi,
  type PlannerDownloadsApi,
  type PlannerSampleApi,
  type PlannerSnapshot,
  type PlannerUserApi,
} from "@/lib/sacramentPlanner/bridge";
import type { Database } from "@/types/database";

// THE ONE PLACE A FAKE SUPABASE CLIENT IS RIGHT. The bridge is browser glue: what it reads and
// writes is proved against the real database by tests/rls/planner-documents.test.ts and the route
// suites. What is proved here is the glue itself — snapshot shape, layer mapping, latency
// compensation, error codes the Planner reads, and live re-reads.

type Row = {
  id: string;
  ward_id: string;
  layer: string;
  collection: string;
  document_id: string;
  data: Record<string, unknown>;
};

type RealtimePayload = {
  eventType: "INSERT" | "UPDATE" | "DELETE";
  new: Partial<Row>;
  old: Partial<Row>;
};

const WARD = "ward-a";

function fakeSupabase(rows: Row[]) {
  let realtimeHandler: ((payload: RealtimePayload) => void) | null = null;
  const reads: { layer?: string; collection?: string }[] = [];

  function query() {
    const filters: Record<string, string> = {};
    const builder = {
      select: () => builder,
      eq: (column: string, value: string) => {
        filters[column] = value;
        return builder;
      },
      order: () => builder,
      range: async () => {
        reads.push({ layer: filters.layer, collection: filters.collection });
        return { data: rows.filter((row) => matches(row, filters)), error: null };
      },
      maybeSingle: async () => ({
        data: rows.find((row) => matches(row, filters)) ?? null,
        error: null,
      }),
    };
    return builder;
  }

  function matches(row: Row, filters: Record<string, string>): boolean {
    return Object.entries(filters).every(
      ([column, value]) => String(row[column as keyof Row]) === value,
    );
  }

  const channel = {
    on: (_type: string, _filter: unknown, handler: (payload: RealtimePayload) => void) => {
      realtimeHandler = handler;
      return channel;
    },
    subscribe: () => channel,
  };

  const client = {
    from: () => query(),
    channel: () => channel,
    removeChannel: vi.fn(async () => "ok"),
  };

  return {
    client: client as unknown as SupabaseClient<Database>,
    removeChannel: client.removeChannel,
    reads,
    emit: (payload: RealtimePayload) => realtimeHandler?.(payload),
  };
}

function row(overrides: Partial<Row>): Row {
  return {
    id: crypto.randomUUID(),
    ward_id: WARD,
    layer: "real",
    collection: "marks",
    document_id: "k1-1",
    data: { name: "Doe, Jane", by: "Avery Stone" },
    ...overrides,
  };
}

const BISHOPRIC_ROW = row({
  collection: "settings",
  document_id: "bishopric",
  data: { members: [{ name: "Avery Stone", role: "Bishop" }] },
});

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

async function flush(): Promise<void> {
  for (let index = 0; index < 5; index += 1) await new Promise((resolve) => setTimeout(resolve, 0));
}

function listen(db: PlannerDbApi, name: string) {
  const snapshots: PlannerSnapshot[] = [];
  const errors: unknown[] = [];
  const unsubscribe = db
    .collection(name)
    .limit(1000)
    .onSnapshot(
      (snapshot) => snapshots.push(snapshot),
      (error) => errors.push(error),
    );
  const latest = () =>
    Object.fromEntries((snapshots.at(-1)?.docs ?? []).map((doc) => [doc.id, doc.data()]));
  return { snapshots, errors, unsubscribe, latest };
}

describe("createPlannerBridge", () => {
  let fetchImpl: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    fetchImpl = vi.fn(async () => jsonResponse(200, { ok: true }));
  });

  function bridgeOver(rows: Row[], roleLabel: "Bishop" | null = "Bishop") {
    const fake = fakeSupabase(rows);
    const bridge: PlannerBridge = createPlannerBridge({
      wardId: WARD,
      roleLabel,
      supabase: fake.client,
      fetchImpl: fetchImpl as unknown as typeof fetch,
      channelSuffix: "test",
    });
    return { fake, bridge };
  }

  it("delivers a snapshot of { id, data() } documents", async () => {
    const { bridge } = bridgeOver([row({ document_id: "k1-1" }), row({ document_id: "k2-2" })]);
    const db = (await bridge.use("db")) as PlannerDbApi;
    const marks = listen(db, "marks");
    await flush();

    expect(marks.snapshots).toHaveLength(1);
    expect(marks.snapshots[0].docs.map((doc) => doc.id)).toEqual(["k1-1", "k2-2"]);
    expect(marks.latest()["k1-1"]).toEqual({ name: "Doe, Jane", by: "Avery Stone" });
  });

  it("reads a t_ collection from the practice layer", async () => {
    const { fake, bridge } = bridgeOver([
      row({ document_id: "real-doc" }),
      row({ layer: "practice", document_id: "practice-doc" }),
    ]);
    const db = (await bridge.use("db")) as PlannerDbApi;
    const practice = listen(db, "t_marks");
    await flush();

    expect(fake.reads).toContainEqual({ layer: "practice", collection: "marks" });
    expect(Object.keys(practice.latest())).toEqual(["practice-doc"]);
  });

  it("fires listeners as soon as a save succeeds, before any realtime echo", async () => {
    const { bridge } = bridgeOver([]);
    const db = (await bridge.use("db")) as PlannerDbApi;
    const marks = listen(db, "marks");
    await flush();

    await db.collection("marks").doc("k9-9").set({ name: "Roe, Sam", by: "Avery Stone" });

    expect(marks.latest()["k9-9"]).toEqual({ name: "Roe, Sam", by: "Avery Stone" });
    expect(fetchImpl).toHaveBeenCalledWith(
      DOCUMENTS_ENDPOINT,
      expect.objectContaining({
        method: "PUT",
        body: JSON.stringify({
          layer: "real",
          collection: "marks",
          documentId: "k9-9",
          data: { name: "Roe, Sam", by: "Avery Stone" },
        }),
      }),
    );
  });

  it("writes a t_ collection to the practice layer", async () => {
    const { bridge } = bridgeOver([]);
    const db = (await bridge.use("db")) as PlannerDbApi;
    await db.collection("t_marks").doc("k9-9").delete();

    expect(fetchImpl).toHaveBeenCalledWith(
      DOCUMENTS_ENDPOINT,
      expect.objectContaining({
        method: "DELETE",
        body: JSON.stringify({ layer: "practice", collection: "marks", documentId: "k9-9" }),
      }),
    );
  });

  it("rejects a failed save and leaves the cache as it was", async () => {
    fetchImpl.mockResolvedValueOnce(jsonResponse(500, { error: "Could not save that change." }));
    const { bridge } = bridgeOver([row({ document_id: "k1-1" })]);
    const db = (await bridge.use("db")) as PlannerDbApi;
    const marks = listen(db, "marks");
    await flush();

    await expect(
      db.collection("marks").doc("k1-1").set({ name: "Changed", by: "Avery Stone" }),
    ).rejects.toThrow("Could not save that change.");
    expect(marks.latest()["k1-1"]).toEqual({ name: "Doe, Jane", by: "Avery Stone" });
  });

  it("rejects a 403 with the code the Planner turns into its view-only message", async () => {
    fetchImpl.mockResolvedValueOnce(jsonResponse(403, { error: "Not yours." }));
    const { bridge } = bridgeOver([]);
    const db = (await bridge.use("db")) as PlannerDbApi;

    await expect(
      db.collection("marks").doc("k1-1").set({ name: "A", by: "B" }),
    ).rejects.toMatchObject({ code: "invalid_argument" });
  });

  it("re-reads a collection when a realtime event names it, never trusting the payload", async () => {
    const rows = [row({ document_id: "k1-1" })];
    const { fake, bridge } = bridgeOver(rows);
    const db = (await bridge.use("db")) as PlannerDbApi;
    const marks = listen(db, "marks");
    await flush();

    rows.push(row({ document_id: "k2-2", data: { name: "From the database", by: "X" } }));
    fake.emit({
      eventType: "INSERT",
      new: { ward_id: WARD, layer: "real", collection: "marks", data: { name: "From the payload" } },
      old: {},
    });
    await flush();

    expect(marks.latest()["k2-2"]).toEqual({ name: "From the database", by: "X" });
  });

  it("re-reads on a DELETE that carries only the row's id", async () => {
    const doomed = row({ document_id: "k1-1" });
    const rows = [doomed, row({ document_id: "k2-2" })];
    const { fake, bridge } = bridgeOver(rows);
    const db = (await bridge.use("db")) as PlannerDbApi;
    const marks = listen(db, "marks");
    await flush();

    rows.splice(rows.indexOf(doomed), 1);
    fake.emit({ eventType: "DELETE", new: {}, old: { id: doomed.id } });
    await flush();

    expect(Object.keys(marks.latest())).toEqual(["k2-2"]);
  });

  it("ignores a DELETE for an id it has never read", async () => {
    const { fake, bridge } = bridgeOver([row({})]);
    const db = (await bridge.use("db")) as PlannerDbApi;
    listen(db, "marks");
    await flush();
    const readsBefore = fake.reads.length;

    fake.emit({ eventType: "DELETE", new: {}, old: { id: "someone-elses" } });
    await flush();

    expect(fake.reads.length).toBe(readsBefore);
  });

  it("knows who is signed in from the bishopric settings, and lets them write", async () => {
    const { bridge } = bridgeOver([BISHOPRIC_ROW]);
    const user = (await bridge.use("user")) as PlannerUserApi;

    expect(await user.me()).toBe("Avery Stone");
    expect(await user.can("data.write")).toBe(true);
    expect(await user.can("something.else")).toBe(false);
  });

  it("refuses writing to a login nobody on the bishopric list matches", async () => {
    const { bridge } = bridgeOver([BISHOPRIC_ROW], null);
    const user = (await bridge.use("user")) as PlannerUserApi;

    expect(await user.can("data.write")).toBe(false);
    expect(await user.me()).toBe("");
  });

  it("drafts through the app's AI route and reports the text once", async () => {
    fetchImpl.mockResolvedValueOnce(jsonResponse(200, { text: "Dear Sam," }));
    const { bridge } = bridgeOver([]);
    const sample = (await bridge.use("sample")) as PlannerSampleApi;
    const onText = vi.fn();

    await expect(sample("Write a note", { onText })).resolves.toEqual({ text: "Dear Sam," });
    expect(onText).toHaveBeenCalledWith({ text: "Dear Sam," });
    expect(fetchImpl).toHaveBeenCalledWith(
      DRAFT_ENDPOINT,
      expect.objectContaining({ method: "POST", body: JSON.stringify({ prompt: "Write a note" }) }),
    );
  });

  it("rejects a refused draft with the code the Planner reads as 'not available here'", async () => {
    fetchImpl.mockResolvedValueOnce(jsonResponse(403, { error: "No." }));
    const { bridge } = bridgeOver([]);
    const sample = (await bridge.use("sample")) as PlannerSampleApi;

    await expect(sample("Write a note")).rejects.toMatchObject({ code: "not_granted" });
  });

  it("saves a download through an anchor and a revoked object URL", async () => {
    const createObjectURL = vi.fn(() => "blob:planner");
    const revokeObjectURL = vi.fn();
    Object.assign(URL, { createObjectURL, revokeObjectURL });
    const clicked: string[] = [];
    const click = vi
      .spyOn(HTMLAnchorElement.prototype, "click")
      .mockImplementation(function (this: HTMLAnchorElement) {
        clicked.push(this.download);
      });

    const { bridge } = bridgeOver([]);
    const downloads = (await bridge.use("downloads")) as PlannerDownloadsApi;
    await downloads.save({ filename: "history.csv", data: new Blob(["a,b"]) });
    await flush();

    expect(clicked).toEqual(["history.csv"]);
    expect(revokeObjectURL).toHaveBeenCalledWith("blob:planner");
    click.mockRestore();
  });

  it("offers nothing for a capability it does not have", async () => {
    const { bridge } = bridgeOver([]);
    expect(await bridge.use("camera")).toBeNull();
  });

  it("removes its channel when disposed", async () => {
    const { fake, bridge } = bridgeOver([]);
    const db = (await bridge.use("db")) as PlannerDbApi;
    listen(db, "marks");
    bridge.dispose();
    expect(fake.removeChannel).toHaveBeenCalledTimes(1);
  });
});
