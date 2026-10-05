// @vitest-environment node
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

// ITER-038 slice mc: EVERY PLACE THAT CLEARS A SUNDAY'S TOPICS STAMP RETURNS SUBMITTED MUSIC TO
// DRAFT, READ OUT OF THE SOURCE.
//
// The conductor approved music chosen for the topics as they stood. Something that clears the stamp
// and forgets the music would leave "Approved" on music chosen for topics that no longer exist, and
// no screen would say so — so, like tests/lib/musicReopenSites.test.ts, this reads the files.
//
// Three places clear the stamp, and each one owns the music's reopen:
//   - the topics-finalized route, on an explicit un-finalize;
//   - lib/topics/finalize.ts, which every edit that changes the topics goes through;
//   - the save-time reconcile, for cancelSundayWork() clearing it when every talk goes.
// And the handoff itself must be called by the route, or finalizing tells nobody.

const SITES: Record<string, { pattern: RegExp; count: number }> = {
  "app/api/sundays/[id]/topics-finalized/route.ts": {
    pattern: /\breopenMusicForTopicChange\s*\(/g,
    count: 1,
  },
  "lib/topics/finalize.ts": { pattern: /\breopenMusicForTopicChange\s*\(/g, count: 1 },
  "lib/sacrament/conductorHandover.ts": {
    pattern: /\breopenMusicIfNeeded\s*\(\s*\{[^}]*reason:\s*"topics_changed"/g,
    count: 1,
  },
};

function read(path: string): string {
  return readFileSync(join(process.cwd(), path), "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, " ")
    .replace(/\/\/[^\n]*/g, " ");
}

describe("every place that clears the topics stamp reopens the music", () => {
  it.each(Object.entries(SITES))("%s reopens the music", (path, { pattern, count }) => {
    expect([...read(path).matchAll(pattern)].length).toBe(count);
  });

  it("the topics-finalized route hands the topics to the music coordinator", () => {
    expect(
      [...read("app/api/sundays/[id]/topics-finalized/route.ts").matchAll(/\bhandTopicsToMusic\s*\(/g)]
        .length,
    ).toBe(1);
  });

  it("ignores a call that only survives in a comment", () => {
    expect([..."// reopenMusicForTopicChange(".replace(/\/\/[^\n]*/g, " ").matchAll(/\breopenMusicForTopicChange\s*\(/g)]).toHaveLength(0);
  });
});
