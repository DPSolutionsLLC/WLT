import path from "node:path";
import { fileURLToPath } from "node:url";
import { config } from "dotenv";

const here = path.dirname(fileURLToPath(import.meta.url));
export const REPO_ROOT = path.resolve(here, "..", "..");
export const TESTING_ROOT = path.resolve(here, "..");

let isLoaded = false;

// Root .env.local first, then testing/.env on top. The harness normally needs nothing beyond
// the keys the app already uses; testing/.env exists so a tester can point at a different
// project without editing the app's own env file.
export function loadEnvironment(): void {
  if (isLoaded) return;

  config({ path: path.join(REPO_ROOT, ".env.local"), quiet: true });
  config({ path: path.join(TESTING_ROOT, ".env"), override: true, quiet: true });

  isLoaded = true;
}

export function requireEnv(name: string, hint: string): string {
  loadEnvironment();

  const value = process.env[name];
  if (!value) {
    throw new Error(`Missing ${name}. ${hint}`);
  }

  return value;
}
