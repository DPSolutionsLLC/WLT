export const PLANNER_COLLECTIONS = [
  "sundays",
  "deferrals",
  "considers",
  "nameFixes",
  "rowFixes",
  "goesBy",
  "marks",
  "holds",
  "people",
  "settings",
] as const;

export type PlannerCollection = (typeof PLANNER_COLLECTIONS)[number];

export const PLANNER_LAYERS = ["real", "practice"] as const;

export type PlannerLayer = (typeof PLANNER_LAYERS)[number];

export type PlannerCollectionRef = {
  layer: PlannerLayer;
  collection: PlannerCollection;
};

export const SETTINGS_DOCUMENT_IDS = [
  "bishopric",
  "rotation",
  "contacts",
  "autoRelease",
  "topics",
] as const;

export type SettingsDocumentId = (typeof SETTINGS_DOCUMENT_IDS)[number];

const PRACTICE_PREFIX = "t_";

export function isPlannerCollection(value: string): value is PlannerCollection {
  return (PLANNER_COLLECTIONS as readonly string[]).includes(value);
}

// The Planner names its practice copy of a collection `t_<name>`. Here that is a layer, so the
// rows live in one table and "Clear test changes" stays a delete of the practice layer.
export function parseCollectionName(name: string): PlannerCollectionRef {
  const isPractice = name.startsWith(PRACTICE_PREFIX);
  const bare = isPractice ? name.slice(PRACTICE_PREFIX.length) : name;

  if (!isPlannerCollection(bare)) {
    throw new Error(`"${name}" is not a Sacrament Planner collection.`);
  }

  return { layer: isPractice ? "practice" : "real", collection: bare };
}

export function collectionNameFor(ref: PlannerCollectionRef): string {
  return ref.layer === "practice" ? `${PRACTICE_PREFIX}${ref.collection}` : ref.collection;
}
