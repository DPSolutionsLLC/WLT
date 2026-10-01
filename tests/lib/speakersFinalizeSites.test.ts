import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

// ITER-036: WHAT UN-FINALIZES A SUNDAY'S SPEAKERS, READ OUT OF THE SOURCE.
//
// A speaker set, changed or cleared un-finalizes (D2); a decline does NOT, even though it clears
// the speaker (lib/sacrament/finalizePeople.ts's table). No assertion about behaviour can see a
// third write path that forgot the call, or a decline path that gained one — the failure is a line
// that is or is not there — so this reads the files, the way tests/lib/topicsFinalize.test.ts does.

function source(relative: string): string {
  return readFileSync(path.resolve(process.cwd(), relative), "utf8");
}

const PATCH_ROUTE = "app/api/assignments/[id]/route.ts";
const POST_ROUTE = "app/api/assignments/route.ts";

describe("every write path that can set or change a speaker un-finalizes the speakers", () => {
  it.each([PATCH_ROUTE, POST_ROUTE])("%s calls unfinalizeSpeakersIfNeeded", (relative) => {
    expect(source(relative)).toMatch(/unfinalizeSpeakersIfNeeded\(/);
  });

  it("calls it inside the PATCH route's `update` branch, never the outcome or transition ones", () => {
    const text = source(PATCH_ROUTE);
    const call = text.indexOf("unfinalizeSpeakersIfNeeded({");
    const updateBranch = text.indexOf('if (input.action === "update")');
    const outcomeBranch = text.indexOf('if (input.action === "record_outcome")');

    expect(call).toBeGreaterThan(updateBranch);
    expect(call).toBeLessThan(outcomeBranch);
    expect(text.indexOf("unfinalizeSpeakersIfNeeded({", call + 1)).toBe(-1);
  });

  it("withdraws the old person's ask on a speaker change rather than closing it unconditionally", () => {
    const text = source(PATCH_ROUTE);
    expect(text).toMatch(/withdrawAsks\(/);
    expect(text).not.toMatch(/closeAsksForAssignment/);
  });
});

describe("a decline never un-finalizes", () => {
  it.each([
    "lib/assignments/requestOutcome.ts",
    "app/api/todos/[id]/answer/route.ts",
  ])("%s does not call unfinalizeSpeakersIfNeeded", (relative) => {
    expect(source(relative)).not.toMatch(/unfinalizeSpeakersIfNeeded/);
  });
});
