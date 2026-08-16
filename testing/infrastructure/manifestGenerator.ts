import { readFile, readdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { TESTING_ROOT } from "./envLoader.ts";
import type { ScenarioManifest, ScenarioManifestEntry } from "./types.ts";

const SCENARIOS_ROOT = path.join(TESTING_ROOT, "scenarios");
const MANIFEST_PATH = path.join(SCENARIOS_ROOT, "manifest.json");

function parseFrontmatter(markdown: string): Record<string, string> {
  const match = /^---\r?\n([\s\S]*?)\r?\n---/.exec(markdown);
  if (!match) return {};

  const fields: Record<string, string> = {};

  for (const line of match[1].split(/\r?\n/)) {
    const separator = line.indexOf(":");
    if (separator === -1) continue;

    const key = line.slice(0, separator).trim();
    const value = line.slice(separator + 1).trim();
    if (key) fields[key] = value;
  }

  return fields;
}

function parseList(value: string | undefined): string[] {
  if (!value) return [];

  return value
    .replace(/^\[|\]$/g, "")
    .split(",")
    .map((entry) => entry.trim().replace(/^["']|["']$/g, ""))
    .filter(Boolean);
}

function extractSection(markdown: string, heading: string): string {
  const pattern = new RegExp(`^##\\s+${heading}\\s*$([\\s\\S]*?)(?=^##\\s|\\Z)`, "im");
  const match = pattern.exec(markdown);
  if (!match) return "";

  return match[1].trim();
}

function extractChecklist(markdown: string): string[] {
  const section = extractSection(markdown, "Verification Checklist");
  const source = section || markdown;

  return [...source.matchAll(/^\s*-\s*\[[ xX]\]\s*(.+)$/gm)].map((match) =>
    match[1].trim(),
  );
}

async function findScenarioDirectories(): Promise<string[]> {
  const found: string[] = [];

  async function walk(directory: string, relative: string): Promise<void> {
    let entries;
    try {
      entries = await readdir(directory, { withFileTypes: true });
    } catch {
      return;
    }

    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      if (entry.name === "_templates" || entry.name === "node_modules") continue;

      const childRelative = relative ? `${relative}/${entry.name}` : entry.name;
      const childPath = path.join(directory, entry.name);
      const children = await readdir(childPath);

      if (children.includes("scenario.md")) {
        found.push(childRelative);
        continue;
      }

      await walk(childPath, childRelative);
    }
  }

  await walk(SCENARIOS_ROOT, "");

  return found.sort();
}

export async function generateManifest(): Promise<ScenarioManifest> {
  const directories = await findScenarioDirectories();
  const scenarios: ScenarioManifestEntry[] = [];

  for (const relative of directories) {
    const markdown = await readFile(
      path.join(SCENARIOS_ROOT, relative, "scenario.md"),
      "utf8",
    );

    const fields = parseFrontmatter(markdown);
    const parsedPart = Number.parseInt(fields.part ?? "", 10);

    scenarios.push({
      id: relative.replace(/\//g, ":"),
      path: relative,
      name: fields.name ?? path.basename(relative),
      scope: fields.scope ?? "",
      part: Number.isNaN(parsedPart) ? null : parsedPart,
      tags: parseList(fields.tags),
      prerequisites: fields.prerequisites ?? "none",
      purpose: extractSection(markdown, "Purpose"),
      checklist: extractChecklist(markdown),
      seedCommand: `npm run seed -- ${relative}`,
    });
  }

  return {
    generatedFrom: "testing/scenarios",
    scenarioCount: scenarios.length,
    scenarios,
  };
}

async function main(): Promise<void> {
  const manifest = await generateManifest();

  await writeFile(MANIFEST_PATH, `${JSON.stringify(manifest, null, 2)}\n`, "utf8");

  console.log(`Wrote testing/scenarios/manifest.json — ${manifest.scenarioCount} scenario(s).`);

  for (const scenario of manifest.scenarios) {
    console.log(`  ${scenario.path} — ${scenario.checklist.length} check(s)`);
  }

  if (manifest.scenarioCount === 0) {
    console.log("\nNo scenarios yet. Create one with /new-scenario.");
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error: unknown) => {
    console.error(`\n${error instanceof Error ? error.message : error}`);
    process.exitCode = 1;
  });
}
