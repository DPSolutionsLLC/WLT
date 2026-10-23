# ITER-045: Sacrament Planner replaces what is behind the Sacrament tile

**Type:** Modification
**Status:** Backlogged
**Created:** 2026-10-23

## Summary
Bring the bishopric's finished Sacrament Planner (`sacrament-planner-handoff/`) into Ward Leadership
Tools behind the existing **Sacrament** tile, replacing the sacrament screens there today. It must
look and work exactly as it does now, read the app's own member list, carry over the real records
the bishopric has already made, and take "who you are" from the login.

## Context
Raised by the user 2026-10-23. The Planner is a single-page app the bishopric has been using for
real (it ran as a Claude artifact on a shared document store). It is the "separate, larger item"
ITER-044 anticipated: ITER-044 makes the Sacrament tile releasable on its own, and this item puts
the Planner behind it. The full brief is `sacrament-planner-handoff/HANDOFF.md` — read it whole
before planning. The other sacrament-area modules (Topic history, Program, Music, Calendar) are
connected to the new work later, one at a time.

Only the three bishopric members use it for now: the bishop, the 1st counselor, and the user as
2nd counselor, in the real ward created under GROUP-03 (roster from the LCR paste, ITER-040).

## Current Behavior
- The Sacrament tile opens the app's own sacrament hub: Sundays, talks pipeline, prayers, music
  submission and review, topic history, finalize-to-To-Do asks, conductor rotation and speaking
  history. Several sibling tiles (Topic history, Program, Music, Calendar) belong to the same
  release module (see ITER-044).
- The Planner covers almost the same ground in its own way: Who's Next, Pray About, Sundays,
  Calls, Follow Up, Topics, To Decide, and Records (History, Name Review, Meetings, People &
  bishopric, Do Not Ask). It has its own built-in ward list, its own records keyed by
  "Last, First Middle" name strings and `hash(name)` ids, and a "You are" menu saved per device.
- The app's member list stores first/last name, full name, preferred name, birth date (not age),
  gender, phone and email.

## Desired Outcome
- **Tile and name:** the tile stays **Sacrament**; inside, the banner reads **Sacrament Planner**.
  The Sacrament tile is where sacrament meeting is managed.
- **A move, not a redesign:** same screens, wording, colors, layout, phone layout, bottom tab bar
  and light/dark switch. Nothing "improved" unless the user asks.
- **Today's sacrament screens are hidden from wards but stay in the code.**
- **Member list:** the Planner reads the app's member list (the user believes it is the same
  people). Before switching, a check compares it with
  `sacrament-planner-handoff/data/ward-list-used-by-planner.json` and reports (a) names only in one
  list, (b) the same person written differently, (c) differences in age, gender, phone or email,
  and every name used in the records that is not in the app's list. **The user reviews the report
  before anything is switched.** Names stay the link for now; suggest a later path to member ids
  that doesn't break old records.
- **Records:** every document in `data/database-export.json` comes across under its original id
  with every field, no `t_` test data. Counts per collection are checked, and the Oct 18 and
  Oct 25 Sundays, To Decide deferral counts, Pray About lists and History/Meetings corrections are
  spot-checked against the old app. The export is a 2026-10-23 snapshot: get a fresh export right
  before the import if the old page is still in use.
- **Identity:** the login decides who you are, mapped to the bishopric members. The **"You are"
  selector is hidden**. Each bishopric member sees their own Pray About list, ★ flags and To
  Decide items.
- **Practice mode:** a small Practice mode switch takes the selector's place, available to
  anyone who can use the Planner. It keeps the Test User sandbox (writes go to a separate practice
  layer shown over the real data) and "Clear test changes". Nothing in practice touches real
  records.
- **Artifact-only workarounds:** Call and Text become real `tel:`/`sms:` links, keeping the copy
  fallback; "Write it fresh with Claude" uses the app's AI service; Download CSV is a normal file
  download.
- **Access for now:** the bishop and both counselors only, with full use. Everyone else does not
  see the tile. The user also wants these three to have the tithing calculator. Wider access comes
  through the title-based access item (raised next, see BACKLOG).

## Scope Notes
- Depends on **ITER-044** (Sacrament tile releasable on its own).
- **Not in this item:** connections to To Do and other modules, and the shared app-wide Pray About
  list (built later on `considers`). Leave clean seams.
- The Planner runs on the browser's own clock and date math; this app's rule 12 (every date
  formatter names its zone) and the UTC server render path need checking wherever it is hosted.
- Project rules that any approach must meet: a ward on every row, RLS as the boundary, an audit
  row per write, TypeScript, no secrets in the browser.
- **Privacy:** `data/`, `app/src/data.json` and the built HTML are gitignored, but `body.html`
  has real names written into it (bishopric defaults, executive secretary). It is not committed
  yet; it must not be committed as is. The member list must come from Supabase, not these files.
- **GROUP-02 (ITER-035, ITER-037) builds on the sacrament flow this replaces** and probably needs
  revisiting.

## Open Questions
- Keep the Planner's own code as-is behind an adapter that provides `window.claude.use()`
  (`db`, `user`, `sample`, `downloads`) backed by the real database and auth, or rebuild it as
  components? The handoff suggests the adapter; the trade-off against this codebase's rules is for
  planning, and the user wants it explained before anything is built.
- How the Planner's document collections are stored (a ward-scoped document table vs. real
  tables) and how live updates reach every user.
- How a login maps to a bishopric member (the Planner's `settings/bishopric` names vs. the
  user's calling in the ward).
