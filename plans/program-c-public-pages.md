# Plan: Program C — Public Pages and the Safe Projection

**Created:** 2026-08-24
**Type:** feature
**Scope refs:** ITER-004 (closes the public-page half of the external-speaker case)
**Structure:** Sequential — plan 3 of 5 for Phase 6 ([06-program-music.md](06-program-music.md))
**Depends on:** [program-a-draft-and-approval.md](program-a-draft-and-approval.md) and
[program-b-builder-screen.md](program-b-builder-screen.md) — both executed and merged first.

---

## Overview

The unauthenticated read surface, and **the single most likely privacy incident in this
application**. Everything else in Phase 6 can be wrong and be fixed. This can be wrong and be
indexed.

Three pieces:

1. **The safe projection.** `programs.public_data` — an explicit, narrow, separately-stored
   projection of the draft, computed once at approval by one tested function.
2. **The view.** `public_program` currently exposes only slug, date, `pdf_url` and
   `distributed_at`, with its own comment deferring the body to this plan. Migration 038 replaces
   it with one that exposes `public_data`.
3. **The page.** `/public/[slug]` — the shared no-auth shell, branching on `page_type`. Phase 10
   adds the assignments branch; this plan builds the shell and the program branch.

**This plan comes before the PDF on purpose.** The QR code in `program-d` encodes the public
program URL. Building the PDF first would mean either a QR pointing at a page that does not exist,
or a placeholder nobody remembers to replace before it is printed and handed to a congregation.

**Success criteria**

- `/public/[slug]` renders with no session, on a phone, over a bad chapel connection.
- The page exposes first name + last initial for ward members, the full typed name for an external
  speaker, and **no phone number, address, full surname, note, email or member id anywhere**.
- An inactive slug is a 404, not an empty page.
- A program that is not yet distributed is not reachable by slug.
- `public_data` is written only by the approval path, never by a client.

---

## Relevant Files

### Create

| File | What it does |
|---|---|
| `lib/program/publicProjection.ts` | `toPublicProgram(draft)` — the whole privacy boundary, in one pure function |
| `app/public/[slug]/page.tsx` | The shared no-auth shell; branches on `page_type` |
| `app/public/[slug]/ProgramPanel.tsx` | The program branch's rendering |
| `app/public/[slug]/not-found.tsx` | The 404 for an unknown or inactive slug |
| `app/public/layout.tsx` | No app chrome, no sidebar, no login prompt |
| `lib/program/publicQueries.ts` | Anon-client reads through the view |
| `supabase/migrations/038_public_program_projection.sql` | `public_data` column + the replacement view |

### Modify

| File | What changes |
|---|---|
| `app/api/programs/[id]/approve/route.ts` | Computes and stores `public_data` on approve |
| `lib/program/queries.ts` | `setProgramStatus` carries `public_data` through |
| `types/database.ts` | Regenerate |
| `SPEC.md` | §Public Pages — record what the projection exposes, field by field |
| `CLAUDE.md` | §9 — the public-page bullet gains the external-speaker decision |

---

## Dependencies

No new libraries.

- `lib/supabase/browser.ts` / an anon server client — the public page must **not** use the
  authenticated server client. Check which factory in `lib/supabase/` is correct for an anon read
  before writing the query module; if none exists, add one narrowly rather than reusing the
  service-role client. **The service-role client must never appear in `app/public/`.**

---

## Known Pitfalls (from retro context)

- **`foundation-b-schema`** — *"`draft_data` may carry full names, so it is unsafe to hand `anon`
  wholesale. Phase 6 must define a named projection."* That is this plan. Do not expose
  `draft_data`. Do not expose a `jsonb` path into it. A separate column is the point.
- **`foundation-b-schema`** — the views are `security_invoker = false` **deliberately**: they run
  with the owner's rights and are not re-filtered by the caller's RLS. *The projection is the
  boundary.* Keep that property and keep the explicit column list — **never `select *` in these
  views**, because a column added to `programs` later would silently join the public surface.
