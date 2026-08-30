// @vitest-environment node
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative, sep } from "node:path";
import { describe, expect, it } from "vitest";

// ---------------------------------------------------------------------------
// EVERY DATE FORMATTER NAMES ITS ZONE, AND THIS IS WHAT ENFORCES IT
// ---------------------------------------------------------------------------
// A formatter with no `timeZone` uses the zone of whatever machine is running it. In a Next.js
// app that is TWO different machines for the same line of code: the server renders a component
// first, the browser hydrates it after. `undefined` means America/Denver on the dev machine and
// UTC on Vercel, so the server and the browser disagree — a React #418 hydration mismatch, a
// visible flash of the wrong text, and a first paint that is simply wrong in production.
//
// It shipped exactly that way. /youth/profiles and /youth/calendar served "Sat, Jan 16, 2027,
// 2:30 AM" over a 7:30pm Friday game: wrong day, seven hours out, invisible in dev because both
// sides were America/Denver there. CLAUDE.md §9's "passes every test on the dev machine and ships
// wrong", arriving through the render path rather than through an ICS file. 3262 tests were green
// at the time and none of them could see it, because every one of them ran in one process with
// one zone — which is the same reason no assertion about a formatted STRING can replace this.
// So this reads the source instead, the way tests/lib/tithingNoFloat.test.ts does.
//
// The rule is deliberately mechanical: name the zone, whichever zone it is. Which one is right
// depends on what is being formatted, and the codebase settles that per case —
//   - a `timestamptz` somebody has to turn up at → the WARD's zone
//     (lib/visits/visitDates.ts, app/(app)/youth/EventList.tsx)
//   - a `date` column, or a stamp that must read the same for everyone → UTC
//     (lib/calendar/dates.ts, app/(app)/ai-settings/VersionHistory.tsx)
// This test does not adjudicate that. It only refuses the third option, which is not naming one.

const SCANNED_DIRECTORIES = ["app", "components", "lib"];

// A formatter that legitimately has no zone to name. EMPTY, and it should stay that way for
// anything that formats a date.
//
// The one thing that could honestly belong here is a NUMBER: `count.toLocaleString()` formats a
// quantity and a time zone is meaningless to it. There are none today. If you add one and this
// test fails, add it here with a comment saying it is a number — do not weaken the pattern, which
// is what makes the check worth having. Precedent: the held-back migration allowlist in
// plans/retros/visits-e-cadence-and-priority.md.
const ALLOWED: readonly string[] = [];

const CALL_PATTERN = /(?:Intl\.DateTimeFormat|\.toLocaleString|\.toLocaleDateString|\.toLocaleTimeString)\s*\(/g;

function stripComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/\/\/[^\n]*/g, " ");
}

