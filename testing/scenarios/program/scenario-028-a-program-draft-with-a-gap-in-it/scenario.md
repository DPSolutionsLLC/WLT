---
name: A program draft with a gap in it
scope: program-a-draft-and-approval
part: 1
tags: [program, smoke, iter-004]
prerequisites: program-b-builder-screen must ship first — see Blocked below
---

> ## ⛔ NOT WALKABLE YET — the builder screen does not exist
>
> `program-a` is the **server half** of the program builder: the draft shape, the assembler, the
> diff and four routes. It ships no page, no form and no button. `program-b` builds the screen.
>
> The seed below is the deliverable that matters today — the Thursday state is expensive to build
> by hand and `program-b` needs it on day one. The checklist is written against the screen
> `program-b` will build, so its items are **predictions, not observations**, and none of them has
> been seen in a browser.
>
> Leave the Walkthrough record reading "Not yet walked" until `program-b` has merged. Ticking a
> line here before then records a check nobody made — which is exactly what
> `plans/retros/ai-c-feature-routes.md` found and had to undo.
>
> **What IS verified today**, without a browser, by suites that run against the hosted project:
>
> | Claim | Proven by |
> |---|---|
> | The draft builds with a member, an external and an empty slot | `tests/lib/programDraftAssembly.test.ts` |
> | An external speaker keeps their typed title (ITER-004) | `tests/lib/programDraftAssembly.test.ts` |
> | Nothing anywhere reads "TBD" or "Not yet assigned" | `tests/lib/programDraftAssembly.test.ts` |
> | A ward secretary can build, refresh and view but not approve | `tests/routes/program-approval.test.ts` |
> | The snapshot does not follow its sources | `tests/db/program-snapshot.test.ts` |
> | Only bishop/counselor/secretary may write a program | `tests/rls/program-access.test.ts` |

## Purpose

The Thursday case — the state the builder is actually used in, and the one that decides whether it
is usable at all.

A program is almost never complete when somebody sits down to build it. A speaker has not replied,
the music coordinator has not chosen the sacrament hymn, and nobody has written the announcements
yet. **That is the normal case, not the error case**, and the single judgement no test can make is
whether the screen reads as *work remaining* or as *something went wrong*.

The second judgement is ITER-004's. A visiting stake president and a ward member sit in adjacent
slots, and they are named by different rules on purpose — full for the visitor, first-name-plus-
initial for the member once the public page exists. Whether that looks deliberate rather than
inconsistent is something only a person can answer.

## Seed Data

| Entity | Detail |
|---|---|
| Ward | Harness Test Ward, `leadership_contacts` populated with three names **and phone numbers**, `missionaries` empty |
| Users | `bishop@…` (bishop, Mark Andersen), `counselor@…` (counselor, Peter Lindqvist), `secretary@…` (ward_secretary, Ruth Delgado) |
| Sunday | **2026-09-20**, `standard`, 3 speaking slots, conducted by Mark Andersen |
| Slot 1 | Sarah Whitfield, ward member, stage `notify`, topic "Charity Never Faileth" |
| Slot 2 | **President Mark Andersen**, external speaker, stage `notify`, contact waiver set (ITER-004) |
| Slot 3 | **No assignment row at all** — not a row at `plan`, no row |
| Prayers | Invocation — David Brooks, stage `done`. **Benediction absent** |
| Hymns | Opening 19, Closing 152. **Sacrament hymn absent** |
| Absent by design | Sacrament hymn, benediction, announcements, organist, chorister — five gaps |

**Sign in with:** `secretary@harness.wardleadershiptools.test`
**Password:** the value of `HARNESS_TEST_PASSWORD` in your env file.

## Steps

1. `npm run seed -- program/scenario-028-a-program-draft-with-a-gap-in-it`
2. `npm run dev`, then open http://localhost:3000
3. Sign in as the ward secretary.
4. Open the calendar and go to **20 September 2026**.
5. Build the program for that Sunday.
6. Read what the app says is still needed.

## Verification Checklist

### Machine-checkable

- [ ] The draft builds — no error, no refusal, no empty screen
- [ ] Slot 1 reads **"Sarah Whitfield"** with the topic "Charity Never Faileth"
- [ ] Slot 2 reads **"President Mark Andersen"** — the title is intact and the name is in full (ITER-004)
- [ ] Slot 3 reads as an open slot, not as a blank line and not as a speaker with no name
- [ ] The sacrament hymn, the benediction and the announcements are **each** named as missing
- [ ] The organist and the chorister are also named as missing
- [ ] Nothing anywhere on the screen reads "TBD" or "Not yet assigned"
- [ ] No raw uuid appears anywhere on the screen
- [ ] Opening hymn reads "19 — We Thank Thee, O God, for a Prophet", closing "152 — God Be with You Till We Meet Again"
- [ ] Presiding reads **Mark Andersen** (the bishop, because no override was typed)
- [ ] There is no horizontal overflow at 375px, and tap targets are at least 44×44

### Needs a human eye

- [ ] Does the missing list read as **work still to do**, or as a list of errors? It should feel like a checklist, not a validation summary.
- [ ] Slot 3 sits between two named speakers. Does it read as *nobody has been asked yet*, or as *something failed to load*?
- [ ] Slots 1 and 2 are named by different rules. Side by side, does that look deliberate or does it look like a bug?
- [ ] Five things are missing at once. Is that overwhelming, or does the screen make it feel manageable?
- [ ] Would a secretary looking at this know what to do next without being told?

## Failure Behavior

- [ ] Building a program for a Sunday that holds **no sacrament meeting** (a stake or general conference Sunday) is refused with a sentence saying there is no meeting — not an empty program. Automated: `tests/routes/program-approval.test.ts` asserts the 422.
- [ ] The **music coordinator** cannot build a program. Automated: same suite asserts the 403.
- [ ] An **organization president** cannot read one. Automated: same suite.
- [ ] A program whose stored draft is corrupt reports that it could not be read, rather than opening blank. Automated: `tests/db/program-snapshot.test.ts`.

## Walkthrough record

Not yet walked. Blocked on `program-b`, which builds the screen this scenario describes.

## Notes

- The five gaps are deliberate and are **not** a seeding bug. A program with one gap would let a
  broken missing-list pass unnoticed.
- Slot 2's contact waiver means its request/confirm/notify stages read "Not applicable - invited
  outside the ward" on the **assignment** screen (talks-b). That is a different screen from this
  one; nothing about the waiver should appear on the program.
- `leadership_contacts` carries phone numbers on purpose. They belong on the printed program's
  contacts panel and must **never** reach the public page — scenario 032 in `program-c` is where
  that is checked on a real phone.
