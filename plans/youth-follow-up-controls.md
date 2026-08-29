# Plan: Youth Follow-Up Controls

**Created:** 2026-08-28
**Type:** bugfix
**Scope refs:** ITER-021 ITER-022
**Structure:** Unified

## Overview

Two defects found walking scenarios 055 and 056 for `youth-d`, both in the follow-up controls on
`/youth`, both invisible to a green suite.

**ITER-021 — a control the policy refuses is still a bug.** "Say how it went" is offered on another
organization's event. RLS holds and nothing is written; the leader is simply invited through a
locked door and gets a refusal sentence. This is `visits-d` → `youth-a`-D1 → here: the **third**
sighting of one shape, inside the slice whose own plan quotes the lesson by name.

**ITER-022 — the follow-up form communicates by appearance alone.** "Did you go?" carries no
`aria-pressed`, `aria-checked` or role, so a screen reader hears two identical buttons and cannot
tell which answer is stored. The two note fields also read as siblings, and one of them is the
field CLAUDE.md rule 5 protects absolutely.

### Key requirements

1. A `canWriteFollowUpOn()` in `lib/youth/activityOwnership.ts` mirroring migration 057c's INSERT
   policy, applied at **both** call sites that offer the control.
2. `aria-pressed` on the "Did you go?" buttons, plus a sentence that always states the stored
   answer in words.
3. Structural separation between the shared and private note fields — **no warning colour**.
4. Do **not** narrow the API. The route's 403 is correct and is what keeps the refusal graceful.
   This is the UI agreeing with the boundary, not a second boundary (CLAUDE.md rule 2).

### Success criteria

- As the Young Men president on `/youth` → *Show past events*, the Young Women *Winter concert*
  card carries **no** "Say how it went" button, while the ward-wide activity still does.
- The same is true in "Waiting on your follow-up" for a cross-org event the reader signed up for.
- "Change what you wrote" is still offered on the reader's **own** follow-up whatever organization
  now owns the event — because migration 058's UPDATE policy allows exactly that.
- A screen reader announces which of "I went" / "I did not go" is selected, and the answer is
  readable as text on screen.
- Scenario 056's failing checklist line passes without being reworded.
- `npm run lint`, `npm run typecheck`, `npm run test` and `npm run build` all pass.

### Explicitly NOT in this change

**ITER-022 item 3** — repositioning "Waiting on your follow-up" on `/youth`. The scope file says so
in terms: *"if ITER-022 is worked first, leave item 3 alone"*, because ITER-020 may move or replace
the page entirely. Do not touch the panel's position on the page.

---

## Relevant Files

- `lib/youth/activityOwnership.ts` — modify — add `canWriteFollowUpOn()` beside the two existing
  mirrors, with the header comment explaining why it is org-only while the profile's is not.
- `app/(app)/youth/EventList.tsx` — modify — carry `orgId` on the profile lookup, take the
  reader's `orgId`, and gate the follow-up control on the policy that actually applies.
- `app/(app)/youth/FollowUpPanel.tsx` — modify — the same gate. **The scope file does not name this
  component; it has the bug too** (see Task 3).
- `app/(app)/youth/page.tsx` — modify — pass `currentUserOrgId` to both components, and
  `currentUserRole` to `FollowUpPanel`.
- `app/(app)/youth/FollowUpForm.tsx` — modify — `aria-pressed`, the always-rendered answer
  sentence, and the note-field separation.
- `tests/lib/activityOwnership.test.ts` — modify — cover `canWriteFollowUpOn` and
  `canManageActivityLog` (the latter shipped untested in `youth-d`).
- `tests/components/youth/FollowUpForm.test.tsx` — create — the assistive-technology half.
- `testing/scenarios/youth/scenario-056-a-follow-up-the-ward-council-should-hear-about/scenario.md`
  — modify — clear the *Currently FAILS* marker and record the fix.
- `testing/scenarios/youth/scenario-055-the-game-is-over-and-nobody-has-said-how-it-went/scenario.md`
  — modify — add the two checklist lines this change makes assertable.

## Dependencies

None. No new libraries, no migration, no schema change, no type regeneration. Every policy this
change mirrors is already applied (migrations 057 and 058).

---

