# Code Conventions

Detailed reference. [CLAUDE.md](../CLAUDE.md) §6 has the short version — load this file
only when you need the specifics.

---

## Naming

| Thing | Convention | Example |
|---|---|---|
| Files — components | PascalCase | `MemberPicker.tsx` |
| Files — everything else | camelCase | `generateSundays.ts` |
| Directories | kebab-case | `visit-tracker/` |
| Components | PascalCase | `ReportTile` |
| Functions | camelCase, verb-first | `resolveConductingUser()` |
| Booleans | `is` / `has` / `can` prefix | `isBishopric`, `canApprove` |
| Types & interfaces | PascalCase, no `I` prefix | `SessionUser` |
| Constants | SCREAMING_SNAKE | `PIPELINE_STAGES` |
| SQL | snake_case | `conducting_user_id` |
| Route handlers | `route.ts` in a named folder | `app/api/visits/route.ts` |
| Tests | mirror the source, `.test.ts` | `pipeline.test.ts` |

**No abbreviations.** `conductingCounselorId`, not `condCounsId`. `organization`, not
`org`, in new code — except where it matches an existing column name (`org_id` stays
`org_id`).

---

## Exports

Named exports only.

```ts
export function assembleDraft(sundayId: string): ProgramDraft { }
export const PIPELINE_STAGES = [...] as const;
```

The one exception is Next.js pages, layouts, and route handlers, which the framework
requires to be default exports. Nothing else.

---

## Server vs Client Components

Server Components are the default. Add `"use client"` only for state, effects, event
handlers, or browser APIs.

Push the boundary as far down the tree as possible. A page that needs one interactive
button should not become a client component wholesale — extract the button.

**Never import these into a client component:**

- `lib/supabase/service.ts` (service-role key)
- `lib/ai/*` (Anthropic and OpenAI keys)
- `lib/pdf/*` (large, server-only)

Each of those modules should have a runtime guard that throws if it finds itself in a
browser.

---

## Data Access

Route handlers do not query Supabase directly. They call a function in `lib/<module>/`.

```
route handler → lib/<module>/queries.ts → supabase client
```

This keeps the query logic testable, prevents the same query from being written five
different ways, and gives one place to enforce the ward scope and the active-status filter.

Case mapping happens once, at this layer: snake_case from the database, camelCase to the
rest of the app.

---

## Validation

Zod at every boundary. One schema, used in both places:

```ts
// lib/validation/visit.ts
export const createVisitSchema = z.object({
  householdId: z.string().uuid(),
  visitDate: z.string().date(),
  sharedNotes: z.string().max(5000).optional(),
});
export type CreateVisitInput = z.infer<typeof createVisitSchema>;
```

The route handler parses the request body with it; the form validates against it. If they
diverge, the form accepts something the server rejects — a bad user experience with no
useful error.

Never trust a client-supplied `wardId`, `role`, `orgId`, or `userId`. All four come from
the session.

---

## Error Handling

Never swallow an error:

```ts
// wrong
try { await doThing(); } catch {}

// right
try {
  await doThing();
} catch (error) {
  console.error('Failed to create visit log', { householdId, error });
  return NextResponse.json(
    { error: 'Could not save the visit. Please try again.' },
    { status: 500 },
  );
}
```

- Log with context, but **never log** a PIN, token, key, private note, or member notes
- User-facing messages say what happened and what to do next
- Distinguish 400 (bad input, tell them what to fix), 403 (not permitted), 404, and 500
- Supabase errors come back as `{ data, error }` — check `error` on every call

The two exceptions that must never throw: `writeAuditLog()` and `emitNotification()`.
An audit or notification failure must not fail the user's action. Log and continue.

---

## Route Handler Shape

Every mutating route follows the same six steps:

```ts
export async function POST(request: Request) {
  // 1. Authenticate
  const user = await requireSessionUser();

  // 2. Authorize
  assertCan(user, 'visits.create');

  // 3. Validate
  const body = createVisitSchema.parse(await request.json());

  // 4. Act — ward_id from the session, never the body
  const visit = await createVisit({ ...body, wardId: user.wardId, visitedBy: user.id });

  // 5. Audit
  await writeAuditLog({ wardId: user.wardId, userId: user.id,
    action: 'visit_created', module: 'visits', detail: { visitId: visit.id } });

  // 6. Notify, if the action has a trigger
  await emitNotification({ wardId: user.wardId, triggerKey: 'visit_logged', ... });

  return NextResponse.json(visit);
}
```

Steps 1, 2, 3, and 5 are non-negotiable on every mutation.

---

## Dates

- **`date`** (no time) for Sundays, visit dates, meeting dates, goal periods
- **`timestamptz`** for events, timestamps, and anything with a moment attached
- Never store a local-time string
- Do date-only math with `date-fns` date helpers, in UTC, to avoid timezone drift
- Cron jobs that depend on "today" read the ward timezone from settings — tithing
  auto-clear and the Monday digest both do

---

## Money

Integer cents. Always. Never `number` for a currency amount in a calculation.

```ts
export function centsToDisplay(cents: number): string {
  return `$${(cents / 100).toFixed(2)}`;   // formatting only, at the edge
}
```

---

## TypeScript

- No `any` without a comment saying why
- Prefer `unknown` and narrow, over `any`
- `as const` for literal unions: `export const STAGES = [...] as const`
- Derive types from Zod schemas with `z.infer` rather than declaring them twice
- Generated `types/database.ts` is never hand-edited — regenerate it
- Hand-written domain types live in `types/domain.ts`

---

## Components

- One component per file
- Props typed inline or as a named `Props` type above the component
- No prop drilling more than two levels — use context or restructure
- Module-scoped components live in `components/<module>/`; genuinely shared primitives
  live in `components/ui/`
- A component used by two modules moves to `components/ui/` — do not copy it

---

## Styling

- Tailwind utility classes; no CSS modules, no styled-components
- Mobile-first: unprefixed classes are the mobile style, `md:` and up are the desktop
  overrides
- Colours come from the theme tokens in `tailwind.config.ts`. **No hardcoded hex values**
  in components — they break dark mode
- `dark:` variants on anything with a background or a border
- Extract a component before extracting a `@apply` class

---

## Tests

- Vitest. Colocate as `<name>.test.ts` beside the source, or mirror under `tests/` for
  integration and RLS suites
- **Pure functions first** — pipeline transitions, rotation, status calculations, totals.
  They are cheap and catch the highest-value bugs
- RLS tests seed with the service-role client and assert with a role-authenticated client
- A `asRole(role, orgId?)` helper returning a scoped client keeps RLS tests readable
- Test the boundary conditions, not the middle: 7 days vs 8 days, 2 approvals vs 3,
  the first and last member of a rotation pool
- Do not test AI output quality. Test that the route builds the right prompt, passes the
  right parameters, and handles an API error

---

## Comments

Default to none. The exceptions:

```ts
// Water blesser must differ from bread blesser, so advance the pointer on collision.
if (waterId === breadId) waterIndex++;
```

A comment stating a *constraint* or a *why* is welcome. A comment restating what the next
line does is noise and goes stale. Never leave a comment explaining that your change is
correct — that is a message to the reviewer, not the next reader.

---

## Git

The user commits manually. Never run `git commit`, `git push`, `git reset`, or any other
destructive git command. Do not suggest commit messages unless asked.
