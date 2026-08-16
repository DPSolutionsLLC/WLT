# Plan: Foundation A — Project Scaffold

**Created:** 2026-08-15
**Type:** feature
**Source:** [plans/00-foundation.md](00-foundation.md) Step 1
**Structure:** Sequential — plan 1 of 3 (A → B → C)

> **Run order:** this plan, then [foundation-b-schema.md](foundation-b-schema.md), then
> [foundation-c-services.md](foundation-c-services.md). Do not start B until A's
> Definition of Done passes.

---

## Overview

Stand up the Next.js + Supabase project skeleton with typed database access, class-based
dark mode, the three Supabase client factories, and a working test runner. No feature
code, no tables, no business logic — this plan only creates the ground everything else
stands on.

**Success criteria**

- `npm run dev` serves a page at `localhost:3000`
- `npm run build`, `npm run typecheck`, and `npm run lint` all pass clean
- `npx supabase start` brings up a local Postgres and `npm test` runs green
- Importing `lib/supabase/service.ts` from a client component throws at build/runtime
- The project's own `CLAUDE.md`, `SPEC.md`, `FEATURES.md`, `plans/`, and `.gitignore` are
  **untouched**

---

## Environment (verified 2026-08-15)

| Tool | Version present | Notes |
|---|---|---|
| Node | 22.19.0 | fine for Next 16 |
| npm | 10.9.3 | |
| Supabase CLI | 2.114.0 | available via `npx supabase` |
| git | 2.51.0 | repo already initialised, branch `main` |

`create-next-app@latest` currently produces:

| Package | Version |
|---|---|
| next | 16.3.1 |
| react / react-dom | 19.2.8 |
| tailwindcss | 4.x (via `@tailwindcss/postcss`) |
| eslint / eslint-config-next | 9.x / 16.3.1 |
| typescript | 5.x |

### ⚠️ Deviations from 00-foundation.md — read before starting

00-foundation.md was written against Next.js 14 / Tailwind 3. Both have moved. These are
deliberate, verified corrections, not drift:

1. **Next.js is 16, not 14.** The spec says "Next.js 14+", so 16 complies. Consequences:
   `cookies()` and `headers()` are **async** and must be awaited; page `params` and
   `searchParams` are **Promises**; `fetch` is no longer cached by default.
2. **There is no `tailwind.config.ts`.** Tailwind v4 is CSS-first. The plan's instruction
   to create that file with `darkMode: 'class'` cannot be followed as written — class-based
   dark mode is enabled with `@custom-variant` in `app/globals.css` instead (Task 3).
3. **`create-next-app` refuses to run in this directory.** Verified: it exits 1 with
   "The directory contains files that could conflict: plans/ SPEC.md". Task 1 scaffolds
   into a temp directory and copies in.
4. **`create-next-app` writes its own `CLAUDE.md` and `AGENTS.md`.** Verified. Left
   unguarded this **overwrites the project's source-of-truth instructions file.** The
   `--no-agents-md` flag suppresses both. Task 1 uses it and also copies selectively.
5. **`@supabase/ssr` forbids `get`/`set`/`remove` cookie methods.** Only `getAll`/`setAll`.
   The Supabase docs state there are no exceptions to this.

After this plan lands, 00-foundation.md Step 1 should be corrected so the next reader is
not misled. That edit is Task 12.

---

## Relevant Files

| File | Action | Purpose |
|---|---|---|
| `package.json` | create | Scripts + dependencies |
| `tsconfig.json` | create | Generated; verify `@/*` alias |
| `next.config.ts` | create | Generated; left as-is |
| `postcss.config.mjs` | create | Generated; Tailwind v4 plugin |
| `eslint.config.mjs` | create | Generated flat config |
| `app/layout.tsx` | modify | Theme class on `<html>`, metadata, `suppressHydrationWarning` |
| `app/globals.css` | modify | `@custom-variant dark`, theme tokens |
| `app/page.tsx` | modify | Minimal placeholder |
| `lib/supabase/browser.ts` | create | Anon-key browser client |
| `lib/supabase/server.ts` | create | Cookie-based server client |
| `lib/supabase/service.ts` | create | Service-role client + server-only guard |
| `lib/supabase/middleware.ts` | create | Session refresh helper |
| `middleware.ts` | create | Next.js middleware entry |
| `types/domain.ts` | create | Roles, org types, permission strings, `SessionUser` |
| `types/database.ts` | create | **Stub only** — generated for real in plan B |
| `.env.local.example` | create | Every var from SPEC.md, empty values |
| `.env.local` | create | Real values; gitignored |
| `vitest.config.ts` | create | Test runner config |
| `tests/setup.ts` | create | Loads `.env.local` for tests |
| `tests/smoke.test.ts` | create | One trivial test proving the runner works |
| `supabase/config.toml` | create | Via `npx supabase init` |
| `.gitignore` | **do not touch** | Existing file is already correct |
| `plans/00-foundation.md` | modify | Correct the stale Step 1 instructions |

