# ITER-040: Roster import — paste the church's ward list report

**Type:** Modification
**Status:** In Progress
**Plan:** plans/roster-paste-import.md
**Created:** 2026-10-14

> **Planning decisions (2026-10-14) that refine this scope:** checklist is untick-only; callings,
> class assignment and ministering are stored **silently** (no review); a three-way "changed in
> the app since the last report" check is **deferred** to the Callings/Ministering modules;
> move-outs start unticked. The real LCR paste was profiled (counts only) and rebuilds cleanly.
> The plan is authoritative where it differs from the text below.

## Summary
Replace the roster's CSV file import with a **paste** import: a leader copies the whole custom
ward list report out of the church's leadership tools (LCR) and pastes it into the app, which
matches the columns by header, stores every column the report carries, and walks the importer
through a checklist of every difference — new people, changed people, people no longer listed —
before anything is applied.

## Context
First of three items for getting the bishopric onto real data now (GROUP-03): this import, then
per-user module access + the real ward (ITER-041), then the Speaker Tracker (ITER-042).

The user builds a custom report in LCR. LCR cannot export it, so the only way out is to select the
table, copy, and paste. Today they paste it into Google Sheets and export a CSV; the goal is to
paste straight into the app. When other wards adopt the app this will be their only path in, and
the user will write instructions on building the report and copying it. Some day the church may
let the app sync with membership records directly; until then, paste is the integration.

**This import establishes the REAL ward's baseline.** Decided during discovery: the user's current
ward becomes the **test ward** and keeps its existing data untouched; a **new real ward** is created
(ITER-041) and the user's ward list report is its first import. Real data and test data never share
a ward, which is what lets the user keep testing in production without risk to the record the
bishopric is building. The first real use of this import IS the baseline load — that is also the
proof the import works on the real report.

The report's columns (current header text): Preferred Name, Full Name, Age, Individual Phone,
Individual E-mail, Address - Street 1, Birth Date (1 Jan 1990), Gender, Class Assignment, Head of
House and Spouse, Callings, Callings with Date Sustained, Callings with Date Sustained and Set
Apart, Ministering Brothers, Ministering Sisters, Has Ministering Sisters, Has Ministering Brothers.

## Current Behavior
- The import takes an uploaded **CSV file** through a column-mapping step, a preview, and a confirm.
- Columns are matched by header text against a small alias list. It knows "Preferred Name" (as
  first name), "Gender" and "Individual Phone", but **not** "Head of House and Spouse" (the household
  must be picked by hand) and has no last-name column to match. Because the report carries names as
  "Last, First" in single columns, the import **refuses the file** and tells the user to split names
  in a spreadsheet first. The code deliberately never splits a whole name, to avoid guessing.
- The roster stores only first name, last name, household (family name + address), category,
  gender, phone and status. **There is no birth date, full name, email, class assignment, callings
  or ministering field**, so those columns cannot be kept.
- The preview shows **counts** (new households listed by name, new members, matched members) — not
  which people changed or what changed.
- It **never changes anyone missing from the file**; the preview says so out loud. That was a
  deliberate early decision (an import never marks, deactivates or removes anyone).
- A member is matched by household + first name + last name, so somebody whose household changes
  between exports reads as a new person.
- A `moved_out` member status already exists and already excludes people from visit counts while
  keeping their records.

## Desired Outcome
- **Paste is the only way in.** A box where the importer pastes the copied report table. The file
  upload goes away.
- **Columns match by header, in any order.** If a column the app needs is missing, the app names it
  and says how to add it to the LCR report. Extra columns are listed as "ignored" so the importer
  knows what happened.
- **Every column in the report is kept on the roster:** full name, preferred name, birth date,
  gender, phone, email, address, class assignment, household (Head of House and Spouse), callings
  and both dated callings columns, ministering brothers/sisters and the two "has ministering"
  flags. Age is computed from the birth date, never stored. Only some of these are needed by the
  Speaker Tracker; the rest are established now for the app as a whole.
- **Names:** first and last name come from parsing Preferred Name ("Last, First") at the comma —
  this is the user's explicit decision, reversing the never-split rule for this known LCR format.
  Full Name is kept and, with birth date, is the match key for future imports (it is what keeps
  "Dimmitt, DeeDee" matched to "Huber, Dee Dee").
- **The preview is a checklist of differences**, in three groups: **new** people, **changed** people
  (showing what changed — household, name, phone, callings, …) and **no longer listed**. The
  importer can untick or adjust any item, and only what they confirm is applied.
- **No longer listed → moved out**, never "inactive" (which means something specific in the
  Church). Nothing is deleted; every bit of history (talks, prayers, visits) stays tied to the
  record. Someone who reappears in a later report is matched back to their old record and set
  active again.
- **The test ward's members get the new fields too**, filled with made-up values (birth dates
  spread across Primary / Youth / Adult ages, sample class assignments and callings), so features
  tested there behave like the real ward and the shapes match when the real ward is opened up
  further.
- **Done when:** the user's report is pasted into the new real ward as its baseline, and a second
  paste with a few deliberate edits shows exactly those edits — and nothing else — in the checklist.

## Scope Notes
- **Partial paste guard:** if a paste is missing most of the ward (only part of the table got
  selected), warn loudly instead of offering to move hundreds of people out.
- **First import into an existing roster** has nothing stored to match on full name + birth date,
  so it must fall back to first + last name and then fill those in. This matters for the test
  ward; the real ward starts empty.
- **Line breaks inside cells.** The three callings columns hold one calling per line. How a copy
  from the LCR web table pastes those (and whether rows stay intact) is the riskiest unknown —
  planning needs a **genuine paste straight from LCR**, not one round-tripped through Google Sheets.
- Paste format is likely tab-separated; quoting rules differ from CSV.
- The report's own "Age" column is redundant with birth date; decide whether to ignore it or use it
  only as a cross-check.
- Two people could share a full name; full name + birth date is the key for exactly that reason.
- **Privacy:** this adds email, callings and ministering data to the roster. Leaders only; none of
  it ever reaches a public page (CLAUDE.md §9's public-projection boundary). The user's source
  file contains real member data and must **never** be placed in the repo or committed — the same
  rule as `prototype/WLT.jsx`.
- Households are keyed today by family name + address; the report's household column ("Head of
  House and Spouse", e.g. "Baker, Travis & Bridgette Jean") is a better key. Two households can
  share an address (an adult child's household at their parents' address).
- Who may import: today `roster.manage`. The Speaker Tracker plan wants admin + counselors; settle
  in ITER-041.
- Moved-out people stay visible as history but should not appear in pickers for new assignments.

## Open Questions
- How do LCR's multi-line cells come through a real paste? (Needs a sample from the user.)
- Should changed callings be shown field-by-field, or as one "callings changed" line per person?
- Do the ministering columns stay plain text for now, or get linked to member records? (Likely
  text now; linking belongs to the Ministering module.)
- Does a changed household (e.g. a youth turning adult and starting their own household) need any
  special treatment, or is it just a "changed" item like any other?
