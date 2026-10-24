---
id: sacrament-planner-adapter
type: feature
iter: ITER-045
commits: []
date: 2026-10-24
files:
  - supabase/migrations/093_sacrament_planner.sql
  - lib/sacramentPlanner/assets/body.html
  - lib/sacramentPlanner/bridge.ts
  - lib/sacramentPlanner/collections.ts
  - lib/sacramentPlanner/documentSchemas.ts
  - lib/sacramentPlanner/access.ts
  - lib/sacramentPlanner/identity.ts
  - lib/sacramentPlanner/wardList.ts
  - lib/sacramentPlanner/assemblePlannerHtml.ts
  - lib/sacramentPlanner/queries.ts
  - lib/sacramentPlanner/legacyGate.ts
  - app/(app)/sacrament-planner/page.tsx
  - app/(app)/sacrament-planner/PlannerFrame.tsx
  - app/api/sacrament-planner/frame/route.ts
  - app/api/sacrament-planner/documents/route.ts
  - app/api/sacrament-planner/draft/route.ts
  - lib/auth/permissions.ts
  - lib/access/releasedModules.ts
  - lib/auth/navigation.tsx
  - next.config.ts
related: [release-sacrament-tile-alone, released-modules-per-ward, route-tests-and-realtime, ward-callings-model]
---

## What was done
Slice A of ITER-045. The bishopric's finished Sacrament Planner now runs behind the Sacrament tile,
its own code unchanged except for listed edits, inside a same-origin iframe under the chrome bar. A
TypeScript bridge fills its `window.claude.use("db" | "user" | "sample" | "downloads")` doorway
with `planner_documents` (migration 093, bishopric-only RLS, live through Supabase Realtime), the
login, the app's AI route and a normal file download. The member list and agenda history are
injected per request by an authenticated frame route. The old hub's pages redirect everyone but the
super admin. Slices B (member-list check) and C (import) are not started.

## Key decisions
- **A surrogate `id` key, not the natural key the plan named.** Supabase sends a realtime DELETE to
  every subscriber without RLS, carrying the primary key. The walk's test confirmed ward B receives
  ward A's deletes; with the surrogate key they carry only an opaque uuid. The natural key is a
  unique constraint and the upsert target.
- **Identity from the calling, enforced on every render.** `renderActing()` used to clear any `me`
  not on the bishopric list, and its first render runs before settings load, so the placeholder
  defaults (needed to get real names out of the code) wiped the login. The login now wins outside
  practice. Practice mode got a second switch in the phone's More sheet, because the header copy is
  hidden at phone width.
- **The Planner follows the app's theme** (user, reviewing the walk). Its button is hidden and
  `PlannerFrame` copies the app's `dark` class onto the frame as `data-theme`, on load and on change.
- **`tests/lib/sacramentPlanner/assetEdits.test.ts` pins every edit to the imported HTML**, since no
  component test can render it. It was shown to fail without the identity fix.

## Pitfalls met
- **Placeholders change behaviour.** Replacing real fallback names looked cosmetic and broke
  identity, because the Planner compared against the fallback list before its data arrived.
- **The tile follows the calling, not the super admin flag.** The notes and CLAUDE.md said a super
  admin sees the tile and is refused; a super admin with a ward secretary calling gets no tile and
  cannot open the old hub either. Corrected after the walk.
- **The Planner's history tuple counts `auto` (the matched ward-list name), not `key`.** The seed
  left it blank and everyone read "Talk never".
- **The full suite on this 2-core machine lost 7 files to "spawn UNKNOWN"** with the dev server and a
  build running alongside; rerun alone they passed.

## Known gaps
- "Write it fresh with Claude" was proven by calling the capability, not by pressing the button.
  Call and Text need a real phone.
- `planner.draft_written`'s `outputTokens` is redacted by `writeAuditLog` (ITER-017).
- The outer page scrolls 32px at phone width to show the version footer (accepted by the user).
- Moving the app's theme button onto the top bar is ITER-047.
