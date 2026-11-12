// @vitest-environment node
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative, sep } from "node:path";
import { describe, expect, it } from "vitest";

// ITER-055 bv5: WHO WRITES A HOUSEHOLD ASSIGNMENT AND ITS TO-DO, READ OUT OF THE SOURCE.
//
// `visit_assignments` has no write policy, so its only writer is lib/visits/assignments.ts on the
// service role; a second writer would be a second place the "visits.assign AND a bishopric calling"
// boundary had to be remembered. `todos.visit_assignment_id` is written only by
// lib/todos/visitLinks.ts, the P5 rule that another person's work arrives through the source that
// owns it.
//
// And EVERY route that records a visit, edits one or ends a goal must bring the assignments into
// line — a route that forgot would leave "Visit the ___ family" open on somebody's list after the
// visit, with no checkbox to clear it and nothing on any screen to say why. No assertion about one
// route's behaviour can catch the next route somebody adds, so this reads the files.

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

const SOURCE_FILES = ["app", "lib", "components"].flatMap(listSourceFiles);

// `.from("visit_assignments")` followed by a write verb before the statement ends.
const ASSIGNMENT_WRITE = /\.from\(\s*"visit_assignments"\s*\)[^;]*?\.(insert|update|upsert|delete)\s*\(/;
// A todos row naming the link column as a key with a VALUE — an insert or an update setting it. A
// row type (`visit_assignment_id: string | null;`) is not a write.
const TODO_LINK_WRITE = /\bvisit_assignment_id\s*:(?!\s*string\b)/;

// The routes that record a visit, edit one, or end a goal, and the call each must make.
const RECONCILING_ROUTES: Record<string, RegExp> = {
  "app/api/visits/route.ts": /\breconcileVisitAssignment\s*\(/g,
  "app/api/visits/[id]/route.ts": /\breconcileVisitAssignment\s*\(/g,
  "app/api/visit-goals/[id]/route.ts": /\bendAssignmentsForGoal\s*\(/g,
};

// The functions that write a visit or end a goal. A file outside lib/visits/queries.ts calling one
// is a route this test must know about.
const VISIT_WRITE_CALL = /\b(createVisitLog|updateVisitLog|endVisitGoal)\s*\(/;

describe("visit assignments and their to-dos have one writer each", () => {
  it("finds a write the way the checks below rely on", () => {
    expect(ASSIGNMENT_WRITE.test(`await db.from("visit_assignments").update({ ended_at: now })`)).toBe(true);
    expect(ASSIGNMENT_WRITE.test(`await db.from("visit_assignments").select("id");`)).toBe(false);
    expect(TODO_LINK_WRITE.test(`.insert({ visit_assignment_id: id })`)).toBe(true);
    expect(TODO_LINK_WRITE.test(`.in("visit_assignment_id", ids)`)).toBe(false);
    expect(TODO_LINK_WRITE.test(`  visit_assignment_id: string | null;`)).toBe(false);
  });

  it("writes visit_assignments only from lib/visits/assignments.ts", () => {
    const writers = SOURCE_FILES.filter((file) => ASSIGNMENT_WRITE.test(read(file))).sort();
    expect(writers).toEqual(["lib/visits/assignments.ts"]);
  });

  it("writes todos.visit_assignment_id only from lib/todos/visitLinks.ts", () => {
    const writers = SOURCE_FILES.filter((file) => TODO_LINK_WRITE.test(read(file))).sort();
    expect(writers).toEqual(["lib/todos/visitLinks.ts"]);
  });
});

describe("every route that records a visit or ends a goal brings the assignments into line", () => {
  it.each(Object.entries(RECONCILING_ROUTES))("%s makes the call", (path, call) => {
    expect([...read(path).matchAll(call)].length).toBeGreaterThanOrEqual(1);
  });

  it("knows every route that writes a visit or ends a goal", () => {
    const callers = SOURCE_FILES.filter(
      (file) => file !== "lib/visits/queries.ts" && VISIT_WRITE_CALL.test(read(file)),
    ).sort();
    expect(callers).toEqual(Object.keys(RECONCILING_ROUTES).sort());
  });
});
