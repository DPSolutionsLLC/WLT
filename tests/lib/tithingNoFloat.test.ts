// @vitest-environment node
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

// plans/09-meetings-tithing.md §Tests asks for a test proving there is no floating-point
// arithmetic in the money path. Asserting on totals cannot do that — a float implementation
// passes every total in tithingTotals.test.ts right up to the session where it does not, because
// the drift only shows after enough coin entries have accumulated. So this reads the source.
//
// It exists because the prototype this module replicates DID hold dollars as floats
// (val: 0.25, val: 0.10) and patched the resulting drift with Math.round(q * val * 100) / 100 at
// each of the four places it multiplied. Reintroducing that shape is an easy, plausible edit; it
// would look correct in review and pass every other test in this suite.

const MONEY_PATH_FILES = ["denominations.ts", "money.ts", "totals.ts"];

function readMoneyPathFile(file: string): string {
  return readFileSync(join(process.cwd(), "lib", "tithing", file), "utf8");
}

// Comments in these files quote coin values ("$0.25 each", "0.1 * 3") to explain the very rule
// being enforced, and the coin sublabels printed on screen say "$0.25 each" literally. Neither
// is arithmetic, so the decimal scan looks at code with both removed. What it is hunting is a
// decimal that a multiplication could reach.
function stripComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/\/\/[^\n]*/g, " ");
}

function stripStringLiterals(source: string): string {
  return source
    .replace(/"(?:[^"\\]|\\.)*"/g, '""')
    .replace(/'(?:[^'\\]|\\.)*'/g, "''")
    .replace(/`(?:[^`\\]|\\.)*`/g, "``");
}

function moneyPathCode(file: string): string {
  return stripStringLiterals(stripComments(readMoneyPathFile(file)));
}

describe("the tithing money path", () => {
  it.each(MONEY_PATH_FILES)("has no decimal number literal in %s", (file) => {
    const matches = moneyPathCode(file).match(/\d+\.\d+/g) ?? [];

    expect(matches).toEqual([]);
  });

  it.each(MONEY_PATH_FILES)("never converts money through a float in %s", (file) => {
    const code = moneyPathCode(file);

    // parseFloat and Number("0.25") are how a cent count becomes a dollar amount; toFixed and
    // Math.round are how the result gets pushed back into looking right afterwards.
    //
    // \bNumber\( deliberately does not match Number.parseInt or Number.isInteger, both of which
    // this module uses and neither of which produces a float.
    expect(code).not.toMatch(/parseFloat/);
    expect(code).not.toMatch(/toFixed/);
    expect(code).not.toMatch(/Math\.round/);
    expect(code).not.toMatch(/\bNumber\(/);
  });

  it("never divides by 100", () => {
    // Cents become dollars by / 100 and never come back exactly. There is no division at all in
    // these three files.
    for (const file of MONEY_PATH_FILES) {
      expect(moneyPathCode(file)).not.toMatch(/\/\s*100\b/);
    }
  });

  it("declares every denomination as a whole number of cents", async () => {
    const { ALL_DENOMINATIONS } = await import("@/lib/tithing/denominations");

    expect(ALL_DENOMINATIONS).toHaveLength(13);
    for (const denomination of ALL_DENOMINATIONS) {
      expect(Number.isInteger(denomination.cents)).toBe(true);
      expect(denomination.cents).toBeGreaterThan(0);
    }
  });
});
