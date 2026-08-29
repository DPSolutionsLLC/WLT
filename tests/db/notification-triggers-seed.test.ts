// @vitest-environment node
//
// One list of notification trigger keys is hand-maintained in THREE places: the seed SQL that
// gives a new ward its rows, SPEC.md, and NOTIFICATION_TRIGGERS in the test harness. They drift,
// and the drift is silent by construction — emitNotification() looks a key up in
// notification_settings, finds no row, and returns without an error or a log. The only symptom is
// a notification that does not arrive, which nothing observes until somebody walks a scenario
// looking for it.
//
// On 2026-08-28 the three disagreed by six keys between them, while a comment above
// NOTIFICATION_TRIGGERS asserted an exact match with the seed file. A rule stated beside the thing
// it governs is not a rule that is kept; this suite is that comment, enforced.
//
// Every input is a file on disk. No database, and no import from testing/ — the harness compiles
// under its own tsconfig with allowImportingTsExtensions, so importing NOTIFICATION_TRIGGERS
// directly breaks `npm run typecheck` on the app graph.

import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const SEED_SQL_PATH = path.resolve(process.cwd(), "supabase/seed/notification_triggers.sql");
const HARNESS_PATH = path.resolve(process.cwd(), "testing/infrastructure/seedUtils.ts");
const SPEC_PATH = path.resolve(process.cwd(), "SPEC.md");

// A key every source has carried since Foundation. Its presence proves a parser actually parsed
// something: three regexes that match nothing would make every set comparison below pass on empty
// arrays, which is the one way this suite could ship green and useless.
const ANCHOR_KEY = "plan_submitted";

type TriggerDefinition = { key: string; defaultRoles: string[] };

function quotedValues(fragment: string, quote: string): string[] {
  const pattern = new RegExp(`${quote}([a-z_]+)${quote}`, "g");
  return [...fragment.matchAll(pattern)].map((match) => match[1]);
}

// ('key', array['role', 'role']) tuples. Comments are stripped FIRST because the file's prose
// mentions trigger keys by name inside them. Tolerates the ::text[] cast on the first tuple.
function parseSeedSqlTriggers(text: string): TriggerDefinition[] {
  const withoutComments = text.replace(/--[^\n]*/g, "");
  const tuple = /\(\s*'([a-z_]+)'\s*,\s*array\[([^\]]*)\]/g;

  return [...withoutComments.matchAll(tuple)].map((match) => ({
    key: match[1],
    defaultRoles: quotedValues(match[2], "'"),
  }));
}

// { key: "…", defaultRoles: [ … ] } objects. Slicing to the array region before stripping //
// comments keeps the strip from touching the rest of a 1700-line file; collapsing newlines makes
// the one multi-line entry parse the same as the single-line ones.
function parseHarnessTriggers(text: string): TriggerDefinition[] {
  const start = text.indexOf("NOTIFICATION_TRIGGERS");
  if (start === -1) return [];

  const end = text.indexOf("];", start);
  if (end === -1) return [];

  const region = text
    .slice(start, end)
    .replace(/\/\/[^\n]*/g, "")
    .replace(/\s+/g, " ");
  const entry = /\{\s*key:\s*"([a-z_]+)"\s*,\s*defaultRoles:\s*\[([^\]]*)\]/g;

  return [...region.matchAll(entry)].map((match) => ({
    key: match[1],
    defaultRoles: quotedValues(match[2], '"'),
  }));
}

// The first fenced block under the heading. Section headings such as `-- Programs` become empty
// once the comment is stripped and fall out with the blank lines.
function parseSpecTriggerKeys(text: string): string[] {
  const heading = text.indexOf("### Trigger Keys (v1)");
  if (heading === -1) return [];

  const fenceStart = text.indexOf("```", heading);
  if (fenceStart === -1) return [];

  const bodyStart = text.indexOf("\n", fenceStart) + 1;
  const fenceEnd = text.indexOf("```", bodyStart);
  if (fenceEnd === -1) return [];

  return text
    .slice(bodyStart, fenceEnd)
    .split("\n")
    .map((line) => line.replace(/--.*$/, "").trim())
    .filter((line) => line.length > 0);
}

