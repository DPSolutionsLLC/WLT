import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/types/database";
import type {
  KnowledgeDocument,
  KnowledgeStatus,
  KnowledgeTypeTag,
  SupportedUploadExtension,
} from "@/types/domain";
import type { Chunk } from "@/lib/knowledge/chunk";

// Every `knowledge_documents` and `document_chunks` read and write goes through this module.
// Route handlers and pages never touch Supabase directly (conventions.md §Data Access).
//
// SERVER-ONLY, but NOT NEXT-ONLY — and that distinction is why createServerSupabaseClient is
// imported DYNAMICALLY below rather than at the top like every other queries module.
// supabase/scripts/ingestStandardWorks.ts runs under plain `node --experimental-strip-types`
// with the service-role client, and `next/headers` cannot be imported outside Next at all
// (ERR_MODULE_NOT_FOUND, not a runtime throw). A static import here would make this module
// unloadable from the script that needs it most. Every caller already passes an explicit
// client; the dynamic import is only the fallback for the ones that do not.

export const KNOWLEDGE_BUCKET = "knowledge-documents";

// Objects are keyed {ward_id}/{document_id}.{ext} because migration 032's policies read the
// ward from the FIRST path segment. A key built any other way is unreachable by its own
// uploader — which is the right failure, but only if the key is built in exactly one place.
export function storageKeyFor(
  wardId: string,
  documentId: string,
  extension: SupportedUploadExtension,
): string {
  return `${wardId}/${documentId}.${extension}`;
}

// A chunk carrying the label chunkByBoundaries produced. The label is prepended to the stored
// content rather than given its own column: migration 014 has no `label` on document_chunks,
// and adding one for the scripture path alone is a migration this plan does not need. The
// bracketed prefix is what lib/ai/retrieve.ts reads back out to build a citation.
export type IngestibleChunk = Chunk & { label?: string };

const LABEL_PREFIX_PATTERN = /^\[([^\]\n]{1,120})\]\s*/;

export function withLabelPrefix(chunk: IngestibleChunk): string {
  return chunk.label ? `[${chunk.label}] ${chunk.content}` : chunk.content;
}

// Returns the label and the content without it. A chunk stored before labels existed, or one
// whose content legitimately opens with a bracket over the length cap, comes back with a null
// label and its text intact.
export function splitLabelPrefix(content: string): {
  label: string | null;
  text: string;
} {
  const match = LABEL_PREFIX_PATTERN.exec(content);
  if (!match) return { label: null, text: content };
  return { label: match[1], text: content.slice(match[0].length) };
}

type KnowledgeDocumentRow = {
  id: string;
  title: string;
  type_tag: string | null;
  file_url: string | null;
  status: string;
  uploaded_by: string | null;
  uploaded_at: string;
};

// One string literal on ONE line, never a `+` concatenation between column names
// (plans/retros/calendar-a-rules-and-api.md).
const DOCUMENT_COLUMNS =
  "id, title, type_tag, file_url, status, uploaded_by, uploaded_at";

// Insert size, not embedding batch size. A single insert of 20,000 rows exceeds PostgREST's
// request limit; 200 rows of ~2,000 characters each is a comfortable ~400 KB body.
const CHUNK_INSERT_BATCH_SIZE = 200;

async function resolveClient(
  client?: SupabaseClient<Database>,
): Promise<SupabaseClient<Database>> {
  if (client) return client;

  const { createServerSupabaseClient } = await import("@/lib/supabase/server");
  return createServerSupabaseClient();
}

// The CHECK constraint in migration 014 permits exactly these three plus null, so an unknown
// value can only mean the constraint changed without this mapper. Falling back to null renders
// the tag as "Untagged" rather than crashing the page.
function toTypeTag(value: string | null): KnowledgeTypeTag | null {
  if (value === "standard_works" || value === "general_conference" || value === "other") {
    return value;
  }
  return null;
}

function toStatus(value: string): KnowledgeStatus {
  return value === "inactive" ? "inactive" : "active";
}

function mapDocumentRow(
  row: KnowledgeDocumentRow,
  counts: { chunkCount: number; embeddedCount: number },
  uploaderNames: Map<string, string>,
): KnowledgeDocument {
  return {
    id: row.id,
    title: row.title,
    typeTag: toTypeTag(row.type_tag),
    fileUrl: row.file_url,
    status: toStatus(row.status),
    uploadedBy: row.uploaded_by,
    uploadedByName: row.uploaded_by ? (uploaderNames.get(row.uploaded_by) ?? null) : null,
    uploadedAt: row.uploaded_at,
    chunkCount: counts.chunkCount,
    embeddedCount: counts.embeddedCount,
  };
}

