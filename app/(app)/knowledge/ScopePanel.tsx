"use client";

import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { FormError } from "@/components/ui/FormError";
import {
  RECENCY_OPTIONS,
  formatConferenceDate,
  resolveSinceDate,
} from "@/lib/knowledge/conferenceMetadata";
import {
  matchesConferenceScope,
  mergeConferenceScope,
} from "@/lib/knowledge/filterResolution";
import {
  SPEAKER_ROLES,
  SPEAKER_ROLE_LABELS,
  type AiSettings,
  type ConferenceScopeSettings,
  type KnowledgeDocument,
  type SavedFilter,
  type SpeakerRole,
} from "@/types/domain";

// WHICH conference talks are searchable at all.
//
// The count sentence under the three controls is the whole feature. It is the difference between
// a bishopric that trusts this panel and one that sets something and wonders whether anything
// happened — and it is the ONLY place the standard-works exemption becomes visible to a person.
//
// It is computed with matchesConferenceScope, the same predicate lib/ai/retrieve.ts sends to the
// database as SQL. One implementation, so the number on screen and the rows Postgres returns
// cannot drift.

export type ScopePanelProps = {
  documents: KnowledgeDocument[];
  savedFilters: SavedFilter[];
  settings: AiSettings | null;
  today: string;
  canManage: boolean;
};

const SELECT_CLASSES =
  "min-h-11 rounded-md border border-border bg-surface-raised px-3 py-2 text-base text-foreground " +
  "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary";

const EMPTY_SCOPE: ConferenceScopeSettings = {
  sinceYears: null,
  speakerRoles: [],
  savedFilterIds: [],
};

