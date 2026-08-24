import { existsSync } from "node:fs";
import { registerHooks } from "node:module";
import path from "node:path";
import { pathToFileURL } from "node:url";

// Teaches plain `node` the `@/*` path alias that tsconfig.json gives the app.
//
// WHY THIS IS NEEDED: ingestStandardWorks.ts shares lib/knowledge/ingest.ts with the upload
// route — that sharing is the point, it is what makes the uploaded count and the script's count
// impossible to disagree. But those modules import each other as `@/lib/...`, and Node resolves
// specifiers against node_modules and package.json only. It has no idea what tsconfig `paths`
// are, so every one of them fails with ERR_MODULE_NOT_FOUND before a single line runs.
//
// The alternatives were worse: rewriting the app's imports to relative paths to suit one script
// (conventions.md forbids it, and it would spread), or duplicating the ingest pipeline in the
// script (the exact two-code-paths-counting-differently bug that roster-c recorded).
//
// registerHooks is Node's synchronous in-thread hook API (22.15+). The async `register()` runs
// hooks on a worker thread, which is more machinery than a specifier rewrite needs.
//
// `format` is deliberately NOT set on the returned resolution. Setting it to "module" makes Node
// treat the .ts file as plain JavaScript and type-stripping never runs — the failure reads as
// `SyntaxError: Unexpected token 'export'` on a line that is obviously valid TypeScript.

const REPO_ROOT = path.resolve(import.meta.dirname, "..", "..");
const EXTENSIONS = [".ts", ".tsx", ""];

registerHooks({
  resolve(specifier, context, nextResolve) {
    if (!specifier.startsWith("@/")) return nextResolve(specifier, context);

    const base = path.join(REPO_ROOT, specifier.slice(2));

    for (const extension of EXTENSIONS) {
      const candidate = `${base}${extension}`;
      if (existsSync(candidate)) {
        return { url: pathToFileURL(candidate).href, shortCircuit: true };
      }
    }

    // Falls through rather than throwing its own error, so an unresolvable alias still reports
    // Node's own message naming the specifier and the importer.
    return nextResolve(specifier, context);
  },
});
