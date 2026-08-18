import { z } from "zod";

// No wardId on any schema here, ever — it comes from the session (conventions.md §Validation).
//
// These schemas check SHAPE only. Whether a column index exists in the uploaded file, and
// whether the required fields are mapped, are checked in lib/roster/csv/importRequest.ts where
// the headers are known — and reported with explicit named messages, because Zod's default text
// names no field and a mapping refusal that names nothing is unactionable
// (plans/retros/auth-b-invites-admin.md).

const columnIndexSchema = z
  .number()
  .int("Choose a column from the list.")
  .min(0, "Choose a column from the list.")
  .max(999, "That column number is not in this file.");

// Written out field by field rather than derived from IMPORT_FIELDS. A generated shape is one
// line shorter and unreadable in an error message, and this object is what a malformed request
// gets measured against.
export const columnMappingSchema = z.object({
  firstName: columnIndexSchema.optional(),
  lastName: columnIndexSchema.optional(),
  familyName: columnIndexSchema.optional(),
  address: columnIndexSchema.optional(),
  category: columnIndexSchema.optional(),
  gender: columnIndexSchema.optional(),
  phone: columnIndexSchema.optional(),
});

// Keep this object in step with IMPORT_FIELDS. A field added there and missed here is not a
// compile error — it is a column the route quietly refuses to accept, which shows up as a
// mapping the user set and the server ignored.
export type ColumnMappingInput = z.infer<typeof columnMappingSchema>;

// Decision 2: confirm re-uploads the same file and the server re-derives everything from it, so
// the only thing carried across from the preview is a hash proving it is the same file.
export const fileHashSchema = z
  .string()
  .regex(
    /^[0-9a-f]{64}$/,
    "That preview is no longer valid. Preview the file again before importing.",
  );
