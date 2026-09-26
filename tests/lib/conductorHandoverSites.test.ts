// @vitest-environment node
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative, sep } from "node:path";
import { describe, expect, it } from "vitest";

// ---------------------------------------------------------------------------
// EVERY WRITE OF A SUNDAY'S CONDUCTOR HANDS ITS OPEN ASKS OVER (Sacrament slice f2)
// ---------------------------------------------------------------------------
// When a Sunday's conductor changes, its open "Ask ___ to speak" to-dos must follow the new
// conductor (lib/sacrament/conductorHandover.ts). A write that skips it fails SILENTLY: the asks
// stay with somebody who no longer conducts, and nothing on any screen says so. No assertion about
// one route's behaviour can catch the NEXT write somebody adds, so this reads the source, the way
// tests/lib/explicitTimeZone.test.ts does.
//
// Four functions write `sundays.conducting_user_id` today. Two can replace a previous conductor and
// are reported to the route; two cannot, and are exempt with their reason. A fifth writer fails
// this test until it is added to one list or the other.

const CALENDAR_QUERIES = "lib/calendar/queries.ts";
const SUNDAY_ROUTE = "app/api/sundays/[id]/route.ts";

// Replace a previous conductor. `updateSunday` returns what it changed (`reshiftedSundayIds`, plus
// the Sunday being edited), and `applyConductingReshift` runs only inside it.
const REPORTED_WRITERS = ["updateSunday", "applyConductingReshift"] as const;

// Never replace anybody, so there is no previous owner holding an ask.
const EXEMPT_WRITERS: Record<string, string> = {
  // An INSERT ... ON CONFLICT DO NOTHING of Sundays that do not exist yet. No talk, so no ask.
  generateSundayRange: "creates new Sundays only",
  // Fills conducting_user_id only where it is still null.
  populateConducting: "fills nulls only",
};

// The lookahead sits BEFORE any whitespace is consumed. Written as `:\s*(?!string)`, `\s*` backtracks
// to zero spaces and the lookahead sees " string", so a type declaration would count as a write.
const WRITE_PATTERN = /\bconducting_user_id\s*:(?!\s*string\b)/g;
const FUNCTION_PATTERN = /(?:^|\n)[ \t]*(?:export\s+)?(?:async\s+)?function\s+(\w+)/g;

function stripComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/\/\/[^\n]*/g, " ");
}

function read(path: string): string {
  return stripComments(readFileSync(join(process.cwd(), path), "utf8"));
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

// The name of the top-level function each write sits inside.
export function conductorWriters(source: string): string[] {
  const starts = [...source.matchAll(FUNCTION_PATTERN)].map((match) => ({
    name: match[1],
    index: match.index ?? 0,
  }));

  const writers = [...source.matchAll(WRITE_PATTERN)].map((match) => {
    const at = match.index ?? 0;
    const enclosing = starts.filter((start) => start.index < at).at(-1);
    return enclosing?.name ?? "(top level)";
  });

  return [...new Set(writers)].sort();
}

function bodyOf(source: string, functionName: string): string {
  const start = source.search(new RegExp(`function\\s+${functionName}\\b`));
  if (start === -1) return "";
  const next = source.slice(start + 1).search(FUNCTION_PATTERN);
  return next === -1 ? source.slice(start) : source.slice(start, start + 1 + next);
}

describe("every write of a Sunday's conductor hands its open asks over", () => {
  it("finds a writer the way the check below relies on", () => {
    const sample = `
      function reads() { return { conductingUserId: row.conducting_user_id }; }
      type Row = { conducting_user_id: string | null };
      async function writes() { await db.update({ conducting_user_id: userId }); }
    `;
    expect(conductorWriters(sample)).toEqual(["writes"]);
  });

  it("writes the conductor only from lib/calendar/queries.ts", () => {
    const elsewhere = ["app", "lib", "components"]
      .flatMap(listSourceFiles)
      .filter((file) => file !== CALENDAR_QUERIES)
      .filter((file) => read(file).match(WRITE_PATTERN) !== null);

    expect(elsewhere).toEqual([]);
  });

  it("names every writer in lib/calendar/queries.ts as reported or exempt", () => {
    const known = [...REPORTED_WRITERS, ...Object.keys(EXEMPT_WRITERS)].sort();
    expect(conductorWriters(read(CALENDAR_QUERIES))).toEqual(known);
  });

  it("applies a re-shift only inside updateSunday, which reports the Sundays it moved", () => {
    const source = read(CALENDAR_QUERIES);
    const calls = [...source.matchAll(/\bapplyConductingReshift\s*\(/g)].length;

    // One definition and one call.
    expect(calls).toBe(2);
    expect(bodyOf(source, "updateSunday")).toMatch(/applyConductingReshift\s*\(/);
    expect(bodyOf(source, "updateSunday")).toMatch(
      /reshiftedSundayIds:\s*reshiftPlan\.sacrament\.map/,
    );
  });

  it("hands over in every route that calls updateSunday, for the edited and re-shifted Sundays", () => {
    const callers = ["app", "lib"]
      .flatMap(listSourceFiles)
      .filter((file) => file !== CALENDAR_QUERIES)
      .filter((file) => /\bupdateSunday\s*\(/.test(read(file)));

    expect(callers).toEqual([SUNDAY_ROUTE]);

    for (const file of callers) {
      const source = read(file);
      expect(source, file).toMatch(/reconcileSundayAsksToConductor\s*\(/);
      expect(source, file).toMatch(/sundayIds:\s*\[sundayId,\s*\.\.\.reshiftedSundayIds\]/);
    }
  });
});
