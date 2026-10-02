import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

// ITER-036 fb: WHAT UN-FINALIZES A SUNDAY'S PRAYERS, READ OUT OF THE SOURCE.
//
// A person set, changed or cleared un-finalizes the prayers and withdraws the old person's ask (D2,
// D3); a decline on the ask does NOT, even though it clears the person, and neither does a stage
// move (lib/sacrament/finalizePeople.ts's table). speakersFinalizeSites.test.ts's reasoning: the
// failure is a line that is or is not there, which no behavioural assertion can see.

function source(relative: string): string {
  return readFileSync(path.resolve(process.cwd(), relative), "utf8");
}

const POST_ROUTE = "app/api/prayers/route.ts";
const PATCH_ROUTE = "app/api/prayers/[id]/route.ts";

describe("every write path that can change who prays un-finalizes the prayers", () => {
  it.each([POST_ROUTE, PATCH_ROUTE])("%s calls afterPrayerPersonChanged", (relative) => {
    expect(source(relative)).toMatch(/afterPrayerPersonChanged\(/);
  });

  it("calls it in the PATCH route's assign branch only, never after a stage move", () => {
    const text = source(PATCH_ROUTE);
    const call = text.indexOf("afterPrayerPersonChanged({");
    const assignBranch = text.indexOf('if (input.action === "assign")');
    const transition = text.indexOf("canTransitionPrayer(from, to");

    expect(call).toBeGreaterThan(assignBranch);
    expect(call).toBeLessThan(transition);
    expect(text.indexOf("afterPrayerPersonChanged({", call + 1)).toBe(-1);
  });

  it("are the only two routes that write who prays", () => {
    const queries = source("lib/prayers/queries.ts");
    expect(queries).toMatch(/export async function upsertPrayer\(/);
    expect(queries).toMatch(/export async function setPrayerMember\(/);
    expect(source(POST_ROUTE)).toMatch(/upsertPrayer\(/);
    expect(source(PATCH_ROUTE)).toMatch(/setPrayerMember\(/);
  });
});

describe("a decline never un-finalizes the prayers", () => {
  it.each(["lib/prayers/prayerOutcome.ts", "app/api/todos/[id]/answer/route.ts"])(
    "%s does not call afterPrayerPersonChanged or clear the stamp",
    (relative) => {
      const text = source(relative);
      expect(text).not.toMatch(/afterPrayerPersonChanged/);
      expect(text).not.toMatch(/setPrayersFinalized/);
    },
  );
});
