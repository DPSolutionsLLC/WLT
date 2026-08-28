# ITER-022: The Follow-Up Form Communicates By Appearance Alone

**Type:** Bug
**Status:** Backlog
**Plan:** _none yet_
**Created:** 2026-08-28
**Found:** walking scenarios 055 and 056 for `youth-d`, 2026-08-28
**Files:** `app/(app)/youth/FollowUpForm.tsx`, and `app/(app)/youth/page.tsx` for the third item.

Three items, all in one file and one sitting.

---

## 1. "Did you go?" conveys its answer by colour alone

**Confirmed from the DOM**, not inferred. "I went" renders
`bg-primary text-primary-foreground`; "I did not go" renders `border border-border bg-surface`.
Neither carries **`aria-pressed`, `aria-checked`, or a role**:

```json
[{"text":"I went","ariaPressed":null,"ariaChecked":null,"role":null},
 {"text":"I did not go","ariaPressed":null,"ariaChecked":null,"role":null}]
```

A screen-reader user hears two identical plain buttons and cannot tell which answer is stored —
including when re-opening a follow-up to change it, where the stored answer is pre-selected.

**This codebase forbids exactly this, in three places.** `components/youth/CoverageBadge.tsx`,
`components/visits/ReportTile.tsx` and `app/(app)/visits/VisitProgressTable.tsx` each state
"colour is never the only signal". And `ReportTile`'s bookmark star already does the right thing
with `aria-pressed` on the same shape of control — a two-state toggle rendered as a button.

**Fix:** `aria-pressed={attended === true}` / `aria-pressed={attended === false}`, or a radio
group, which is arguably the truer semantic — it is one question with two answers and a third
"not said" state. Whichever, the selected answer needs a non-colour signal on screen too.

---

## 2. The two note fields are not distinct enough

The user's verdict on whether they would type the wrong thing into the wrong box:

> i don't think so? but it wouldn't hurt to make it more clear somehow though

The private note already sits in a `border-dashed` block with its own sentence
(*"Yours alone. Not the bishop, not an administrator, not anybody else — ever."*). On screen the
two textareas still read as siblings. **This is the field whose contents nobody else may ever
see**, and CLAUDE.md rule 5 is the most sensitive rule in the codebase — the distinction has to
survive being glanced at on a phone.

Worth noting the emphasis is already correct and should not be undone: `visits-a` deliberately
moved the caution **off** the private field and **onto** the shared one, because a leader
hesitating over the private box has it backwards. The shared field names its audience, and that
sentence changes with the ward's cross-org setting. Keep that; strengthen the visual separation.

---

## 3. "Waiting on your follow-up" sits third on the page

Measured 2026-08-28: the panel renders **below both activity cards, roughly 770px down**
`/youth`. A leader arriving meets "Activities" first. The panel does the right thing internally —
it **names** the waiting event rather than counting it, which is the fix that worked for
`youth-c`'s uncovered banner — but it may be in the wrong place.

`/youth` currently carries four jobs on one screen: activities, the follow-up panel, the schedule,
and the add-event form. **This overlaps ITER-020**, which may move or replace the page entirely —
so do not reposition the panel in isolation. If ITER-020 is worked first, this item may disappear
into it; if ITER-022 is worked first, leave item 3 alone.
