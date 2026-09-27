// @vitest-environment node
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative, sep } from "node:path";
import { describe, expect, it } from "vitest";

// ---------------------------------------------------------------------------
// EVERY READ OF A SUNDAY'S WORK SKIPS CANCELLED ROWS (Sacrament slice f2c)
// ---------------------------------------------------------------------------
// A cancelled talk, prayer, hymn choice or musical number is a RECORD, not work on the Sunday
// (migration 085). A read that forgets to skip one fails SILENTLY: the hub counts a talk that is not
// happening, the program prints it, a slot reads as taken so planning cannot start over. No
// assertion about one screen can catch the NEXT read somebody adds, so this reads the source, the
// way conductorHandoverSites.test.ts and explicitTimeZone.test.ts do.
//
// Rule: every SELECT on those four tables sits in a function that mentions `cancelled_at`, or is
// named below with its reason. A write (update / insert / delete) is not a read and is not checked.

const TABLES = ["assignments", "prayer_assignments", "hymn_selections", "musical_numbers"];

// Reads that must see a cancelled row, each for a stated reason. Keyed `file:function`.
const EXEMPT: Record<string, string> = {
  // One talk by id. A route must see a cancelled talk to refuse editing it with a sentence
  // (app/api/assignments/[id]); the Assignment it returns carries `cancelledAt`.
  "lib/assignments/queries.ts:getAssignment": "reads one row by id, cancelled or not",
  // Speaker history: a cancelled talk's history row still needs the talk's Sunday and type.
  "lib/assignments/queries.ts:attachAssignmentContext": "history for cancelled talks too",
  // One prayer by id, for the same reason as getAssignment.
  "lib/prayers/queries.ts:getPrayer": "reads one row by id, cancelled or not",
};

const SCANNED_DIRECTORIES = ["app", "lib"];
const FROM_PATTERN = new RegExp(`\\.from\\("(${TABLES.join("|")})"\\)`, "g");
const FUNCTION_PATTERN = /(?:^|\n)[ \t]*(?:export\s+)?(?:async\s+)?function\s+(\w+)/g;

function stripComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/\/\/[^\n]*/g, " ");
}

function listSourceFiles(directory: string): string[] {
  const found: string[] = [];

  function walk(current: string): void {
    for (const entry of readdirSync(current)) {
      const full = join(current, entry);
      if (statSync(full).isDirectory()) {
        walk(full);
        continue;
      }
      if (entry.endsWith(".ts") || entry.endsWith(".tsx")) found.push(full);
    }
  }

  walk(join(process.cwd(), directory));
  return found.map((file) => relative(process.cwd(), file).split(sep).join("/"));
}

export type UnfilteredRead = { file: string; fn: string; table: string };

// The chain that starts at `.from(...)`, up to the end of its statement.
function chainAt(source: string, index: number): string {
  const end = source.indexOf(";", index);
  return end === -1 ? source.slice(index) : source.slice(index, end);
}

function functionAround(source: string, index: number): { name: string; body: string } {
  const starts = [...source.matchAll(FUNCTION_PATTERN)].map((match) => ({
    name: match[1],
    index: match.index ?? 0,
  }));
  const current = starts.filter((start) => start.index < index).at(-1);
  const next = starts.find((start) => start.index > index);
  const from = current?.index ?? 0;
  return {
    name: current?.name ?? "(top level)",
    body: source.slice(from, next?.index ?? source.length),
  };
}

export function findUnfilteredReads(file: string, rawSource: string): UnfilteredRead[] {
  const source = stripComments(rawSource);
  const found: UnfilteredRead[] = [];

  for (const match of source.matchAll(FROM_PATTERN)) {
    const at = match.index ?? 0;
    const chain = chainAt(source, at);
    const isWrite = /\.(update|insert|delete|upsert)\(/.test(chain);
    if (isWrite || !chain.includes(".select(")) continue;

    const fn = functionAround(source, at);
    if (fn.body.includes("cancelled_at")) continue;
    if (EXEMPT[`${file}:${fn.name}`] !== undefined) continue;

    found.push({ file, fn: fn.name, table: match[1] });
  }

  return found;
}

describe("every read of a Sunday's work skips cancelled rows", () => {
  it("finds an unfiltered read the way the check below relies on", () => {
    const sample = `
      async function filtered() { return db.from("assignments").select("id").is("cancelled_at", null); }
      async function forgot() { return db.from("prayer_assignments").select("id").eq("ward_id", w); }
      async function writes() { return db.from("hymn_selections").update({ a: 1 }).select("id"); }
    `;
    expect(findUnfilteredReads("sample.ts", sample)).toEqual([
      { file: "sample.ts", fn: "forgot", table: "prayer_assignments" },
    ]);
  });

  it("has no read that forgets the filter", () => {
    const unfiltered = SCANNED_DIRECTORIES.flatMap(listSourceFiles).flatMap((file) =>
      findUnfilteredReads(file, readFileSync(join(process.cwd(), file), "utf8")),
    );
    expect(unfiltered).toEqual([]);
  });

  it("names only exemptions that still exist", () => {
    for (const key of Object.keys(EXEMPT)) {
      const [file, fn] = key.split(":");
      const source = stripComments(readFileSync(join(process.cwd(), file), "utf8"));
      expect(source, key).toMatch(new RegExp(`function\\s+${fn}\\b`));
    }
  });
});