export function ScopePanel({
  documents,
  savedFilters,
  settings,
  today,
  canManage,
}: ScopePanelProps) {
  const router = useRouter();

  // The ONE piece of state this component owns, and it is a draft the user is editing rather
  // than a copy of server data. DocumentList's rule — hold no copy of the documents — still
  // applies: `documents` and `savedFilters` are read straight from props on every render, so a
  // router.refresh() after a save updates the count even though this state survives it
  // (plans/retros/ai-a-client-and-settings.md).
  const [draft, setDraft] = useState<ConferenceScopeSettings>(
    settings?.conferencePreferences?.scope ?? EMPTY_SCOPE,
  );
  const [saveError, setSaveError] = useState<string>();
  const [isSaving, setIsSaving] = useState(false);
  const [savedMessage, setSavedMessage] = useState<string>();

  const conferenceTalks = useMemo(
    () => documents.filter((document) => document.typeTag === "general_conference"),
    [documents],
  );

  const scope = useMemo(
    () => mergeConferenceScope(draft, savedFilters, today),
    [draft, savedFilters, today],
  );

  const inScopeCount = useMemo(
    () => conferenceTalks.filter((talk) => matchesConferenceScope(talk, scope)).length,
    [conferenceTalks, scope],
  );

  const unfilterableCount = useMemo(
    () =>
      conferenceTalks.filter(
        (talk) =>
          talk.speaker === null || talk.speakerRole === null || talk.conferenceDate === null,
      ).length,
    [conferenceTalks],
  );

  function toggleRole(role: SpeakerRole) {
    setSavedMessage(undefined);
    setDraft((current) => ({
      ...current,
      speakerRoles: current.speakerRoles.includes(role)
        ? current.speakerRoles.filter((existing) => existing !== role)
        : [...current.speakerRoles, role],
    }));
  }

  function toggleSavedFilter(id: string) {
    setSavedMessage(undefined);
    setDraft((current) => ({
      ...current,
      savedFilterIds: current.savedFilterIds.includes(id)
        ? current.savedFilterIds.filter((existing) => existing !== id)
        : [...current.savedFilterIds, id],
    }));
  }

  async function handleSave() {
    setSaveError(undefined);
    setSavedMessage(undefined);
    setIsSaving(true);

    try {
      // A SCOPE CHANGE IS A NEW AI SETTINGS VERSION, not an update. `ai_settings` is append-only
      // (migration 014) and lib/ai/queries.ts has no update function on purpose, so the whole
      // settings object is posted with the new scope folded in — and the change shows up in the
      // existing version history like every other settings change.
      const response = await fetch("/api/ai-settings", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          toneVoice: settings?.toneVoice ?? null,
          doctrinalEmphasis: settings?.doctrinalEmphasis ?? null,
          scripturePreferences: settings?.scripturePreferences ?? null,
          conferencePreferences: {
            // Carried forward rather than defaulted, so saving a scope never quietly resets the
            // recency and talk-count preferences somebody set on the AI settings screen.
            maxYearsOld: settings?.conferencePreferences?.maxYearsOld ?? null,
            maxTalks: settings?.conferencePreferences?.maxTalks ?? 3,
            preferKnowledgeBase: settings?.conferencePreferences?.preferKnowledgeBase ?? true,
            scope: draft,
          },
          topicPreferences: settings?.topicPreferences ?? null,
          wardContext: settings?.wardContext ?? null,
          thankYouPreferences: settings?.thankYouPreferences ?? null,
        }),
      });

      const body: { error?: string } = await response.json();

      if (!response.ok) {
        // VERBATIM. The route's refusals are already written for a human.
        setSaveError(body.error ?? "Could not save the scope. Please try again.");
        return;
      }

      setSavedMessage("Saved. Every suggestion from now on uses this scope.");
      router.refresh();
    } catch (error) {
      console.error("Could not save the conference scope", error);
      setSaveError("Could not reach the server. Check your connection and try again.");
    } finally {
      setIsSaving(false);
    }
  }

  const sinceDate = resolveSinceDate(draft.sinceYears, today);

  return (
    <Card>
      <div className="flex flex-col gap-4">
        <div>
          <h2 className="text-base font-semibold text-foreground">
            Which conference talks count as reference
          </h2>
          {/* NAMES THE DIFFERENCE FROM THE AI SETTINGS RECENCY CONTROL. Two recency settings on
              two screens that mean different things is a real trap, and one sentence is the
              whole cost of avoiding it. This decides what is SEARCHED; the AI settings screen
              decides what the AI prefers to cite from whatever it finds. */}
          <p className="mt-1 text-sm text-muted">
            This decides which talks are searched at all. The recency preference in AI settings
            is a different thing — it asks the AI to prefer recent talks among whatever the
            search returns.
          </p>
        </div>

        {/* -------------------------------------------------------------------------------
            Recency — ONE select, because two ticked checkboxes would be ambiguous
            ------------------------------------------------------------------------------- */}
        <div className="flex flex-col gap-1.5">
          <label htmlFor="scope-recency" className="text-sm font-medium text-foreground">
            How far back to look
          </label>
          <select
            id="scope-recency"
            value={draft.sinceYears === null ? "" : String(draft.sinceYears)}
            disabled={!canManage}
            onChange={(event) => {
              setSavedMessage(undefined);
              setDraft((current) => ({
                ...current,
                sinceYears: event.target.value === "" ? null : Number(event.target.value),
              }));
            }}
            className={SELECT_CLASSES}
          >
            {RECENCY_OPTIONS.map((option) => (
              <option key={option.label} value={option.years === null ? "" : option.years}>
                {option.label}
              </option>
            ))}
          </select>
          {sinceDate !== null && (
            <p className="text-xs text-muted">
              Talks from {formatConferenceDate(sinceDate)} onwards.
            </p>
          )}
        </div>

        {/* -------------------------------------------------------------------------------
            Speaker roles — checkboxes, and NONE TICKED MEANS NO RESTRICTION
            ------------------------------------------------------------------------------- */}
        <fieldset className="flex flex-col gap-2">
          <legend className="text-sm font-medium text-foreground">Callings</legend>
          {/* THIS SENTENCE IS NOT OPTIONAL. An empty checkbox group that silently means
              "everything" is the same trap as an empty `WHERE ... IN ()`, and the only defence
              is saying which one it is where the boxes are. */}
          <p className="text-xs text-muted">
            {draft.speakerRoles.length === 0
              ? "None ticked, so no restriction — talks by anyone are searched."
              : "Only talks by the callings ticked here are searched."}{" "}
            A calling is the one the speaker held when they gave the talk, not the one they hold
            now.
          </p>
          <div className="flex flex-col gap-1">
            {SPEAKER_ROLES.map((role) => (
              <label
                key={role}
                className="flex min-h-11 items-center gap-2 text-sm text-foreground"
              >
                <input
                  type="checkbox"
                  className="size-4 accent-[var(--color-primary)]"
                  checked={draft.speakerRoles.includes(role)}
                  disabled={!canManage}
                  onChange={() => toggleRole(role)}
                />
                {SPEAKER_ROLE_LABELS[role]}
              </label>
            ))}
          </div>
        </fieldset>

        {/* -------------------------------------------------------------------------------
            Saved filters
            ------------------------------------------------------------------------------- */}
        <fieldset className="flex flex-col gap-2">
          <legend className="text-sm font-medium text-foreground">Saved filters</legend>

          {savedFilters.length === 0 ? (
            <p className="text-xs text-muted">
              None saved yet. Describe the talks you want in the box below and one will be
              offered.
            </p>
          ) : (
            <>
              {/* THE COMBINATION RULE, IN WORDS. Q2 of the plan's open questions: everything
                  narrows together. A rule nobody can see is a rule nobody can predict. */}
              <p className="text-xs text-muted">
                Everything here narrows together — a ticked filter applies on top of the callings
                and the period above, not instead of them.
              </p>
              <ul className="flex flex-col divide-y divide-border">
                {savedFilters.map((filter) => (
                  <li key={filter.id} className="flex items-start justify-between gap-2 py-2">
                    <label className="flex min-h-11 flex-1 items-start gap-2">
                      <input
                        type="checkbox"
                        className="mt-3.5 size-4 shrink-0 accent-[var(--color-primary)]"
                        checked={draft.savedFilterIds.includes(filter.id)}
                        disabled={!canManage}
                        onChange={() => toggleSavedFilter(filter.id)}
                      />
                      <span className="flex flex-col py-2">
                        <span className="text-sm text-foreground">{filter.label}</span>
                        {/* The phrase that produced it. Six months on, three columns of enum
                            values are something to reverse-engineer; this is the explanation. */}
                        <span className="text-xs text-muted">
                          &ldquo;{filter.sourcePhrase}&rdquo;
                        </span>
                      </span>
                    </label>
                    {canManage && <DeleteFilterButton filter={filter} />}
                  </li>
                ))}
              </ul>
            </>
          )}
        </fieldset>

        {/* -------------------------------------------------------------------------------
            The count sentence — the honest half of the whole feature
            ------------------------------------------------------------------------------- */}
        <div className="rounded-md border border-dashed border-border bg-surface p-3">
          {conferenceTalks.length === 0 ? (
            <p className="text-sm text-foreground">
              There are no general conference talks in the knowledge base yet, so this scope
              changes nothing. The standard works are always searched.
            </p>
          ) : inScopeCount === 0 ? (
            // A LEGITIMATE STATE, NOT AN ERROR. A ward may genuinely scope to one speaker in a
            // year they have not ingested. It has to say what will HAPPEN, not just that the
            // number is zero — suggestions fall back to scripture, which is a real answer.
            <p className="text-sm text-foreground">
              This scope matches none of your {conferenceTalks.length} conference talks.
              Suggestions will be written from the standard works alone, which are always
              included. Widen the period or untick a calling to bring talks back.
            </p>
          ) : (
            <p className="text-sm text-foreground">
              Currently scoped to {inScopeCount} of {conferenceTalks.length} conference{" "}
              {conferenceTalks.length === 1 ? "talk" : "talks"}. The standard works are always
              included.
            </p>
          )}

          {/* Task 9's silent-inclusion problem, counted. A conference talk with no speaker, role
              or date cannot be reached by any filter — which per migration 033 means it is
              always included, however narrow the scope looks. */}
          {unfilterableCount > 0 && (
            <p className="mt-2 text-xs text-muted">
              {unfilterableCount}{" "}
              {unfilterableCount === 1
                ? "talk has no speaker or date recorded, so no filter can reach it and it is always searched"
                : "talks have no speaker or date recorded, so no filter can reach them and they are always searched"}
              . They are marked &ldquo;Not filterable&rdquo; below.
            </p>
          )}
        </div>

        {canManage && (
          <div className="flex flex-col gap-2">
            <div>
              <Button onClick={() => void handleSave()} disabled={isSaving}>
                {isSaving ? "Saving…" : "Save scope"}
              </Button>
            </div>

            <FormError message={saveError} />

            {savedMessage && (
              <p className="text-sm text-success" role="status">
                {savedMessage}
              </p>
            )}

            <p className="text-xs text-muted">
              Saving adds a new version to the AI settings history, the same as any other
              settings change. Nothing is overwritten.
            </p>
          </div>
        )}
      </div>
    </Card>
  );
}

