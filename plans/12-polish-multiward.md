# Phase 12 — Polish, Accessibility & Multi-Ward Scaffolding

The last phase before a second ward could realistically be onboarded. Nothing new is
built; everything already built is verified, tightened, and made safe to duplicate.

**Depends on:** all prior phases. **Unlocks:** Milestone M8 — shippable.
**Reference:** [FEATURES.md](../FEATURES.md) §Application Name & Branding; [SPEC.md](../SPEC.md) §Multi-Ward Architecture.

---

## Step 1 — Theme

Light and dark mode, user-configurable, persisted in `users.theme_preference`
(`light` / `dark` / `system`).

- `system` reads `prefers-color-scheme` and follows it live, not just on load
- Set the theme class on `<html>` **before first paint** via an inline script in the root
  layout, or every page flashes the wrong theme on load
- Store the preference server-side so it follows the user across devices; mirror it to
  `localStorage` so the pre-paint script has it without a round trip

Audit every screen in both modes. The usual failures:

- Colour-coded pipeline stages illegible on dark backgrounds
- Status badges with hardcoded light-mode colours
- Charts, maps, and PDFs preview panels that assume white
- Focus rings invisible against a dark surface
- Text over the program cover image

Define the full palette as CSS custom properties in `tailwind.config.ts` so no component
hardcodes a hex value.

**Public pages are the exception.** `/public/[slug]` is printed on paper via QR and viewed
by visitors with unknown preferences. Pick one clean look — probably light — and commit to
it rather than following system preference.

---

## Step 2 — Accessibility

Not optional. Ward leadership spans a wide age range and this app carries real
responsibility.

| Area | Requirement |
|---|---|
| Contrast | WCAG AA — 4.5:1 body text, 3:1 large text and UI components, **in both themes** |
| Keyboard | Every interactive element reachable and operable; visible focus indicator; logical tab order |
| Modals | Focus trapped, `Esc` closes, focus returns to the trigger on close |
| Forms | Every input has a `<label>`; errors associated via `aria-describedby`; errors announced |
| Screen readers | Landmark regions, meaningful headings, `aria-live` for notification arrival and save confirmation |
| Icons | Icon-only buttons have `aria-label`. The report-feed flag icon and notification bell are the common misses |
| Colour | Never the sole carrier of meaning — pipeline stage, visit status, and coverage state all need a text or shape cue alongside the colour |
| Touch targets | 44×44px minimum. Check the tithing keypad, the PIN pad, and the sacrament grid |
| Motion | Respect `prefers-reduced-motion` |

Run axe or Lighthouse on every route as a baseline, then hand-test keyboard navigation
through the three heaviest flows: the talk pipeline, the tithing entry form, and the
sacrament manager view.

---

## Step 3 — Mobile Verification

Mobile-first was the rule from Phase 0; this is the check that it held.

Test at 375px on every route. The known-hard screens:

| Screen | Concern |
|---|---|
| Calendar month grid | Must become a card list below `md:` |
| Sacrament assignment grid | Four columns do not fit — stack per Sunday |
| Tithing entry form | Long form, numeric keyboards, sticky running total |
| Roster household list | Long list; virtualize and keep search reachable |
| Program preview | Wide document on a narrow screen; offer zoom or a download |
| Report feed | Tile density and one-handed next-unread reach |
| Admin tables | Wide tables need horizontal scroll or a card layout |

Also verify: numeric inputs bring up the numeric keyboard, `sms:` links behave on real iOS
and Android devices, and the app is usable one-handed where it matters — the tithing form
and the sacrament manager view especially.

---

## Step 4 — Performance

- **N+1 queries.** The roster, report feed, and dashboards are the likely offenders.
  Check the Supabase query log under realistic data volume
- **Indexes.** Verify every index from Phase 0 exists and is being used. `EXPLAIN ANALYZE`
  the roster list, the visit progress query, the audit log page, and the vector search
- **Virtualize** lists over ~200 rows: roster, audit log, report feed
- **Bundle size.** `@react-pdf/renderer` is large — keep it server-side only and confirm
  it is not in the client bundle. Same for the Anthropic and OpenAI SDKs
- **Realistic seed data.** Test with ~500 members, ~150 households, two years of
  assignments and visits, and ~50k audit rows. Bugs that only appear at volume are the
  ones that reach production

---

