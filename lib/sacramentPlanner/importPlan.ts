import {
  isPlannerCollection,
  type PlannerCollection,
} from "@/lib/sacramentPlanner/collections";
import { validatePlannerDocument } from "@/lib/sacramentPlanner/documentSchemas";

// Decides what the Slice C import (supabase/scripts/plannerImport.ts) will write, without
// touching a database, so every rule here is testable. ITER-045.

export type ExportedCollections = Record<string, Record<string, unknown>>;

export type SettingsDefaults = {
  bishopric: unknown[];
  rotation: Record<string, unknown>;
};

export type PlannedDocument = {
  collection: PlannerCollection;
  documentId: string;
  data: Record<string, unknown>;
};

export type PlannerImportPlan = {
  documents: PlannedDocument[];
  skippedPracticeCollections: string[];
  addedSettings: string[];
  unknownCollections: string[];
  failures: string[];
};

const PRACTICE_PREFIX = "t_";

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

// The Planner fell back to names written into its own code when the export had no bishopric or
// rotation settings. Those names moved to the gitignored defaults file (Task 2, E1), so the
// import supplies them — but only where the export has nothing, never over what it has.
function missingSettings(
  settings: Record<string, unknown>,
  defaults: SettingsDefaults,
): PlannedDocument[] {
  const added: PlannedDocument[] = [];
  if (!("bishopric" in settings)) {
    added.push({ collection: "settings", documentId: "bishopric", data: { members: defaults.bishopric } });
  }
  if (!("rotation" in settings)) {
    added.push({ collection: "settings", documentId: "rotation", data: { ...defaults.rotation } });
  }
  return added;
}

export function planPlannerImport(
  collections: ExportedCollections,
  defaults: SettingsDefaults,
): PlannerImportPlan {
  const plan: PlannerImportPlan = {
    documents: [],
    skippedPracticeCollections: [],
    addedSettings: [],
    unknownCollections: [],
    failures: [],
  };

  for (const [name, documents] of Object.entries(collections)) {
    if (name.startsWith(PRACTICE_PREFIX)) {
      plan.skippedPracticeCollections.push(name);
      continue;
    }
    if (!isPlannerCollection(name)) {
      plan.unknownCollections.push(name);
      continue;
    }
    if (!isRecord(documents)) {
      plan.failures.push(`The "${name}" collection is not a set of records.`);
      continue;
    }
    for (const [documentId, data] of Object.entries(documents)) {
      if (!isRecord(data)) {
        plan.failures.push(`${name}/${documentId}: the record is not an object.`);
        continue;
      }
      plan.documents.push({ collection: name, documentId, data });
    }
  }

  const settings = isRecord(collections.settings) ? collections.settings : {};
  for (const added of missingSettings(settings, defaults)) {
    plan.documents.push(added);
    plan.addedSettings.push(added.documentId);
  }

  for (const document of plan.documents) {
    const check = validatePlannerDocument("real", document.collection, document.documentId, document.data);
    if (!check.ok) plan.failures.push(`${document.collection}/${document.documentId}: ${check.problem}`);
  }

  return plan;
}

export function countByCollection(
  documents: readonly { collection: string }[],
): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const document of documents) counts[document.collection] = (counts[document.collection] ?? 0) + 1;
  return counts;
}

// Postgres jsonb keeps neither key order nor whitespace, so "the same document" is compared with
// keys sorted at every level.
export function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (isRecord(value)) {
    const keys = Object.keys(value).sort();
    return `{${keys.map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`).join(",")}}`;
  }
  return JSON.stringify(value);
}
