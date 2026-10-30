# Plan: Sacrament Planner behind the Sacrament tile (adapter)

**Created:** 2026-10-23
**Type:** feature
**Scope refs:** ITER-045

## Overview

The bishopric's finished **Sacrament Planner** (`sacrament-planner-handoff/`) moves into Ward
Leadership Tools behind the existing **Sacrament** tile. It looks and works exactly as it does
today. The Planner's own code runs **unchanged** inside a same-origin `<iframe>` under the app's chrome
bar, and a TypeScript **adapter** fills the one doorway it already uses for the outside world
(`window.claude.use("db" | "user" | "sample" | "downloads")`) with the app's real database, login
and AI.

### Decisions settled with the user (2026-10-23, during `/planning`)

| # | Decision |
|---|---|
| D1 | **Adapter, not a rebuild — for now.** The user asked whether the adapter can carry the app's future links and pipelines. The answer given: it *can* (every save passes through our server route), but each pipeline would have to diff the Planner's JSON documents and translate them into the app's tables, and the Planner's rules run only in the browser. So it is the right way to get the bishopric on real data now, and a weak permanent foundation. **The user chose "adapter only, decide about a rebuild later"**, after using it inside the app. Build nothing that assumes either outcome. |
| D2 | **Today's sacrament screens stay in the code, hidden from everyone except the super admin**, as reference for re-pointing pipelines later. Not deleted. |
| D3 | **The Planner sits under the app's chrome bar** (the app's top bar stays; the Planner fills the rest with its own banner and bottom tab bar). |
| D4 | **Live updates are instant** (Supabase Realtime), as they are today. |
| D5 | **Storage is one ward-scoped document table** (`planner_documents`) holding the Planner's ten collections as JSON, keyed exactly as today, plus a read-only `planner_history` row holding the agenda history that is built into the page today. |
| D6 | **Identity comes from the calling, not the name.** A bishop login is whoever the Planner's `settings/bishopric` lists with role "Bishop"; a counselor with `counselor_position` 1 or 2 is "1st Counselor" / "2nd Counselor". The "You are" selector is hidden and a **Practice mode** switch takes its place. |
| D7 | **Bishopric only for now**, through a new non-overridable permission `planner.use` plus `is_bishopric()` in RLS. ITER-046 (access by title) replaces this later. |

### Things the scope did not mention, found in research

1. **The agenda history is built into the page.** `app/src/data.json` holds `rows` (922 talk and
   prayer lines from 205 agendas), `meetings` and `conduct`, all with members' names, embedded at
   build time where `body.html` says `__DATA__`. It cannot be a static file. It is imported into
   `planner_history` and injected by an authenticated route at request time, exactly where
   `build.py` puts it today.
2. **Real names are hard-coded in `body.html`** as fallbacks: `DEFAULT_BISHOPRIC`,
   `DEFAULT_ROTATION` and `DEFAULT_CONTACTS.execSecretary`. **The export has no `bishopric` or
   `rotation` settings documents**, so the Planner runs on those fallbacks right now. They are moved
   into imported settings documents and replaced in the code with placeholders.
3. **`talks.view` (the Sacrament tile's permission) is also held by `music_coordinator`**, so the
   tile needs a new permission to be bishopric-only.
4. **Both the Planner and the app store the theme in `localStorage["theme"]`**, and a same-origin
   iframe shares the parent's storage. The Planner's five keys get a `planner:` prefix.
5. **Call / Text already work from a same-origin frame.** `tryOpenApp()` tries a `_top` anchor
   first and falls back to copying. No code change; it must be checked on a real phone.

### Success criteria

- The Sacrament tile opens the Planner under the chrome bar for the bishop and both counselors.
  It looks and behaves like `sacrament-planner-handoff/app/sacrament-planner.html` on desktop and
  phone, in light and dark.
- Nobody else sees the tile. A music coordinator gets no tile, and the frame route answers 403.
- The member list comes from the app's `members` table. The Slice B report has been reviewed by
  the user before the import.
- Every exported document is present under its original id with every field, and no `t_` data.
  Counts match. The user's spot-checks pass (Oct 18 and Oct 25 Sundays, To Decide deferral
  counts, Pray About lists, History/Meetings corrections).
- Each bishopric login sees its own Pray About list, ★ flags and To Decide items, and nobody sees
  a "You are" menu.
- Practice mode writes only to the practice layer. "Clear test changes" removes them, and the
  real documents are untouched.
- One person's save appears for the others within a couple of seconds.
- "Write it fresh with Claude" works through the app's AI service. "Download CSV" downloads a file.
- `/sacrament`, `/assignments/**` and `/prayers` redirect everyone except the super admin to the
  Planner.

## Slices and stops

This plan runs as **three slices with two hard stops**. Do not run past a stop.

| Slice | What | Ends with |
|---|---|---|
| **A** | Schema, adapter, frame, tile, legacy gate, AI and download capabilities, tests, scenario | Commit-ready. Works in any ward with seeded or empty data. |
| **B** | Member-list check script (handoff Phase 2) | **STOP:** show the user the report and wait. |
| **C** | Import script (handoff Phase 3) and the go-live runbook | **STOP:** run a dry run, ask for a fresh export, apply, then spot-check with the user. |

## Relevant Files

