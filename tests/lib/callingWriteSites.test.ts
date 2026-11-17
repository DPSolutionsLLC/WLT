// @vitest-environment node
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative, sep } from "node:path";
import { describe, expect, it } from "vitest";

// ITER-058: WHO WRITES A CALLING, AND WHO TOUCHES A ROSTER LINK, READ OUT OF THE SOURCE.
//
// Both tables have a SELECT policy and no write policy, so the module that writes them is the whole
// boundary. A link decides privileges from cr2 on; a second writer is a second place the "nobody
// links themselves" rule would have to be remembered. tests/lib/remoteLinkRetireSites.test.ts
// already holds the UPDATE half for callings; this holds the INSERT half and the links table.

const WRITE_CALLING = "lib/callings/writeCalling.ts";
const MEMBER_LINKS = "lib/callings/memberLinks.ts";

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

const SOURCE_FILES = [...listSourceFiles("lib"), ...listSourceFiles("app"), ...listSourceFiles("supabase/scripts")];

const CALLING_INSERT = /\.from\(\s*"ward_role_assignments"\s*\)[^;]*?\.(insert|delete)\s*\(/g;
const LINK_QUERY = /\.from\(\s*"user_member_links"\s*\)/;

describe("calling and roster-link write sites", () => {
  it("finds the one calling insert in writeCalling.ts (the anchor)", () => {
    expect([...read(WRITE_CALLING).matchAll(CALLING_INSERT)]).toHaveLength(1);
  });

  it("finds no other file that inserts or deletes a calling", () => {
    const offenders = SOURCE_FILES.filter(
      (path) => path !== WRITE_CALLING && [...read(path).matchAll(CALLING_INSERT)].length > 0,
    );
    expect(offenders).toEqual([]);
  });

  it("finds user_member_links queried by memberLinks.ts and by nothing else", () => {
    expect(SOURCE_FILES.filter((path) => LINK_QUERY.test(read(path)))).toEqual([MEMBER_LINKS]);
  });
});
