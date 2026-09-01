import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
    // /walk WORKING DIRECTORIES. Throwaway scripts that read the harness ward back through a
    // service-role client to verify what a screen claimed — they are already excluded from git
    // (.git/info/exclude), and they are written against `any`-shaped PostgREST rows on purpose,
    // because typing a one-off read-back is work that proves nothing.
    //
    // Added 2026-08-31: `.walk061/` had been failing `npm run lint` with seven errors since the
    // previous walk, so the suite everybody runs was red for a reason nobody had shipped. A walk
    // must not be able to break lint.
    ".walk*/**",
  ]),
]);

export default eslintConfig;