**Create**
- `supabase/migrations/093_sacrament_planner.sql`: the `planner_documents` and `planner_history` tables, RLS, the release restrictive policies and the realtime publication entry.
- `lib/sacramentPlanner/assets/head.html`, `extra.css`, `body.html`: copied from `sacrament-planner-handoff/app/src/`, with the edits listed in Task 2 only.
- `lib/sacramentPlanner/collections.ts`: collection names, the layer type, and the `t_` ↔ layer mapping.
- `lib/sacramentPlanner/documentSchemas.ts`: Zod schemas for the write envelope and each collection's id and minimal shape (passthrough).
- `lib/sacramentPlanner/access.ts`: `canUsePlanner()` and `assertPlannerAccess()`, mirroring RLS.
- `lib/sacramentPlanner/identity.ts`: calling → bishopric role label → Planner name.
- `lib/sacramentPlanner/wardList.ts`: pure `toPlannerWardList()` (members + households → the Planner's `ward` rows).
- `lib/sacramentPlanner/assemblePlannerHtml.ts`: pure; head + css + bridge script + body with `__DATA__` replaced.
- `lib/sacramentPlanner/queries.ts`: read history, upsert and delete a document.
- `lib/sacramentPlanner/bridge.ts`: client-side `window.claude` adapter.
- `lib/sacramentPlanner/legacyGate.ts`: `redirectUnlessSuperAdmin()`.
- `app/(app)/sacrament-planner/page.tsx`: the gated page.
- `app/(app)/sacrament-planner/PlannerFrame.tsx`: `"use client"`; installs the bridge, then renders the iframe.
- `app/api/sacrament-planner/frame/route.ts`: GET, the assembled Planner document.
- `app/api/sacrament-planner/documents/route.ts`: PUT and DELETE, one document.
- `app/api/sacrament-planner/draft/route.ts`: POST, "Write it fresh with Claude".
- `supabase/scripts/plannerWardListCheck.ts`: Slice B.
- `supabase/scripts/plannerImport.ts`: Slice C.
- Tests, listed under Testing Strategy.
- `testing/scenarios/sacrament/scenario-093-sacrament-planner-in-the-app/`: harness scenario (folder name per `testing/scenarios/_templates`; use the area folder the templates prescribe).

**Modify**
- `lib/auth/permissions.ts`: add `planner.use` to `PERMISSIONS` and `planner.` to `NON_OVERRIDABLE_PERMISSIONS`.
- `lib/access/releasedModules.ts`: sacrament entry gets permission prefix `planner.`, route prefix `/sacrament-planner`, and tables `planner_documents`, `planner_history`.
- `lib/access/accessModules.ts`: confirm no access module offers `planner.*`. Change only if its import-time assertion requires an explicit exclusion.
- `lib/auth/navigation.tsx`: the Sacrament item's `href` becomes `/sacrament-planner` and its `permission` becomes `planner.use`. Rewrite the row's comment to say why.
- `app/(app)/sacrament/page.tsx`, `app/(app)/assignments/page.tsx`, `app/(app)/assignments/[sunday_id]/page.tsx`, `app/(app)/prayers/page.tsx`: call `redirectUnlessSuperAdmin()` first.
- `next.config.ts`: `outputFileTracingIncludes` for the frame route's assets.
- `types/database.ts`: regenerate (`npm run db:types`).
- `tests/rls/realtime-isolation.test.ts`: add `planner_documents`.
- `.gitignore`: add `sacrament-planner-handoff/` (it holds real names in `body.html` and `HANDOFF.md`).
- `CLAUDE.md` §9, `SPEC.md` (tables), `plans/prototype/module-map.md` (a row for the Planner): documentation, Task 17.

## Dependencies

- **No new libraries.**
- **Migration 092 must be applied before 093.** ITER-044's completion note says it is not yet
  applied. Apply it first (`npm run db:push` applies both, in order) and confirm with the user
  before pushing.
- Existing helpers to use: `requireSessionUser`, `resolveRoleAccess`, `assertCan`, `can`
  (`lib/auth/*`); `readJsonBody` and `respondToRouteError` (`lib/auth/routeErrors.ts`);
  `writeAuditLog`; `createServerSupabaseClient`, `createBrowserSupabaseClient` and
  `createServiceSupabaseClient`; `readWardRoster` (`lib/roster/wardRoster.ts`, called with
  statuses `active` and `do_not_contact`, so moved-out members are excluded); `readWardTimezone`;
  `callClaude`, `MODEL`, `MESSAGE_MAX_TOKENS` and the `AiRequestError` mapping (`lib/ai/*`). Use the
  realtime channel pattern from `app/(app)/assignments/CommentThread.tsx` (unique channel name per
  instance, cleanup on unmount, the "callbacks after subscribe" trap documented there).
- Scripts follow `supabase/scripts/fillTestRosterFields.ts`: run under Node with `register.mjs`,
  service client, dotenv. Add `planner:check` and `planner:import` entries to `package.json`
  `scripts` in the same style (an edit to `package.json`, not a new dependency).

## Known Pitfalls (from retro context)

- **route-tests-and-realtime**: a table added to `supabase_realtime` is a privacy decision. The
  realtime isolation suite once passed while realtime was dead, so assert a positive delivery
  before trusting a negative. Channel topics must be unique per instance.
- **released-modules-per-ward / release-sacrament-tile-alone**: every new permission must belong
  to exactly one module (it throws at load). Every top-level page folder must map to a module
  (`tests/lib/releasedRoutesCovered.test.ts`). The restrictive release policies must equal the
  catalog's `tables` (`tests/db/module-release-policies.test.ts`). Matching is whole-segment, so
  `/sacrament` does **not** cover `/sacrament-planner`.
- **ward-callings-model**: author columns reference `users (id)` alone, never a composite key.
  `updated_by` is written from `auth.uid()` and checked in WITH CHECK.
- **CLAUDE.md §9, 060-D2**: a UI gate that mirrors a policy must mirror **both** USING and WITH
  CHECK. `canUsePlanner()` must equal the policy exactly: `planner.use` **and** a bishopric role.
- **ITER-017**: `writeAuditLog` redacts any detail key matching
  `/pin|token|secret|password|…|\bkey\b|hash|…|note/i`. Use detail keys `collection`,
  `documentId` and `layer`. Never `key`, never `docHash`, never anything containing "note", and
  never the document body.
- **CLAUDE.md rule 12**: the explicit-timezone test scans `.ts`/`.tsx` under `app/`,
  `components/` and `lib/`. The Planner's HTML assets are not scanned, and the Planner renders only
  in the browser (its `TODAY` is the device's date, which is the ward's for this ward). No server
  path runs Planner code. Any **TypeScript** this plan adds that formats a date must name its zone.
  The age calculation uses the ward zone's today, not `new Date()` local parts.
- **roster-paste-import**: PostgREST caps a read at 1000 rows. The ward has about 350 members, but
  page the read the way `roster-paste-import` does if `readWardRoster` does not already.

## Tasks

### Slice A: the Planner runs inside the app

#### Task 1: Migration 093
**File:** `supabase/migrations/093_sacrament_planner.sql` (create)
**Action:** Two tables, their policies and the publication entry. Follow the header-comment style of 091 and 092.
**Details:**
- `planner_documents`
  - `ward_id uuid not null references wards (id) on delete cascade`
  - `layer text not null check (layer in ('real','practice'))`
  - `collection text not null check (collection in ('sundays','deferrals','considers','nameFixes','rowFixes','goesBy','marks','holds','people','settings'))`
  - `document_id text not null check (char_length(document_id) between 1 and 200)`
  - `data jsonb not null check (jsonb_typeof(data) = 'object')`
  - `updated_at timestamptz not null default now()`
  - `updated_by uuid references users (id) on delete set null` (null only for imported rows)
  - `primary key (ward_id, layer, collection, document_id)`
- `planner_history`: `ward_id uuid primary key references wards (id) on delete cascade`,
  `agenda_rows jsonb not null`, `meetings jsonb not null`, `conducting jsonb not null`,
  `imported_at timestamptz not null default now()`.
- RLS on both. `planner_documents`:
  - SELECT and DELETE `using (ward_id = current_ward_id() and is_bishopric())`.
  - INSERT `with check (ward_id = current_ward_id() and is_bishopric() and updated_by = auth.uid())`.
  - UPDATE uses the same predicate on **both** halves, plus `updated_by = auth.uid()` in WITH CHECK.
- `planner_history`: a SELECT policy only, same predicate. There is **no write policy**; the import
  script uses the service role.
- A **restrictive** policy on each table calling `ward_module_released('sacrament')`. Copy the
  exact form and naming from migration 091/092.
- `alter publication supabase_realtime add table planner_documents;`, guarded the way migration
  026 guards it.
- Do not put `planner_history` in the publication. It never changes after import.

#### Task 2: Bring the Planner's files in, with the listed edits only
**Files:** `lib/sacramentPlanner/assets/head.html`, `extra.css`, `body.html` (create, copied from `sacrament-planner-handoff/app/src/`)
**Action:** Copy them byte for byte, then make **only** these edits. Keep a list of them in the commit message.
**Details:**
- **E1 (real names out).** First write the current values of `DEFAULT_BISHOPRIC`,
  `DEFAULT_ROTATION` and `DEFAULT_CONTACTS` to
  `sacrament-planner-handoff/data/settings-defaults.json` (gitignored; Slice C imports them). Then
  replace them in `body.html` with placeholders that keep every code path working:
  `[{name:"Bishop",role:"Bishop"},{name:"1st Counselor",role:"1st Counselor"},{name:"2nd Counselor",role:"2nd Counselor"}]`,
  a rotation whose `order` is those three names with `start` unchanged, and contacts with an empty
  `execSecretary`. Read `rotation()` and `bishopric()` first to confirm the placeholders cannot
  divide by zero or render "undefined".
- **E2 (identity).** In the header markup, keep `<select id="actingAs">` in the DOM but `hidden`,
  because other code reads its `innerHTML`. Add
  `<label class="acting"><input type="checkbox" id="practiceMode"> Practice mode</label>` beside it.
  In boot, after `const user = await claude.use("user")`, set `state.loginMe = await user.me()`.
  When `loginMe` is non-empty, set `state.me = state.loginMe` and `state.meChosen = true`, and
  ignore the stored `me`. In the `change` listener, treat `practiceMode` exactly as the
  `actingAs` branch does, with `state.me = checked ? TEST : state.loginMe` and no `localStorage`
  write of `me`. When `loginMe` is empty, the adapter's `can("data.write")` returns false and the
  existing read-only message shows (Task 9). Check that the `actingAs2` dialog (around line 1889)
  can no longer open when `meChosen` is true. If it can, hide it on the same condition.
- **E3 (storage keys).** Prefix the Planner's `localStorage` keys (`fold`, `show`, `theme`, `tab`,
  `me`) with `planner:` at every read, write and remove (lines around 1369, 1370, 1873, 1917, 2012
  and 2294–2296).