## Known Pitfalls (from retro context)

- **`visits-d` / `youth-a`-D1 — "a locked door somebody was invited through."** Recorded twice
  before this. The reason it recurred is that each fix was applied to *the control that was found*
  rather than to every control on the screen. **Task 3 exists because of this.** Before finishing,
  grep for every place the follow-up control is offered and confirm each one is gated.
- **`lib/visits/visitOwnership.ts` — the `null === null` trap.** JavaScript's `null === null` is
  `true`; SQL's `null = null` is `NULL`. `ward_council_member` is the widest role in the app and the
  one most likely to have no organization at all. **This function inverts the usual guard** — see
  Task 1, where a null profile `org_id` means *ward-wide and writable by everybody*, which is the
  opposite of what `canManageActivityProfile` does with a null. Getting this backwards silently
  removes every ward-wide activity from the follow-up flow, and no test in the repo today would
  fail.
- **`youth-a`-D2 — a Server Component prop never refetches.** `FollowUpPanel` currently takes
  `profiles` as a plain prop. Task 3 moves it onto the shared query key that `EventList` already
  seeds, so the two components cannot disagree about which organization owns a profile.
- **`youth-c` — the mirror mistake.** Hiding a control the API *would* allow is the same class of
  defect, and the one nobody notices. This is why the gate is not simply
  `canWriteFollowUpOn` everywhere: on an existing follow-up the applicable policy is migration
  058's UPDATE, which is `logged_by = auth.uid()` with no organization arm at all. See Task 2.
- **`visits-a` — the caution belongs on the SHARED field.** A leader hesitating over the private
  box has it backwards. `VisitLogForm` records that highlighting the private field "read as an
  error state". Task 6 strengthens *separation*, never *emphasis*, and uses no warning colour.
- **`youth-b` / `youth-c` — copy defects survive a green suite.** Between them those two slices
  shipped seven. The sentence added in Task 5 must be read on the real screen in all three states,
  not just asserted.

---

## Tasks

### ITER-021 Tasks

#### Task 1: Add `canWriteFollowUpOn()`

**File:** `lib/youth/activityOwnership.ts` (modify)

**Action:** Add a third exported mirror, after `canManageActivityLog` and before the
`THERE IS DELIBERATELY NO canManageActivityEvent()` block.

**Details:**

Mirror migration 057c's INSERT policy:

```sql
with check (
  ward_id = current_ward_id()
  and logged_by = auth.uid()
  and (is_bishopric() or activity_event_is_in_caller_org(event_id))
)
```

`activity_event_is_in_caller_org` resolves through the event's profile with a LEFT JOIN:

```sql
left join youth_activity_profiles profile
  on profile.id = event.profile_id
 and profile.ward_id = event.ward_id
where event.id = target_event_id
  and event.ward_id = current_ward_id()
  and (profile.org_id is null or profile.org_id = current_org_id())
```

Signature — takes the resolved profile, or `null`:

```ts
export function canWriteFollowUpOn(
  user: Pick<SessionUser, "role" | "orgId">,
  profile: { orgId: string | null } | null,
): boolean {
  if (isBishopricRole(user.role)) return true;

  // A LEFT JOIN that matched nothing yields a null org_id, and `profile.org_id is null` is the
  // policy's own first arm — so an event with no profile, or one whose profile is not in the
  // reader's list, is ward-wide and writable. Absent means ward-wide, module-wide.
  if (profile === null) return true;
  if (profile.orgId === null) return true;

  // Only NOW does the null-equals-null trap apply: a reader with no organization cannot match
  // an owned profile, and SQL's `null = current_org_id()` is NULL rather than true.
  if (user.orgId === null) return false;

  return user.orgId === profile.orgId;
}
```

**Write a header comment covering three things, in the style the two functions above it use:**

1. **The `logged_by = auth.uid()` clause is not represented here and must not be.** The caller is
   always writing their own follow-up — `loggedBy` is never in a request body — so that clause is
   satisfied by construction. Restating it would invite somebody to pass another user's id.
