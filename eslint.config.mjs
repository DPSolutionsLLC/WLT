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
    // THE DESIGN PROTOTYPE. `prototype/WLT.jsx` is a DESIGN source and not a code source
    // (CLAUDE.md section 1): a client-only React app with 622 useState hooks, no persistence, no
    // router and no server. It is gitignored because it carries 359 real ward member records, so
    // it is never committed and never deployed — but eslint was still linting it, and its 21,819
    // lines produced 237 errors that made `npm run lint` red for everybody, permanently.
    //
    // Added during P1 for the reason `.walk*/**` above was added: a suite everybody runs must not
    // be red for something nobody shipped. Nothing here is built, imported or bundled; the
    // durable content was harvested into plans/prototype/ instead.
    "prototype/**",
  ]),
]);

export default eslintConfig;
