import { createHash } from "node:crypto";
import {
  describeMissingFields,
  missingRequiredFields,
  suggestMapping,
  type ColumnMapping,
} from "@/lib/roster/csv/columnMapping";
import {
  ACCEPTED_MIME_TYPES,
  MAX_IMPORT_FILE_BYTES,
  MAX_IMPORT_ROWS,
  MAX_REPLACEMENT_CHARACTERS,
  formatFileSizeLimit,
  hasAcceptedExtension,
} from "@/lib/roster/csv/limits";
import { normalizeRows, type NormalizedRow, type RowProblem } from "@/lib/roster/csv/normalizeRow";
import { isCsvLimitError, parseCsvStream } from "@/lib/roster/csv/parseCsv";
import { columnMappingSchema } from "@/lib/validation/rosterImport";

// Steps 3–8 of roster-c-csv-import.md Task 7, which are identical in the preview route and the
// import route. They are here rather than copied into both because the two halves of a
// preview-then-confirm flow disagreeing about what the file contains is precisely the failure
// Decision 2 exists to prevent — and two copies of a parse-and-map sequence is how they start
// to disagree.
//
// Server-only: node:crypto. The parser itself imports nothing and runs in the browser too.

export class ImportRequestError extends Error {
  readonly status: number;

  constructor(status: number, message: string) {
    super(message);
    this.name = "ImportRequestError";
    this.status = status;
  }
}

export function isImportRequestError(error: unknown): error is ImportRequestError {
  return error instanceof ImportRequestError;
}

export type ImportRequestFields = {
  file: File;
  mapping: ColumnMapping | null;
  fileHash: string | null;
};

export type ReadImportFileResult = {
  headers: string[];
  mapping: ColumnMapping;
  fileHash: string;
  normalized: NormalizedRow[];
  problems: RowProblem[];
  totalFileRows: number;
  sampleRow: string[];
};

// request.formData() throws on a malformed multipart body, and an unhandled throw here is a 500
// that reads as the server's fault for someone else's bad upload — the same reasoning
// readJsonBody() applies to JSON (plans/retros/auth-b-invites-admin.md).
export async function readImportFormData(request: Request): Promise<ImportRequestFields> {
  let formData: FormData;

  try {
    formData = await request.formData();
  } catch (error) {
    // Logged with the underlying reason in the MESSAGE, not only in the payload object — Next's
    // dev logger renders an object argument as `{}` (plans/retros/auth-b-invites-admin.md).
    const description =
      error instanceof Error ? `${error.name}: ${error.message}` : String(error);
    console.error(`Could not read the roster import upload — ${description}`);

    throw new ImportRequestError(
      400,
      "That upload could not be read. Choose the file again and retry.",
    );
  }

  const file = formData.get("file");

  if (!(file instanceof File)) {
    throw new ImportRequestError(400, "Choose a CSV file to import.");
  }

  const rawMapping = formData.get("mapping");
  let mapping: ColumnMapping | null = null;

  if (typeof rawMapping === "string" && rawMapping !== "") {
    let parsed: unknown;

    try {
      parsed = JSON.parse(rawMapping);
    } catch {
      throw new ImportRequestError(
        400,
        "The column mapping could not be read. Go back to the mapping step and continue again.",
      );
    }

    mapping = columnMappingSchema.parse(parsed);
  }

  const rawFileHash = formData.get("fileHash");
  const fileHash = typeof rawFileHash === "string" && rawFileHash !== "" ? rawFileHash : null;

  return { file, mapping, fileHash };
}

// Checked BEFORE a byte is read. A 400 that arrives after a 40MB upload has been streamed and
// parsed is a refusal the user has already paid for.
export function assertAcceptableFile(file: File): void {
  const type = file.type.toLowerCase();

  // An empty type is accepted: some browsers send nothing at all for a .csv, and the extension
  // check plus the parse are what actually decide. MIME is a hint, never a guarantee.
  if (type !== "" && !(ACCEPTED_MIME_TYPES as readonly string[]).includes(type)) {
    throw new ImportRequestError(
      400,
      "That is not a CSV file. Export your roster from LCR as CSV and try again.",
    );
  }

  if (!hasAcceptedExtension(file.name)) {
    throw new ImportRequestError(
      400,
      "That file is not a .csv. Export your roster from LCR as CSV and try again.",
    );
  }

  if (file.size > MAX_IMPORT_FILE_BYTES) {
    throw new ImportRequestError(
      413,
      `That file is larger than ${formatFileSizeLimit()}. Split the export and import it in parts.`,
    );
  }
}

// A mapping built against a different file points at columns this one does not have. Silently
// reading them as empty would report every row as missing a required field, which names the
// symptom and hides the cause.
function assertMappingFitsFile(
  mapping: ColumnMapping,
  headers: readonly string[],
): void {
  const pointsPastTheFile = Object.values(mapping).some(
    (index) => index >= headers.length,
  );

  if (pointsPastTheFile) {
    throw new ImportRequestError(
      400,
      "The column mapping does not match this file. Go back and map the columns again.",
    );
  }
}

export async function readImportFile(
  file: File,
  suppliedMapping: ColumnMapping | null,
): Promise<ReadImportFileResult> {
  const hash = createHash("sha256");

  let parsed;

  try {
    parsed = await parseCsvStream(file.stream(), {
      maxRows: MAX_IMPORT_ROWS,
      maxBytes: MAX_IMPORT_FILE_BYTES,
      onDecodedChunk: (text) => hash.update(text, "utf8"),
    });
  } catch (error) {
    if (isCsvLimitError(error)) {
      throw new ImportRequestError(
        413,
        error.kind === "rows"
          ? `This file has more than ${MAX_IMPORT_ROWS} rows. Split the export and import it in parts.`
          : `That file is larger than ${formatFileSizeLimit()}. Split the export and import it in parts.`,
      );
    }
    throw error;
  }

  if (parsed.headers.length === 0) {
    throw new ImportRequestError(
      400,
      "That file has no header row. The first line of an LCR export names the columns.",
    );
  }

  // Decision 4. Windows-1252 decoded as UTF-8 does not throw — it yields U+FFFD, and "Sørensen"
  // becomes "S?rensen" with no error anywhere. Importing a corrupted name is worse than refusing
  // the file, because the corruption is then in the roster every other module reads from.
  if (parsed.replacementCharacterCount > MAX_REPLACEMENT_CHARACTERS) {
    throw new ImportRequestError(
      400,
      "This file is not saved as UTF-8, so accented names would import corrupted. Re-save the " +
        "export as CSV UTF-8 and try again.",
    );
  }

  const mapping = suppliedMapping ?? suggestMapping(parsed.headers);
  assertMappingFitsFile(mapping, parsed.headers);

  const missing = missingRequiredFields(mapping);
  if (missing.length > 0) {
    throw new ImportRequestError(400, describeMissingFields(missing, parsed.headers));
  }

  const normalized = normalizeRows(parsed.rows, mapping, parsed.rowNumbers);

  return {
    headers: parsed.headers,
    mapping,
    fileHash: hash.digest("hex"),
    normalized: normalized.rows,
    // The parser's problems first: a row the parser could not split is the reason the same row
    // then failed normalization, and reading them the other way round hides the cause.
    problems: [...parsed.problems, ...normalized.problems],
    totalFileRows: parsed.rowCount,
    sampleRow: parsed.rows[0] ?? [],
  };
}
