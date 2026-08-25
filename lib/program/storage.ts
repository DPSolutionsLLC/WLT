import type { SupabaseClient } from "@supabase/supabase-js";
import type { DateOnly } from "@/lib/calendar/dates";
import type { Database } from "@/types/database";

// Upload and signed-URL read for the rendered bifold PDF. Every storage call for a programme goes
// through this module; no route handler talks to supabase.storage directly.

export const PROGRAM_BUCKET = "programs";

// Objects are keyed {ward_id}/{sunday_date}.pdf because migration 040's policies read the ward
// from the FIRST path segment. A key built any other way is unreachable by its own uploader —
// which is the right failure, but only if the key is built in exactly one place.
//
// The SUNDAY DATE rather than the programme id, so a ward browsing its own bucket sees dates. One
// programme per Sunday is already guaranteed by lib/program/queries.ts, so this is unique.
export function programStorageKey(wardId: string, sundayDate: DateOnly): string {
  return `${wardId}/${sundayDate}.pdf`;
}

// ---------------------------------------------------------------------------------------------
// WHY pdf_url HOLDS A SIGNED URL AND NOT THE STORAGE KEY
// ---------------------------------------------------------------------------------------------
// /public/[slug] renders pdf_url straight into an href (app/public/[slug]/ProgramPanel.tsx). A
// bare storage key would be a broken relative link, and a public bucket was rejected in migration
// 040 — so the third option is what the plan sanctions: a signed URL with a BOUNDED lifetime.
//
// 90 days. Long enough to cover the Sunday the programme was printed for and a season of "can I
// see last month's programme", short enough that a link forwarded outside the ward does not work
// forever. It expires rather than being permanent, which is the whole point of bounding it.
//
// After it expires the public page still renders the full programme; only the PDF link 404s.
// Regenerating the PDF re-signs, so the path a ward actually uses stays fresh.
//
// A signed URL signs the PATH, not a particular version of the object, so a regenerated programme
// is served by a URL minted before it. That is the behaviour we want: the link on a distributed
// page keeps working and shows the current file.
export const PDF_SIGNED_URL_TTL_SECONDS = 90 * 24 * 60 * 60;

export type StoredProgramPdf = {
  storageKey: string;
  signedUrl: string;
  byteLength: number;
};

// Replaces the object by DELETE-THEN-UPLOAD.
//
// Migration 040 has no UPDATE policy, following migration 032's reasoning, so `upsert: true` is
// not available: it issues an UPDATE, which no policy permits, and it fails with a storage error
// that reads like a permissions bug rather than like a missing policy.
//
// The remove() runs first and its result is IGNORED on purpose — the object usually does not exist
// yet, and "nothing to delete" is the normal first-generation case rather than a failure. A real
// permission problem surfaces on the upload immediately after, where it can be reported properly.
export async function storeProgramPdf(
  wardId: string,
  sundayDate: DateOnly,
  pdf: Buffer,
  client: SupabaseClient<Database>,
): Promise<StoredProgramPdf> {
  const storageKey = programStorageKey(wardId, sundayDate);

  await client.storage.from(PROGRAM_BUCKET).remove([storageKey]);

  const { error: uploadError } = await client.storage
    .from(PROGRAM_BUCKET)
    // A Uint8Array view of the buffer rather than the Node Buffer itself: supabase-js types the
    // body as a browser-compatible union, and Buffer satisfies it structurally but not nominally.
    .upload(storageKey, new Uint8Array(pdf), {
      contentType: "application/pdf",
      upsert: false,
    });

  if (uploadError) {
    console.error(`Could not store a programme PDF — ${uploadError.message}`, {
      wardId,
      storageKey,
    });
    throw new Error(`Could not store the generated PDF: ${uploadError.message}`);
  }

  const { data, error: signError } = await client.storage
    .from(PROGRAM_BUCKET)
    .createSignedUrl(storageKey, PDF_SIGNED_URL_TTL_SECONDS);

  // A stored file nobody can link to is not a success. Surfaced rather than returning the key and
  // letting the public page render a broken href (CLAUDE.md rule 7).
  if (signError || !data) {
    console.error(
      `Stored a programme PDF but could not sign a URL for it — ${signError?.message ?? "no URL returned"}`,
      { wardId, storageKey },
    );
    throw new Error(
      `The PDF was stored but no link could be created for it: ${signError?.message ?? "no URL returned"}`,
    );
  }

  return { storageKey, signedUrl: data.signedUrl, byteLength: pdf.byteLength };
}

// Downloads a stored programme back into memory, for the email attachment.
//
// Distribution re-reads the file rather than re-rendering it, so the PDF a ward is emailed is
// BYTE-IDENTICAL to the one they proofread and to the one behind the public link. Re-rendering at
// send time would leave three copies of a programme that ought to be one object, differing by
// whatever changed in between.
export async function readProgramPdf(
  wardId: string,
  sundayDate: DateOnly,
  client: SupabaseClient<Database>,
): Promise<Buffer> {
  const storageKey = programStorageKey(wardId, sundayDate);

  const { data, error } = await client.storage.from(PROGRAM_BUCKET).download(storageKey);

  if (error || !data) {
    console.error(
      `Could not read a stored programme PDF — ${error?.message ?? "no file returned"}`,
      { wardId, storageKey },
    );
    throw new Error(
      `Could not read the stored PDF: ${error?.message ?? "no file was returned"}`,
    );
  }

  return Buffer.from(await data.arrayBuffer());
}