2. **This function's null handling is the INVERSE of `canManageActivityProfile`'s**, and that is
   the single most important line in the file. There, a null `org_id` means *nobody but the author
   or the bishopric*; here it means *everybody*. The policies genuinely differ:
   `youth_activity_profiles_update` compares `org_id = current_org_id()` directly, while
   `activity_event_is_in_caller_org` carries an explicit `profile.org_id is null` arm. Two mirrors
   of two different policies are allowed to disagree; a reader assuming they agree is the hazard.
3. **There is no `enteredBy` arm.** The profile's UPDATE policy has one; the log's INSERT policy
   does not. Filing a follow-up is about the organization that owns the event, not about who typed
   the activity in.

Keep the module PURE and client-importable — no Supabase, no `next/headers`, no clock.

#### Task 2: Gate the control in `EventList`

**File:** `app/(app)/youth/EventList.tsx` (modify)

**Action:** Resolve the event's owning organization and gate the follow-up control on the policy
that actually applies to the action being offered.

**Details:**

1. Add to `EventListProps`, beside `currentUserRole`, documented the same way:

```ts
// For canWriteFollowUpOn(), which mirrors migration 057c's INSERT policy. Resolved once on the
// server; a client component never re-derives a session value.
currentUserOrgId: string | null;
```

2. `profileLabels` currently stores `{ activityName, memberName }`. Add `orgId`:

```ts
const profileLabels = new Map(
  (profilesQuery.data ?? []).map((profile) => [
    profile.id,
    { activityName: profile.activityName, memberName: profile.memberName, orgId: profile.orgId },
  ]),
);
```

`ActivityProfile` already carries `orgId: string | null` — no query or type change is needed.

3. Inside the row loop, after `const canWriteFollowUp = isFollowUpWritable(...)`, add the ownership
   half. **The two policies are different and the distinction is the whole point of this task:**

```ts
// WHICH POLICY APPLIES DEPENDS ON WHICH ACTION IS OFFERED.
//
// Creating a follow-up is an INSERT (057c): the bishopric, or the organization that owns the
// event through its profile. Changing one is an UPDATE (058): the author, or the bishopric —
// with NO organization arm at all.
//
// Collapsing these into one check would break in both directions. Using the INSERT rule on an
// existing log would hide "Change what you wrote" from a leader who has since moved
// organizations but may still edit what they wrote — the mirror mistake, hiding what the API
// allows. Using the UPDATE rule on a new one would offer the create button on every
// organization's events, which is the bug this task exists to close.
const canWriteFollowUpHere =
  ownLog === null
    ? canWriteFollowUpOn({ role: currentUserRole, orgId: currentUserOrgId }, profile ?? null)
    : canManageActivityLog(
        { id: currentUserId, role: currentUserRole },
        { loggedBy: ownLog.loggedBy },
      );
```

`profile` is the existing `const profile = event.profileId === null ? undefined : profileLabels.get(event.profileId)`. Pass `profile ?? null` — `undefined` covers both "the event has no profile" and "the profile is not in the reader's list", and both resolve to ward-wide, which is what the LEFT JOIN does.

4. Change the gate from `{canLog && canWriteFollowUp ? (` to:

```tsx
{canLog && canWriteFollowUp && canWriteFollowUpHere ? (
```

5. Import `canWriteFollowUpOn` alongside the existing `canManageActivityLog` import.

6. **Extend the existing comment block above the control.** It currently explains the
   `isFollowUpWritable` vs `followUp !== "not_due"` distinction at length. Add a paragraph saying
   that `canLog` is the permission and says nothing about WHICH events, that
   `canWriteFollowUpOn` is the organization half, and that this is `youth-a`-D1 / `visits-d` a
   third time — found walking scenario 056. Cite ITER-021.

#### Task 3: Gate the control in `FollowUpPanel`

**File:** `app/(app)/youth/FollowUpPanel.tsx` (modify)

**Action:** The same gate. **This component is not named in ITER-021's scope file and has the same
defect.**

**Details:**

*Why it is in scope:* the panel lists events in the `awaiting` state — past, not cancelled, the
reader has an attendee row, no log. `activity_attendees` writes are `is_bishopric() or user_id =
auth.uid()`, so **any leader can add themselves to any organization's event**. A Young Men
president who signs up for a Young Women game therefore gets that game in "Waiting on your
follow-up" with a "Say how it went" button the API refuses. Fixing `EventList` alone would ship the
same defect a fourth time, in the change that exists to close it.