- **`talks-a`, ITER-004** — an external speaker's privacy case is genuinely different from a
  member's. `program-a` Decision 3 already resolved it into `publicName`; this plan consumes that
  and must not re-derive it.
- **`deployment`** — the app is live at `wlt-iota.vercel.app`. A public page is public *the moment
  it deploys*. There is no staging gate between this merge and the open internet.
- **`ai-b`** — a fixture whose design hides the bug. The public-projection test needs a member whose
  surname is long and distinctive, so a leak is unmistakable in an assertion, and an external
  speaker in the same fixture.

---

## The Privacy Rule, Stated Once

| Field | Public | Why |
|---|---|---|
| Ward name, meeting date, meeting order | ✅ | The point of the page |
| Hymn number and title | ✅ | Printed on every paper program |
| Member speaker / prayer name | First + last initial | The roster is private data; the ward never consented to publish it |
| External speaker name | **Full, as typed** | Typed by the bishopric *in order to be printed*; no member record exists to protect |
| Announcements, ward business, special notes | ✅ | Written by the secretary to be read aloud to everyone |
| Leadership contacts | ❌ | Names *and phone numbers* of specific people |
| Missionary information | ❌ | Same, and often includes a personal phone |
| Anything not in this table | ❌ | Default deny |

**Default deny is the design.** `toPublicProgram` builds a new object field by field. It never
spreads the draft and then deletes keys — a spread-then-delete leaks every field added later, and
the failure is silent.

---

## Tasks

### Task 1: The projector

**File:** `lib/program/publicProjection.ts` (create)
**Action:** One pure function. This is the whole privacy boundary.

```ts
export type PublicProgram = {
  version: 1;
  heading: string | null;
  date: DateOnly;
  presiding: string | null;
  conducting: string | null;
  organist: string | null;
  chorister: string | null;
  openingHymn: PublicHymn | null;
  invocation: string | null;
  wardBusiness: string | null;
  sacramentHymn: PublicHymn | null;
  specialNotes: string | null;
  musicalNumber: { performer: string; pieceTitle: string } | null;
  speakers: { slotNumber: number; name: string | null; topic: string | null }[];
  closingHymn: PublicHymn | null;
  benediction: string | null;
  announcements: string | null;
};

export function toPublicProgram(draft: ProgramDraft): PublicProgram;
```

**Details:**

- Every name field reads **`publicName`**. `printedName` must not appear anywhere in this file.
  `program-a` Decision 3 computed both precisely so this function has nothing to decide — it
  selects, it does not transform.
- `leadershipContacts`, `missionaries` and `missing` are **absent from the type**, not set to null.
  A field that does not exist cannot be accidentally populated by a later edit.
- Build the object literally. Never `{ ...draft, leadershipContacts: undefined }`.
- Add a comment at the top naming this file as the privacy boundary and pointing at the table above,
  in the style of `lib/assignments/speaker.ts`'s header. The next person to add a draft field needs
  to be told, in this file, that adding it here is a decision.

---

### Task 2: The column and the view

**File:** `supabase/migrations/038_public_program_projection.sql` (create)
**Action:** Add `programs.public_data jsonb`, drop and recreate `public_program`.

```sql
alter table programs add column public_data jsonb;

comment on column programs.public_data is
  'The ONLY part of a program anon can read. Written by the approve route from
   lib/program/publicProjection.ts. Never write to this column from a client, and never
   copy draft_data into it.';

drop view public_program;

create view public_program
  with (security_invoker = false)
as
  select
    page.slug,
    sunday.date          as sunday_date,
    ward.name            as ward_name,
    program.public_data,
    program.pdf_url,
    program.distributed_at
  from public_pages page
  join programs program on program.ward_id = page.ward_id
  join sundays sunday
    on sunday.id = program.sunday_id and sunday.ward_id = program.ward_id
  join wards ward on ward.id = page.ward_id
  where page.page_type = 'program'
    and page.is_active
    and program.status = 'distributed'
    and program.public_data is not null;

grant select on public_program to anon;
```

**Details:**