// Strings are blanked so that prose inside an argument cannot satisfy the check, and so an
// apostrophe in a comment cannot unbalance the paren scan below.
function stripStringLiterals(source: string): string {
  return source
    .replace(/"(?:[^"\\]|\\.)*"/g, '""')
    .replace(/'(?:[^'\\]|\\.)*'/g, "''")
    .replace(/`(?:[^`\\]|\\.)*`/g, "``");
}

function listSourceFiles(directory: string): string[] {
  const found: string[] = [];

  function walk(current: string): void {
    for (const entry of readdirSync(current)) {
      const full = join(current, entry);
      if (statSync(full).isDirectory()) {
        walk(full);
        continue;
      }
      if (entry.endsWith(".ts") || entry.endsWith(".tsx")) found.push(full);
    }
  }

  walk(join(process.cwd(), directory));
  return found;
}

// The argument list, found by balancing parentheses from the opening one. A regex cannot do this:
// an options object spans lines and contains its own braces and parens.
function argumentsOf(code: string, openIndex: number): string {
  let depth = 0;

  for (let index = openIndex; index < code.length; index += 1) {
    const character = code[index];
    if (character === "(") depth += 1;
    else if (character === ")") {
      depth -= 1;
      if (depth === 0) return code.slice(openIndex + 1, index);
    }
  }

  // Unbalanced — treat the rest of the file as the argument rather than silently passing.
  return code.slice(openIndex + 1);
}

export type Violation = { line: number; call: string };

export function findImplicitZoneCalls(source: string): Violation[] {
  const code = stripStringLiterals(stripComments(source));
  const violations: Violation[] = [];

  CALL_PATTERN.lastIndex = 0;
  let match = CALL_PATTERN.exec(code);

  while (match !== null) {
    const openIndex = match.index + match[0].length - 1;
    const args = argumentsOf(code, openIndex);

    if (!args.includes("timeZone")) {
      violations.push({
        line: code.slice(0, match.index).split("\n").length,
        call: match[0].replace(/\s*\($/, ""),
      });
    }

    match = CALL_PATTERN.exec(code);
  }

  return violations;
}

describe("the implicit-zone scanner", () => {
  // PROVED ABLE TO FAIL BEFORE IT IS BELIEVED. A scanner with a broken pattern reports zero
  // violations across the whole repo and looks exactly like a clean bill of health — the theatre
  // tests/db/notification-triggers-seed.test.ts records catching in itself.
  it("catches a formatter with no zone", () => {
    const source = `const f = new Intl.DateTimeFormat("en-US", { day: "numeric" });`;

    expect(findImplicitZoneCalls(source)).toHaveLength(1);
  });

  it("catches the exact shape that shipped", () => {
    // app/(app)/youth/EventList.tsx as it was before 2026-08-29.
    const source = `
      function formatInstant(instant: string): string {
        return new Date(instant).toLocaleString(undefined, {
          weekday: "short",
          hour: "numeric",
          minute: "2-digit",
        });
      }
    `;

    expect(findImplicitZoneCalls(source)).toHaveLength(1);
  });

  it("catches a bare call with no arguments at all", () => {
    expect(findImplicitZoneCalls(`new Date(v).toLocaleDateString()`)).toHaveLength(1);
  });

  it("accepts a literal zone", () => {
    const source = `new Intl.DateTimeFormat("en-US", { timeZone: "UTC", day: "numeric" })`;

    expect(findImplicitZoneCalls(source)).toEqual([]);
  });

  it("accepts a zone passed as a variable", () => {
    const source = `parsed.toLocaleString("en-US", { timeZone, hour: "numeric" })`;

    expect(findImplicitZoneCalls(source)).toEqual([]);
  });

  it("does not mistake the options TYPE for a call", () => {
    // lib/youth/ics/buildImportPreview.ts declares one of these, and it names no zone because it
    // is not a formatter.
    const source = `const DATE_PARTS: Intl.DateTimeFormatOptions = { day: "numeric" };`;

    expect(findImplicitZoneCalls(source)).toEqual([]);
  });

  it("is not satisfied by the word appearing in a comment", () => {
    const source = `
      // the timeZone is deliberately omitted here
      new Intl.DateTimeFormat("en-US", { day: "numeric" })
    `;

    expect(findImplicitZoneCalls(source)).toHaveLength(1);
  });
});

describe("every date formatter in the app", () => {
  const files = SCANNED_DIRECTORIES.flatMap(listSourceFiles);

  it("scans a plausible number of files", () => {
    // A walk that silently returns nothing would make every assertion below pass. This is the
    // anchor the notification-triggers test calls for by name.
    expect(files.length).toBeGreaterThan(200);
  });

  it("names its time zone explicitly", () => {
    const offenders: string[] = [];

    for (const file of files) {
      const label = relative(process.cwd(), file).split(sep).join("/");
      if (ALLOWED.includes(label)) continue;

      for (const violation of findImplicitZoneCalls(readFileSync(file, "utf8"))) {
        offenders.push(`${label}:${violation.line} — ${violation.call}`);
      }
    }

    expect(offenders).toEqual([]);
  });
});