1. Add to `FollowUpPanelProps`, beside `currentUserId`:

```ts
currentUserRole: SessionUser["role"];
currentUserOrgId: string | null;
```

Import `type SessionUser` from `@/types/domain`.

2. **Read the profiles from the shared query rather than the prop.** Keep the `profiles` prop as
   the seed — this is `youth-a`-D2's rule, and it also means this panel and `EventList` cannot
   disagree about which organization owns a profile:

```ts
const profilesQuery = useQuery({
  queryKey: [YOUTH_PROFILES_QUERY_KEY],
  queryFn: fetchProfiles,
  initialData: profiles,
});
```

Import `YOUTH_PROFILES_QUERY_KEY` and `fetchProfiles` from `@/app/(app)/youth/youthQueries` —
`EventList` already seeds this exact key on the same page, so this costs no extra fetch.

Build the lookup from `profilesQuery.data ?? []`, and change its value from a formatted string to
an object so it can carry `orgId` as well as the label:

```ts
const profilesById = new Map(
  (profilesQuery.data ?? []).map((profile) => [
    profile.id,
    { label: `${profile.memberName} · ${profile.activityName}`, orgId: profile.orgId },
  ]),
);
```

Update the existing label render (`profileLabels.get(event.profileId) ?? "An activity that is no
longer listed"`) to read `.label` off the entry. **Keep the existing null/missing fallback text
exactly as it is** — it is `youth-a`-D2's wording and is asserted in scenario 055.

3. Carry the resolved profile through the `judged` map so the row has it without a second lookup,
   or look it up at render — either is fine, but resolve it **once** per row.

4. Gate the button. The panel only ever creates (`awaiting` means `hasLog === false`), so only the
   INSERT rule applies here — no `canManageActivityLog` branch:

```tsx
{canLog && canWriteFollowUpOn(
  { role: currentUserRole, orgId: currentUserOrgId },
  profile ?? null,
) ? (
  <Button onClick={() => setOpenEventId(event.id)}>Say how it went</Button>
) : (
  <p className="text-sm text-muted">…</p>
)}
```

5. **The existing `else` sentence is now wrong for one of the two reasons it can be reached.** It
   reads *"Recording what happened is done by an organization presidency, the bishopric, or a ward
   council member."* — true when the reader lacks `youth_activities.log`, false and confusing when
   the reader holds it but the event belongs to another organization. Split it:

```tsx
{!canLog ? (
  <p className="text-sm text-muted">
    Recording what happened is done by an organization presidency, the bishopric, or a ward
    council member.
  </p>
) : (
  <p className="text-sm text-muted">
    This activity belongs to another organization. They record what happened; you can still see
    that it was played.
  </p>
)}
```

The second sentence must say **whose** it is and what the reader can still do — the route's own
403 names the alternative, and this is the same message arriving before the attempt rather than
after it. Do not reuse the route's constant: that string is written for somebody who has already
pressed Save.

#### Task 4: Pass the new props

**File:** `app/(app)/youth/page.tsx` (modify)

**Action:** Thread the reader's organization to both components.

**Details:**

- On `<FollowUpPanel …>` add `currentUserRole={user.role}` and `currentUserOrgId={user.orgId}`.
- On `<EventList …>` add `currentUserOrgId={user.orgId}` beside the existing `currentUserRole`.

Both are already-resolved session values; no new query. Do not pass the whole `user` object to
either — both components take scalars deliberately, and `EventList`'s prop comment says why.

---

### ITER-022 Tasks

#### Task 5: Give "Did you go?" a non-visual answer

**File:** `app/(app)/youth/FollowUpForm.tsx` (modify)

**Action:** Add `aria-pressed` to both buttons and make the helper sentence always state the
stored answer.

**Details:**

1. `aria-pressed` on each button, exactly the pattern `app/(app)/visits/VisitLogForm.tsx` uses for
   the identical question (`draft.outcome === outcome`), and that `MemberPicker`,
   `RosterViewToggle`, `CrossOrgVisibilityToggle` and `ReportTile` all use:

```tsx
<Button
  variant={attended === true ? "primary" : "secondary"}
  aria-pressed={attended === true}
  disabled={isBusy}
  onClick={() => setAttended(true)}
>
  I went
</Button>
```

