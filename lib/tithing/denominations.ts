import { quantityValue } from "@/lib/tithing/money";

// The denominations a ward counts, in INTEGER CENTS.
//
// `cents` is the unit for every denomination including the coins, and that is the whole point.
// The prototype this module replicates stored coin values as dollars (0.25, 0.10, 0.05) and
// patched the resulting drift with Math.round(q * val * 100) / 100 at each of the four places it
// multiplied. plans/09-meetings-tithing.md §Pitfalls calls floating-point money in a tithing
// count unacceptable; a quarter is 25, so there is nothing to round and nothing to patch.
//
// The ids match the prototype's (b100, c025 …) so a row on screen can be traced back to it.

export type DenominationKind = "bill" | "coin";

// The ids are spelled out here rather than inferred from the two arrays below, so that
// DenominationQuantities can be keyed by them. Inferring the union FROM the arrays and then
// keying the record BY that union is circular, and the compiler resolves the circle by widening
// the key to `string` — at which point quantities[id] is `any` and a typo in a denomination id
// becomes a silent zero in a money total. The `satisfies` on each array keeps the two lists
// honest: an id here with no row below, or a row below with an id not here, will not compile.
export type BillId = "b100" | "b50" | "b20" | "b10" | "b5" | "b2" | "b1";
export type CoinId = "c100" | "c050" | "c025" | "c010" | "c005" | "c001";
export type DenominationId = BillId | CoinId;

export type Denomination = {
  id: DenominationId;
  label: string;
  sublabel: string;
  cents: number;
  kind: DenominationKind;
  // "12 bills" / "12 coins" on the summary. Held here rather than derived from `kind` at the
  // call site so the two lists stay the only place that knows the difference.
  unitLabel: string;
};

export const BILLS = [
  { id: "b100", label: "$100", sublabel: "Hundreds", cents: 10_000, kind: "bill", unitLabel: "bills" },
  { id: "b50", label: "$50", sublabel: "Fifties", cents: 5_000, kind: "bill", unitLabel: "bills" },
  { id: "b20", label: "$20", sublabel: "Twenties", cents: 2_000, kind: "bill", unitLabel: "bills" },
  { id: "b10", label: "$10", sublabel: "Tens", cents: 1_000, kind: "bill", unitLabel: "bills" },
  { id: "b5", label: "$5", sublabel: "Fives", cents: 500, kind: "bill", unitLabel: "bills" },
  { id: "b2", label: "$2", sublabel: "Twos", cents: 200, kind: "bill", unitLabel: "bills" },
  { id: "b1", label: "$1", sublabel: "Ones", cents: 100, kind: "bill", unitLabel: "bills" },
] as const satisfies readonly Denomination[];

export const COINS = [
  { id: "c100", label: "Dollar Coin", sublabel: "$1.00 each", cents: 100, kind: "coin", unitLabel: "coins" },
  { id: "c050", label: "Half Dollar", sublabel: "$0.50 each", cents: 50, kind: "coin", unitLabel: "coins" },
  { id: "c025", label: "Quarter", sublabel: "$0.25 each", cents: 25, kind: "coin", unitLabel: "coins" },
  { id: "c010", label: "Dime", sublabel: "$0.10 each", cents: 10, kind: "coin", unitLabel: "coins" },
  { id: "c005", label: "Nickel", sublabel: "$0.05 each", cents: 5, kind: "coin", unitLabel: "coins" },
  { id: "c001", label: "Penny", sublabel: "$0.01 each", cents: 1, kind: "coin", unitLabel: "coins" },
] as const satisfies readonly Denomination[];

export const ALL_DENOMINATIONS: readonly Denomination[] = [...BILLS, ...COINS];

// Every id is present, always. A Partial here would make "the ward counted no quarters" and
// "nobody has looked at the quarters row yet" the same value, and the summary has to tell them
// apart to decide whether to print the row.
export type DenominationQuantities = Record<DenominationId, number>;

// What the form holds while somebody is typing: the raw text, not a number. A number cannot
// represent the empty field that a quantity row starts in, and coercing empty to 0 would put a
// premature "0" in every one of the thirteen boxes on a counting screen.
export type DenominationInputs = Record<DenominationId, string>;

export function emptyDenominationInputs(): DenominationInputs {
  return Object.fromEntries(
    ALL_DENOMINATIONS.map((denomination) => [denomination.id, ""]),
  ) as DenominationInputs;
}

export function emptyDenominationQuantities(): DenominationQuantities {
  return Object.fromEntries(
    ALL_DENOMINATIONS.map((denomination) => [denomination.id, 0]),
  ) as DenominationQuantities;
}

// Form text to countable numbers, at the one boundary between them. Everything upstream of this
// call is a string somebody is typing; everything downstream is integer arithmetic.
export function toQuantities(inputs: DenominationInputs): DenominationQuantities {
  return Object.fromEntries(
    ALL_DENOMINATIONS.map((denomination) => [
      denomination.id,
      quantityValue(inputs[denomination.id] ?? ""),
    ]),
  ) as DenominationQuantities;
}

// The reverse, for loading a saved entry back into the form. A zero becomes an EMPTY box rather
// than a literal "0": the eleven denominations nobody submitted should look untouched, exactly
// as they did before the entry was saved.
export function toDenominationInputs(quantities: DenominationQuantities): DenominationInputs {
  return Object.fromEntries(
    ALL_DENOMINATIONS.map((denomination) => {
      const quantity = quantities[denomination.id] ?? 0;
      return [denomination.id, quantity === 0 ? "" : String(quantity)];
    }),
  ) as DenominationInputs;
}
