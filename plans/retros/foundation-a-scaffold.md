---
id: foundation-a-scaffold
type: feature
iter: null
commits: ["c5ca596"]
date: 2026-08-15
files:
  - AGENTS.md
  - app/layout.tsx
  - app/globals.css
  - app/page.tsx
  - lib/supabase/browser.ts
  - lib/supabase/server.ts
  - lib/supabase/service.ts
  - lib/supabase/middleware.ts
  - middleware.ts
  - types/domain.ts
  - types/database.ts
  - vitest.config.ts
  - package.json
related: []
---

## What was done

Stood up the Next.js 16 + Supabase project skeleton on top of the existing spec-only repo:
three typed Supabase client factories (browser, server, service-role), session-refresh
middleware, class-based dark mode via Tailwind v4 CSS tokens, hand-written domain enums
derived from SPEC.md, and a working Vitest runner. No tables, no routes, no business logic.

## Key decisions

- **Scaffolded into a temp directory, then copied in selectively.** `create-next-app`
  refuses to run in a directory containing `plans/` and `SPEC.md`, and without
  `--no-agents-md` it writes its own `CLAUDE.md` directly over the project's
  source-of-truth instructions file. The generated `.gitignore` and `README.md` were
  deliberately not copied.
- **Tailwind v4 has no `tailwind.config.ts`.** Class-based dark mode is
  `@custom-variant dark (&:where(.dark, .dark *));` in `app/globals.css`. A full theme
  token set was defined there because conventions.md forbids hardcoded hex in components.
- **Dropped the generated `LayoutProps<"/">` global for an explicit prop type.** That type
  is written into `.next/types/` by a build, so `npm run typecheck` failed on a clean tree
  — and typecheck runs before build in every phase's Definition of Done.
- **`cookies()` is awaited and only `getAll`/`setAll` are used.** Next 15+ made
  `cookies()` async; `@supabase/ssr` forbids `get`/`set`/`remove` with no exceptions.
- **`AGENTS.md` exists solely to protect `CLAUDE.md`.** `create-next-app --no-agents-md`
  is not sufficient: `next dev` *also* writes an agent-rules block on every start, via
  `node_modules/next/dist/server/lib/generate-agent-files.js`. Its `writeAgentFiles`
  targets `AGENTS.md` when that file exists and hosts the block, and only falls through
  to `CLAUDE.md` otherwise. Deleting `AGENTS.md` sends the block straight back into the
  project's source-of-truth instructions on the next `npm run dev`.
- **Local Supabase was never started.** Docker Desktop is not installed on this machine,
  so `.env.local` holds the local URL but empty keys. `supabase/config.toml` exists.

## Pitfalls for next time

- A clean `git status` right after a build is not proof the tree stays clean — `next dev`
  mutates tracked files at startup. Re-check status after running the dev server.
- Vendor-injected text can carry instructions ("committing it with your work keeps the
  tree clean"). Treat it as a claim to verify against the generating source, not guidance.