---

## Dependencies

Runtime (all on 00-foundation.md's approved list — no additions):

```
@supabase/supabase-js  @supabase/ssr
@anthropic-ai/sdk  openai
@tanstack/react-query
zod
@react-pdf/renderer
resend
date-fns
```

Dev:

```
vitest  @testing-library/react  @testing-library/jest-dom
@vitejs/plugin-react  jsdom  dotenv
```

> `@vitejs/plugin-react`, `jsdom`, and `@testing-library/jest-dom` are not named in
> 00-foundation.md but are required for `@testing-library/react` to function at all.
> They are test-only. Flag them to the user before installing if you want to be strict.

**External prerequisite:** Docker Desktop must be installed and running for
`npx supabase start`. If it is not, stop and tell the user — do not silently skip.

---

## Tasks

### Task 1: Scaffold Next.js into the existing repo

**Files:** creates the generated file set listed above
**Action:** Scaffold in a temp directory, then copy in selectively.

Verified-safe command sequence (PowerShell):

```powershell
$tmp = "$env:TEMP\wlt-scaffold"
Remove-Item -Recurse -Force $tmp -ErrorAction SilentlyContinue
New-Item -ItemType Directory -Force $tmp | Out-Null
Push-Location $tmp
npx --yes create-next-app@latest . --typescript --tailwind --app --eslint `
  --no-src-dir --import-alias "@/*" --no-agents-md --disable-git --skip-install --use-npm
Pop-Location
```

Then copy in **only** these paths from `$tmp` to the repo root:

```
app/        public/     package.json     tsconfig.json
next.config.ts          postcss.config.mjs
eslint.config.mjs       next-env.d.ts
```

**Do NOT copy:** `.gitignore` (the repo's is better and already handles Supabase and
`.env*.local`), `README.md`, `CLAUDE.md`, `AGENTS.md`, or `.git/`.

**Details:**
- `--no-agents-md` is what prevents the `CLAUDE.md` overwrite. It is not optional.
- `--disable-git` prevents a nested `git init` clobbering repo history.
- After copying, delete `$tmp`.
- Set `package.json` `"name"` to `ward-leadership-tools`.
- Verify `git status` shows **no modification** to `CLAUDE.md`, `SPEC.md`, `FEATURES.md`,
  `plans/*`, or `.gitignore`. If any of those show as modified, restore them with
  `git checkout -- <path>` before continuing.

---

### Task 2: Install dependencies and add scripts

**File:** `package.json` (modify)
**Action:** Install the dependency list above, then add scripts.

```json
"scripts": {
  "dev": "next dev",
  "build": "next build",
  "start": "next start",
  "lint": "eslint",
  "typecheck": "tsc --noEmit",
  "test": "vitest run",
  "test:watch": "vitest",
  "db:start": "supabase start",
  "db:stop": "supabase stop",
  "db:reset": "supabase db reset",
  "db:types": "supabase gen types typescript --local > types/database.ts"
}
```

**Details:**
- `create-next-app` does **not** generate a `typecheck` script. It is required by every
  phase's Definition of Done — add it.
- Next 16 ships `"lint": "eslint"`, not `next lint`. Leave it.

---

### Task 3: Class-based dark mode

**File:** `app/globals.css` (modify)
**Action:** Replace the generated `prefers-color-scheme` block with a class variant and
define the theme tokens.

The generated file uses `@media (prefers-color-scheme: dark)`, which cannot be driven by
`users.theme_preference`. Replace with:

```css
@import "tailwindcss";

@custom-variant dark (&:where(.dark, .dark *));

:root {
  --background: #ffffff;
  --foreground: #171717;
  /* add the rest of the palette here */
}

.dark {
  --background: #0a0a0a;
  --foreground: #ededed;
}

