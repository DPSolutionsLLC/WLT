import { NextResponse } from "next/server";
import { writeAuditLog } from "@/lib/audit/writeAuditLog";
import { assertCan, resolveRoleAccess } from "@/lib/auth/permissions";
import { respondToRouteError } from "@/lib/auth/routeErrors";
import { requireSessionUser } from "@/lib/auth/session";
import { chunkText } from "@/lib/knowledge/chunk";
import { ingestChunks } from "@/lib/knowledge/ingest";
import { parseDocument, resolveUploadType } from "@/lib/knowledge/parseDocument";
import {
  KNOWLEDGE_BUCKET,
  createDocument,
  deleteDocument,
  setDocumentFileUrl,
  storageKeyFor,
} from "@/lib/knowledge/queries";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { MAX_UPLOAD_BYTES, uploadMetadataSchema } from "@/lib/validation/knowledge";

// A 5 MB text document is a few hundred passages and several embedding batches, which comfortably
// exceeds the default serverless budget. MAX_UPLOAD_BYTES is what keeps 60 seconds sufficient:
// anything larger belongs in supabase/scripts/ingestStandardWorks.ts, which has no timeout at all.
export const maxDuration = 60;

// The session is resolved OUTSIDE the try: requireSessionUser() redirects by throwing an internal
// Next.js error, and catching that would turn a redirect into a 500.

// A refusal the UPLOADER caused, carrying a sentence written for them. Distinct from a 500 so
// the five different ways an upload can be wrong each keep their own message rather than
// collapsing into one generic fallback.
class UploadRefusedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "UploadRefusedError";
  }
}

// Multipart, so readJsonBody does not apply. This mirrors what it does for JSON — a malformed
// body is the CALLER's mistake and must be a 400, not a 500 reporting the server's own fault.
async function readFormData(request: Request): Promise<FormData> {
  try {
    return await request.formData();
  } catch (error) {
    console.error("Could not read the upload body", { cause: error });
    throw new UploadRefusedError(
      "The upload could not be read. Try choosing the file again.",
    );
  }
}

// parseDocument throws plain Errors whose messages are ALREADY written for a human — "It may be
// a scan rather than text. Try uploading the text instead." Left alone they reach
// respondToRouteError, which correctly treats an unrecognised Error as a server fault and
// replaces the message with the generic fallback. Translating here is what keeps the sentence
// that tells the uploader what actually went wrong.
async function parseOrRefuse(file: File) {
  try {
    return await parseDocument(file);
  } catch (error) {
    throw new UploadRefusedError(
      error instanceof Error
        ? error.message
        : "That file could not be read. Try a .txt, .md, or .pdf file.",
    );
  }
}

export async function POST(request: Request) {
  const user = await requireSessionUser();

  try {
    const supabase = await createServerSupabaseClient();
    const roleAccess = await resolveRoleAccess(supabase, user.wardId);

    assertCan(user, "knowledge.manage", roleAccess);

    const form = await readFormData(request);
    const file = form.get("file");

    if (!(file instanceof File) || file.size === 0) {
      throw new UploadRefusedError("Choose a file to upload.");
    }

    // SIZE AND TYPE FIRST, before anything reads the file into memory. Checking after parsing
    // means a 40 MB file is fully buffered before being told it was never acceptable.
    if (file.size > MAX_UPLOAD_BYTES) {
      const megabytes = (file.size / (1024 * 1024)).toFixed(1);
      throw new UploadRefusedError(
        `That file is ${megabytes} MB. The limit is ${MAX_UPLOAD_BYTES / (1024 * 1024)} MB — try uploading the text on its own, or split it in two.`,
      );
    }

    const extension = resolveUploadType(file);
    if (extension === null) {
      throw new UploadRefusedError(
        `"${file.name}" is not a file type this can read. Upload a .txt, .md, or .pdf file.`,
      );
    }

    // form.get() returns null for an absent field, and Zod would report that as "expected
    // string, received null" — a developer's sentence, not a bishop's. Coercing to "" lets the
    // schema's own written message ("Give the document a title.") be the one that surfaces.
    const metadata = uploadMetadataSchema.parse({
      title: form.get("title") ?? "",
      typeTag: form.get("typeTag") ?? "",
    });

    // Refuses with an actionable sentence when a PDF turns out to be a scan.
    const parsed = await parseOrRefuse(file);

    const document = await createDocument(
      user.wardId,
      { title: metadata.title, typeTag: metadata.typeTag },
      user.id,
      supabase,
    );

    const storageKey = storageKeyFor(user.wardId, document.id, extension);

    const { error: storageError } = await supabase.storage
      .from(KNOWLEDGE_BUCKET)
      .upload(storageKey, file, { contentType: file.type || undefined, upsert: false });

    // A STORAGE FAILURE DOES FAIL THE REQUEST, and the row is removed before returning. A
    // document row pointing at a file that was never written is worse than no row: it looks
    // ingested, and the provenance the file exists for is silently absent.
    if (storageError) {
      console.error(`Could not store an uploaded document — ${storageError.message}`, {
        wardId: user.wardId,
        documentId: document.id,
      });
      await deleteDocument(user.wardId, document.id, null, supabase);
      throw new Error(`Could not store the uploaded file: ${storageError.message}`);
    }

    await setDocumentFileUrl(user.wardId, document.id, storageKey, supabase);

    const chunks = chunkText(parsed.text);
    const summary = await ingestChunks(user.wardId, document.id, chunks, supabase);

    await writeAuditLog(
      {
        wardId: user.wardId,
        userId: user.id,
        action: "knowledge_document_uploaded",
        module: "knowledge",
        detail: {
          documentId: document.id,
          typeTag: metadata.typeTag,
          chunkCount: summary.chunkCount,
          embeddedCount: summary.embeddedCount,
        },
      },
      supabase,
    );

    // A PARTIAL EMBEDDING FAILURE RETURNS 201, NOT AN ERROR. The document is genuinely usable —
    // most of its passages are searchable — and reporting total failure would make the
    // bishopric re-upload and end up with two copies. `failedChunkIndexes` is populated and the
    // UI says so plainly instead.
    return NextResponse.json(
      {
        document,
        summary: { ...summary, characterCount: parsed.characterCount },
        pageCount: parsed.pageCount,
      },
      { status: 201 },
    );
  } catch (error) {
    // Every uploader-caused refusal — wrong type, too big, a scanned PDF, a blank title, an
    // unreadable body — is a 400 carrying its own written sentence.
    if (error instanceof UploadRefusedError) {
      return NextResponse.json({ error: error.message }, { status: 400 });
    }

    return respondToRouteError(error, {
      route: "POST /api/knowledge/upload",
      fallbackMessage: "Could not add the document. Please try again.",
      detail: { wardId: user.wardId, userId: user.id },
    });
  }
}
