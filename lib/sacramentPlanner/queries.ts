import type { SupabaseClient } from "@supabase/supabase-js";
import type { PlannerCollection, PlannerLayer } from "@/lib/sacramentPlanner/collections";
import { isPolicyRefusal } from "@/lib/youth/policyRefusal";
import type { Database, Json } from "@/types/database";

export type PlannerHistory = {
  rows: unknown[];
  meetings: Record<string, unknown>;
  conduct: Record<string, unknown>;
};

export type PlannerDocumentKey = {
  wardId: string;
  layer: PlannerLayer;
  collection: PlannerCollection;
  documentId: string;
};

export const NATURAL_KEY_COLUMNS = "ward_id,layer,collection,document_id";

function asObject(value: Json | undefined): Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

// A ward that was never imported is ordinary — a new ward, or the test ward — and the Planner must
// still open, so no row reads as empty history rather than as an error.
export async function readPlannerHistory(
  wardId: string,
  client: SupabaseClient<Database>,
): Promise<PlannerHistory> {
  const { data, error } = await client
    .from("planner_history")
    .select("agenda_rows, meetings, conducting")
    .eq("ward_id", wardId)
    .maybeSingle();

  if (error) {
    console.error(`Could not read the Sacrament Planner's history — ${error.message}`, { wardId });
    throw new Error(`Could not read the Sacrament Planner's history: ${error.message}`);
  }

  if (!data) return { rows: [], meetings: {}, conduct: {} };

  return {
    rows: Array.isArray(data.agenda_rows) ? data.agenda_rows : [],
    meetings: asObject(data.meetings),
    conduct: asObject(data.conducting),
  };
}

// Runs through the CALLER's client, so RLS decides (rule 2). Null means the policy refused it,
// which the route answers with 403 rather than a 500 — a refused INSERT always raises 42501.
export async function upsertPlannerDocument(
  key: PlannerDocumentKey & { data: Record<string, unknown>; userId: string },
  client: SupabaseClient<Database>,
): Promise<true | null> {
  const { error } = await client.from("planner_documents").upsert(
    {
      ward_id: key.wardId,
      layer: key.layer,
      collection: key.collection,
      document_id: key.documentId,
      data: key.data as Json,
      updated_by: key.userId,
      updated_at: new Date().toISOString(),
    },
    { onConflict: NATURAL_KEY_COLUMNS },
  );

  if (isPolicyRefusal(error)) return null;
  if (error) {
    console.error(`Could not save a Sacrament Planner document — ${error.message}`, {
      wardId: key.wardId,
      layer: key.layer,
      collection: key.collection,
      documentId: key.documentId,
    });
    throw new Error(`Could not save that record: ${error.message}`);
  }

  return true;
}

// Deleting a document that is not there succeeds, as it did in the Planner's old store. A refusal
// by USING is the same zero-row success, so the route checks access before calling this.
export async function deletePlannerDocument(
  key: PlannerDocumentKey,
  client: SupabaseClient<Database>,
): Promise<void> {
  const { error } = await client
    .from("planner_documents")
    .delete()
    .eq("ward_id", key.wardId)
    .eq("layer", key.layer)
    .eq("collection", key.collection)
    .eq("document_id", key.documentId);

  if (error) {
    console.error(`Could not delete a Sacrament Planner document — ${error.message}`, {
      wardId: key.wardId,
      layer: key.layer,
      collection: key.collection,
      documentId: key.documentId,
    });
    throw new Error(`Could not delete that record: ${error.message}`);
  }
}