## Step 5 — Multi-Ward Scaffolding

The data model has supported multi-ward since Phase 0. This step **verifies** that and
adds the minimum scaffolding — it does not build a multi-ward UI, which is out of scope
for v1.

**Verification — the important part:**

1. Create a second ward with its own users, roster, and data
2. Run the full Phase 0 ward-isolation suite against both
3. **Manually attempt to cross the boundary** from a signed-in session in ward A:
   direct API calls with ward B IDs, URL manipulation with ward B record IDs, a public
   page slug from ward B. Every attempt must fail
4. Verify every cron job is ward-aware — tithing auto-clear, overdue visits, the Monday
   digest, the sacrament deadline, and the agenda email must each iterate wards rather
   than assuming one

Item 4 is the most likely place a single-ward assumption survives. Grep every Edge Function
for a hardcoded ward or a missing `ward_id` filter.

**Scaffolding to add:**

- A `ward_id` resolution point that a future ward switcher can plug into, rather than
  reading the session's ward directly in dozens of places
- Ward slug in public page URLs so two wards' public pages cannot collide
- A seed/provisioning script that creates a new ward with organizations, notification
  triggers, base topics, and a first bishop account — onboarding ward two should be a
  script, not a manual afternoon

**Explicitly not building:** a ward switcher UI, cross-ward reporting, or a stake-level
view. Data model only.

---

## Step 6 — Final Sweep

- [ ] `.env.local.example` matches what the app actually reads
- [ ] No `console.log` of tokens, PINs, keys, or note content anywhere
- [ ] Every route handler has error handling; no unhandled promise rejections
- [ ] Loading and empty states on every list and dashboard widget — an empty roster
      should say "No members yet — import from LCR", not render a blank box
- [ ] Error boundaries around each dashboard widget so one failure does not blank the page
- [ ] 404 and 500 pages that match the app's design
- [ ] Every destructive action has a confirmation
- [ ] `README.md` covering local setup, migrations, seeding, and env vars
- [ ] Lint and typecheck clean; no `@ts-expect-error` without a comment
- [ ] Every `any` in the codebase either removed or annotated with why

---

## Tests

| Test | Asserts |
|---|---|
| `two-ward-isolation.test.ts` | With two fully populated wards, no query, route, or public page crosses the boundary. **Highest priority in this phase** |
| `cron-ward-awareness.test.ts` | Every scheduled function processes both wards correctly |
| `public-slug-collision.test.ts` | Two wards' public pages have distinct, non-guessable slugs |
| `theme-contrast.test.ts` | Automated contrast check across key components in both themes |
| `a11y-routes.test.ts` | axe passes with no serious or critical violations on every route |
| `keyboard-flows.test.ts` | Talk pipeline, tithing entry, and sacrament manager are fully keyboard-operable |

---

## Definition of Done

- [ ] Light and dark mode correct on every screen, with no flash on load
- [ ] WCAG AA contrast in both themes; axe clean on every route
- [ ] Full keyboard operability on the three heaviest flows
- [ ] Every route verified at 375px; `sms:` tested on real iOS and Android
- [ ] No N+1 queries under realistic data volume; indexes verified with `EXPLAIN`
- [ ] Server-only libraries confirmed absent from the client bundle
- [ ] Two-ward isolation verified, including manual boundary-crossing attempts
- [ ] Every cron job is ward-aware
- [ ] New-ward provisioning script works end to end
- [ ] Loading, empty, and error states everywhere
- [ ] README complete; lint and typecheck clean
- [ ] All six tests pass

---

## Pitfalls

- **Theme flash on load.** Set the class before first paint with an inline script.
  Reading the preference in a `useEffect` guarantees a flash.
- **Colour as the only signal.** Pipeline stage and visit status both rely on colour by
  default. Add text or shape.
- **Single-ward assumptions in cron.** The most likely surviving multi-ward bug, because
  cron paths are the least exercised in development.
- **Testing on an empty database.** N+1 queries and missing indexes are invisible with
  ten rows. Seed realistically.
- **Public page slug guessing.** Sequential or predictable slugs let anyone enumerate
  wards. Use a random component.
- **Shipping the ward switcher.** Out of scope. Verify the data model, add the resolution
  point, stop there.
- **Treating accessibility as a checklist.** Run axe, then actually navigate the tithing
  form with a keyboard. The automated pass and the real experience are different things.
