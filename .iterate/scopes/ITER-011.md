# ITER-011: Choose Which Conference Talks Count as Reference

**Type:** Feature
**Status:** Completed
**Created:** 2026-08-23
**Completed:** 2026-08-24
**Commit:** d96b83d

## Summary

Give the bishopric a way to say **which** conference talks the AI may draw on — by recency, by who
spoke, and by filters they describe in their own words — instead of activating and deactivating
documents one at a time.

## Context

Raised on 2026-08-23, planning how General Conference talks get into the corpus at all. The
conversation started as "is it worth uploading talks, or should the AI just search the web each
time" and settled on a curated local corpus (see CLAUDE.md §9, *Conference talk corpus scope*). That
decision immediately produces this one: once there are a hundred and fifty talks, the ward needs a
lever finer than active/inactive.

The user's framing, and it is the right one: *"rather than sorting and adding/removing like we have
set up for the scriptures — which I like — for General Conference talks I feel we need a more
simplified way of choosing what talks to use."*

Five volumes of scripture is a list you manage by hand. A conference corpus is not.

## Desired Outcome

A bishopric member opens `/knowledge`, sets "last two years, apostles and prophets", and every topic
suggestion from then on respects it. Nothing to press again. A sentence on screen tells them how many
talks that leaves and confirms the standard works are unaffected.

Beyond the standing options, they can type a filter in plain words — "talks by President Nelson" —
see what it resolved to before accepting it, and keep it as a checkbox alongside the rest.

## Scope Notes

**Nothing about this is possible today.** `match_document_chunks` (migration 031) filters on
`ward_id`, `status = 'active'`, and `embedding is not null`. `knowledge_documents` stores `title`,
`type_tag`, `file_url`, `status`, `uploaded_by`, `uploaded_at` — **no speaker, no date, no calling.**
Three columns and a function rewrite are the floor.

**The bug this feature will ship if nobody is watching for it.** A recency filter written the obvious
way (`conference_date >= :since`) excludes every document whose `conference_date` is null — which is
the entire standard works. The ward narrows their conference talks and silently loses the Book of
Mormon from every suggestion. Nothing errors; the drafts just quietly get worse. The filter must
apply to `general_conference` documents and to nothing else, and that has to be asserted in a test
rather than reviewed for.

**Recency is one axis, so it gets one control.** The user asked for checkboxes with standing limits.
Checkboxes are right for speaker roles and saved filters; they are wrong for recency, because
"last 2 years" and "last 5 years" both ticked has no defensible meaning. One select, several
checkboxes.

**The AI resolves the phrase once, at save time — not per query.** Two readings of "let the AI figure
it out" exist and only one is viable. Translating "talks by prophets" into `speaker_role = 'prophet'`
once, showing the user what it produced, and thereafter running a plain WHERE clause is cheap,
deterministic, inspectable, and testable. Judging every talk against the phrase on every retrieval is
none of those. This is the `topic_candidates` pattern — propose, show, accept — applied to a filter.

**The failure mode of the resolver is the interesting part.** The corpus can be filtered by *who
spoke and when*. It cannot be filtered by *what a talk is about* — that is what the vector search
already does on every call. Users will type both kinds of phrase without noticing the difference, and
a filter built from a subject phrase matches nothing while looking like it worked. The resolver needs
a third outcome — "that is a search, not a filter, and it is already happening" — and that message
doing its job is most of what separates this feature from a confusing one.

**Standing defaults already have a home.** `ai_settings.conference_preferences` is a `jsonb` column
that has existed since migration 014, and FEATURES.md Module 6 already describes it as
"recency, quantity, knowledge base priority". Saved custom filters need a new table;
the ward's standing scope does not.

**`ai_settings` is append-only.** A scope change is a new version and shows in the existing history.
`lib/ai/queries.ts` has no update function on purpose — do not add one.

**Files this touches:** two migrations; `types/domain.ts`; `lib/ai/retrieve.ts`;
`lib/knowledge/queries.ts`; `lib/validation/knowledge.ts` and `aiSettings.ts`; three new routes under
`app/api/knowledge/filters/`; `app/(app)/knowledge/` page plus two new components and two modified;
a new ingest script; SPEC.md and FEATURES.md.

**Plan:** [ai-d-conference-corpus-scoping.md](../../plans/ai-d-conference-corpus-scoping.md)

## Open Questions

1. **What does "talks by prophets" mean?** Talks given *while serving* as President of the Church, or
   talks by anyone who ever held that office? The schema stores role-at-time-of-talk, which answers
   the first; many users will mean the second. The resolver's prompt has to commit to one.
2. **Do a saved filter and the recency select combine by AND or OR?** AND matches "narrow the
   corpus" and is the safe default. A user who saves "President Nelson" *and* sets "last 2 years"
   probably wants his older talks too. Whichever it is, the panel must say so in words.
3. **Does the Retrieval Tester respect the scope by default?** Testing against the scope is the
   honest preview; testing against everything is more useful while deciding what the scope should be.
4. **Is `speaker` free text or a controlled list?** Free text lets a misspelling create a filter that
   matches nothing forever.

## Related

- **CLAUDE.md §9** — *Conference talk corpus scope* and *Conference talk acquisition*, the two
  decisions that produced this scope.
- **ITER-012** — suggestion frequency. Its logging table ships inside this work because telemetry
  cannot be backfilled; only its display is deferred.
- **`ai-b-knowledge-and-retrieval`** — built the corpus and the search function this extends.
- **`plans/05-ai-platform.md`** — the phase this belongs to.
- **`plans/06-program-music.md`** — hymn suggestions retrieve from the same corpus and will inherit
  whatever scope is set here.
