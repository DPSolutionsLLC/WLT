import { z } from "zod";
import {
  PLANNER_COLLECTIONS,
  PLANNER_LAYERS,
  SETTINGS_DOCUMENT_IDS,
  type PlannerCollection,
  type PlannerLayer,
} from "@/lib/sacramentPlanner/collections";

// What the Planner may store, checked at the boundary (the documents route) and by the import
// script, so both refuse the same things.
//
// THE CHECK IS DELIBERATELY THIN. The Planner owns the shape of its documents and its rules run in
// the browser (D1). What is checked here is only what would break the Planner on read: the id it
// keys the document by, and the one or two fields its loaders read before anything else
// (`APPLY` in assets/body.html). Every other field is kept exactly as written — the caller stores
// the original object, never a parsed copy, and every schema is loose so nothing is stripped.

export const MAX_DOCUMENT_CHARACTERS = 200_000;

// Widened to what is really there: every id in the 2026-10-23 export and every agenda row id fits
// it. Hash ids are `k<hex>-<n>`, practice and consider ids are base 36, row ids carry letters and
// dashes, and marks join a name and a hash with `|`.
const DOCUMENT_ID_PATTERN = /^[A-Za-z0-9_.:|-]{1,200}$/;
const SUNDAY_ID_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

const named = z.looseObject({ name: z.string() });

const DOCUMENT_SHAPES: Record<PlannerCollection, z.ZodType> = {
  sundays: z.looseObject({ date: z.string() }),
  deferrals: named,
  considers: z.looseObject({ name: z.string(), kind: z.string() }),
  nameFixes: z.looseObject({ key: z.string(), person: z.string() }),
  rowFixes: z.looseObject({}),
  goesBy: named,
  marks: z.looseObject({ name: z.string(), by: z.string() }),
  holds: named,
  people: named,
  settings: z.looseObject({}),
};

const documentIdSchema = z.string().min(1).max(200);

export const plannerDocumentRefSchema = z.object({
  layer: z.enum(PLANNER_LAYERS),
  collection: z.enum(PLANNER_COLLECTIONS),
  documentId: documentIdSchema,
});

export const plannerWriteSchema = plannerDocumentRefSchema.extend({
  data: z.record(z.string(), z.unknown()),
});

export type PlannerDocumentRef = z.infer<typeof plannerDocumentRefSchema>;
export type PlannerWrite = z.infer<typeof plannerWriteSchema>;

export type PlannerDocumentCheck = { ok: true } | { ok: false; problem: string };

// The Planner's practice layer hides a real document with this marker instead of deleting it
// (practiceDb() in assets/body.html), so it is valid in practice and nowhere else.
function isPracticeDeleteMarker(data: Record<string, unknown>): boolean {
  return data.__del === true && Object.keys(data).length === 1;
}

export function checkPlannerDocumentId(
  collection: PlannerCollection,
  documentId: string,
): PlannerDocumentCheck {
  if (collection === "sundays") {
    return SUNDAY_ID_PATTERN.test(documentId)
      ? { ok: true }
      : { ok: false, problem: `A Sunday is saved under its date, and "${documentId}" is not one.` };
  }

  if (collection === "settings") {
    return (SETTINGS_DOCUMENT_IDS as readonly string[]).includes(documentId)
      ? { ok: true }
      : { ok: false, problem: `"${documentId}" is not one of the Planner's settings.` };
  }

  return DOCUMENT_ID_PATTERN.test(documentId)
    ? { ok: true }
    : { ok: false, problem: `"${documentId}" is not a document id the Planner uses.` };
}

export function validatePlannerDocument(
  layer: PlannerLayer,
  collection: PlannerCollection,
  documentId: string,
  data: Record<string, unknown>,
): PlannerDocumentCheck {
  const idCheck = checkPlannerDocumentId(collection, documentId);
  if (!idCheck.ok) return idCheck;

  if (JSON.stringify(data).length > MAX_DOCUMENT_CHARACTERS) {
    return { ok: false, problem: "That record is too large to save. Try removing some of it." };
  }

  if (layer === "practice" && isPracticeDeleteMarker(data)) return { ok: true };

  const parsed = DOCUMENT_SHAPES[collection].safeParse(data);
  if (!parsed.success) {
    const field = parsed.error.issues[0]?.path.join(".") || "a field";
    return {
      ok: false,
      problem: `This ${collection} record is missing ${field}, so the Planner could not read it.`,
    };
  }

  if (collection === "sundays" && data.date !== documentId) {
    return { ok: false, problem: "A Sunday's date must match the date it is saved under." };
  }

  return { ok: true };
}