- **Nothing else changes.** Leave `if (!window.claude) …` (the bridge is set before it runs), the
  `__DATA__` line, `tryOpenApp`, the `t_` practice mechanism and `limit(1000)`.
- **Name sweep before the commit:** write a throwaway script in the scratchpad that lists every
  `name` in `sacrament-planner-handoff/data/ward-list-used-by-planner.json` (both "Last, First"
  and "First Last" forms). Search all three asset files for each one. **Zero hits** is required.
  Report the result in the commit summary.
- **Later edits:** see `plans/sacrament-planner-refinements.md` (G1–G5).

#### Task 3: Collections and layers
**File:** `lib/sacramentPlanner/collections.ts` (create)
**Details:** Export `PLANNER_COLLECTIONS` (the ten names, `as const`), `PlannerCollection`, and
`PLANNER_LAYERS = ["real","practice"]`. Export `parseCollectionName(name)`, which maps `"t_sundays"`
to `{ layer: "practice", collection: "sundays" }` and `"sundays"` to `{ layer: "real", collection:
"sundays" }`, and **throws** on anything else. Also export `SETTINGS_DOCUMENT_IDS = ["bishopric",
"rotation","contacts","autoRelease","topics"]`.

#### Task 4: Document schemas
**File:** `lib/sacramentPlanner/documentSchemas.ts` (create)
**Details:**
- `plannerWriteSchema`: `{ layer, collection, documentId, data }` for PUT, and the same without
  `data` for DELETE. The serialized `data` must be at most 200 000 characters. Refuse with a
  sentence, not a stack trace.
