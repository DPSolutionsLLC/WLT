# ITER-009: Name a Settings Version

**Type:** Feature
**Status:** Backlogged
**Created:** 2026-08-23

## Summary

Let whoever saves a version of the AI settings **give it a name**, so the history can be read
by circumstance rather than by date. A default name is offered; a custom one replaces it.

## Context

Raised on 2026-08-23 walking scenario 020, immediately after `ai-a` shipped the version history.

The history today reads:

> Saved by Mark Andersen on 12 August 2026 · **Active**
> Saved by Peter Nakamura on 12 July 2026

Which is a complete audit record and a poor recall tool. A bishopric that has six versions has
six dates, and no way to answer "which one was the one we liked for thank-you notes". The user's
words: *"I think we should be able to title the versions ourselves with something custom to be
able to recall easily under a particular circumstance."*

This is the smaller half of a pair raised together. The other is ITER-010, which wants per-leader
settings recalled automatically. They are related but genuinely separable, and this one is worth
doing first: a named version is useful on its own, and ITER-010 will almost certainly want to
point at a named thing rather than a timestamp.

## Desired Outcome

Saving offers a name. Accepting the default is one tap; typing over it is one field. The history
lists names, with the date and the saver kept as the secondary line rather than the headline.

## Scope Notes

**This needs a migration.** `ai_settings` (migration 014) has no `label` column, and `ai-a`
deliberately shipped without one — its plan states there is no migration in it. A nullable
`label text` is the whole schema change, and nullable matters: the two versions that exist today,
and any written before this ships, have no name and must render as something honest rather than
as "Untitled".

**What is the default?** Three candidates, and the choice is a real one:
- The date, which is what the history already shows — so the default adds nothing.
- A sequence — "Version 4". Honest, sortable, and says nothing about the content.
- Something derived from what changed since the previous version — "Tone and ward context". The
  most useful and the only one with real work behind it, since it means diffing two versions.

Deriving is probably right but should not block the feature. Shipping with "Version N" and a
free-text override is a defensible first cut.

**The append-only rule stays.** A name is chosen at SAVE time and is part of the row like every
other field. Renaming an existing version would be an UPDATE, and `lib/ai/queries.ts` has no
update function on purpose — that absence is the versioning guarantee. If renaming is wanted, it
is a **new version carrying the new name**, and that should be stated rather than discovered.

**Restore should carry the name forward, and say it is a copy.** Restoring "Christmas tone"
appends a row; calling the new row "Christmas tone" as well makes the history ambiguous. Something
like "Christmas tone (restored)" is likelier right. Worth deciding rather than defaulting.

**Validation.** `lib/validation/aiSettings.ts` already holds the schema both the form and the
route parse. A `label` with a short max length (60?) and a trim-to-null goes there, with the
message written as a sentence like every other one in that file.

**Files this touches:** a new migration; `types/domain.ts` (`AiSettings`);
`lib/validation/aiSettings.ts`; `lib/ai/queries.ts` (columns, mapper, insert);
`app/api/ai-settings/route.ts` and `restore/[id]/route.ts`;
`app/(app)/ai-settings/AiSettingsForm.tsx` and `VersionHistory.tsx`;
`testing/infrastructure/seedUtils.ts` (`createAiSettings`); scenario 020's checklist and seed.

## Open Questions

1. **What is the default name?** Sequence, date, or derived-from-what-changed. See above.
2. **Does a restored version's name get a marker?** Probably, and probably automatic.
3. **Is a name required or optional?** Optional is friendlier and means the migration's nullable
   column stays honest forever; required means every version is findable. Optional-with-a-default
   is likely the answer — the user asked for "the option to just use a default title".
4. **Does the preview panel show which named version it is running against?** It runs against
   the unsaved form, so the honest answer is "none of them" — but that is worth saying on screen
   once versions have names people expect to see.

## Related

- **`ai-a-client-and-settings`** — built the append-only history this extends.
  See `plans/retros/ai-a-client-and-settings.md`.
- **ITER-010** — per-leader settings recalled on rotation. Raised in the same conversation; will
  likely want to reference a named version.
- **`plans/05-ai-platform.md`** — the phase this belongs to.
- **scenario 020** — its history checks are written against dates and would need updating.
