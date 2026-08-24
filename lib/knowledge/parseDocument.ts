import { extractText } from "unpdf";
import {
  MAX_UPLOAD_BYTES,
  type SupportedUploadExtension,
} from "@/types/domain";

// Re-exported so server callers read the limit from the module that enforces it, while
// UploadForm — a client component — imports the same constant from types/domain.ts without
// pulling unpdf into the browser bundle. One number, two import paths, no second copy.
export { MAX_UPLOAD_BYTES };

export const SUPPORTED_MIME_TYPES: Record<string, SupportedUploadExtension> = {
  "text/plain": "txt",
  "text/markdown": "md",
  "text/x-markdown": "md",
  "application/pdf": "pdf",
};

// Browsers disagree about the MIME type of `.md` — Chrome sends "text/markdown", Safari has
// sent "" and "application/octet-stream". Dispatching on the extension as well is what keeps a
// perfectly ordinary markdown file from being refused on one browser and accepted on another.
const EXTENSION_TYPES: Record<string, SupportedUploadExtension> = {
  txt: "txt",
  text: "txt",
  md: "md",
  markdown: "md",
  pdf: "pdf",
};

// Below this, a PDF is almost certainly a scan rather than text. Chosen well under a real
// document and well over the handful of characters a scanned page's stray OCR layer yields.
const MINIMUM_USEFUL_CHARACTERS = 200;

export type ParsedDocument = {
  text: string;
  characterCount: number;
  pageCount: number | null;
};

export function extensionOf(fileName: string): string {
  const lastDot = fileName.lastIndexOf(".");
  if (lastDot === -1 || lastDot === fileName.length - 1) return "";
  return fileName.slice(lastDot + 1).toLowerCase();
}

// Extension first, MIME second. Returns null when neither identifies a supported type, so the
// caller can write its own message naming what it accepts.
export function resolveUploadType(file: File): SupportedUploadExtension | null {
  const byExtension = EXTENSION_TYPES[extensionOf(file.name)];
  if (byExtension) return byExtension;

  const byMime = SUPPORTED_MIME_TYPES[file.type.split(";")[0].trim().toLowerCase()];
  return byMime ?? null;
}

// A PDF whose first bytes are not %PDF- is something else wearing a .pdf name. Sniffed rather
// than trusted so unpdf is never handed a text file to choke on.
function looksLikePdf(bytes: Uint8Array): boolean {
  return (
    bytes.length >= 5 &&
    bytes[0] === 0x25 && // %
    bytes[1] === 0x50 && // P
    bytes[2] === 0x44 && // D
    bytes[3] === 0x46 && // F
    bytes[4] === 0x2d //   -
  );
}

async function parsePdf(bytes: Uint8Array): Promise<ParsedDocument> {
  if (!looksLikePdf(bytes)) {
    throw new Error(
      "This file is named .pdf but does not look like a PDF inside. Try uploading it again, or save it as plain text.",
    );
  }

  // `mergePages: true` is the overload that returns `text` as a single string rather than one
  // entry per page. Verified against unpdf 1.8.1's own type declarations, not from memory.
  const { text, totalPages } = await extractText(bytes, { mergePages: true });

  return { text, characterCount: text.length, pageCount: totalPages };
}

// Markdown is ingested AS-IS, not stripped. The heading structure is signal — it is what makes
// paragraph-boundary chunking land in sensible places — and the model reads it fine.
export async function parseDocument(file: File): Promise<ParsedDocument> {
  const type = resolveUploadType(file);

  if (type === null) {
    throw new Error(
      `"${file.name}" is not a file type this can read. Upload a .txt, .md, or .pdf file.`,
    );
  }

  const parsed =
    type === "pdf"
      ? await parsePdf(new Uint8Array(await file.arrayBuffer()))
      : await (async () => {
          const text = await file.text();
          return { text, characterCount: text.length, pageCount: null };
        })();

  const trimmed = parsed.text.trim();

  // A parse that yields almost nothing is REFUSED rather than ingested. Silently accepting it
  // creates a document row, zero useful passages, and a bishopric who believe their corpus
  // contains something it does not — a failure they would discover weeks later through bad
  // retrieval, if at all.
  if (trimmed.length < MINIMUM_USEFUL_CHARACTERS) {
    throw new Error(
      type === "pdf"
        ? `Only ${trimmed.length} characters of text could be read from this PDF. It may be a scan rather than text. Try uploading the text instead.`
        : `Only ${trimmed.length} characters of text could be read from this file. It may be empty. Check the file and try again.`,
    );
  }

  return { text: trimmed, characterCount: trimmed.length, pageCount: parsed.pageCount };
}