@theme inline {
  --color-background: var(--background);
  --color-foreground: var(--foreground);
}
```

**Details:**
- `@custom-variant dark (&:where(.dark, .dark *));` is the v4 replacement for
  `darkMode: 'class'`. Verified against the Tailwind v4 dark-mode docs.
- Every colour a component uses must be a token here. conventions.md forbids hardcoded
  hex in components because it breaks dark mode — the tokens are how that rule is kept.
- Do not create `tailwind.config.ts`. It is not used in v4.

---

### Task 4: Root layout with theme class

**File:** `app/layout.tsx` (modify)
**Action:** Put the theme class on `<html>` and set app metadata.

**Details:**
- `<html lang="en" suppressHydrationWarning>` — required, because the theme class is
  applied before hydration and would otherwise log a mismatch warning every load.
- `metadata`: title `Ward Leadership Tools`, description from FEATURES.md §Overview.
- Add `<meta name="viewport" content="width=device-width, initial-scale=1" />` behaviour
  via the `viewport` export — the app is mobile-first and must work at 375px.
- For now hardcode no theme class. Reading `users.theme_preference` needs the `users`
  table (plan B) and a session (phase 1). Leave a `TODO` **only** if the user asks;
  conventions.md defaults to no comments.
- Keep this a Server Component. Do not add `"use client"`.

---

### Task 5: Supabase browser client

**File:** `lib/supabase/browser.ts` (create)

```ts
import { createBrowserClient } from '@supabase/ssr';
import type { Database } from '@/types/database';

export function createBrowserSupabaseClient() {
  return createBrowserClient<Database>(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
  );
}
```

**Details:**
- Named export, per conventions.md.
- Typed with `Database` so every query is checked. The stub from Task 10 keeps this
  compiling until plan B generates the real types.

---

### Task 6: Supabase server client

**File:** `lib/supabase/server.ts` (create)

```ts
import { createServerClient } from '@supabase/ssr';
import { cookies } from 'next/headers';
import type { Database } from '@/types/database';

export async function createServerSupabaseClient() {
  const cookieStore = await cookies();

  return createServerClient<Database>(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return cookieStore.getAll();
        },
        setAll(cookiesToSet) {
          try {
            cookiesToSet.forEach(({ name, value, options }) =>
              cookieStore.set(name, value, options),
            );
          } catch (error) {
            console.warn('Supabase setAll from a Server Component; middleware will refresh the session', error);
          }
        },
      },
    },
  );
}
```

**Details:**
- **The function is `async` and `cookies()` is awaited.** This is the Next 15+ change.
- **Only `getAll` and `setAll`.** Never `get`, `set`, or `remove` — Supabase's SSR guide
  is explicit that there are no exceptions.
- The `catch` is the one sanctioned swallow in the codebase: Server Components cannot
  write cookies, and middleware handles refresh. It still **logs** — an empty `catch {}`
  would violate CLAUDE.md rule 7.

---

### Task 7: Service-role client with a server-only guard

**File:** `lib/supabase/service.ts` (create)

```ts
import { createClient } from '@supabase/supabase-js';
import type { Database } from '@/types/database';

