// @vitest-environment node
import { readdirSync, statSync } from "node:fs";
import { join, relative, sep } from "node:path";
import { describe, expect, it } from "vitest";
import { NAVIGATION_ITEMS } from "@/lib/auth/navigation";

// ---------------------------------------------------------------------------
// NO TILE POINTS AT A ROUTE WITH NO PAGE, AND THIS IS WHAT ENFORCES IT
// ---------------------------------------------------------------------------
// CLAUDE.md §9 carried a standing note that a bishop is offered links to pages that do not exist:
// Next.js prefetches them, so the console carried errors on every page a bishop opened, and a
// click either 404'd or silently bounced back to /dashboard. It was left as a known cost through
// several phases because nothing could catch it — and nothing could, because NO ASSERTION ABOUT A
// RENDERED COMPONENT CAN SEE A MISSING FILE. A grid test renders the tile perfectly; the failure
// is somewhere else entirely, in a directory that has no page.tsx in it.
//
// So this reads `app/` from disk instead, the way tests/lib/explicitTimeZone.test.ts reads source
// for the same class of reason. It is the highest-value test in P3.
//
// ROUTE GROUPS ARE INVISIBLE IN A URL. `app/(app)/roster/page.tsx` serves `/roster`, so the
// `(app)` segment is dropped when a path is turned into a route. That is also why a URL belongs
// to exactly ONE group: app/(app)/sacrament/page.tsx and app/(youth)/sacrament/page.tsx would be
// the same route and Next.js would refuse to build. p4-sacrament-a settled that collision by
// giving `/sacrament` to the meeting hub in the app shell and moving the youth ordinance screen
// to `/ordinances`.
//
// This test used to note that /sacrament RESOLVED from the youth shell, which made it
// `built: false` on a subtler ground than "no page exists". That is no longer the case: the
// ordinance row is `/sacrament/ordinances` and has no page anywhere, so it is now a SECOND
// genuine unbuilt href beside the anchor below.

const APP_DIRECTORY = join(process.cwd(), "app");

// The one item that must stay unbuilt AND have no page, so the negative assertion cannot pass
// trivially. tests/db/notification-triggers-seed.test.ts records the lesson: a both-directions
// assertion passed on two empty arrays until an anchor was added. When P12 builds the audit
// viewer and flips this to `built: true`, this key must move to another genuinely unbuilt href.
const UNBUILT_ANCHOR = "/admin/audit-log";

function listPageFiles(directory: string): string[] {
  const found: string[] = [];

  function walk(current: string): void {
    for (const entry of readdirSync(current)) {
      const full = join(current, entry);
      if (statSync(full).isDirectory()) {
        walk(full);
        continue;
      }
      if (entry === "page.tsx") found.push(full);
    }
  }

  walk(directory);
  return found;
}

// `app/(app)/talks/topics/page.tsx` → `/talks/topics`. Route groups — a segment wrapped in
// parentheses — contribute nothing to the URL and are dropped.
export function routeForPageFile(pageFile: string, appDirectory: string): string {
  const segments = relative(appDirectory, pageFile)
    .split(sep)
    .slice(0, -1)
    .filter((segment) => !(segment.startsWith("(") && segment.endsWith(")")));

  return `/${segments.join("/")}`;
}

describe("the route scanner", () => {
  // PROVED ABLE TO FAIL BEFORE IT IS BELIEVED. A walk that silently returns nothing makes every
  // assertion below pass and looks exactly like a clean bill of health.
  it("drops route groups from a path", () => {
    const appDirectory = join("C:", "repo", "app");

    expect(
      routeForPageFile(join(appDirectory, "(app)", "talks", "topics", "page.tsx"), appDirectory),
    ).toBe("/talks/topics");
  });

  it("resolves a page directly under a group", () => {
    const appDirectory = join("C:", "repo", "app");

    expect(routeForPageFile(join(appDirectory, "(app)", "roster", "page.tsx"), appDirectory)).toBe(
      "/roster",
    );
  });
});

describe("every navigation item marked built", () => {
  const routes = new Set(
    listPageFiles(APP_DIRECTORY).map((file) => routeForPageFile(file, APP_DIRECTORY)),
  );

  it("scans a plausible number of pages", () => {
    expect(routes.size).toBeGreaterThan(20);
  });

  it("has a page on disk", () => {
    const dead = NAVIGATION_ITEMS.filter(
      (item) => item.built && !routes.has(item.href),
    ).map((item) => `${item.label} → ${item.href}`);

    expect(dead).toEqual([]);
  });
});

describe("the unbuilt anchor", () => {
  const routes = new Set(
    listPageFiles(APP_DIRECTORY).map((file) => routeForPageFile(file, APP_DIRECTORY)),
  );

  // Without this the suite above goes green the day somebody marks every item built, or the day
  // the walk breaks and returns nothing.
  it("is still in the list, still unbuilt, and still has no page", () => {
    const anchor = NAVIGATION_ITEMS.find((item) => item.href === UNBUILT_ANCHOR);

    expect(anchor, `${UNBUILT_ANCHOR} has left NAVIGATION_ITEMS — pick another anchor`).toBeDefined();
    expect(anchor?.built).toBe(false);
    expect(routes.has(UNBUILT_ANCHOR)).toBe(false);
  });
});
