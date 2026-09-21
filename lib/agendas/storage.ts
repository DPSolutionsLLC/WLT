import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/types/database";

// Upload and signed-URL read for the rendered agenda PDF. Every storage call for an agenda goes
// through this module; no route handler talks to supabase.storage directly. The shape follows
// lib/program/storage.ts exactly, and the two places it deliberately differs are marked.

export const AGENDA_BUCKET = "agendas";

// Objects are keyed {ward_id}/{agenda_id}.pdf because migration 064b's policies read the ward from
// the FIRST path segment. A key built any other way is unreachable by its own uploader — the right
// failure, but only if the key is built in exactly one place.
//
// THE AGENDA ID, NOT THE MEETING DATE — the one structural difference from `programs`. A ward
// holds at most one programme per Sunday, so migration 040 could key on the date. A ward can hold
// a bishopric meeting AND a ward council meeting on the same day, and a date key would make the
// second silently overwrite the first.
export function agendaStorageKey(wardId: string, agendaId: string): string {
  return `${wardId}/${agendaId}.pdf`;
}

// SHORTER THAN THE PROGRAMME'S 90 DAYS, and deliberately.
//
// A programme's signed URL is long-lived because a public page links to it for a season. An agenda
// link is emailed to the bishopric and read in the days around one meeting; it names families
// raised for discussion, so a link forwarded outside the ward should stop working sooner rather
// than later. Thirty days covers "can I see last month's agenda" and little more.
//
// After it expires the agenda still opens in the app — only the PDF link 404s, and re-publishing
// re-signs it.
export const AGENDA_PDF_SIGNED_URL_TTL_SECONDS = 30 * 24 * 60 * 60;

export type StoredAgendaPdf = {
  storageKey: string;
  signedUrl: string;
  byteLength: number;
};

// Replaces the object by DELETE-THEN-UPLOAD.
//
// Migration 064b has no UPDATE policy, following 032 and 040, so `upsert: true` is not available:
// it issues an UPDATE, which no policy permits, and it fails with a storage error that reads like
// a permissions bug rather than like a missing policy.
//
// The remove() runs first and its result is IGNORED on purpose — the object usually does not exist
// yet, and "nothing to delete" is the normal first-publish case rather than a failure. A real
// permission problem surfaces on the upload immediately after, where it can be reported properly.
export async function storeAgendaPdf(
  wardId: string,
  agendaId: string,
  pdf: Buffer,
  client: SupabaseClient<Database>,
): Promise<StoredAgendaPdf> {
  const storageKey = agendaStorageKey(wardId, agendaId);

  await client.storage.from(AGENDA_BUCKET).remove([storageKey]);

  const { error: uploadError } = await client.storage
    .from(AGENDA_BUCKET)
    // A Uint8Array view rather than the Node Buffer itself: supabase-js types the body as a
    // browser-compatible union, which Buffer satisfies structurally but not nominally.
    .upload(storageKey, new Uint8Array(pdf), {
      contentType: "application/pdf",
      upsert: false,
    });

  if (uploadError) {
    console.error(`Could not store an agenda PDF — ${uploadError.message}`, { wardId, storageKey });
    throw new Error(`Could not store the generated PDF: ${uploadError.message}`);
  }

  const { data, error: signError } = await client.storage
    .from(AGENDA_BUCKET)
    .createSignedUrl(storageKey, AGENDA_PDF_SIGNED_URL_TTL_SECONDS);

  // A stored file nobody can link to is not a success (rule 7).
  if (signError || !data) {
    console.error(
      `Stored an agenda PDF but could not sign a URL for it — ${signError?.message ?? "no URL returned"}`,
      { wardId, storageKey },
    );
    throw new Error(
      `The PDF was stored but no link could be created for it: ${signError?.message ?? "no URL returned"}`,
    );
  }

  return { storageKey, signedUrl: data.signedUrl, byteLength: pdf.byteLength };
}

// Downloads a stored agenda back into memory, for the email attachment.
//
// The send re-reads the file rather than re-rendering it, so the PDF a ward is emailed is
// BYTE-IDENTICAL to the one behind the link in the app. Re-rendering at send time would leave two
// copies of a document that ought to be one, differing by whatever changed in between.
export async function readAgendaPdf(
  wardId: string,
  agendaId: string,
  client: SupabaseClient<Database>,
): Promise<Buffer> {
  const storageKey = agendaStorageKey(wardId, agendaId);

  const { data, error } = await client.storage.from(AGENDA_BUCKET).download(storageKey);

  if (error || !data) {
    throw new Error(
      `Could not read the stored PDF: ${error?.message ?? "the file is missing"}. ` +
        "Publish the agenda again to regenerate it.",
    );
  }

  return Buffer.from(await data.arrayBuffer());
}