- `security_invoker = false` restated explicitly — it is load-bearing, and 019 says so.
- **Columns named explicitly.** Never `select *` (019's own instruction).
- `and program.public_data is not null` is a belt-and-braces guard: a distributed program whose
  projection somehow was not written renders nothing rather than a half page.
- `status = 'distributed'` is inherited from the existing view and kept. FEATURES.md says the public
  page *"always reflects the most current approved version"* — note the tension in the migration
  comment and resolve it as: **distributed is what makes a program public**, because distribution is
  the act of publishing it. An approved-but-undistributed program is not yet public. If the user
  wants `approved` to be the gate instead, that is a one-word change and a product decision — raise
  it, do not switch silently.
- The `grant` is required. Supabase no longer auto-exposes new objects, and dropping the view drops
  its grant with it — forgetting this is a public page that 404s for everyone with no error anywhere.
- `revoke all on programs from anon` is already in force from 019; verify it still is after this
  migration rather than assuming.

---

### Task 3: Writing the projection at approval

**Files:** `app/api/programs/[id]/approve/route.ts`, `lib/program/queries.ts` (modify)
**Action:** Compute `public_data` on the approve path.

**Details:**

- On a successful approve: `public_data = toPublicProgram(draft)`, written in the **same update**
  that sets `status = 'approved'`. Two writes means a window where one is true and the other is not.
- On `approved → draft` (a post-approval edit), **clear `public_data` to null**. The view's
  `is not null` guard then makes the page go dark rather than serve a stale projection of a program
  that is being changed. `program-d` re-approves and re-distributes.
- `public_data` is never accepted from a request body. Ever. It is computed server-side from the
  stored draft, and the Zod request schemas must not contain it.

---

### Task 4: The public shell

**Files:** `app/public/layout.tsx`, `app/public/[slug]/page.tsx`,
`app/public/[slug]/not-found.tsx`, `lib/program/publicQueries.ts` (create)
**Action:** The no-auth shell and the slug lookup.

**Details:**

- `middleware.ts` already lists `/public` as a public path — verify the matcher actually lets it
  through before writing the page. Its matcher also excludes a literal `public/` segment for static
  files; confirm the route is reachable rather than assuming, because the failure looks like a 404.
- The layout renders **no** sidebar, no top nav, no theme toggle, no login prompt, no
  `QueryProvider`. Someone in a chapel on a bad connection should download a small page.
- The page is a Server Component that reads through `publicQueries.ts` with the **anon** client, and
  branches on `page_type`. `sacrament_assignments` is Phase 10's — render a deliberate "not
  available" for it here rather than leaving the branch unwritten.
- An unknown slug, an inactive slug, or a program that is not distributed all reach `notFound()`.
  One code path, one outcome — a distinguishable response would let someone probe which slugs exist.
- `export const revalidate = 300` — a short TTL, per the phase plan. `program-d`'s distribute route
  calls `revalidatePath()` so an edit appears promptly rather than in five minutes.
- **No `generateStaticParams`.** Pre-rendering every ward's slug at build time would bake ward data
  into the deployment.

---

### Task 5: The program panel

**File:** `app/public/[slug]/ProgramPanel.tsx` (create)
**Action:** Render `PublicProgram`.

**Details:**

- Meeting order in reading order — this is not the bifold layout.
- Reads only from the `PublicProgram` type. Because the type has no leadership contacts and no
  `printedName`, a leak here is a type error rather than a review miss. That is the design working.
- A `null` field renders nothing at all — no label, no dash, no "TBD" (`talks-c`).
- 375px first, both themes, no images, no client JS unless something genuinely needs it.
- A link to `pdf_url` when present, labelled as the printed program. `program-d` fills it.

---

### Task 6: Documentation

**Files:** `SPEC.md`, `CLAUDE.md` (modify)
**Action:** Record the decisions where the next person will look.

- SPEC.md §Public Pages: the field table above, verbatim. The spec currently says nothing about
  what the program page exposes.
- CLAUDE.md §9's public-pages bullet currently says *"first name + last initial only"*. That is now
  incomplete — add the external-speaker exception and point at
  `lib/program/publicProjection.ts` as the boundary. Getting this wrong in CLAUDE.md would teach a
  future session the wrong rule.

---

## Testing Strategy

| File | Asserts |
|---|---|
| `tests/lib/publicProjection.test.ts` | **Highest priority.** Given a full draft, the output contains no phone, no address, no full member surname, no note, no member id, no email. Asserted by scanning the serialised output for the fixture's known-distinctive strings, so a field added later fails the test without anyone updating it |
| `tests/lib/publicProjection.test.ts` | An external speaker's full typed name **is** present (ITER-004); a member's is not |
| `tests/rls/public-program-anon.test.ts` | The anon client reads the view; the anon client **cannot** read `programs`, `members`, `sundays` or `wards` directly; a non-distributed program is absent from the view |
| `tests/rls/public-views.test.ts` (extend) | The existing suite gains the new columns |
| `tests/routes/public-page.test.ts` | Renders with no session; unknown slug 404s; inactive slug 404s; undistributed program 404s |

The scan-for-known-strings assertion is the one that matters. A test listing allowed fields passes
forever as fields are added; a test that fails when the fixture's phone number appears anywhere in
the output catches the field nobody thought about. Write it that way.

---

## Test Scenarios (Harness)

### Scenario 032: The QR page a visitor sees

**Tags:** `program`, `public`, `privacy`, `smoke`
**Purpose:** The privacy surface, checked by a human on a real phone. Machine tests prove the
projection; a person has to look at the page and confirm nothing on it should not be there.

**Seed data summary:**
- scenario 028's Sunday, program `distributed`, `public_data` written
- `public_pages` — 1 — `page_type = 'program'`, active, a known slug
- `members` — the speaker's household carries a **phone number and a street address**, so a leak has
  something visible to leak
- `wards.settings.leadership_contacts` — three names **with phone numbers**

**Tester action:** Open `/public/<slug>` in a **private browser window on a phone**, signed out.

**Verification checklist:**
- [ ] The page renders with no login prompt and no app chrome
- [ ] The member speaker reads "Sarah W." — never the full surname
- [ ] The external speaker reads "President Mark Andersen" in full (ITER-004)
- [ ] **No phone number appears anywhere on the page** — check the rendered source, not just the view
- [ ] No street address, no email, no leadership contact panel
- [ ] Changing the slug to a made-up value gives a 404
- [ ] The page is legible at 375px in both light and dark

### Scenario 033: A program that is not distributed yet

**Tags:** `program`, `public`, `full`
**Purpose:** The gate. Seeding an approved-but-undistributed program is the state that is awkward to
reach by hand.

**Seed data summary:** as 032, but `status = 'approved'` and `distributed_at` null.

**Verification checklist:**
- [ ] The slug 404s — it does not render an empty program
- [ ] After distribution (`program-d`), the same slug renders
- [ ] Sending it back to draft makes it 404 again

---

## Validation Commands

```bash
npm run db:push
npm run db:types
npm run lint
npm run typecheck
npm run test
npm run build
```

After `db:push`, **verify the grant landed** before trusting the tests:

```sql
select grantee, privilege_type from information_schema.role_table_grants
 where table_name = 'public_program';
```

A dropped-and-recreated view loses its grants. The failure mode is a public page that 404s for
everyone, with nothing in any log to say why.

---

## Integration Notes

- **`program-d`** encodes `https://<host>/public/<slug>` in the QR code and calls `revalidatePath()`
  after distributing. The slug must therefore exist before a PDF is generated — `program-d` creates
  the `public_pages` row if it is missing.
- **Phase 10** adds the `sacrament_assignments` branch to this same shell and reads the
  `public_sacrament_assignments` view, which this plan leaves untouched.
- **ITER-004 is closed by this plan and `program-d` together** — public here, printed there. Do not
  close the scope until `program-d` merges.
- **Breaking change:** `public_program` gains and loses columns. Nothing reads it today, so the
  blast radius is zero — but it is the last moment that will be true.
