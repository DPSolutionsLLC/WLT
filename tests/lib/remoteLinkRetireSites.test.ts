// @vitest-environment node
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative, sep } from "node:path";
import { describe, expect, it } from "vitest";

// ITER-051: A CALLING CHANGE TURNS STALE STREAM REMOTE LINKS OFF, READ OUT OF THE SOURCE.
//
// Migration 094's policy hides a link the moment its calling stops matching, but only the stamp
// stops a later undo from reviving it. The stamp is written by retireRemoteLinksForCalling(), from
// updateCalling() and endCalling() — so this holds three things no behaviour test can hold for the
// NEXT writer somebody adds: both functions call it, nothing else changes an existing calling, and
// nothing else touches `zoom_remote_links` (whose `url` is a capability).

const WRITE_CALLING = "lib/callings/writeCalling.ts";
const REMOTE_LINKS = "lib/zoom/remoteLinks.ts";

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

function functionBody(source: string, name: string): string {
  const start = source.indexOf(`export async function ${name}(`);
  if (start === -1) throw new Error(`${name} was not found in ${WRITE_CALLING}.`);
  const next = source.indexOf("export ", start + 1);
  return source.slice(start, next === -1 ? undefined : next);
}

const CALLING_UPDATE = /\.from\(\s*"ward_role_assignments"\s*\)[^;]*?\.(update|upsert)\s*\(/g;

const SOURCE_FILES = [
  ...listSourceFiles("lib"),
  ...listSourceFiles("app"),
  ...listSourceFiles("supabase/scripts"),
];

describe("calling changes retire stale remote links", () => {
  it.each(["updateCalling", "endCalling"])("%s calls retireRemoteLinksForCalling", (name) => {
    expect(functionBody(read(WRITE_CALLING), name)).toMatch(/\bretireRemoteLinksForCalling\s*\(/);
  });

  it("finds exactly the two calling updates in writeCalling.ts (the anchor)", () => {
    expect([...read(WRITE_CALLING).matchAll(CALLING_UPDATE)]).toHaveLength(2);
  });

  it("finds no other file that changes an existing calling", () => {
    const offenders = SOURCE_FILES.filter(
      (path) => path !== WRITE_CALLING && [...read(path).matchAll(CALLING_UPDATE)].length > 0,
    );
    expect(offenders).toEqual([]);
  });

  // A query, not a mention: the release catalog names the table and never reads it.
  it("finds zoom_remote_links queried by remoteLinks.ts and by nothing else in lib/ or app/", () => {
    const touching = [...listSourceFiles("lib"), ...listSourceFiles("app")].filter((path) =>
      /\.from\(\s*"zoom_remote_links"\s*\)/.test(read(path)),
    );
    expect(touching).toEqual([REMOTE_LINKS]);
  });
});
