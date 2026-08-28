import { createHash } from "node:crypto";
import {
  ACCEPTED_MIME_TYPES,
  MAX_ICS_FILE_BYTES,
  formatFileSizeLimit,
  hasAcceptedExtension,
} from "@/lib/youth/ics/limits";
import {
  isIcsParseError,
  parseIcs,
  type IcsOccurrence,
  type IcsProblem,
} from "@/lib/youth/ics/parseIcs";
import { profileIdSchema } from "@/lib/validation/youthImport";

// Everything the preview route and the confirm route must do IDENTICALLY, in one module rather
// than copied into both — for the reason lib/roster/csv/importRequest.ts gives in as many words:
// "the two halves of a preview-then-confirm flow disagreeing about what the file contains is
// precisely the failure this exists to prevent."
//
// SERVER-ONLY: node:crypto, and parseIcs.ts is server-only for the same reason.

export class IcsImportError extends Error {
  readonly status: number;

  constructor(status: number, message: string) {
    super(message);
    this.name = "IcsImportError";
    this.status = status;
  }
}

export function isIcsImportError(error: unknown): error is IcsImportError {
  return error instanceof IcsImportError;
}

export type IcsImportFields = {
  file: File;
  profileId: string;
  fileHash: string | null;
};

export type ReadIcsFileResult = {
  fileHash: string;
  occurrences: IcsOccurrence[];
  problems: IcsProblem[];
  occurrencesDropped: number;
};

// request.formData() throws on a malformed multipart body, and an unhandled throw here is a 500
// that reads as the server's fault for somebody else's bad upload — the same reasoning
// readJsonBody() applies to JSON (plans/retros/auth-b-invites-admin.md).
export async function readIcsFormData(request: Request): Promise<IcsImportFields> {
  let formData: FormData;

  try {
    formData = await request.formData();
  } catch (error) {
    // Logged with the underlying reason IN THE MESSAGE, not only as an object argument — Next's
    // dev logger renders an object argument as `{}` (plans/retros/auth-b-invites-admin.md).
    const description = error instanceof Error ? `${error.name}: ${error.message}` : String(error);
    console.error(`Could not read the youth calendar upload — ${description}`);

    throw new IcsImportError(
      400,
      "That upload could not be read. Choose the file again and retry.",
    );
  }

  const file = formData.get("file");

  if (!(file instanceof File)) {
    throw new IcsImportError(400, "Choose a calendar file to import.");
  }

  const rawProfileId = formData.get("profileId");
  const parsedProfileId = profileIdSchema.safeParse(
    typeof rawProfileId === "string" ? rawProfileId : undefined,
  );

  if (!parsedProfileId.success) {
    throw new IcsImportError(
      400,
      parsedProfileId.error.issues[0]?.message ??
        "Choose which activity this schedule belongs to.",
    );
  }

  const rawFileHash = formData.get("fileHash");
  const fileHash = typeof rawFileHash === "string" && rawFileHash !== "" ? rawFileHash : null;

  return { file, profileId: parsedProfileId.data, fileHash };
}

// Checked BEFORE A BYTE IS READ. A 413 that arrives after a full upload has been streamed is a
// refusal the user has already paid for.
export function assertAcceptableIcsFile(file: File): void {
  const type = file.type.toLowerCase();

  // An empty type is accepted deliberately: browsers frequently send nothing at all for a .ics,
  // and Windows commonly reports application/octet-stream. MIME is a hint; the extension is
  // checked next and the parse is the real guard.
  if (!(ACCEPTED_MIME_TYPES as readonly string[]).includes(type)) {
    throw new IcsImportError(
      400,
      "That is not a calendar file. Export the schedule as .ics and try again.",
    );
  }

  if (!hasAcceptedExtension(file.name)) {
    throw new IcsImportError(
      400,
      "That file is not a .ics. Export the schedule from the school or league calendar and try " +
        "again.",
    );
  }

  if (file.size > MAX_ICS_FILE_BYTES) {
    throw new IcsImportError(
      413,
      `That file is larger than ${formatFileSizeLimit()}. Export one season at a time.`,
    );
  }
}

// Read once, hashed once, parsed once. The hash is over the DECODED TEXT rather than the raw
// bytes, so a file re-saved with a different line ending between preview and confirm still reads
// as the same file — the check is meant to catch an EDIT, not a re-save.
export async function readIcsFile(
  file: File,
  options: { asOf: Date; wardTimeZone: string },
): Promise<ReadIcsFileResult> {
  const text = await file.text();
  const fileHash = createHash("sha256").update(text, "utf8").digest("hex");

  try {
    const parsed = parseIcs(text, options);

    return {
      fileHash,
      occurrences: parsed.occurrences,
      problems: parsed.problems,
      occurrencesDropped: parsed.occurrencesDropped,
    };
  } catch (error) {
    // A file this app cannot read is a 400 with the parser's own sentence, never a 500. The
    // sentence names the likely cause, which is the precedent parseDocument() set for PDFs.
    if (isIcsParseError(error)) throw new IcsImportError(400, error.message);
    throw error;
  }
}
