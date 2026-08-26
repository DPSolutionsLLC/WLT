import {
  BILLS,
  COINS,
  type Denomination,
  type DenominationQuantities,
} from "@/lib/tithing/denominations";

// Every number a tithing session displays, derived from the entries.
//
// The totals are COMPUTED, never stored on the entry. The prototype cached checkSum, billsSum,
// coinsSum and grand on each saved entry, which means an entry edited by a future change can
// carry a total that no longer matches its own contents, and nothing would catch it. Recomputing
// is a handful of integer additions over a session that is realistically dozens of entries long.

export type CheckAmount = {
  // The number written on the check, as typed. A text field, not a number: real check numbers
  // carry letters ("1042A") and leading zeros.
  number: string;
  amountCents: number;
};

export type TithingEntryContents = {
  checks: CheckAmount[];
  quantities: DenominationQuantities;
};

export type TithingEntry = TithingEntryContents & {
  // Written on the paper slip. Assigned once at save and never reused or renumbered — a
  // deleted entry leaves a gap on purpose, because the number on the paper still says what it
  // says (plans/09-meetings-tithing.md §Step B2).
  entryNumber: number;
};

export type EntryTotals = {
  checksCents: number;
  billsCents: number;
  coinsCents: number;
  grandCents: number;
};

export type SessionTotals = EntryTotals & { entryCount: number };

export type DenominationTally = {
  denomination: Denomination;
  quantity: number;
  valueCents: number;
};

export type SubmittedCheck = CheckAmount & { entryNumber: number };

function denominationSubtotalCents(
  denominations: readonly Denomination[],
  quantities: DenominationQuantities,
): number {
  return denominations.reduce(
    (total, denomination) => total + (quantities[denomination.id] ?? 0) * denomination.cents,
    0,
  );
}

export function entryTotals(entry: TithingEntryContents): EntryTotals {
  const checksCents = entry.checks.reduce((total, check) => total + check.amountCents, 0);
  const billsCents = denominationSubtotalCents(BILLS, entry.quantities);
  const coinsCents = denominationSubtotalCents(COINS, entry.quantities);

  return {
    checksCents,
    billsCents,
    coinsCents,
    grandCents: checksCents + billsCents + coinsCents,
  };
}

export function sessionTotals(entries: readonly TithingEntry[]): SessionTotals {
  return entries.reduce<SessionTotals>(
    (running, entry) => {
      const totals = entryTotals(entry);
      return {
        entryCount: running.entryCount + 1,
        checksCents: running.checksCents + totals.checksCents,
        billsCents: running.billsCents + totals.billsCents,
        coinsCents: running.coinsCents + totals.coinsCents,
        grandCents: running.grandCents + totals.grandCents,
      };
    },
    { entryCount: 0, checksCents: 0, billsCents: 0, coinsCents: 0, grandCents: 0 },
  );
}

// The verification count: how many of each denomination the drawer should physically contain.
//
// Denominations nobody submitted are OMITTED, not listed as zero. The person holding this screen
// is counting against a stack of cash; thirteen rows of which six say "0 coins" is a list to read
// past rather than a list to check.
export function denominationTally(
  entries: readonly TithingEntry[],
  denominations: readonly Denomination[],
): DenominationTally[] {
  return denominations
    .map((denomination) => {
      const quantity = entries.reduce(
        (total, entry) => total + (entry.quantities[denomination.id] ?? 0),
        0,
      );
      return { denomination, quantity, valueCents: quantity * denomination.cents };
    })
    .filter((tally) => tally.quantity > 0);
}

// Every check across the session, in the order they were entered, each still carrying the entry
// number written on its slip.
export function submittedChecks(entries: readonly TithingEntry[]): SubmittedCheck[] {
  return entries.flatMap((entry) =>
    entry.checks.map((check) => ({ ...check, entryNumber: entry.entryNumber })),
  );
}
