import { readFileSync } from "node:fs";
import path from "node:path";

// The Sacrament Planner is one HTML document run in an iframe, so nothing renders it in Vitest.
// Its pure slot rules sit between two marker lines in body.html; this slices that block out and
// runs it, handing in the only three page helpers the block is allowed to use.

export type PlannerSlot = {
  id: string;
  role: string;
  name?: string;
  topic?: string;
  status?: string;
  number?: string;
  title?: string;
  performer?: string;
  refs?: { url: string; label?: string }[];
  history?: { name: string; at: string; reason?: string }[];
  past?: { name: string; at: string; status?: string }[];
};

export type PlaceRefusal = "already" | "prayersFull" | "talksFull";
export type PlaceResult = { ok: true; slots: PlannerSlot[] } | { ok: false; reason: PlaceRefusal };
export type SlotFill = {
  filled: number;
  total: number;
  people: { role: string; name: string; status: string }[];
};

export type PlannerSlotRules = {
  isEmptyWork(slot: PlannerSlot): boolean;
  placeIntoSlots(
    slots: PlannerSlot[],
    name: string,
    kind: "talk" | "prayer",
    topic: string,
    whenFull: "add" | "warn",
  ): PlaceResult;
  withoutLoneRestHymn(slots: PlannerSlot[]): PlannerSlot[];
  withoutEmptySpeakers(slots: PlannerSlot[]): PlannerSlot[];
  withDefaultSpeakers(slots: PlannerSlot[]): PlannerSlot[];
  withRestHymnIfTwoSpeakers(slots: PlannerSlot[]): PlannerSlot[];
  withSpeakerAdded(slots: PlannerSlot[]): PlannerSlot[];
  withoutLastEmptySpeaker(slots: PlannerSlot[]): PlannerSlot[] | null;
  slotFill(slots: PlannerSlot[], kind: "talk" | "prayer"): SlotFill;
  callEditable(date: string, today: string, inHistory: boolean): boolean;
  callMatches(slot: PlannerSlot, query: string): boolean;
};

export const SLOT_RULES_START = "// ---------- slot rules (read by tests/helpers/plannerSlotRules.ts) ----------";
export const SLOT_RULES_END = "// ---------- end slot rules ----------";

const RULE_NAMES: (keyof PlannerSlotRules)[] = [
  "isEmptyWork",
  "placeIntoSlots",
  "withoutLoneRestHymn",
  "withoutEmptySpeakers",
  "withDefaultSpeakers",
  "withRestHymnIfTwoSpeakers",
  "withSpeakerAdded",
  "withoutLastEmptySpeaker",
  "slotFill",
  "callEditable",
  "callMatches",
];

export function readPlannerBody(): string {
  return readFileSync(path.join(process.cwd(), "lib", "sacramentPlanner", "assets", "body.html"), "utf8");
}

export function sliceSlotRules(body: string): string {
  const start = body.indexOf(SLOT_RULES_START);
  const end = body.indexOf(SLOT_RULES_END);
  if (start < 0) throw new Error(`body.html has lost its opening marker: ${SLOT_RULES_START}`);
  if (end < 0) throw new Error(`body.html has lost its closing marker: ${SLOT_RULES_END}`);
  if (end < start) throw new Error("body.html's slot-rules markers are in the wrong order");
  return body.slice(start, end);
}

export function loadPlannerSlotRules(): PlannerSlotRules {
  const block = sliceSlotRules(readPlannerBody());
  let counter = 0;
  // The block is the Planner's own browser code, run here exactly as written; new Function is the
  // only way to evaluate it without copying it into TypeScript, which would test the copy instead.
  const build = new Function("isTalk", "isPrayer", "rid", `${block}\nreturn { ${RULE_NAMES.join(", ")} };`) as (
    isTalk: (role: string) => boolean,
    isPrayer: (role: string) => boolean,
    rid: () => string,
  ) => PlannerSlotRules;
  return build(
    (role) => /Speaker/.test(role),
    (role) => /Prayer/.test(role),
    () => `test-${++counter}`,
  );
}
