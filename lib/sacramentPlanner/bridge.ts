import type { RealtimeChannel, SupabaseClient } from "@supabase/supabase-js";
import {
  parseCollectionName,
  type PlannerCollectionRef,
} from "@/lib/sacramentPlanner/collections";
import { plannerNameFor, type BishopricRoleLabel } from "@/lib/sacramentPlanner/identity";
import type { Database } from "@/types/database";

// THE ONE DOORWAY THE PLANNER USES FOR THE OUTSIDE WORLD.
//
// The Sacrament Planner was written as a Claude artifact and reaches everything through
// `window.claude.use("db" | "user" | "sample" | "downloads")`. Its code runs unchanged in a
// same-origin frame (ITER-045, D1); this object fills that doorway with the app's own database,
// login and AI. The page that frames it installs it as `window.__wltPlannerBridge`, and the
// frame's first script copies it into `window.claude` (lib/sacramentPlanner/assemblePlannerHtml.ts).
//
// READS go through the signed-in user's own Supabase client, so RLS decides what they see.
// WRITES go through /api/sacrament-planner/documents, so every one is validated and audited.
// LIVE UPDATES come from one realtime channel per bridge; an event only says WHICH collection
// changed, and the collection is re-read. The payload is never trusted: a DELETE event carries
// nothing but the row's surrogate id (migration 093), and an INSERT or UPDATE is re-read anyway so
// RLS answers rather than the event.

declare global {
  interface Window {
    __wltPlannerBridge?: PlannerBridge;
  }
}

export type PlannerDocumentData = Record<string, unknown>;

export type PlannerSnapshot = {
  docs: { id: string; data: () => PlannerDocumentData }[];
};

type SnapshotListener = {
  onNext: (snapshot: PlannerSnapshot) => void;
  onError?: (error: unknown) => void;
};

export type PlannerDocumentRefApi = {
  set: (value: PlannerDocumentData) => Promise<void>;
  delete: () => Promise<void>;
};

export type PlannerCollectionApi = {
  limit: (count: number) => PlannerCollectionApi;
  onSnapshot: (
    onNext: (snapshot: PlannerSnapshot) => void,
    onError?: (error: unknown) => void,
  ) => () => void;
  doc: (id: string) => PlannerDocumentRefApi;
};

export type PlannerDbApi = { collection: (name: string) => PlannerCollectionApi };

export type PlannerUserApi = {
  can: (permission: string) => Promise<boolean>;
  me: () => Promise<string>;
};

export type PlannerSampleApi = (
  prompt: string,
  options?: { onText?: (partial: { text: string }) => void },
) => Promise<{ text: string }>;

export type PlannerDownloadsApi = {
  save: (file: { filename: string; data: Blob | string }) => Promise<void>;
};

export type PlannerCapabilityName = "db" | "user" | "sample" | "downloads";

export type PlannerBridge = {
  use: (name: PlannerCapabilityName | string) => Promise<unknown>;
  dispose: () => void;
};

export type PlannerBridgeOptions = {
  wardId: string;
  roleLabel: BishopricRoleLabel | null;
  supabase: SupabaseClient<Database>;
  fetchImpl?: typeof fetch;
  channelSuffix?: string;
};

// The Planner reads these codes off a rejected write or draft and shows its own wording.
export type PlannerBridgeError = Error & { code?: "invalid_argument" | "not_granted" };

export const DOCUMENTS_ENDPOINT = "/api/sacrament-planner/documents";
export const DRAFT_ENDPOINT = "/api/sacrament-planner/draft";

const PAGE_SIZE = 1000;

function keyOf(ref: PlannerCollectionRef): string {
  return `${ref.layer}:${ref.collection}`;
}

function bridgeError(message: string, code?: PlannerBridgeError["code"]): PlannerBridgeError {
  const error: PlannerBridgeError = new Error(message);
  if (code) error.code = code;
  return error;
}

async function readErrorMessage(response: Response, fallback: string): Promise<string> {
  try {
    const body = (await response.json()) as { error?: unknown };
    return typeof body.error === "string" ? body.error : fallback;
  } catch {
    return fallback;
  }
}

type CollectionState = {
  ref: PlannerCollectionRef;
  documents: Map<string, PlannerDocumentData>;
  listeners: Set<SnapshotListener>;
  loaded: boolean;
  reading: boolean;
  readAgain: boolean;
  localWrites: number;
};

