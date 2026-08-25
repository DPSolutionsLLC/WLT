import { renderToBuffer } from "@react-pdf/renderer";
import { ProgramDocument } from "@/lib/pdf/ProgramDocument";
import { resolveTheme } from "@/lib/pdf/theme";
import type { ProgramDraft } from "@/lib/program/draft";
import type { ProgramTemplate } from "@/lib/program/gather";

// THE ONLY FILE IN THIS APP THAT CALLS renderToBuffer.
//
// One entry point keeps the cold-start cost in one place. @react-pdf/renderer is a large
// dependency that pulls in a layout engine and a font subsystem, and the first call in a serverless
// instance pays for all of it — several seconds is normal on Vercel. Two entry points would mean
// two places to reason about that, and two places for a preview path to grow into.
//
// RENDER ON APPROVAL AND ON EXPLICIT REQUEST, NEVER ON EVERY PREVIEW. program-b shows an HTML
// preview during editing precisely so that this is not on the keystroke path
// (components/program/ProgramPreview.tsx).
//
// SERVER-ONLY. The same `typeof window` guard lib/ai/client.ts and lib/supabase/service.ts use —
// this repo's established pattern, rather than the `server-only` package, which is not a
// dependency here. A PDF renderer reaching a client bundle is a large regression that nothing
// else in the build would catch.
if (typeof window !== "undefined") {
  throw new Error(
    "lib/pdf/renderProgram.ts was imported into browser code. @react-pdf/renderer is a server-side " +
      "renderer and must never reach a client bundle.",
  );
}

// A cover image that takes longer than this is not worth the programme waiting for. The render
// continues without it and says so.
const COVER_FETCH_TIMEOUT_MS = 5000;

// 2 MB. A ward cover image larger than this is a photograph nobody resized, and embedding it as a
// base64 data URI inflates it by a third before it even reaches the PDF.
const COVER_MAX_BYTES = 2 * 1024 * 1024;

const SUPPORTED_COVER_TYPES = ["image/png", "image/jpeg"] as const;

export type ProgramRenderResult = {
  buffer: Buffer;
  // Everything that went differently from what the ward configured. NOT errors — the PDF rendered
  // — but not silent either (CLAUDE.md rule 7). The route surfaces these so a cover image that
  // never appears has a sentence attached rather than being a mystery.
  warnings: string[];
};

// @react-pdf/renderer's <Image> takes a URL, but resolving one INSIDE the render means a network
// call in the middle of a cold start, with no timeout and no error anybody sees. Fetched here
// instead, to a data URI, so the render itself touches nothing but memory.
//
// A FAILURE HERE DOES NOT FAIL THE PROGRAMME. A missing cover picture is a cosmetic difference; a
// refused PDF on a Saturday night is not. The warning carries the reason.
async function fetchCoverImage(
  coverImageUrl: string | null,
): Promise<{ dataUri: string | null; warning: string | null }> {
  if (coverImageUrl === null || coverImageUrl.trim() === "") {
    return { dataUri: null, warning: null };
  }

  const url = coverImageUrl.trim();

  // A storage KEY rather than an absolute URL cannot be fetched, and would otherwise fail as an
  // opaque "Failed to parse URL". Named plainly, because the fix is to store a full URL.
  if (!/^https?:\/\//i.test(url)) {
    return {
      dataUri: null,
      warning: `The ward's cover image ("${url}") is not a full https:// address, so the programme was printed without it.`,
    };
  }

  try {
    const response = await fetch(url, {
      signal: AbortSignal.timeout(COVER_FETCH_TIMEOUT_MS),
    });

    if (!response.ok) {
      return {
        dataUri: null,
        warning: `The ward's cover image could not be downloaded (${response.status}), so the programme was printed without it.`,
      };
    }

    const contentType = (response.headers.get("content-type") ?? "").split(";")[0].trim();

    // @react-pdf/renderer renders PNG and JPG and nothing else. An SVG or a WebP would reach the
    // renderer and throw there, taking the whole programme with it.
    if (!(SUPPORTED_COVER_TYPES as readonly string[]).includes(contentType)) {
      return {
        dataUri: null,
        warning: `The ward's cover image is a ${contentType || "unknown"} file. The programme prints PNG and JPEG only, so it was printed without it.`,
      };
    }

    const bytes = Buffer.from(await response.arrayBuffer());

    if (bytes.byteLength > COVER_MAX_BYTES) {
      return {
        dataUri: null,
        warning: `The ward's cover image is ${Math.round(bytes.byteLength / 1024)} KB, over the 2 MB limit, so the programme was printed without it.`,
      };
    }

    return { dataUri: `data:${contentType};base64,${bytes.toString("base64")}`, warning: null };
  } catch (error) {
    // Caught and REPORTED, never swallowed. The cause goes to the server log; the ward gets a
    // sentence naming what is missing and why.
    console.error(
      `Could not fetch a programme cover image — ${error instanceof Error ? error.message : String(error)}`,
      { coverImageUrl: url },
    );
    return {
      dataUri: null,
      warning:
        "The ward's cover image could not be downloaded, so the programme was printed without it.",
    };
  }
}

export type RenderProgramParams = {
  draft: ProgramDraft;
  template: ProgramTemplate;
  // The ward row's own name, used when program_template.ward_name has not been configured.
  fallbackWardName: string;
  // Both null when the programme has no public page yet. The back panel then prints no QR block
  // at all rather than a code pointing nowhere.
  qrDataUri: string | null;
  publicUrl: string | null;
};

export async function renderProgramPdf({
  draft,
  template,
  fallbackWardName,
  qrDataUri,
  publicUrl,
}: RenderProgramParams): Promise<ProgramRenderResult> {
  const theme = resolveTheme(template, fallbackWardName);
  const cover = await fetchCoverImage(template.coverImageUrl);

  const warnings = [theme.colorRejectedReason, cover.warning].filter(
    (warning): warning is string => warning !== null,
  );

  const buffer = await renderToBuffer(
    <ProgramDocument
      draft={draft}
      theme={theme}
      coverImage={cover.dataUri}
      qrDataUri={qrDataUri}
      publicUrl={publicUrl}
    />,
  );

  return { buffer, warnings };
}