and the mirror for `attended === false`. **Both buttons carry the attribute in every state** — an
`aria-pressed` present on one and absent on the other is worse than neither, because the reader is
told about one answer and left to infer the other.

2. Replace the conditional helper paragraph with one that always renders and names the stored
   answer in words:

```tsx
<p className="text-xs text-muted">
  {attended === null
    ? "You have not said either way. Leaving it is fine — the follow-up saves without it."
    : attended
      ? "Recorded: you went."
      : "Recorded: you did not go."}
</p>
```

Write a short comment saying why it always renders: the fill-versus-outline difference between the
two button variants is the only other signal that an answer is stored, and `CoverageBadge`,
`ReportTile` and `VisitProgressTable` each state in this codebase that colour is never the only
signal. `youth-c` found that a badge is a weaker pointer than a sentence; this is the sentence.

**Do not add a tick glyph or any other marker.** `youth-c` defect 1 is the precedent — a marker
carried less than naming the thing did.

#### Task 6: Separate the two note fields structurally

**File:** `app/(app)/youth/FollowUpForm.tsx` (modify)

**Action:** Make the private block harder to mistake for the shared one, using structure and
spacing only.

**Details:**

**The constraint that decides this task:** `visits-a` deliberately moved the caution **off** the
private field and **onto** the shared one, and `VisitLogForm` records that highlighting the private
box "read as an error state". So:

- **No `warning` or `danger` token anywhere in this block.** Not on the border, not on the
  background, not on the text.
- **Do not touch the shared field's audience sentence.** `YOUTH_SHARED_NOTE_AUDIENCE` is correct,
  changes with the ward's cross-org setting, and scenario 055 asserts it.

What to change:

1. Give the private block a **visible heading** rather than only a field label — a `<h4>` styled
   like the form's existing `text-sm font-semibold text-foreground` heading, reading
   `Private note`, with the existing `<label>` beneath it becoming the field's own label. This is
   what makes it read as a *section* rather than a third field in a stack.
2. Keep the `border-dashed border-border` block. Change its fill so the textarea inside is
   distinguishable from its container: the block is `bg-surface` and the textareas are
   `bg-surface-raised`, so the private textarea currently sits on a near-identical fill. Give the
   private textarea `bg-surface` (overriding `TEXTAREA_CLASSES`' fill via a trailing class) so the
   two boxes on the form differ in fill as well as in position.
3. Increase the gap above the block — the form's container is `gap-4`; give the private block a
   `mt-2` so the shared field and the private field are not evenly spaced siblings.
4. Keep the sentence *"Yours alone. Not the bishop, not an administrator, not anybody else —
   ever. Saved separately from what you wrote above."* verbatim. It is the strongest thing on the
   screen and scenario 055 asserts the block is visually distinct.

Add a comment recording that the emphasis stays on the shared field by `visits-a`'s finding, and
that this task changed separation rather than emphasis, per ITER-022 item 2.

**This is the one item on the plan a test cannot settle.** It must be looked at on a real screen at
375px in both themes during the walk.

---

### Test Tasks

#### Task 7: Cover both ownership mirrors

**File:** `tests/lib/activityOwnership.test.ts` (modify)

**Action:** Add two `describe` blocks. Follow the file's existing style — table-driven, named
constants, a comment saying what the suite is for.

**Details:**

Reuse the existing actors (`bishop`, `counselor`, `eqPresident`, `councilMember`) and org
constants. `canWriteFollowUpOn` takes `Pick<SessionUser, "role" | "orgId">`, so the existing
`Actor` type satisfies it.

`describe("canManageActivityLog")` — **shipped untested in `youth-d`**, mirroring migration 058's
UPDATE policy (`is_bishopric() or logged_by = auth.uid()`):

- the bishopric may manage a follow-up somebody else wrote (both `bishop` and `counselor`)
- an author may manage their own
- an org leader may **not** manage a colleague's
- the organization is **not** an arm: an org leader is refused a follow-up written by somebody
  else on their **own** organization's event. This is the assertion that stops somebody
  "improving" the function by adding an org branch.

`describe("canWriteFollowUpOn")` — mirroring migration 057c's INSERT policy:

- the bishopric may write on any organization's event
- an org leader may write on their own organization's event
- an org leader may **not** write on another organization's event *(the scenario 056 defect,
  asserted directly)*