// Its own component so a delete in progress does not disable the whole panel, and so the confirm
// wording lives next to the thing it describes.
function DeleteFilterButton({ filter }: { filter: SavedFilter }) {
  const router = useRouter();
  const [isDeleting, setIsDeleting] = useState(false);

  async function handleDelete() {
    // Worded by CONSEQUENCE, not by action. Naming what is NOT affected is what lets somebody
    // answer it — the calendar-b confirm dialog is the precedent.
    const confirmed = window.confirm(
      `Delete the saved filter "${filter.label}"? The documents are not affected, and any scope using it will simply stop narrowing by it.`,
    );
    if (!confirmed) return;

    setIsDeleting(true);

    try {
      const response = await fetch(`/api/knowledge/filters/${filter.id}`, {
        method: "DELETE",
      });

      if (!response.ok) {
        const body: { error?: string } = await response.json();
        window.alert(body.error ?? "Could not delete the filter. Please try again.");
        return;
      }

      router.refresh();
    } catch (error) {
      console.error("Could not delete a saved filter", error);
      window.alert("Could not reach the server. Check your connection and try again.");
    } finally {
      setIsDeleting(false);
    }
  }

  return (
    <Button variant="secondary" disabled={isDeleting} onClick={() => void handleDelete()}>
      Delete
    </Button>
  );
}
