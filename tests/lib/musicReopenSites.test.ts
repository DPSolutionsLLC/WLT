// @vitest-environment node
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative, sep } from "node:path";
import { describe, expect, it } from "vitest";

// ITER-038 slice mb: EVERY CHANGE TO A SUNDAY'S MUSIC RETURNS A SUBMISSION TO DRAFT, READ OUT OF THE
// SOURCE.
//
// The conductor approves the music as it stood. A write route that forgot reopenMusicAfterWrite()
// would leave "Approved" on music nobody approved — and nothing on any screen would say so, so no
// assertion about one route's behaviour can catch the NEXT route somebody adds. This reads the
// files, the way tests/lib/conductorHandoverSites.test.ts does.
//
// It also holds the other half of migration 089a's design: `sunday_music` has no write policy, so
// the only writers are the two service-role modules in lib/music/, and the status machine has ONE
// of them.

const MUSIC_WRITE_ROUTES: Record<string, number> = {
  // POST and DELETE each.
  "app/api/hymns/select/route.ts": 2,
  "app/api/musical-numbers/route.ts": 2,
  // PATCH (the chorister and organist).
  "app/api/sundays/[id]/music/route.ts": 1,
};

const SUNDAY_MUSIC_WRITERS = ["lib/music/musicReview.ts", "lib/music/sundayMusic.ts"];

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

// `.from("sunday_music")` followed by a write verb before the statement ends.
const WRITE_PATTERN = /\.from\(\s*"sunday_music"\s*\)[^;]*?\.(insert|update|upsert|delete)\s*\(/;

describe("every music write route reopens a submitted Sunday", () => {
  it.each(Object.entries(MUSIC_WRITE_ROUTES))("%s calls reopenMusicAfterWrite %i time(s)", (path, count) => {
    const calls = [...read(path).matchAll(/\breopenMusicAfterWrite\s*\(/g)].length;
    expect(calls).toBe(count);
  });

  it("finds a write the way the check below relies on", () => {
    expect(WRITE_PATTERN.test(`await db.from("sunday_music").update({ status: "draft" })`)).toBe(true);
    expect(WRITE_PATTERN.test(`await db.from("sunday_music").select("status");`)).toBe(false);
  });

  it("writes sunday_music only from lib/music/musicReview.ts and lib/music/sundayMusic.ts", () => {
    const writers = ["app", "lib", "components"]
      .flatMap(listSourceFiles)
      .filter((file) => WRITE_PATTERN.test(read(file)))
      .sort();
    expect(writers).toEqual(SUNDAY_MUSIC_WRITERS);
  });

  it("writes the people columns only from sundayMusic.ts, never the status", () => {
    const source = read("lib/music/sundayMusic.ts");
    const writer = source.slice(source.indexOf("async function upsertSundayMusicPeople"));
    expect(writer).toMatch(/\.upsert\(/);
    expect(writer).not.toMatch(/\b(status|submitted_at|submitted_by|approved_at|returned_at)\s*:/);
  });
});