- Per-collection id rules: `sundays` ids match `^\d{4}-\d{2}-\d{2}$` and `data.date` equals the
  id. `settings` ids are in `SETTINGS_DOCUMENT_IDS`. Everything else matches
  `^[A-Za-z0-9_.:|-]{1,200}$`. **Before fixing the regex, run every id in
  `database-export.json` and every `rows` id in `data.json` through it**, and widen it to fit
  what is really there.
- Per-collection minimal shape, using **`.passthrough()` always** so every field survives:
  `deferrals`, `holds`, `goesBy`, `people`, `marks` and `considers` need `name: string`; `marks`
  also needs `by: string`; `considers` needs `kind`; `nameFixes` needs `key: string` and
  `person: string`.
- Export `validatePlannerDocument(collection, documentId, data)`, used by both the route and the
  import script.

#### Task 5: Access, mirroring RLS
**Files:** `lib/auth/permissions.ts` (modify), `lib/access/releasedModules.ts` (modify), `lib/sacramentPlanner/access.ts` (create)
**Details:**
- Add `"planner.use"` to `PERMISSIONS`. Bishopric and super admin receive all of `PERMISSIONS`
  already. Confirm no other role's list is derived in a way that picks it up.
- Add `permission.startsWith("planner.")` to `NON_OVERRIDABLE_PERMISSIONS` and extend its comment:
  bishopric-only until ITER-046.
- Sacrament catalog entry: `permissionPrefixes: ["talks.", "topics.", "planner."]`; add
  `"/sacrament-planner"` to `routePrefixes`; add `"planner_documents"` and `"planner_history"` to
  `tables`.
- `canUsePlanner(user, roleAccess)` returns `can(user, "planner.use", roleAccess) &&
  BISHOPRIC_ROLES.includes(user.role)`. `assertPlannerAccess()` throws the same error type
  `assertCan` throws. The comment says this mirrors `is_bishopric()` in migration 093, so a super
  admin whose calling here is not bishopric is refused by both.

#### Task 6: Identity
**File:** `lib/sacramentPlanner/identity.ts` (create)
**Details:** `bishopricRoleLabel(role, counselorPosition)` returns `"Bishop" | "1st Counselor" |
"2nd Counselor" | null`. `plannerNameFor(label, bishopricDocument)` finds `members[]` with that
`role` and returns its `name`, or `null` when there is no match or the document is missing.
It is pure.

#### Task 7: Ward list mapping
**File:** `lib/sacramentPlanner/wardList.ts` (create)
**Details:**
- `toPlannerWardList(households, todayInWardZone)` returns the Planner's `ward` array as tuples,
  the shape `data.json` uses: `[name, age, gender, phone, phoneVia, email]`. Check the tuple
  order against `body.html` line 216.
- `name` is `preferred_name ?? full_name ?? "${last}, ${first}"`. Slice B reports how well each
  source matches. Adjust here only if the user agrees.
- `age` is whole years from `birth_date` to `todayInWardZone` (a `DateOnly`). Use null when the
  birth date is unknown, and check that the Planner tolerates a null age.
