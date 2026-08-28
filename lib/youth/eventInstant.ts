// THE CLIENT HALF OF lib/validation/youth.ts's `eventInstantSchema`. The two must agree, so they
// are written as one rule in two files that reference each other: the schema REFUSES a floating
// time, and this module is what makes sure no form in this app ever sends one.
//
// A pure module on purpose — no "use client", no server imports. Both halves of the round trip
// (the create form and the edit control) read it, so "what instant did the user mean" has one
// answer (plans/retros/visits-b-*, visits-f-*: one predicate, one place). It is also what makes
// the double-conversion bug testable without a browser.
//
// ---------------------------------------------------------------------------
// WHY A `datetime-local` VALUE CANNOT BE POSTED AS IT STANDS
// ---------------------------------------------------------------------------
// `<input type="datetime-local">` yields `2026-09-04T19:30` — half past seven in NO PARTICULAR
// PLACE. Posted as-is, the server reads it in whatever zone the server happens to run in, stores
// the resulting instant, and the game shows an hour or eight out. 08-youth-activities.md is
// blunt about the cost: "A game showing at the wrong hour makes the whole feature useless."
//
// ---------------------------------------------------------------------------
// THE DOUBLE-CONVERSION BUG, AND WHY THIS SHAPE AVOIDS IT
// ---------------------------------------------------------------------------
// The obvious implementation is `new Date(value).toISOString()`, which converts local → UTC. Fill
// the form back in from that UTC string without converting BACK, and the second save converts
// again: 7:30pm becomes 1:30am becomes 7:30pm the following morning. It only ever appears on the
// SECOND write, which is why it survives a demo.
//
// So this module never converts the wall clock at all. It KEEPS the digits the person typed and
// appends the offset that was in force at that local moment. 7:30pm stays the characters
// "19:30"; only a suffix is added. The inverse re-derives those same digits from the instant.
// Round-tripping is therefore idempotent by construction rather than by care.

function twoDigits(value: number): string {
  return String(value).padStart(2, "0");
}

// The offset AT THAT LOCAL MOMENT, not the offset today — which is the whole DST story. A game
// on 1 November and a game on 1 July are an hour apart in the same zone, and `getTimezoneOffset`
// is evaluated on the parsed date rather than on `new Date()` for exactly that reason.
//
// The sign is inverted deliberately: getTimezoneOffset() returns MINUTES BEHIND UTC (600 for
// UTC-10), and ISO-8601 writes minutes AHEAD (-10:00). Getting this backwards is a silent
// twenty-hour error in the two zones where it would be noticed least.
export function offsetSuffix(instant: Date): string {
  const minutesAheadOfUtc = -instant.getTimezoneOffset();
  const sign = minutesAheadOfUtc < 0 ? "-" : "+";
  const absolute = Math.abs(minutesAheadOfUtc);

  return `${sign}${twoDigits(Math.floor(absolute / 60))}:${twoDigits(absolute % 60)}`;
}

// Takes a `datetime-local` value and returns an offset-bearing ISO string the schema accepts, or
// null when the field is empty or unparseable. Null rather than a throw: an empty date field is
// an ordinary state of a form being filled in, not an exception.
export function toOffsetBearingInstant(localValue: string): string | null {
  const trimmed = localValue.trim();
  if (trimmed === "") return null;

  // The browser reads a bare `YYYY-MM-DDTHH:MM` in LOCAL time, which is what makes it the right
  // thing to ask for the offset. A value that already carries a zone would be read as that zone
  // and is not something this input can produce.
  const parsed = new Date(trimmed);
  if (!Number.isFinite(parsed.getTime())) return null;

  // Seconds are optional in a datetime-local value and required by nothing here, but writing
  // them makes every stored instant the same shape, which matters when somebody is comparing two
  // rows in the database by eye.
  const withSeconds = trimmed.length === 16 ? `${trimmed}:00` : trimmed;

  return `${withSeconds}${offsetSuffix(parsed)}`;
}

// The inverse, for filling the form back in. Reads the instant IN THE BROWSER'S OWN ZONE and
// writes the local wall clock — never `toISOString().slice(0, 16)`, which writes UTC into a field
// the browser will then read as local time and is precisely the double conversion above.
export function toLocalInputValue(instant: string): string {
  const parsed = new Date(instant);
  if (!Number.isFinite(parsed.getTime())) return "";

  return [
    `${parsed.getFullYear()}-${twoDigits(parsed.getMonth() + 1)}-${twoDigits(parsed.getDate())}`,
    `${twoDigits(parsed.getHours())}:${twoDigits(parsed.getMinutes())}`,
  ].join("T");
}
