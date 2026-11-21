// Which street a household is on, read from `households.address` — one free-text field, so there
// are no street columns to group by (ITER-055 bv8, plan P16). Not a map.
//
// MATCHING STAYS BORING, classifyLocation.ts's rule: drop the house number and any unit, fold case,
// spacing and a fixed list of spellings, and compare. A near-miss ("Mapel St") is its own group,
// never a guess — a household put on the wrong street is one somebody walks past.

export type StreetKey = { key: string; label: string };

export type StreetGroup<Row> = { key: string | null; label: string; rows: Row[] };

export const NO_STREET_LABEL = "No street on file";

const SUFFIXES: Record<string, string> = {
  st: "street",
  str: "street",
  ave: "avenue",
  av: "avenue",
  dr: "drive",
  rd: "road",
  ln: "lane",
  ct: "court",
  cir: "circle",
  blvd: "boulevard",
  pl: "place",
  hwy: "highway",
  pkwy: "parkway",
};

const DIRECTIONS: Record<string, string> = {
  n: "north",
  s: "south",
  e: "east",
  w: "west",
  ne: "northeast",
  nw: "northwest",
  se: "southeast",
  sw: "southwest",
};

const DIRECTION_WORDS = new Set(Object.values(DIRECTIONS));
const PO_BOX = /^p\s*o\s*box\b|^post\s+office\s+box\b|^box\s+\d/;
const UNIT = /\s+(?:apt|apartment|unit|suite|ste|lot|trlr|#)\s*[\w-]*$/;
const HASH_UNIT = /\s*#\s*[\w-]+/g;
const HOUSE_NUMBER = /^\d[\w/-]*$/;

function canonicalDirection(token: string): string {
  return DIRECTIONS[token] ?? token;
}

function isDirection(token: string): boolean {
  return DIRECTION_WORDS.has(canonicalDirection(token));
}

function titleCase(word: string): string {
  return word.charAt(0).toUpperCase() + word.slice(1);
}

export function streetKeyFor(address: string | null | undefined): StreetKey | null {
  if (address === null || address === undefined) return null;

  const firstLine = address.split(/[,\n]/)[0] ?? "";
  let line = firstLine.toLowerCase().replace(/\./g, "").replace(/\s+/g, " ").trim();
  if (line === "" || PO_BOX.test(line)) return null;

  line = line.replace(HASH_UNIT, "").replace(UNIT, "").trim();

  const tokens = line.split(" ").filter((token) => token !== "");
  if (tokens.length > 0 && HOUSE_NUMBER.test(tokens[0])) tokens.shift();
  if (tokens.length === 0) return null;

  // Directions only at either end ("N Main St", "Main St N"); a suffix only as the last word, or
  // just before a trailing direction. "St" at the front is a saint, never a street.
  tokens[0] = canonicalDirection(tokens[0]);
  const last = tokens.length - 1;
  if (last > 0) tokens[last] = canonicalDirection(tokens[last]);
  const suffixAt = last > 0 && isDirection(tokens[last]) ? last - 1 : last;
  if (suffixAt > 0 || tokens.length === 1) {
    tokens[suffixAt] = SUFFIXES[tokens[suffixAt]] ?? tokens[suffixAt];
  }

  return { key: tokens.join(" "), label: tokens.map(titleCase).join(" ") };
}

// Streets A to Z, "No street on file" last. Rows keep the order they arrived in, so the list's own
// sort still decides the order inside each street.
export function groupByStreet<Row extends { address: string | null }>(
  rows: readonly Row[],
): StreetGroup<Row>[] {
  const groups = new Map<string, StreetGroup<Row>>();
  const unplaced: Row[] = [];

  for (const row of rows) {
    const street = streetKeyFor(row.address);
    if (street === null) {
      unplaced.push(row);
      continue;
    }
    const existing = groups.get(street.key);
    if (existing === undefined) groups.set(street.key, { ...street, rows: [row] });
    else existing.rows.push(row);
  }

  const ordered = [...groups.values()].sort((left, right) => left.label.localeCompare(right.label));
  if (unplaced.length > 0) ordered.push({ key: null, label: NO_STREET_LABEL, rows: unplaced });
  return ordered;
}