- an org leader **may** write on a ward-wide event (`orgId: null`) — the arm the walk verified
  working and which must not regress
- a `ward_council_member` with **no organization** may write on a ward-wide event
- a `ward_council_member` with no organization may **not** write on an owned event
- a `null` profile (an event with no profile at all) is writable — the LEFT JOIN arm
- **an inversion assertion, written as one:** the same `{ orgId: null }` profile that
  `canManageActivityProfile` refuses for a non-author is *admitted* here. Assert both functions in
  one test with a comment naming the two policies, so a future reader who "unifies" them gets a
  red test with the reason attached.

Close with the scenario 056 table, in the style of the existing
`"matches the shape of scenario 049 for a Young Men president"` test: the Young Men president
against *Varsity basketball* (own org, writable), *Winter concert* (Young Women, refused) and the
ward-wide activity (writable).

#### Task 8: Cover the form's assistive-technology half

**File:** `tests/components/youth/FollowUpForm.test.tsx` (create)

**Action:** A jsdom component test for what Task 5 added.

**Details:**

Follow `tests/components/youth/CoverageBadge.test.tsx`: `// @vitest-environment jsdom` on line 1,
`render`/`screen` from `@testing-library/react`, a header comment saying why the suite exists.

`FollowUpForm` uses TanStack Query (`useMutation`, `useQueryClient`), so wrap the render in a
`QueryClientProvider` with a fresh `QueryClient` per test — check
`tests/components/program/ProgramBuilder.test.tsx` for the existing helper before writing a new
one. The `useEffect` that fetches a private note only runs when `existingLog !== null`; pass
`existingLog={null}` in these tests and no fetch is needed.

Cases:

- with `isAttendee` and `confirmedAttendance={null}`: both buttons render with
  `aria-pressed="false"`, and the copy reads *"You have not said either way"*
- with `confirmedAttendance={true}`: "I went" is `aria-pressed="true"` and "I did not go" is
  `"false"`; the text *"Recorded: you went."* is present
- with `confirmedAttendance={false}`: the mirror, and *"Recorded: you did not go."*
- **both directions pinned**, which is `CoverageBadge`'s own stated lesson: assert the unselected
  button is `aria-pressed="false"` rather than only that the selected one is `"true"`. Removing
  the attribute from one button must fail.
- with `isAttendee={false}`: the question does not render at all — the existing rule that no
  attendee row means no question, which must survive this change.

**Do not** add RLS or route tests. `tests/rls/activity-logs.test.ts` already proves the database
refuses a cross-org follow-up (`"refuses one against another organization's event"`) and
`tests/routes/youthLogs.test.ts` already proves the route answers 403 with a sentence
(`"answers 403 with a sentence for another organization's event"`). The boundary is proven at both
layers; the gap this change closes is the screen agreeing with it, and that is a pure-function
test.

#### Task 9: Update the harness scenarios

**Files:**
- `testing/scenarios/youth/scenario-056-a-follow-up-the-ward-council-should-hear-about/scenario.md` (modify)
- `testing/scenarios/youth/scenario-055-the-game-is-over-and-nobody-has-said-how-it-went/scenario.md` (modify)

**Action:** Clear the known-failing marker and add the lines this change makes assertable.

**Details:**

In **scenario 056**:

- The checklist line at ~106 currently reads *"**"Say how it went" is absent on another
  organization's event.** *Currently FAILS — see the walkthrough record.*"*. Remove the *Currently
  FAILS* sentence and the explanation of the failure; leave the assertion itself **unchanged in
  wording** so the line that failed is the line that now passes.
- In the *"Two defects found, not fixed"* section, mark defect 1 fixed with the date and
  `ITER-021`. Follow how the notification-trigger defect beside it was annotated. Do not delete
  the record.

In **scenario 055**, add checklist lines under the follow-up form section:

- [ ] *"Did you go?"* announces which answer is stored — inspect both buttons and confirm
  `aria-pressed` is `true` on the selected one and `false` on the other, and that the line beneath
  reads **Recorded: you went** / **Recorded: you did not go**.
