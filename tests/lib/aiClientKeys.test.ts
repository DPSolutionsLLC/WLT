// @vitest-environment node
//
// Phase 5 test **no-client-keys**. CLAUDE.md rule 4: ANTHROPIC_API_KEY and OPENAI_API_KEY never
// reach the browser, and no NEXT_PUBLIC_ prefix on either.
//
// This is a SOURCE-LEVEL test on purpose. A runtime test can only prove the paths it happens to
// execute, and the failure this guards against is a single import added to a single client
// component months from now. Reading the repo's own source proves it for every file at once.

import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const ROOT = path.resolve(__dirname, "../..");
const SCANNED_DIRECTORIES = ["app", "components", "lib", "types"];
const SOURCE_EXTENSIONS = new Set([".ts", ".tsx"]);

// The two modules that hold a vendor key or reach one. Both are server-only by construction.
const SERVER_ONLY_AI_MODULES = ["@/lib/ai/client", "@/lib/ai/queries"];

function collectSourceFiles(directory: string): string[] {
  const absolute = path.join(ROOT, directory);
  const found: string[] = [];

  const walk = (current: string) => {
    for (const entry of readdirSync(current)) {
      const full = path.join(current, entry);
      if (statSync(full).isDirectory()) {
        walk(full);
        continue;
      }
      if (SOURCE_EXTENSIONS.has(path.extname(entry))) found.push(full);
    }
  };

  walk(absolute);
  return found;
}

const SOURCE_FILES = SCANNED_DIRECTORIES.flatMap(collectSourceFiles);

function read(file: string): string {
  return readFileSync(file, "utf8");
}

function relative(file: string): string {
  return path.relative(ROOT, file).split(path.sep).join("/");
}

function isClientComponent(contents: string): boolean {
  // The directive must be the first statement, so it appears in the opening lines. Matching
  // anywhere would count the word inside a comment discussing client components.
  return /^\s*(?:\/\/[^\n]*\n|\/\*[\s\S]*?\*\/\s*)*["']use client["']/.test(contents);
}

function importedModules(contents: string): string[] {
  const modules: string[] = [];
  const pattern = /(?:from|import)\s+["']([^"']+)["']/g;
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(contents)) !== null) modules.push(match[1]);
  return modules;
}

describe("AI vendor keys never reach the browser", () => {
  it("finds source files to scan", () => {
    // A scan that silently matched nothing would pass every assertion below.
    expect(SOURCE_FILES.length).toBeGreaterThan(50);
  });

  it("has no NEXT_PUBLIC_ prefix on either vendor key anywhere", () => {
    const offenders = SOURCE_FILES.filter((file) =>
      /NEXT_PUBLIC_(?:ANTHROPIC|OPENAI)/.test(read(file)),
    ).map(relative);

    expect(offenders).toEqual([]);
  });

  it("keeps the browser guard in lib/ai/client.ts", () => {
    const contents = read(path.join(ROOT, "lib/ai/client.ts"));

    expect(contents).toContain('typeof window !== "undefined"');
    expect(contents).toContain("ANTHROPIC_API_KEY must never reach the client");
  });

  // Transitive, one level deep through @/lib/ai/*: a client component that imports
  // lib/ai/systemPrompt.ts is fine, but would not be if THAT file reached the client module.
  it("keeps every client component out of the server-only AI modules", () => {
    const aiModuleFiles = new Map<string, string>();
    for (const file of SOURCE_FILES) {
      const rel = relative(file);
      if (rel.startsWith("lib/ai/")) {
        aiModuleFiles.set(`@/${rel.replace(/\.tsx?$/, "")}`, read(file));
      }
    }

    const offenders: string[] = [];

    for (const file of SOURCE_FILES) {
      const contents = read(file);
      if (!isClientComponent(contents)) continue;

      for (const imported of importedModules(contents)) {
        if (SERVER_ONLY_AI_MODULES.includes(imported)) {
          offenders.push(`${relative(file)} imports ${imported}`);
          continue;
        }

        const reached = aiModuleFiles.get(imported);
        if (!reached) continue;

        for (const nested of importedModules(reached)) {
          if (SERVER_ONLY_AI_MODULES.includes(nested)) {
            offenders.push(`${relative(file)} reaches ${nested} through ${imported}`);
          }
        }
      }
    }

    expect(offenders).toEqual([]);
  });

  it("keeps the pure AI modules importable from anywhere", () => {
    // The other half of the rule. systemPrompt.ts and moduleInstructions.ts are PURE precisely so
    // a client component can import them; if they ever reach next/headers the test above starts
    // failing for files that did nothing wrong.
    for (const pure of ["lib/ai/systemPrompt.ts", "lib/ai/moduleInstructions.ts"]) {
      const contents = read(path.join(ROOT, pure));
      expect(contents).not.toContain("next/headers");
      expect(contents).not.toContain("@/lib/supabase/");
      expect(contents).not.toContain("@/lib/ai/client");
      expect(contents).not.toContain("@/lib/ai/queries");
    }
  });
});
