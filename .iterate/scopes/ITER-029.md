# ITER-029: Browsing the Activity List for Your Own

**Type:** Enhancement
**Status:** Backlog
**Plan:** _none yet_
**Created:** 2026-08-29
**Raised by:** the user, 2026-08-29, reviewing the scenario 049 walk: *"the label makes it obvious.
However it could be more easily browsed for your own if the labels were colour coded. Maybe a
filter to show only your own organization's youth would be good too?"*
**Related:** `youth-a` (the ownership label), `youth-e` (the page split),
`app/(app)/youth/ActivityProfileList.tsx`, `components/visits/ReportFeed.tsx`,
`types/domain.ts` §`ORGANIZATION_TYPE_TONES`

## Summary

`/youth/profiles` lists every activity in the ward grouped by young person, and names the owning
organization under each one in plain muted text — *Young Men*, *Young Women*, *Ward-wide*. Scenario
049 asked whether a leader can tell at a glance which rows are theirs. **The answer was yes**: the
label does its job, and this is not a defect.

What was asked for instead is **browsing**. With four activities the label is enough. With a real
ward's forty, finding your own means reading every card. Two suggestions, and they are separable —
**the second is much cheaper than the first, and should probably ship alone.**

## 1. Colour-coding the organization label — NOT the small change it looks like

`ORGANIZATION_TYPE_TONES` already exists (`types/domain.ts:74`) and already colours organization
chips on the visits report feed, so no palette needs inventing. That makes this look like an
afternoon's work. It is not, and the reason is on the card already.

**Both tone maps draw from the same seven `CONTEXT_TONES`, and they collide:**

| Activity type | Tone | Organization | Tone |
|---|---|---|---|
| `sport` | **teal** | `young_men` | **teal** |
| `academic` | **blue** | `elders_quorum` | **blue** |
| `performance` | **violet** | `relief_society` | **violet** |
| `community` | **amber** | `primary` | **amber** |

Every card already carries an `ACTIVITY_TYPE_TONES` chip. So *Varsity basketball* — a **teal**
"Sport" chip — would gain a **teal** "Young Men" chip immediately beside it, in the same colour,
meaning something entirely different. *Chamber choir* would carry violet "Performance" next to
magenta "Young Women"; the reader has no way to learn which axis a hue belongs to when the two axes
share a palette.

`ORGANIZATION_TYPE_TONES`' own header comment says *"two contexts sharing a hue is a smaller cost
than a seventh hue nobody can tell from the sixth"*. That reasoning was correct and is still
correct — **but it assumed one tone map per card.** This would be the first screen in the app to
render two.

**So the real question is not "which colour is Young Women", it is "how many colour axes does one
card get".** Options, none free:

- **Colour the organization, drop the type chip to plain text.** The card gains an ownership hue
  and loses a type hue. Defensible on this page — the type is already legible as a word, and
  ownership is what the page is being browsed by — but it changes a component `youth-a` shipped
  and would want checking against `/youth`, where the type chip also appears.
- **Give ownership a different visual channel entirely** — a left border on the card, a background
  tint, a weight change — leaving hue to mean "activity type" everywhere in the app. Probably the
  right answer, and it is the one that does not require choosing between two meanings for teal.
- **Mark only "yours" rather than colouring all seven.** One accent on the rows you own, nothing on
  the rest. Cheapest, and it answers the actual ask — the user did not ask to tell Primary from
  Sunday School at a glance, they asked to find their own.

The third is the smallest thing that solves the stated problem, and it composes with the filter
below rather than competing with it.

## 2. A filter — has a shipped precedent, and one trap

`components/visits/ReportFeed.tsx` already carries an organization filter with an
`allContextsLabel` prop (defaulted to *"Every organization"*, overridden to *"Every activity"* by
`YouthReportFeed`). That is the pattern to copy; it does not need designing.

`ActivityProfileList` currently has **no search and no filter at all** — `/youth` (`YouthOverview`)
got a search box in `youth-e` and this page got nothing. So the filter lands on the page that has
the least, which is also the page with the most rows.

**The trap is the one that runs through all of Phase 8: what does "my organization" mean when there
isn't one?**

- A **ward-wide** activity (`org_id = null`) belongs to no presidency. Is it "yours"? It is not
  *not* yours — the council member who entered one can edit it. A filter that hides ward-wide rows
  under "only mine" would hide the row its user just created.
- **`ward_council_member` has no organization at all**, and it is the role most likely not to —
  CLAUDE.md §9 says so twice. "Only my organization" resolves to the empty set for the widest role
  in the app, which is the `null`-equals-`null` trap wearing a filter control.

Both are already-solved problems elsewhere in this module: `canManageActivityProfile()` has the
three-arm answer (bishopric, author, organization) and it is **pure and client-importable** for
exactly this kind of reuse. **A filter labelled "Only what I can change" would read off that helper
and be correct by construction for every account**, including the two above — where "Only my
organization" would need a fourth rule invented on the spot and would get the council member wrong.

That reframing is probably the whole item: the user asked to browse for *their own*, and "what I
can change" is what "their own" means here.

## Open questions

- Does the filter belong on `/youth` as well, where the cards are young people rather than
  activities? The two pages have different units, and `/youth`'s existing search is over youth
  names, not organizations.
- Should the filter persist across visits? `ReportFeed`'s does not, and `visits-c` recorded a
  cache bug caused by two views sharing one query entry — worth reading before adding a second
  filtered view of the same list.

## Deliberately not in scope

- **Anything about who may WRITE.** The permission model was walked in scenario 049 and is correct;
  this is entirely about finding rows in a list. A filter must never be the thing that stops a
  write — CLAUDE.md rule 2.
- **Hiding other organizations' activities by default.** Reads are ward-wide by design (migration
  054), and FEATURES.md §Module 10 gives the ward council the full calendar for a reason. Whatever
  ships here defaults to showing everything and narrows only on request.