// TWO NUMBERS, not one. "412 passages, 410 embedded" is how a partial embedding failure becomes
// visible instead of becoming quietly worse retrieval. Counted with head-only queries so no row
// bodies cross the wire.
//
// Two round trips per document. At a few dozen documents per ward that is fine; if a ward ever
// reaches hundreds this becomes one grouped RPC, not a lazily-loaded count.
async function countChunks(
  supabase: SupabaseClient<Database>,
  wardId: string,
  documentId: string,
): Promise<{ chunkCount: number; embeddedCount: number }> {
  const [total, embedded] = await Promise.all([
    supabase
      .from("document_chunks")
      .select("id", { count: "exact", head: true })
      .eq("ward_id", wardId)
      .eq("document_id", documentId),
    supabase
      .from("document_chunks")
      .select("id", { count: "exact", head: true })
      .eq("ward_id", wardId)
      .eq("document_id", documentId)
      .not("embedding", "is", null),
  ]);

  if (total.error) {
    console.error(`Could not count document passages — ${total.error.message}`, {
      wardId,
      documentId,
    });
    throw new Error(`Could not count the document's passages: ${total.error.message}`);
  }

  if (embedded.error) {
    console.error(`Could not count embedded passages — ${embedded.error.message}`, {
      wardId,
      documentId,
    });
    throw new Error(
      `Could not count the document's embedded passages: ${embedded.error.message}`,
    );
  }

  return { chunkCount: total.count ?? 0, embeddedCount: embedded.count ?? 0 };
}

// Uploader names come from a SECOND query, not a PostgREST embedded join. The foreign key to
// `users` is composite (uploaded_by, ward_id), and embedded-join syntax over a composite FK
// depends on a generated constraint name and is fragile (lib/ai/queries.ts records the same).
async function resolveUploaderNames(
  supabase: SupabaseClient<Database>,
  wardId: string,
  uploaderIds: readonly string[],
): Promise<Map<string, string>> {
  const names = new Map<string, string>();
  if (uploaderIds.length === 0) return names;

  const { data, error } = await supabase
    .from("users")
    .select("id, first_name, last_name")
    .eq("ward_id", wardId)
    .in("id", [...uploaderIds]);

  if (error) {
    // Degrade to "who uploaded it is unknown" rather than failing the page. The documents are
    // the record; a missing name is a smaller loss than an unreadable knowledge base.
    console.error(`Could not resolve document uploader names — ${error.message}`, { wardId });
    return names;
  }

  for (const row of data ?? []) {
    const name = [row.first_name, row.last_name].filter(Boolean).join(" ").trim();
    if (name !== "") names.set(row.id, name);
  }

  return names;
}

// Newest first. Order any list you then index into
// (plans/retros/route-tests-and-realtime.md).
export async function listDocuments(
  wardId: string,
  client?: SupabaseClient<Database>,
): Promise<KnowledgeDocument[]> {
  const supabase = await resolveClient(client);

  const { data, error } = await supabase
    .from("knowledge_documents")
    .select(DOCUMENT_COLUMNS)
    .eq("ward_id", wardId)
    .order("uploaded_at", { ascending: false })
    .order("id", { ascending: false });

  if (error) {
    console.error(`Could not read the knowledge base — ${error.message}`, { wardId });
    throw new Error(`Could not read the knowledge base: ${error.message}`);
  }

  const rows = data ?? [];

  const uploaderIds = [
    ...new Set(
      rows
        .map((row) => row.uploaded_by)
        .filter((uploadedBy): uploadedBy is string => uploadedBy !== null),
    ),
  ];

  const [names, counts] = await Promise.all([
    resolveUploaderNames(supabase, wardId, uploaderIds),
    Promise.all(rows.map((row) => countChunks(supabase, wardId, row.id))),
  ]);

  return rows.map((row, index) => mapDocumentRow(row, counts[index], names));
}

export async function getDocument(
  wardId: string,
  id: string,
  client?: SupabaseClient<Database>,
): Promise<KnowledgeDocument | null> {
  const supabase = await resolveClient(client);

  const { data, error } = await supabase
    .from("knowledge_documents")
    .select(DOCUMENT_COLUMNS)
    .eq("ward_id", wardId)
    .eq("id", id)
    .maybeSingle();

  if (error) {
    console.error(`Could not read a knowledge document — ${error.message}`, { wardId, id });
    throw new Error(`Could not read that document: ${error.message}`);
  }

  if (!data) return null;

  const [counts, names] = await Promise.all([
    countChunks(supabase, wardId, data.id),
    resolveUploaderNames(supabase, wardId, data.uploaded_by ? [data.uploaded_by] : []),
  ]);

  return mapDocumentRow(data, counts, names);
}

export type CreateDocumentInput = {
  title: string;
  typeTag: KnowledgeTypeTag;
  fileUrl?: string | null;
};

export async function createDocument(
  wardId: string,
  input: CreateDocumentInput,
  uploadedBy: string | null,
  client?: SupabaseClient<Database>,
): Promise<KnowledgeDocument> {
  const supabase = await resolveClient(client);

  const { data, error } = await supabase
    .from("knowledge_documents")
    .insert({
      ward_id: wardId,
      title: input.title,
      type_tag: input.typeTag,
      file_url: input.fileUrl ?? null,
      status: "active",
      uploaded_by: uploadedBy,
    })
    .select(DOCUMENT_COLUMNS)
    .single();

  if (error) {
    console.error(`Could not create a knowledge document — ${error.message}`, {
      wardId,
      uploadedBy,
    });
    throw new Error(`Could not add the document: ${error.message}`);
  }

  // A brand-new document has no chunks yet, so the counts are known without a query.
  return mapDocumentRow(data, { chunkCount: 0, embeddedCount: 0 }, new Map());
}

