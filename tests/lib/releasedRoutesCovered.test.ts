// @vitest-environment node
import { readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { isCorePath, moduleForPath } from "@/lib/access/releasedModules";
import { NAVIGATION_ITEMS } from "@/lib/auth/navigation";

// EVERY PAGE BELONGS TO A MODULE OR TO CORE, AND THIS IS WHAT ENFORCES IT (ITER-041).
//
// The bounce (lib/access/requireReleasedRoute.ts) only redirects a path moduleForPath() claims, so
// a new top-level page that no module's routePrefixes name would silently escape the release list.
// No assertion about a rendered page can see that — the gap is a folder nobody listed — so this
// reads app/ from disk, the way tests/lib/navigationRoutesExist.test.ts does.
//
// (youth) is deliberately not read: its layout does not bounce (requireReleasedRoute's header).

const SHELLS = ["(app)", "(tithing)"];

function topLevelRouteFolders(shell: string): string[] {
  const directory = join(process.cwd(), "app", shell);
  return readdirSync(directory).filter((entry) => statSync(join(directory, entry)).isDirectory());
}

describe("every page maps to a released module or to core", () => {
  for (const shell of SHELLS) {
    it(`covers every top-level folder in app/${shell}`, () => {
      const folders = topLevelRouteFolders(shell);
      expect(folders.length).toBeGreaterThan(0);

      const uncovered = folders
        .map((folder) => `/${folder}`)
        .filter((path) => moduleForPath(path) === null && !isCorePath(path));

      expect(uncovered).toEqual([]);
    });
  }

  it("reads the folder it is anchored on", () => {
    expect(topLevelRouteFolders("(app)")).toContain("roster");
    expect(moduleForPath("/roster")).toBe("roster");
  });

  it("maps every built navigation tile to a module", () => {
    const unmapped = NAVIGATION_ITEMS.filter((item) => item.built)
      .map((item) => item.href)
      .filter((href) => moduleForPath(href) === null);

    expect(unmapped).toEqual([]);
  });
});
