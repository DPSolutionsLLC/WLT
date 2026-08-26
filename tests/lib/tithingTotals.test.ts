import { describe, expect, it } from "vitest";
import {
  ALL_DENOMINATIONS,
  BILLS,
  COINS,
  emptyDenominationQuantities,
  type DenominationId,
  type DenominationQuantities,
} from "@/lib/tithing/denominations";
import {
  denominationTally,
  entryTotals,
  sessionTotals,
  submittedChecks,
  type TithingEntry,
} from "@/lib/tithing/totals";

function quantities(counts: Partial<Record<DenominationId, number>>): DenominationQuantities {
  return { ...emptyDenominationQuantities(), ...counts };
}

function entry(
  entryNumber: number,
  contents: {
    checks?: { number: string; amountCents: number }[];
    counts?: Partial<Record<DenominationId, number>>;
  } = {},
): TithingEntry {
  return {
    entryNumber,
    checks: contents.checks ?? [],
    quantities: quantities(contents.counts ?? {}),
  };
}

describe("entryTotals", () => {
  it("totals every denomination exactly, one of each", () => {
    const oneOfEach = Object.fromEntries(
      ALL_DENOMINATIONS.map((denomination) => [denomination.id, 1]),
    ) as DenominationQuantities;

    const totals = entryTotals({ checks: [], quantities: oneOfEach });

    // 100 + 50 + 20 + 10 + 5 + 2 + 1 dollars
    expect(totals.billsCents).toBe(18_800);
    // 100 + 50 + 25 + 10 + 5 + 1 cents
    expect(totals.coinsCents).toBe(191);
    expect(totals.grandCents).toBe(18_991);
  });

  it("adds checks, cash and coins into the grand total", () => {
    const totals = entryTotals({
      checks: [
        { number: "1042", amountCents: 23_600 },
        { number: "1042A", amountCents: 5_000 },
      ],
      quantities: quantities({ b20: 3, c025: 2 }),
    });

    expect(totals.checksCents).toBe(28_600);
    expect(totals.billsCents).toBe(6_000);
    expect(totals.coinsCents).toBe(50);
    expect(totals.grandCents).toBe(34_650);
  });

  // THE REASON THIS MODULE COUNTS IN CENTS.
  //
  // Three dimes in floating-point dollars is 0.1 * 3 = 0.30000000000000004, and a session of a
  // few hundred coin entries accumulates that until the grand total is visibly a cent out from
  // the cash on the table. There is nothing to round here because 10 * 3 is 30.
  it("gets the coin arithmetic that breaks in floating point exactly right", () => {
    expect(entryTotals({ checks: [], quantities: quantities({ c010: 3 }) }).coinsCents).toBe(30);
    expect(entryTotals({ checks: [], quantities: quantities({ c001: 10 }) }).coinsCents).toBe(10);
    expect(
      entryTotals({ checks: [], quantities: quantities({ c010: 1, c005: 4 }) }).coinsCents,
    ).toBe(30);
    expect(
      entryTotals({ checks: [], quantities: quantities({ c025: 3, c010: 2, c001: 3 }) })
        .coinsCents,
    ).toBe(98);
  });

  it("returns whole cents for every denomination at every plausible quantity", () => {
    for (const denomination of ALL_DENOMINATIONS) {
      for (const quantity of [0, 1, 3, 7, 99, 250]) {
        const totals = entryTotals({
          checks: [],
          quantities: quantities({ [denomination.id]: quantity }),
        });

        expect(Number.isInteger(totals.grandCents)).toBe(true);
        expect(totals.grandCents).toBe(quantity * denomination.cents);
      }
    }
  });

  it("is zero for an empty entry", () => {
    expect(entryTotals({ checks: [], quantities: quantities({}) })).toEqual({
      checksCents: 0,
      billsCents: 0,
      coinsCents: 0,
      grandCents: 0,
    });
  });
});

describe("sessionTotals", () => {
  it("is zero with no entries", () => {
    expect(sessionTotals([])).toEqual({
      entryCount: 0,
      checksCents: 0,
      billsCents: 0,
      coinsCents: 0,
      grandCents: 0,
    });
  });

  // ONE AND SEVERAL. A summary that happens to work for a single entry and drops the rest is the
  // shape this project has shipped before (plans/retros/ai-b-knowledge-and-retrieval.md).
  it("adds up across one entry and across several", () => {
    const first = entry(1, { checks: [{ number: "1042", amountCents: 10_000 }], counts: { b20: 1 } });
    const second = entry(2, { counts: { b100: 2, c025: 4 } });
    const third = entry(3, { checks: [{ number: "", amountCents: 2_550 }] });

    expect(sessionTotals([first])).toEqual({
      entryCount: 1,
      checksCents: 10_000,
      billsCents: 2_000,
      coinsCents: 0,
      grandCents: 12_000,
    });

    expect(sessionTotals([first, second, third])).toEqual({
      entryCount: 3,
      checksCents: 12_550,
      billsCents: 22_000,
      coinsCents: 100,
      grandCents: 34_650,
    });
  });
});

describe("denominationTally", () => {
  it("sums a denomination across every entry", () => {
    const tally = denominationTally(
      [entry(1, { counts: { b20: 3 } }), entry(2, { counts: { b20: 4, b5: 1 } })],
      BILLS,
    );

    expect(tally).toEqual([
      { denomination: BILLS.find((bill) => bill.id === "b20"), quantity: 7, valueCents: 14_000 },
      { denomination: BILLS.find((bill) => bill.id === "b5"), quantity: 1, valueCents: 500 },
    ]);
  });

  it("omits denominations nobody submitted rather than listing them as zero", () => {
    const tally = denominationTally([entry(1, { counts: { c025: 2 } })], COINS);

    expect(tally).toHaveLength(1);
    expect(tally[0]?.denomination.label).toBe("Quarter");
  });

  it("is empty when the session has no cash at all", () => {
    expect(denominationTally([], BILLS)).toEqual([]);
    expect(denominationTally([entry(1, { checks: [{ number: "9", amountCents: 100 }] })], BILLS))
      .toEqual([]);
  });

  it("keeps the denominations in descending order", () => {
    const tally = denominationTally([entry(1, { counts: { b1: 1, b100: 1, b20: 1 } })], BILLS);

    expect(tally.map((row) => row.denomination.label)).toEqual(["$100", "$20", "$1"]);
  });
});

describe("submittedChecks", () => {
  it("lists every check in entry order, each carrying its entry number", () => {
    const checks = submittedChecks([
      entry(1, {
        checks: [
          { number: "1042", amountCents: 10_000 },
          { number: "1042A", amountCents: 2_500 },
        ],
      }),
      entry(2, { counts: { b20: 1 } }),
      entry(3, { checks: [{ number: "", amountCents: 7_500 }] }),
    ]);

    expect(checks).toEqual([
      { entryNumber: 1, number: "1042", amountCents: 10_000 },
      { entryNumber: 1, number: "1042A", amountCents: 2_500 },
      { entryNumber: 3, number: "", amountCents: 7_500 },
    ]);
  });

  // Deleting entry #2 leaves a gap on purpose: the slip in the tray still says what it says.
  it("keeps the original entry numbers after an entry is deleted", () => {
    const checks = submittedChecks([
      entry(1, { checks: [{ number: "1042", amountCents: 100 }] }),
      entry(3, { checks: [{ number: "1044", amountCents: 200 }] }),
    ]);

    expect(checks.map((check) => check.entryNumber)).toEqual([1, 3]);
  });
});