- [ ] A leader who signed themselves up for **another organization's** past event sees it in
  *Waiting on your follow-up* with **no** "Say how it went" button, and a sentence saying the
  activity belongs to another organization.

The second line needs the seed to place the president as an attendee on a Young Women past event.
**Check `seed.ts` before writing the line** — if the fixture does not already do that, either
extend the seed or write the step as a manual "add yourself to *Winter concert*, then reload"
action. Prefer the manual step: it is one tap in the UI, and it keeps the seed matching what
scenario 056 expects.

---

## Testing Strategy

| Layer | File | What it proves |
|---|---|---|
| Pure function | `tests/lib/activityOwnership.test.ts` (modify) | The screen's rule says what migrations 057c and 058 say, including where the two disagree |
| Component | `tests/components/youth/FollowUpForm.test.tsx` (create) | The stored answer is announced and readable as text |
| RLS | `tests/rls/activity-logs.test.ts` (**no change**) | Already proves the database refuses |
| Route | `tests/routes/youthLogs.test.ts` (**no change**) | Already proves the 403 and its sentence |
| Human | scenarios 055, 056 | The note fields are distinguishable at 375px; the copy reads correctly |

**Prove the new tests can fail before believing them.** ITER-023's retro records a both-directions
assertion that passed on two empty arrays. For Task 7, temporarily invert the `profile.orgId ===
null` arm and confirm the ward-wide tests go red. For Task 8, remove one `aria-pressed` and confirm
the suite goes red.

## Test Scenarios (Harness)

**No new scenario.** Scenarios 055 and 056 already cover this ground — 056 carries the failing
checklist line that this change makes pass, and 055 covers the follow-up form field by field. A
third scenario over the same screen would duplicate their seeds and give a future walker two
places to look. Task 9 extends both in place, which is what `08-youth-activities.md` §Pitfalls asks
for.

## Validation Commands

```bash
# Linting
npm run lint

# Type checking
npm run typecheck

# Tests — the RLS suites run over the network against the hosted project, so this is slow
npm run test

# Production build — REQUIRED, not optional
npm run build
```

**Do not skip the build.** `youth-c` had lint, typecheck and 2982 tests pass while `npm run build`
failed, because a constant in a server-only module pulled `next/headers` into the browser bundle.
This change imports `lib/youth/activityOwnership.ts` into a second client component; that module is
already client-imported by `EventList` and is pure by design, but the build is the only thing that
proves it stayed that way.

To run just the fast suites while iterating:

```bash
npx vitest run tests/lib/activityOwnership.test.ts tests/components/youth/FollowUpForm.test.tsx
```

## Integration Notes

- **No migration, no schema change, no type regeneration.** Every policy mirrored here is already
  applied. `ActivityProfile.orgId` already exists on the read shape.
- **No API change.** The route's 403 and its sentence stay exactly as they are. If the UI gate and
  the policy ever disagree, the policy still wins and the symptom is this cosmetic bug again
  rather than a leak — which is the property CLAUDE.md rule 2 is protecting.
- **`app/(app)/youth/calendar` is unaffected.** It offers no follow-up control; verified by
  grepping `canLog` and `FollowUpForm`, which appear only in `EventList`, `FollowUpPanel` and
  `page.tsx`. `/youth/feed` is read-only. If a future screen adds a third place the control is
  offered, `canWriteFollowUpOn` is what it must call.
- **`FollowUpPanel` gains a query subscription** it did not have. It renders on the same page as
  `EventList`, which already seeds `YOUTH_PROFILES_QUERY_KEY`, so this is one cache entry with two
  readers rather than a second fetch.
- **Documentation:** add ITER-021 and ITER-022 to the `youth-d` retro when it is written. Note
  that `plans/retros/youth-d-followup-and-report-feed.md` **does not exist yet** — `youth-d`
  shipped (99af99f) without its retro entry, unlike slices A, B and C. That is outside this
  change, but it is where this fix belongs on the record, and `plans/retros/INDEX.md` has no
  `youth-d` line either.
- **ITER-022 item 3 stays open.** After this change, that scope file should be reduced to item 3
  alone, still pointing at ITER-020.