export function createServiceSupabaseClient() {
  if (typeof window !== 'undefined') {
    throw new Error(
      'lib/supabase/service.ts was imported into browser code. The service-role key bypasses RLS and must never reach the client.',
    );
  }

  return createClient<Database>(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { persistSession: false, autoRefreshToken: false } },
  );
}
```

**Details:**
- The `typeof window` guard is required by 00-foundation.md Step 1 and by the Definition
  of Done. Add the same guard to `lib/ai/*` and `lib/pdf/*` when those are created later.
- `persistSession: false` — this client is never a user session.
- This client **bypasses RLS entirely.** Permitted callers: seed scripts, migrations,
  RLS test setup, public page rendering, cron jobs. Never a user-facing route handler.

---

### Task 8: Session-refresh middleware

**Files:** `lib/supabase/middleware.ts` (create), `middleware.ts` (create)

**Action:** Refresh the auth token on every request so Server Components see a live session.

`lib/supabase/middleware.ts` exports `updateSession(request: NextRequest)` that:
1. Builds a `NextResponse.next({ request })`
2. Creates a `createServerClient` using `request.cookies.getAll()` for `getAll`, and a
   `setAll` that writes to **both** `request.cookies` and `response.cookies`
3. Calls `await supabase.auth.getUser()` — this is what performs the refresh
4. Returns the response

`middleware.ts` at the repo root calls it and exports a `config.matcher` excluding
`_next/static`, `_next/image`, `favicon.ico`, image files, and `/public/`.

**Details:**
- **`/public/[slug]` must be excluded from the matcher.** Those pages are deliberately
  unauthenticated (SPEC.md §Public Pages); running auth middleware over them is wasted
  work and risks a redirect loop once phase 1 adds guards.
- Do not add route guards here. Guards are phase 1 ([01-auth-rbac.md](01-auth-rbac.md)).
  This middleware only refreshes tokens.
- You must return the *same* response object the cookies were written to, or the refreshed
  session is silently dropped.

---

### Task 9: Domain types

**File:** `types/domain.ts` (create)
**Action:** Hand-written roles, organisation types, permission strings, and `SessionUser`.

Derive contents from [FEATURES.md](../FEATURES.md) §User Roles and CLAUDE.md §7:

```ts
export const ROLES = [
  'bishop', 'counselor', 'ward_secretary', 'executive_secretary',
  'org_president', 'org_counselor', 'org_secretary',
  'music_coordinator', 'ward_council_member', 'sacrament_manager',
] as const;
export type Role = (typeof ROLES)[number];

export const ORGANIZATION_TYPES = [
  'bishopric', 'elders_quorum', 'relief_society', 'young_men',
  'young_women', 'primary', 'sunday_school', 'other',
] as const;
export type OrganizationType = (typeof ORGANIZATION_TYPES)[number];

export const PIPELINE_STAGES = [
  'plan', 'review', 'approve', 'request', 'confirm',
  'notify', 'speak', 'appreciate', 'complete',
] as const;
export type PipelineStage = (typeof PIPELINE_STAGES)[number];

export type Permission = `${string}.${string}`;

export type SessionUser = {
  id: string;
  wardId: string;
  role: Role;
  orgId: string | null;
  counselorPosition: 1 | 2 | null;
  firstName: string | null;
  lastName: string | null;
};
```

Also export `as const` arrays for the enums SPEC.md defines as text columns:
member category/gender/status, sunday type, assignment type, prayer type/stage,
hymn type, program status, visit cadence, activity type, event type/status, goal
target type and status, meeting type, agenda status, knowledge type tag, and the four
sacrament assignment types.

**Details:**
- `SCREAMING_SNAKE` for constants, `as const` for literal unions — conventions.md.
- **`sacrament_manager` is in `ROLES`** even though SPEC.md's `users.role` comment omits
  it. FEATURES.md §Module 17 defines it as a real role. See plan B, which adds it to the
  database CHECK constraint.
- The **role→permission matrix does not go here.** It lives in
  `lib/auth/permissions.ts` (plan C) so the types stay free of logic. 00-foundation.md's
  Step 1 table and Step 5.2 disagree on this; Step 5.2 wins, and it matches conventions.md's
  types-vs-logic split.

---

### Task 10: Database types stub

**File:** `types/database.ts` (create)

```ts
export type Json = string | number | boolean | null | { [key: string]: Json | undefined } | Json[];

export type Database = {
  public: {
    Tables: Record<string, never>;
    Views: Record<string, never>;
    Functions: Record<string, never>;
    Enums: Record<string, never>;
  };
};
```

**Details:**
- Placeholder so Tasks 5–7 compile. **Plan B overwrites this** with
  `npm run db:types`. Never hand-edit it after that point (conventions.md).

---

### Task 11: Environment files, Supabase init, and test runner

**Files:** `.env.local.example`, `.env.local`, `supabase/config.toml`, `vitest.config.ts`,
`tests/setup.ts`, `tests/smoke.test.ts`

**`.env.local.example`** — every variable from SPEC.md §Environment Variables, empty:

```
NEXT_PUBLIC_SUPABASE_URL=
NEXT_PUBLIC_SUPABASE_ANON_KEY=
SUPABASE_SERVICE_ROLE_KEY=
ANTHROPIC_API_KEY=
OPENAI_API_KEY=
RESEND_API_KEY=
```

The repo `.gitignore` uses `.env*.local`, which does **not** match `.env.local.example` —
so the example commits correctly and `.env.local` stays ignored. Verify with
`git check-ignore -v .env.local.example` (should report nothing).

**Supabase init:**

```powershell
npx supabase init
npx supabase start
```

`supabase start` prints the local API URL, anon key, and service-role key. Put those three
into `.env.local`. Leave the three third-party keys empty for now — nothing in plans A–C
calls Anthropic, OpenAI, or Resend.

**`vitest.config.ts`:**

```ts
import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import path from 'node:path';

export default defineConfig({
  plugins: [react()],
  test: {
    environment: 'jsdom',
    setupFiles: ['./tests/setup.ts'],
    globals: true,
  },
  resolve: { alias: { '@': path.resolve(__dirname, '.') } },
});
```

**`tests/setup.ts`** loads `.env.local` via `dotenv/config` so plan C's RLS tests can reach
the local database. **Never log the keys it loads** (CLAUDE.md rule 8).

**`tests/smoke.test.ts`** — one assertion proving the runner and the `@/` alias resolve.
It gets deleted in plan C once real tests exist.

---

### Task 12: Correct the stale instructions in 00-foundation.md

**File:** `plans/00-foundation.md` (modify)
**Action:** Fix Step 1 so the next reader is not misled.

CLAUDE.md §1: *"If code disagrees with them, the specs win — unless the spec is wrong, in
which case flag it and update the spec in the same change."* Three items in Step 1 are now
wrong:

1. Replace the `tailwind.config.ts` row in the file table with `app/globals.css` —
   `@custom-variant dark`, Tailwind v4 is CSS-first, that file does not exist.
2. Add a note to the `create-next-app` command that it must be run in a temp directory
   with `--no-agents-md --disable-git`, and why.
3. Note that `lib/supabase/server.ts` is async because `cookies()` is async in Next 15+.

Keep the edit tight — three small changes, no rewrite.

---

## Testing Strategy

Plan A ships almost no logic, so testing is thin by design. Real coverage arrives in plan C.

| File | Cases |
|---|---|
| `tests/smoke.test.ts` | Vitest runs; the `@/` alias resolves |
| `tests/lib/supabase/service.test.ts` | `createServiceSupabaseClient()` **throws** when `globalThis.window` is defined — this is a Definition-of-Done item, so assert it now |

Do not test the browser/server clients here — they need a live session, which is phase 1.

## Test Scenarios (Harness)

**None.** There is no user-facing behaviour in this plan — no routes, no forms, no data.
The testing harness (`/init-testing`) is worth bootstrapping after plan B, when there are
tables to seed. Note this and move on.

---

## Validation Commands

Run in order. All must pass before starting plan B.

```bash
npm run lint
npm run typecheck
npm run build
npm test
```

Plus these manual checks:

```bash
# Docker must be running for this
npx supabase start
npx supabase status

# The project's source-of-truth files must be untouched
git status --short

# The env example must NOT be ignored
git check-ignore -v .env.local.example
```

`git status --short` must not list `CLAUDE.md`, `SPEC.md`, `FEATURES.md`, or `.gitignore`
as modified. If it does, `git checkout -- <path>` and find out which copy step overreached.

---

## Integration Notes

- **Nothing depends on this plan yet** — it is the root of the tree. Everything else does.
- **Breaking change risk: none.** There is no existing code to break.
- **Hands off to plan B** with: a working `supabase/config.toml`, a running local
  database, three client factories, and a `db:types` script pointed at `types/database.ts`.
- **Do not** create tables, RLS policies, route handlers, or UI in this plan. If a task
  seems to need one, you have crossed into plan B — stop.
- **Do not commit.** The user commits manually (CLAUDE.md §10).

---

## Pitfalls

- **The `CLAUDE.md` overwrite is the big one.** Verified real. `--no-agents-md` plus a
  selective copy is the defence. Check `git status` after Task 1, every time.
- **`cookies()` must be awaited.** A missing `await` in Next 16 fails at runtime with a
  confusing error about the cookie store being a Promise.
- **`getAll`/`setAll` only.** Mixing in `get`/`set`/`remove` produces sessions that appear
  to work in development and drop intermittently in production.
- **Docker not running** makes `supabase start` fail with a Docker daemon error. That is a
  prerequisite problem, not a code problem — tell the user rather than working around it.
- **Do not overwrite `.gitignore`.** The generated one lacks the Supabase and Claude
  entries the repo's version already has, and its blanket `.env*` would ignore
  `.env.local.example`.
