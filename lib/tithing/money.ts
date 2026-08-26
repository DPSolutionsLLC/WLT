// Parsing and formatting for the counting screen. Integers in, strings out; no arithmetic.
//
// Money in this module is ALWAYS an integer number of cents (lib/tithing/denominations.ts says
// why). Nothing here returns a float, and nothing here accepts one.

// The most digits an amount field will accept, giving a ceiling of $999,999,999.99. It exists so
// a fistful of keystrokes on a phone cannot produce a number too large to be an exact integer —
// past 2^53 cents the arithmetic stops being reliable and the total would be quietly wrong,
// which is the one outcome a tithing count cannot have. Digits beyond the cap are ignored rather
// than rejected: there is no plausible real amount up here, so a message would be noise.
const MAX_AMOUNT_DIGITS = 11;

// 999,999 of any one denomination. Same reasoning, much lower ceiling — this is a quantity of
// physical bills somebody is holding.
const MAX_QUANTITY_DIGITS = 6;

function groupThousands(digits: string): string {
  return digits.replace(/\B(?=(\d{3})+(?!\d))/g, ",");
}

// "236.00", never "$236". The decimal is always present and always two places, because this is
// what the fixed-decimal amount field displays while it is being typed into: a value that
// gained and lost a decimal point as you typed would be unreadable.
export function formatCents(cents: number): string {
  const digits = String(Math.abs(Math.trunc(cents))).padStart(3, "0");
  return `${groupThousands(digits.slice(0, -2))}.${digits.slice(-2)}`;
}

export function formatDollars(cents: number): string {
  return `$${formatCents(cents)}`;
}

// The fixed-decimal entry rule, in one function.
//
// Every digit typed shifts the value left one place: 2 → 0.02, 23 → 0.23, 236 → 2.36,
// 23600 → 236.00. There is no decimal key to hit and no decimal point to put in the wrong
// place, which is the reason to do it this way on a phone keypad — the field cannot hold
// "23.6" meaning either $23.60 or $2.36.
export function digitsToCents(raw: string): number {
  const digits = raw.replace(/\D/g, "").replace(/^0+/, "").slice(0, MAX_AMOUNT_DIGITS);
  if (digits === "") return 0;
  return Number.parseInt(digits, 10);
}

// Quantity fields take whole counts only. Non-digits are dropped rather than refused so that a
// stray "." or "-" from a numeric keypad does nothing at all instead of putting the field into a
// state the value cannot come back out of.
//
// Returns a STRING, and the empty string survives: an untouched quantity box shows its "0"
// placeholder rather than a real 0 somebody has to read past. A typed "0" is kept as "0".
export function normalizeQuantityInput(raw: string): string {
  const digits = raw.replace(/\D/g, "").slice(0, MAX_QUANTITY_DIGITS);
  if (digits === "") return "";
  return String(Number.parseInt(digits, 10));
}

export function quantityValue(input: string): number {
  if (input === "") return 0;
  const parsed = Number.parseInt(input, 10);
  return Number.isNaN(parsed) ? 0 : parsed;
}