export async function setDocumentFileUrl(
  wardId: string,
  id: string,
  fileUrl: string | null,
  client?: SupabaseClient<Database>,
): Promise<void> {
  const supabase = await resolveClient(client);

  const { error } = await supabase
    .from("knowledge_documents")
    .update({ file_url: fileUrl })
    .eq("ward_id", wardId)
    .eq("id", id);

  if (error) {
    console.error(`Could not record a document's file location — ${error.message}`, {
      wardId,
      id,
    });
    throw new Error(`Could not record where the file was stored: ${error.message}`);
  }
}

// Inserts in batches and returns how many rows were written. A chunk whose embedding is null is
// inserted anyway — see lib/knowledge/ingest.ts for why that is deliberate.
export async function insertChunks(
  wardId: string,
  documentId: string,
  chunks: readonly (IngestibleChunk & { embedding: number[] | null })[],
  client?: SupabaseClient<Database>,
): Promise<number> {
  const supabase = await resolveClient(client);

  let written = 0;

  for (let start = 0; start < chunks.length; start += CHUNK_INSERT_BATCH_SIZE) {
    const batch = chunks.slice(start, start + CHUNK_INSERT_BATCH_SIZE);

    const { error } = await supabase.from("document_chunks").insert(
      batch.map((chunk) => ({
        ward_id: wardId,
        document_id: documentId,
        content: withLabelPrefix(chunk),
        // pgvector's text input format is `[1,2,3]`, byte-identical to a JSON array. Sending
        // the string removes any ambiguity about how PostgREST serialises a JS number array
        // into a vector column.
        embedding: chunk.embedding === null ? null : JSON.stringify(chunk.embedding),
        chunk_index: chunk.chunkIndex,
      })),
    );

    if (error) {
      console.error(`Could not save document passages — ${error.message}`, {
        wardId,
        documentId,
        batchStart: start,
      });
      throw new Error(
        `Could not save the document's passages (batch starting at ${start}): ${error.message}`,
      );
    }

    written += batch.length;
  }

  return written;
}

// Returns null when no row matched, which for a ward-scoped query means "not this ward's
// document" — the caller turns that into a 404 rather than a 403, because confirming that
// another ward's id exists is itself a leak.
export async function setDocumentStatus(
  wardId: string,
  id: string,
  status: KnowledgeStatus,
  client?: SupabaseClient<Database>,
): Promise<KnowledgeDocument | null> {
  const supabase = await resolveClient(client);

  const { data, error } = await supabase
    .from("knowledge_documents")
    .update({ status })
    .eq("ward_id", wardId)
    .eq("id", id)
    .select(DOCUMENT_COLUMNS)
    .maybeSingle();

  if (error) {
    console.error(`Could not change a document's status — ${error.message}`, {
      wardId,
      id,
      status,
    });
    throw new Error(`Could not change the document's status: ${error.message}`);
  }

  if (!data) return null;

  const [counts, names] = await Promise.all([
    countChunks(supabase, wardId, data.id),
    resolveUploaderNames(supabase, wardId, data.uploaded_by ? [data.uploaded_by] : []),
  ]);

  return mapDocumentRow(data, counts, names);
}

// Deletes the document row and lets the composite foreign key cascade take its chunks
// (migration 014 declares `on delete cascade`).
//
// THE STORAGE OBJECT GOES LAST AND BEST-EFFORT. An orphaned file is a housekeeping problem an
// administrator can clean up later; an orphaned chunk is a retrieval problem that silently
// returns text from a document the bishopric believes they deleted. Only one of those is worth
// failing the request over, and it is not the file. The failure is still logged, never swallowed.
export async function deleteDocument(
  wardId: string,
  id: string,
  fileUrl: string | null,
  client?: SupabaseClient<Database>,
): Promise<boolean> {
  const supabase = await resolveClient(client);

  const { data, error } = await supabase
    .from("knowledge_documents")
    .delete()
    .eq("ward_id", wardId)
    .eq("id", id)
    .select("id");

  if (error) {
    console.error(`Could not delete a knowledge document — ${error.message}`, { wardId, id });
    throw new Error(`Could not delete the document: ${error.message}`);
  }

  // An RLS-denied DELETE is a zero-row success, not an error
  // (plans/retros/foundation-c-services.md). Selecting the deleted ids is what tells the two
  // apart, and it is why this returns a boolean rather than void.
  if ((data ?? []).length === 0) return false;

  if (fileUrl) {
    const { error: storageError } = await supabase.storage
      .from(KNOWLEDGE_BUCKET)
      .remove([fileUrl]);

    if (storageError) {
      console.error(
        `Deleted document ${id} but could not remove its stored file — ${storageError.message}`,
        { wardId, fileUrl },
      );
    }
  }

  return true;
}