- `gender` maps `male`/`female` to `"M"`/`"F"`, and anything else to `""`.
- `phone` is the member's own phone. When it is empty, use the phone of the oldest adult in the
  same household who has one, and set `phoneVia` to that person's name. Otherwise `phoneVia` is
  `""`. Slice B confirms this rule matches the Planner's list.
- Sort by name, the way the Planner's list is sorted.

#### Task 8: HTML assembly and queries
**Files:** `lib/sacramentPlanner/assemblePlannerHtml.ts` (create), `lib/sacramentPlanner/queries.ts` (create)
**Details:**
- `assemblePlannerHtml({ head, css, body, data })` reproduces `build.py` exactly:
  `head + css + "\n</style>\n\n" + BRIDGE_SCRIPT + body`, with the **first** `__DATA__` replaced
  by `JSON.stringify(data).replaceAll("</", "<\\/")`.
  `BRIDGE_SCRIPT = '<script>window.claude = (window.parent !== window && window.parent.__wltPlannerBridge) || undefined;</script>\n'`.
  Throw if `__DATA__` is absent. It is pure: file reading happens in the route.
- `readPlannerHistory(wardId, client)` returns `{ rows, meetings, conduct }`. When no row exists,
  return **empty structures**, not null: `{ rows: [], meetings: {}, conduct: {} }`. A ward that
  was never imported is ordinary, and the Planner must still open.
- `upsertPlannerDocument(...)` and `deletePlannerDocument(...)` run through the caller's own
  client (RLS). An RLS refusal on INSERT/UPDATE (SQLSTATE 42501) maps to a `null` the route turns
  into 403. A zero-row DELETE is a success, just as Firestore deleting a missing document is.