function duplicates(keys: string[]): string[] {
  const seen = new Set<string>();
  return keys.filter((key) => (seen.has(key) ? true : (seen.add(key), false)));
}

function missingFrom(expected: string[], actual: string[]): string[] {
  const present = new Set(actual);
  return expected.filter((key) => !present.has(key));
}

const seedTriggers = parseSeedSqlTriggers(readFileSync(SEED_SQL_PATH, "utf8"));
const harnessTriggers = parseHarnessTriggers(readFileSync(HARNESS_PATH, "utf8"));
const specKeys = parseSpecTriggerKeys(readFileSync(SPEC_PATH, "utf8"));

const seedKeys = seedTriggers.map((trigger) => trigger.key);
const harnessKeys = harnessTriggers.map((trigger) => trigger.key);

describe("notification trigger keys", () => {
  // No total count is asserted anywhere. A test that must be edited every time a key is added is
  // a test somebody eventually edits without thinking about what it was for.
  describe("every source parses", () => {
    it("finds the anchor key in the seed SQL", () => {
      expect(seedKeys).toContain(ANCHOR_KEY);
    });

    it("finds the anchor key in NOTIFICATION_TRIGGERS", () => {
      expect(harnessKeys).toContain(ANCHOR_KEY);
    });

    it("finds the anchor key in SPEC.md", () => {
      expect(specKeys).toContain(ANCHOR_KEY);
    });
  });

  // A duplicate would let a set comparison pass while the seed insert carries a redundant tuple.
  describe("no source repeats a key", () => {
    it("the seed SQL has no duplicate", () => {
      expect(duplicates(seedKeys)).toEqual([]);
    });

    it("NOTIFICATION_TRIGGERS has no duplicate", () => {
      expect(duplicates(harnessKeys)).toEqual([]);
    });

    it("SPEC.md has no duplicate", () => {
      expect(duplicates(specKeys)).toEqual([]);
    });
  });

  // Both directions, as two expectations, so the failure names which way round the drift went and
  // which keys are involved. A length comparison would say neither.
  describe("NOTIFICATION_TRIGGERS matches the seed SQL", () => {
    it("carries every key the seed SQL carries", () => {
      expect(missingFrom(seedKeys, harnessKeys)).toEqual([]);
    });

    it("carries no key the seed SQL does not", () => {
      expect(missingFrom(harnessKeys, seedKeys)).toEqual([]);
    });

    // Sorted copies: the order of a Postgres text[] is preserved but means nothing, so asserting
    // order would turn a harmless reordering into a failure.
    it("agrees on default_roles for every shared key", () => {
      const seedRolesByKey = new Map(
        seedTriggers.map((trigger) => [trigger.key, [...trigger.defaultRoles].sort()]),
      );

      const mismatches = harnessTriggers
        .filter((trigger) => seedRolesByKey.has(trigger.key))
        .map((trigger) => ({
          key: trigger.key,
          harness: [...trigger.defaultRoles].sort(),
          seed: seedRolesByKey.get(trigger.key),
        }))
        .filter(
          (comparison) =>
            comparison.harness.join(",") !== (comparison.seed ?? []).join(","),
        );

      expect(mismatches).toEqual([]);
    });
  });

  // Keys only. SPEC.md documents the list, not the role defaults — the seed SQL is where those
  // live, and duplicating them into prose would be a fourth copy to keep in step.
  describe("SPEC.md matches the seed SQL", () => {
    it("lists every key the seed SQL carries", () => {
      expect(missingFrom(seedKeys, specKeys)).toEqual([]);
    });

    it("lists no key the seed SQL does not", () => {
      expect(missingFrom(specKeys, seedKeys)).toEqual([]);
    });
  });
});