export function createPlannerBridge(options: PlannerBridgeOptions): PlannerBridge {
  const { wardId, roleLabel, supabase } = options;
  const fetchImpl = options.fetchImpl ?? ((...args: Parameters<typeof fetch>) => fetch(...args));

  const collections = new Map<string, CollectionState>();
  const keyOfRowId = new Map<string, string>();
  let channel: RealtimeChannel | null = null;
  let subscribedBefore = false;
  let disposed = false;
  let namePromise: Promise<string | null> | null = null;

  function stateFor(ref: PlannerCollectionRef): CollectionState {
    const key = keyOf(ref);
    let state = collections.get(key);
    if (!state) {
      state = {
        ref,
        documents: new Map(),
        listeners: new Set(),
        loaded: false,
        reading: false,
        readAgain: false,
        localWrites: 0,
      };
      collections.set(key, state);
    }
    return state;
  }

  function snapshotOf(state: CollectionState): PlannerSnapshot {
    return {
      docs: [...state.documents].map(([id, value]) => ({ id, data: () => value })),
    };
  }

  function fire(state: CollectionState): void {
    const snapshot = snapshotOf(state);
    for (const listener of state.listeners) {
      try {
        listener.onNext(snapshot);
      } catch (error) {
        console.error("The Sacrament Planner failed while applying an update", {
          collection: state.ref.collection,
          layer: state.ref.layer,
          error,
        });
      }
    }
  }

  function fail(state: CollectionState, error: unknown): void {
    console.error("Could not read the Sacrament Planner's records", {
      collection: state.ref.collection,
      layer: state.ref.layer,
      error,
    });
    for (const listener of state.listeners) listener.onError?.(error);
  }

  async function readCollection(
    ref: PlannerCollectionRef,
  ): Promise<{ id: string; documentId: string; data: PlannerDocumentData }[]> {
    const rows: { id: string; documentId: string; data: PlannerDocumentData }[] = [];

    for (let from = 0; ; from += PAGE_SIZE) {
      const { data, error } = await supabase
        .from("planner_documents")
        .select("id, document_id, data")
        .eq("ward_id", wardId)
        .eq("layer", ref.layer)
        .eq("collection", ref.collection)
        .order("document_id")
        .range(from, from + PAGE_SIZE - 1);

      if (error) throw new Error(error.message);

      for (const row of data ?? []) {
        rows.push({
          id: row.id,
          documentId: row.document_id,
          data: (row.data ?? {}) as PlannerDocumentData,
        });
      }

      if (!data || data.length < PAGE_SIZE) return rows;
    }
  }

  // Coalesces bursts: an event arriving mid-read asks for one more read rather than a second
  // concurrent one. A read that started before a local write landed is discarded and repeated,
  // so it cannot put the old value back over the one the person just saved.
  async function refresh(state: CollectionState): Promise<void> {
    if (state.reading) {
      state.readAgain = true;
      return;
    }

    state.reading = true;
    try {
      do {
        state.readAgain = false;
        const writesAtStart = state.localWrites;
        const rows = await readCollection(state.ref);
        if (disposed) return;
        if (state.localWrites !== writesAtStart) {
          state.readAgain = true;
          continue;
        }

        state.documents = new Map(rows.map((row) => [row.documentId, row.data]));
        for (const row of rows) keyOfRowId.set(row.id, keyOf(state.ref));
        state.loaded = true;
        fire(state);
      } while (state.readAgain && !disposed);
    } catch (error) {
      if (!disposed) fail(state, error);
    } finally {
      state.reading = false;
    }
  }

  function ensureChannel(): void {
    if (channel || disposed) return;

    const suffix = options.channelSuffix ?? Math.random().toString(36).slice(2);
    // Every .on() before .subscribe(): realtime-js throws if a callback is added after
    // (app/(app)/assignments/CommentThread.tsx). The topic is unique per bridge, so two tabs or a
    // remount never share one channel.
    channel = supabase
      .channel(`planner-documents:${wardId}:${suffix}`)
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "planner_documents",
          filter: `ward_id=eq.${wardId}`,
        },
        (payload) => {
          const row = (payload.eventType === "DELETE" ? payload.old : payload.new) as {
            id?: string;
            ward_id?: string;
            layer?: string;
            collection?: string;
          };

          let key: string | undefined;
          if (row.layer && row.collection) {
            if (row.ward_id !== wardId) return;
            key = `${row.layer}:${row.collection}`;
          } else if (row.id) {
            key = keyOfRowId.get(row.id);
          }

          const state = key ? collections.get(key) : undefined;
          if (state && state.listeners.size > 0) void refresh(state);
        },
      )
      .subscribe((status, error) => {
        // A reconnect cannot replay what happened while the socket was down, so everything
        // somebody is looking at is read again.
        if (status === "SUBSCRIBED") {
          if (subscribedBefore) {
            for (const state of collections.values()) {
              if (state.listeners.size > 0) void refresh(state);
            }
          }
          subscribedBefore = true;
          return;
        }
        if (status === "CHANNEL_ERROR" || status === "TIMED_OUT") {
          console.error("The Sacrament Planner's live updates could not connect", {
            wardId,
            status,
            error,
          });
        }
      });
  }

  async function send(method: "PUT" | "DELETE", body: Record<string, unknown>): Promise<void> {
    const response = await fetchImpl(DOCUMENTS_ENDPOINT, {
      method,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });

    if (response.ok) return;

    const message = await readErrorMessage(response, "Could not save that change.");
    console.error("The Sacrament Planner could not save a change", {
      status: response.status,
      collection: body.collection,
      layer: body.layer,
    });
    throw bridgeError(message, response.status === 403 ? "invalid_argument" : undefined);
  }

  function collectionApi(name: string): PlannerCollectionApi {
    const ref = parseCollectionName(name);
    const state = stateFor(ref);

    const api: PlannerCollectionApi = {
      limit: () => api,
      onSnapshot(onNext, onError) {
        const listener: SnapshotListener = { onNext, onError };
        state.listeners.add(listener);
        ensureChannel();

        if (state.loaded) {
          queueMicrotask(() => {
            if (state.listeners.has(listener)) onNext(snapshotOf(state));
          });
        } else {
          void refresh(state);
        }

        return () => {
          state.listeners.delete(listener);
        };
      },
      doc(documentId) {
        const target = { layer: ref.layer, collection: ref.collection, documentId };
        return {
          async set(value) {
            const copy = JSON.parse(JSON.stringify(value)) as PlannerDocumentData;
            await send("PUT", { ...target, data: copy });
            state.localWrites += 1;
            state.documents.set(documentId, copy);
            fire(state);
          },
          async delete() {
            await send("DELETE", target);
            state.localWrites += 1;
            state.documents.delete(documentId);
            fire(state);
          },
        };
      },
    };

    return api;
  }

  async function readSignedInName(): Promise<string | null> {
    const { data, error } = await supabase
      .from("planner_documents")
      .select("data")
      .eq("ward_id", wardId)
      .eq("layer", "real")
      .eq("collection", "settings")
      .eq("document_id", "bishopric")
      .maybeSingle();

    if (error) {
      console.error("Could not read the Sacrament Planner's bishopric list", {
        wardId,
        error: error.message,
      });
      return null;
    }

    return plannerNameFor(roleLabel, data?.data ?? null);
  }

  function signedInName(): Promise<string | null> {
    namePromise ??= readSignedInName();
    return namePromise;
  }

  const db: PlannerDbApi = { collection: collectionApi };

  // `can` is false when the login matches nobody on the Planner's bishopric list, and the Planner
  // then shows its own view-only message. Only "data.write" is ever asked.
  const user: PlannerUserApi = {
    can: async (permission) => permission === "data.write" && (await signedInName()) !== null,
    me: async () => (await signedInName()) ?? "",
  };

  const sample: PlannerSampleApi = async (prompt, sampleOptions) => {
    const response = await fetchImpl(DRAFT_ENDPOINT, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ prompt }),
    });

    if (!response.ok) {
      const message = await readErrorMessage(response, "Could not reach Claude.");
      console.error("The Sacrament Planner could not draft a message", {
        status: response.status,
      });
      throw bridgeError(message, response.status === 403 ? "not_granted" : undefined);
    }

    const body = (await response.json()) as { text?: unknown };
    if (typeof body.text !== "string" || body.text === "") {
      throw bridgeError("Claude returned an empty draft.");
    }

    sampleOptions?.onText?.({ text: body.text });
    return { text: body.text };
  };

  const downloads: PlannerDownloadsApi = {
    async save({ filename, data }) {
      const blob = typeof data === "string" ? new Blob([data], { type: "text/plain" }) : data;
      const url = URL.createObjectURL(blob);
      try {
        const anchor = document.createElement("a");
        anchor.href = url;
        anchor.download = filename;
        document.body.appendChild(anchor);
        anchor.click();
        anchor.remove();
      } finally {
        setTimeout(() => URL.revokeObjectURL(url), 0);
      }
    },
  };

  const capabilities: Record<PlannerCapabilityName, unknown> = { db, user, sample, downloads };

  return {
    use: async (name) =>
      (capabilities as Record<string, unknown>)[name] ?? null,
    dispose() {
      disposed = true;
      for (const state of collections.values()) state.listeners.clear();
      if (channel) {
        void supabase.removeChannel(channel);
        channel = null;
      }
    },
  };
}

export function disposePlannerBridge(bridge: PlannerBridge | undefined): void {
  bridge?.dispose();
}