#### Task 9: The bridge
**File:** `lib/sacramentPlanner/bridge.ts` (create)
**Action:** Export `createPlannerBridge(options)`, returning `{ use(name): Promise<capability | null> }`.
**Details:** `options = { wardId, roleLabel, supabase (browser client), fetchImpl }`.
- **`db`**: `collection(name)` returns
  `{ limit(): sameObject, onSnapshot(callback, errorCallback): unsubscribe, doc(id): { set(value), delete() } }`.
  - Parse the name with `parseCollectionName`. Keep one cache per `(layer, collection)`.
  - `onSnapshot`: on first use, read through the **user's own client**
    (`select document_id, data … eq ward_id … eq layer … eq collection`). Fill the cache and
    call `callback({ docs: [{ id, data: () => value }] })`. Call `errorCallback` on a read error
    and `console.error` with context; never swallow it.
  - **One realtime channel per bridge**, on `planner_documents` filtered `ward_id=eq.${wardId}`.
    On **any** event, re-read that event's `(layer, collection)` and fire its listeners. **Never
    trust the payload** (DELETE payloads carry only the primary key).
  - `set` / `delete`: call `PUT` / `DELETE /api/sacrament-planner/documents`. On success, update
    the cache and fire listeners **immediately** (Firestore's latency compensation, which the
    Planner's undo/redo relies on). On failure, **reject**, so the Planner's `write()` shows
    "Couldn't save". On a 403, reject with `{ code: "invalid_argument" }`, which the Planner
    already turns into its view-only message.
- **`user`**:
  `{ can: async (permission) => permission === "data.write" ? nameResolved : false, me: async () => name ?? "" }`.
  The name resolves once by reading `settings/bishopric` (real layer) and calling
  `plannerNameFor`. With no match, `can` is false, so the Planner shows its own view-only
  message. Change that sentence only if the user asks.
- **`sample`**: `(prompt, options) => POST /api/sacrament-planner/draft { prompt }`. Call
  `options.onText({ text })` once and resolve `{ text }`. On failure, throw an object whose
  `code` is `"not_granted"` for 403, so the Planner's own wording appears.
- **`downloads`**: `{ save({ filename, data }) }` uses an object URL and an anchor click,
  revoked afterwards.
- Export `disposePlannerBridge()` to remove the channel. The page calls it on unmount.

#### Task 10: The frame route
**File:** `app/api/sacrament-planner/frame/route.ts` (create)
**Details:**
- `GET`: `requireSessionUser()`, then `resolveRoleAccess` and `assertPlannerAccess`, then the
  released-module check (`isModuleReleased(user, "sacrament")` or the existing helper in
  `releasedModules.ts`). On refusal, answer **403 with a short HTML sentence**.
- Read the three assets with `fs/promises` from `path.join(process.cwd(), "lib/sacramentPlanner/assets", …)`.
- Data: `readWardRoster(user.wardId, { statuses: ["active", "do_not_contact"] }, supabase)`, then
  `toPlannerWardList(households, todayInWardZone)`, where the zone comes from `readWardTimezone`.
  Then `readPlannerHistory`.
- Assemble `{ ward, rows, meetings, conduct }` in `data.json`'s shape, call `assemblePlannerHtml`,
  and return it with `Content-Type: text/html; charset=utf-8`, `Cache-Control: private, no-store`,
  `X-Frame-Options: SAMEORIGIN`, and `Content-Security-Policy: frame-ancestors 'self'`.
- Errors go through `respondToRouteError`, which logs with context.

**File:** `next.config.ts` (modify). Add
`outputFileTracingIncludes: { "/api/sacrament-planner/frame": ["./lib/sacramentPlanner/assets/**"] }`
with a one-line *why* comment (Vercel bundles only imported files).

#### Task 11: The documents route
**File:** `app/api/sacrament-planner/documents/route.ts` (create)
**Details:**
- `PUT`: session, access check, `readJsonBody`, `plannerWriteSchema`,
  `validatePlannerDocument`, then `upsertPlannerDocument` with `updated_by = user.id`, then
  `writeAuditLog({ action: "planner.document_saved", module: "sacrament", detail: { collection, documentId, layer } })`.
  Respond `{ ok: true }`.
- `DELETE`: same, with action `"planner.document_deleted"`.
- A 400 carries a sentence. A refusal is 403. Never 500 for a policy refusal.
- Practice writes are audited too, with `layer: "practice"` in the detail.

#### Task 12: The AI route
**File:** `app/api/sacrament-planner/draft/route.ts` (create)
**Details:**
- `POST { prompt: string (1–8000) }`: session, access check, then
  `callClaude({ system: [a short system block: "You write messages for a ward bishopric. Return only the message text."], userPrompt: prompt, effort: "medium", maxTokens: MESSAGE_MAX_TOKENS })`.
  Return `{ text }`.
- The prompt text is built by the Planner, unchanged. Say so in a *why* comment: rule 3 holds,
  because the result lands in a textarea the user edits and copies, and nothing is stored or sent.
- Audit `"planner.draft_written"` with `{ outputTokens }` (ITER-017 will redact it; that is a
  known open item, not this plan's).
- Map `AiRequestError` through the existing `AI_ERROR_STATUSES` / `AI_ERROR_MESSAGES`.

#### Task 13: The page and the frame component
**Files:** `app/(app)/sacrament-planner/page.tsx`, `PlannerFrame.tsx` (create)
**Details:**
- **Page (Server Component):** `requireSessionUser`, `resolveRoleAccess`, then `canUsePlanner`.
  If false, render the app's existing "not permitted" pattern (copy it from a sibling page). Pass
  `wardId` and `roleLabel = bishopricRoleLabel(user.role, user.counselorPosition)` to
  `PlannerFrame`.
- **PlannerFrame (`"use client"`):** in an effect, create the bridge, assign
  `window.__wltPlannerBridge`, and set `ready`. Render `<iframe src="/api/sacrament-planner/frame" title="Sacrament Planner">`
  only when ready. On unmount, dispose the bridge and delete the global.
- **No `sandbox` attribute.** Same-origin and trusted, and `tryOpenApp` needs `_top` navigation.
- Size: full width, `height: calc(100dvh - <chrome bar height>)`, no border. Read the chrome bar's
  height from `components/layout/*` rather than guessing.
- Declare `__wltPlannerBridge` on `Window` in a `declare global` block in `bridge.ts`.

#### Task 14: The tile and the legacy gate
**Files:** `lib/auth/navigation.tsx`, `lib/sacramentPlanner/legacyGate.ts`, the four legacy pages (modify / create)
**Details:**
- The Sacrament item becomes `href: "/sacrament-planner"`, `permission: "planner.use"`. Keep the
  label "Sacrament", the blurb, the icon and the accent. Rewrite the comment: the Planner (ITER-045)
  is behind the tile, the old hub is super-admin-only reference (D2), and `planner.use` is
  bishopric-only until ITER-046.
- `redirectUnlessSuperAdmin(user)` calls `redirect("/sacrament-planner")` when `!user.isSuperAdmin`.
  Call it at the top of `sacrament/page.tsx`, `assignments/page.tsx`,
  `assignments/[sunday_id]/page.tsx` and `prayers/page.tsx`.
- **Do not touch** `/talks/topics`, `/program`, `/music` or `/calendar`. They are their own
  released modules (ITER-044).
- Hidden, not disabled: the old API routes still answer the bishopric. Say so in
  `legacyGate.ts`'s comment.

#### Task 15: Types
Run `npm run db:types` after the migration is applied. No hand-written domain types are needed
beyond those in `lib/sacramentPlanner/*`.

#### Task 16: Harness scenario 093
See Test Scenarios. Fake names only.

#### Task 17: Documentation
- `CLAUDE.md` §9: a new entry, **"THE SACRAMENT PLANNER RUNS AS AN ADAPTER — DECIDED
  2026-10-23"**. Cover D1–D7, the JavaScript exception (the Planner's assets are imported code,
  edited only for the listed reasons), and the fact that pipelines are deliberately unconnected.
- `SPEC.md`: add both tables.
- `plans/prototype/module-map.md`: one row: Sacrament Planner (handoff), verdict ADAPTER, not
  from the prototype, replaces the Sacrament hub's tile.

### Slice B: check the member list — STOP after

#### Task 18: Check script
**File:** `supabase/scripts/plannerWardListCheck.ts` (create); `package.json` script `planner:check`
**Details:**
- Arguments: `--ward <uuid>` (the real ward), `--list sacrament-planner-handoff/data/ward-list-used-by-planner.json`,
  `--export sacrament-planner-handoff/data/database-export.json`,
  `--history sacrament-planner-handoff/app/src/data.json`, and `--out` (must sit under
  `sacrament-planner-handoff/data/`; refuse any other path, because the report contains names).
- Read the ward through the service client and map it with **`toPlannerWardList`**, so the
  report checks exactly what the frame will serve.
- Report, as Markdown:
  1. Names only in the app's list, and names only in the Planner's list.
  2. Likely the same person written differently: same last name with a first-name prefix or
     nickname, or edit distance ≤ 2.
  3. Field differences for matched names: age, gender, phone, `phoneVia` and email.
  4. Every name used in the records that is not in the app's list. Sources: `deferrals`,
     `considers`, `goesBy`, `marks`, `holds` and `people` names; `sundays` slot names;
     `nameFixes.person` and `rowFixes.person` (skip `__none__`); and `rows[].key`.
  5. The match rate for each name source (`preferred_name`, `full_name`,
     `"${last}, ${first}"`), so the Task 7 rule can be confirmed.
- **No writes of any kind.**
- **STOP:** tell the user where the report is, summarise the counts in plain words, and wait. If
  fixes are needed, they are made in the roster (paste a fresh LCR report) or agreed changes to
  Task 7. Never edit records to fit.

### Slice C: import — STOP for spot-checks

#### Task 19: Import script
**File:** `supabase/scripts/plannerImport.ts` (create); `package.json` script `planner:import`
**Details:**
- Arguments: `--ward`, `--export`, `--history`, `--settings-defaults` (from Task 2 E1), and
  `--apply` (default **dry run**).
- Skip any collection starting with `t_` and report it. Refuse an unknown collection.
- Run every document through `validatePlannerDocument`. If any document fails, write **nothing**
  and list the failures.
- Add `settings/bishopric` (`{ members: DEFAULT_BISHOPRIC }`) and `settings/rotation` from the
  defaults file **only if the export lacks them**. Report which were added.
- Apply: upsert every document into `planner_documents` (layer `real`, `updated_by` null) with
  its original id and `data` byte for byte. Upsert `planner_history` from `data.json`'s `rows`,
  `meetings` and `conduct` (not `ward`). Write one audit row,
  `planner.imported { counts }`.
- Afterwards, re-read and print the count per collection beside the export's count. Exit
  non-zero on any mismatch.
- Re-runnable: a fresh export overwrites documents with the same id and adds new ones. It **never
  deletes**. Say so in the output.

#### Task 20: Go-live runbook (executor walks the user through, one step at a time)
1. Confirm migrations 092 and 093 are applied and Slice A is deployed.
2. Run `npm run planner:check`. **Stop** for the user's review (Slice B).
3. Ask the user to stop using the old Planner page and send a **fresh export**. Replace
   `data/database-export.json`.
4. Run `npm run planner:import` without `--apply`. Show the counts.
5. Run with `--apply`.
6. On Stakes & Wards, the super admin releases **Sacrament** and **Tithing** for the real ward.
   The bishopric already holds `tithing.*` and now `planner.use`.
7. Spot-check with the user, comparing the old page with the new one side by side: Oct 18 and
   Oct 25 Sundays, deferral counts on To Decide, each member's Pray About list, and the
   History/Meetings corrections.
8. Each bishopric member signs in and confirms their own name, Pray About list and ★ flags.

## Testing Strategy

| File | Covers |
|---|---|
| `tests/lib/sacramentPlanner/collections.test.ts` | `t_` mapping, unknown names throw |
| `tests/lib/sacramentPlanner/documentSchemas.test.ts` | Each id rule, passthrough keeps unknown fields, size cap, sunday id ≠ date refused. **Negative data passes every earlier check** (a valid collection and id with a bad shape, and so on) |
| `tests/lib/sacramentPlanner/identity.test.ts` | Bishop, counselor positions 1 and 2, a counselor with null position → null, a missing document → null |
| `tests/lib/sacramentPlanner/wardList.test.ts` | Name source fallback; age on the day before and on the birthday, computed from a ward-zone `DateOnly`; gender; the household `phoneVia` fallback; moved-out excluded (by caller statuses); tuple order |
| `tests/lib/sacramentPlanner/assemblePlannerHtml.test.ts` | Mirrors `build.py`; a name containing `</script>` is escaped; only the first `__DATA__` is replaced; the bridge script comes before the Planner script; a missing placeholder throws |
| `tests/lib/sacramentPlanner/bridge.test.ts` (jsdom) | Snapshot shape; `t_` reads the practice layer; `set` fires listeners before the realtime echo; a failed PUT rejects; a 403 rejects with `invalid_argument`; `user.can` false when no bishopric match; `downloads.save` creates an anchor. Supabase and fetch are faked here — this is the one place a fake client is right, because the real path is covered by the route and RLS suites |
| `tests/rls/planner-documents.test.ts` | Bishop and counselor in ward A read and write; ward B sees nothing; `music_coordinator` in ward A reads nothing and its write raises 42501; `updated_by` must be self; `planner_history` is unwritable by anyone, the bishop included; an unreleased `sacrament` module hides both tables. Assert refused UPDATE/DELETE **by re-reading** with the service client |
| `tests/rls/realtime-isolation.test.ts` (modify) | Ward A's bishop receives a `planner_documents` event, and ward B's does not. Assert the positive first |
| `tests/routes/sacrament-planner-documents.test.ts` | PUT and DELETE happy paths with audit rows; practice layer; 400 with a sentence; `music_coordinator` 403; super admin without a bishopric calling 403 |
| `tests/routes/sacrament-planner-frame.test.ts` | The bishop gets HTML with seeded fake member names in "Last, First" form and no `__DATA__`; `no-store`; 403 for `music_coordinator`; it opens with no `planner_history` row |
| `tests/routes/sacrament-planner-draft.test.ts` | Assembles the call with the Planner's prompt and `effort: "medium"` (mock only the Anthropic SDK, as existing AI route tests do); an API error maps to its status; 403 path |
| Existing suites to run and keep green | `permissions.test.ts`, `releasedRoutesCovered.test.ts`, `navigationRoutesExist.test.ts`, `module-release-policies.test.ts`, `ward-isolation.test.ts`, `explicitTimeZone.test.ts` |

Seed through `seedFixtures(handles)` and clean up in `afterAll`. Read
`tests/helpers/routeClient.ts`'s header before writing the route tests.

## Test Scenarios (Harness)

### Scenario 093: The Sacrament Planner inside the app
**Tags:** sacrament, full, access, realtime
**Purpose:** Proves that the Planner opens under the chrome bar for the bishopric only, that
identity follows the login, that practice stays separate, and that a save reaches a second
person live. Two logins plus seeded Planner documents is hard to set up by hand.
**Seed data summary:**
- The test ward's bishop and 1st counselor users (existing harness users).
- `planner_documents` (real), 8 documents: `settings/bishopric` naming the two seeded users'
  display names as "Bishop" and "1st Counselor"; `settings/rotation`; two upcoming Sundays
  (one with a tentative speaker and a topic); two `deferrals` (one active, one pending
  approval); one `considers` item owned by each of the two members.
- `planner_history`: about 10 fake agenda rows across 3 past Sundays, with `meetings` and
  `conduct`.
- **Fake names only.**

**Tester action:** Sign in as the bishop on a phone-width window and as the counselor in a second
browser. Open the Sacrament tile. Edit a Sunday as the counselor. Turn on Practice mode as the
bishop, make a change, then clear it. Sign in as the music coordinator. Visit `/sacrament` as the
bishop and as the super admin.

**Verification checklist:**
- [ ] The Sacrament tile opens the Planner under the chrome bar, with its own banner and bottom tab bar, in light and dark
- [ ] The header shows "Using as <bishop's name>" and a Practice mode switch, and no "You are" menu
- [ ] Each person's Pray About list shows only their own item
- [ ] The counselor's save appears in the bishop's window within a few seconds, with no reload
- [ ] Practice mode shows the practice bar; a practice change does not appear for the counselor; "Clear test changes" removes it
- [ ] Undo/redo works on a real change
- [ ] "Write it fresh with Claude" fills the message box; nothing is sent or saved
- [ ] Download CSV saves a file
- [ ] On a real phone, Call and Text open the phone and messages apps
- [ ] The music coordinator sees no Sacrament tile, and `/sacrament-planner` refuses
- [ ] `/sacrament` redirects the bishop to the Planner; the super admin still sees the old hub
- [ ] The app's own theme toggle and the Planner's do not change each other

## Validation Commands

```bash
# Linting
npm run lint

# Type checking
npm run typecheck
npm run harness:typecheck

# Tests (hosted DB; migrations 092 and 093 applied first)
npm test

# Production build
npm run build
```

## Integration Notes

- **Order of operations:** apply 092, then 093, then `db:types`, then Slice A code and tests,
  then commit (the user commits), then deploy. Slices B and C run against the deployed app's
  database.
- **Hidden, not removed:** the old hub's pages redirect, but its API routes and tables are
  untouched and still work for the bishopric. Program, Music and Topic history keep reading the
  old tables. In the real ward they are unreleased, so nothing shows the gap. In the test ward,
  their links to the hub now land on the Planner. That is expected, and the scenario says so.
- **No pipelines are connected.** The Planner's saves reach To Do, music, program and speaking
  history **nowhere**. That is ITER-045's stated scope (D1). Say it in the CLAUDE.md entry so
  nobody assumes otherwise. GROUP-02 (ITER-035, ITER-037) is built on the hidden flow and needs
  a fresh look before it is planned. Note this in the backlog when the item closes.
- **Concurrency is last-write-wins per document**, exactly as the Firestore store was. Two
  people editing the same Sunday card at once can overwrite each other, the same as today.
  Realtime keeps that window small. No locking is added.
- **Practice is shared per ward**, as `t_` collections were. "Clear test changes" clears
  everybody's practice data, as it did.
- **Rule 12:** see Known Pitfalls. The Planner's `TODAY` is the device's date. This is safe
  because the Planner never renders on the server. If a future rebuild moves any of it into
  React Server Components, its date math must be redone against the ward's zone.
- **Privacy:** after Task 2's name sweep, the assets are safe to commit. Everything with names
  stays in `sacrament-planner-handoff/` (gitignored by this plan) or in the database.
- **ITER-046** will replace `planner.use` and the `is_bishopric()` policy with title × module
  levels. Keep the gate in `lib/sacramentPlanner/access.ts` and migration 093 so that change has
  one place to land.
- **A later move to member ids:** names stay the link for now. The non-breaking path is a
  `planner_name_links (ward_id, planner_name, member_id)` table filled from the Slice B match.
  The adapter would resolve names to ids on read while the documents keep their names, so old
  records never need rewriting. Not built here; record it in the CLAUDE.md entry.
