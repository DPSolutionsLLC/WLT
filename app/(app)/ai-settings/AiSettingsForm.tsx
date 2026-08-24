"use client";

import { useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { PreviewPanel } from "@/app/(app)/ai-settings/PreviewPanel";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { FormError } from "@/components/ui/FormError";
import { Input } from "@/components/ui/Input";
import {
  MAX_CONFERENCE_TALKS,
  MAX_CONFERENCE_YEARS,
  MAX_SCRIPTURE_REFERENCES,
  aiSettingsInputSchema,
  type AiSettingsInput,
} from "@/lib/validation/aiSettings";
import {
  STANDARD_WORKS,
  STANDARD_WORK_LABELS,
  type AiSettings,
  type ConferenceScopeSettings,
  type StandardWork,
} from "@/types/domain";

// The seven sections of FEATURES.md §Module 6, in its order, plus the preview panel that runs
// against whatever is currently typed into them.
//
// EVERY FIELD HAS A DISTINCT id. Seven sections on one page and `Input` requires an id — a
// repeated one makes a label point at the wrong input (plans/retros/talks-c-prayers-topics.md).
//
// Validation is aiSettingsInputSchema, the SAME schema POST /api/ai-settings parses. One rule,
// both sides of the boundary (CLAUDE.md §6).

const TEXTAREA_CLASSES =
  "w-full rounded-md border border-border bg-surface-raised px-3 py-2 text-base text-foreground " +
  "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary " +
  "disabled:opacity-70";

export type AiSettingsFormProps = {
  initialSettings: AiSettings | null;
  canManage: boolean;
};

type DraftState = {
  toneVoice: string;
  doctrinalEmphasis: string;
  canonPriority: StandardWork[];
  maxReferences: string;
  relevanceNotes: string;
  maxYearsOld: string;
  maxTalks: string;
  preferKnowledgeBase: boolean;
  // CARRIED THROUGH UNTOUCHED, AND THERE IS NO CONTROL FOR IT ON THIS PAGE.
  //
  // The corpus scope is edited on /knowledge, but it LIVES inside conference_preferences — and
  // this form rebuilds that whole object from draft state on every save. Leaving it out would
  // make saving the AI settings form silently erase the ward's scope, with nothing on either
  // screen to suggest it happened. It rides in the draft so it rides back out.
  scope: ConferenceScopeSettings | null;
  topicPreferences: string;
  wardContext: string;
  thankYouPreferences: string;
};

function toDraftState(settings: AiSettings | null): DraftState {
  return {
    toneVoice: settings?.toneVoice ?? "",
    doctrinalEmphasis: settings?.doctrinalEmphasis ?? "",
    canonPriority: [...(settings?.scripturePreferences?.canonPriority ?? [])],
    maxReferences: String(settings?.scripturePreferences?.maxReferences ?? 3),
    relevanceNotes: settings?.scripturePreferences?.relevanceNotes ?? "",
    // An empty box means "no recency limit", which is what null means downstream. It is not zero.
    maxYearsOld:
      settings?.conferencePreferences?.maxYearsOld === null ||
      settings?.conferencePreferences?.maxYearsOld === undefined
        ? ""
        : String(settings.conferencePreferences.maxYearsOld),
    maxTalks: String(settings?.conferencePreferences?.maxTalks ?? 3),
    preferKnowledgeBase: settings?.conferencePreferences?.preferKnowledgeBase ?? true,
    scope: settings?.conferencePreferences?.scope ?? null,
    topicPreferences: settings?.topicPreferences ?? "",
    wardContext: settings?.wardContext ?? "",
    thankYouPreferences: settings?.thankYouPreferences ?? "",
  };
}

// A blank box is an unset field, not an empty string, so the prose renderer skips it rather than
// emitting a label with nothing after it.
function orNull(value: string): string | null {
  const trimmed = value.trim();
  return trimmed === "" ? null : trimmed;
}

// NaN rather than 0 for an unparseable number: Zod then refuses it with a sentence, instead of
// the form silently saving "0 scriptures" — which is a real and very different instruction.
function toNumber(value: string): number {
  return value.trim() === "" ? Number.NaN : Number(value);
}

export function toDraftInput(state: DraftState): AiSettingsInput {
  return {
    toneVoice: orNull(state.toneVoice),
    doctrinalEmphasis: orNull(state.doctrinalEmphasis),
    scripturePreferences: {
      canonPriority: state.canonPriority,
      maxReferences: toNumber(state.maxReferences),
      relevanceNotes: orNull(state.relevanceNotes),
    },
    conferencePreferences: {
      maxYearsOld: state.maxYearsOld.trim() === "" ? null : toNumber(state.maxYearsOld),
      maxTalks: toNumber(state.maxTalks),
      preferKnowledgeBase: state.preferKnowledgeBase,
      // Spread into MUTABLE arrays because AiSettingsInput is Zod-inferred and mutable while
      // ConferenceScopeSettings is readonly — the same conversion the canonPriority line above
      // does, for the same reason.
      scope: state.scope
        ? {
            sinceYears: state.scope.sinceYears,
            speakerRoles: [...state.scope.speakerRoles],
            savedFilterIds: [...state.scope.savedFilterIds],
          }
        : null,
    },
    topicPreferences: orNull(state.topicPreferences),
    wardContext: orNull(state.wardContext),
    thankYouPreferences: orNull(state.thankYouPreferences),
  };
}

export function AiSettingsForm({ initialSettings, canManage }: AiSettingsFormProps) {
  const router = useRouter();

  const [draft, setDraft] = useState<DraftState>(() => toDraftState(initialSettings));
  const [formError, setFormError] = useState<string>();
  const [savedNote, setSavedNote] = useState<string>();
  const [isSaving, setIsSaving] = useState(false);

  // WHY THIS EXISTS: `router.refresh()` re-runs the Server Component and hands down fresh props,
  // but it deliberately PRESERVES client state — so a `useState` initialiser never runs again.
  // Restoring an old version therefore updated the history and left this form showing the values
  // it was mounted with, which reads as "restore did nothing". It was the only visible evidence a
  // restore had happened, and it was stale.
  //
  // Resetting during render rather than in an effect is React's documented pattern for state that
  // must follow a prop: it re-renders before anything is painted, so the stale values are never
  // on screen. A `key` on the parent would also work, but it would remount the whole form and
  // throw away the "Saved" note along with it.
  //
  // Keyed on the ACTIVE VERSION ID, not on the settings object: every save and every restore
  // appends a row with a new id, so the id changing is exactly "the active configuration moved".
  const activeVersionId = initialSettings?.id ?? null;
  const [loadedVersionId, setLoadedVersionId] = useState(activeVersionId);

  if (loadedVersionId !== activeVersionId) {
    setLoadedVersionId(activeVersionId);
    setDraft(toDraftState(initialSettings));
    setFormError(undefined);
  }

  function update<Key extends keyof DraftState>(key: Key, value: DraftState[Key]) {
    setDraft((current) => ({ ...current, [key]: value }));
    setSavedNote(undefined);
  }

  function moveCanonEntry(index: number, direction: -1 | 1) {
    setDraft((current) => {
      const next = [...current.canonPriority];
      const target = index + direction;
      if (target < 0 || target >= next.length) return current;
      [next[index], next[target]] = [next[target], next[index]];
      return { ...current, canonPriority: next };
    });
    setSavedNote(undefined);
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setFormError(undefined);
    setSavedNote(undefined);

    const parsed = aiSettingsInputSchema.safeParse(toDraftInput(draft));
    if (!parsed.success) {
      setFormError(parsed.error.issues[0]?.message ?? "Check the form and try again.");
      return;
    }

    setIsSaving(true);
    try {
      const response = await fetch("/api/ai-settings", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(parsed.data),
      });

      const body: { settings?: AiSettings; error?: string } = await response.json();

      if (!response.ok || !body.settings) {
        setFormError(body.error ?? "Could not save the AI settings. Please try again.");
        return;
      }

      setSavedNote("Saved as a new version. The previous one is still in the history below.");
      // Refresh so the history picks up the version that was just appended.
      router.refresh();
    } catch (error) {
      console.error("Could not save the AI settings", error);
      setFormError("Could not reach the server. Check your connection and try again.");
    } finally {
      setIsSaving(false);
    }
  }

  const unselectedWorks = STANDARD_WORKS.filter(
    (work) => !draft.canonPriority.includes(work),
  );

  // Read-only for a role that may view but not manage. NOT a disabled Save button — a disabled
  // control reads as "this is coming" (plans/retros/talks-b-month-planner.md), and this is a
  // permanent answer for this role rather than an unfinished feature.
  const readOnly = !canManage;

  return (
    <div className="flex flex-col gap-6">
      <form onSubmit={handleSubmit} className="flex flex-col gap-4" noValidate>
        {readOnly && (
          <p className="text-sm text-muted">
            You can read these settings. A member of the bishopric can change them.
          </p>
        )}

        <Card>
          <label
            htmlFor="ai-tone"
            className="flex flex-col gap-1 text-sm font-medium text-foreground"
          >
            Tone &amp; voice
            <span className="text-xs font-normal text-muted">
              How drafts should sound. For example: warm and brief, never formal.
            </span>
            <textarea
              id="ai-tone"
              rows={3}
              value={draft.toneVoice}
              disabled={readOnly}
              onChange={(event) => update("toneVoice", event.target.value)}
              className={TEXTAREA_CLASSES}
            />
          </label>
        </Card>

        <Card>
          <label
            htmlFor="ai-doctrinal"
            className="flex flex-col gap-1 text-sm font-medium text-foreground"
          >
            Doctrinal emphasis
            <span className="text-xs font-normal text-muted">
              Themes this ward keeps returning to.
            </span>
            <textarea
              id="ai-doctrinal"
              rows={3}
              value={draft.doctrinalEmphasis}
              disabled={readOnly}
              onChange={(event) => update("doctrinalEmphasis", event.target.value)}
              className={TEXTAREA_CLASSES}
            />
          </label>
        </Card>

        <Card>
          <fieldset className="flex flex-col gap-3" disabled={readOnly}>
            <legend className="text-sm font-medium text-foreground">
              Scripture preferences
            </legend>

            <div className="flex flex-col gap-2">
              <p className="text-xs text-muted">
                Which books to draw from first. The order is the priority order.
              </p>

              {draft.canonPriority.length === 0 ? (
                <p className="text-sm text-muted">
                  No order set — drafts may cite from anywhere in the standard works.
                </p>
              ) : (
                <ol className="flex flex-col gap-2">
                  {draft.canonPriority.map((work, index) => (
                    <li key={work} className="flex items-center gap-2">
                      <span className="flex-1 text-sm text-foreground">
                        {index + 1}. {STANDARD_WORK_LABELS[work]}
                      </span>
                      <Button
                        variant="secondary"
                        aria-label={`Move ${STANDARD_WORK_LABELS[work]} up`}
                        disabled={readOnly || index === 0}
                        onClick={() => moveCanonEntry(index, -1)}
                      >
                        ↑
                      </Button>
                      <Button
                        variant="secondary"
                        aria-label={`Move ${STANDARD_WORK_LABELS[work]} down`}
                        disabled={readOnly || index === draft.canonPriority.length - 1}
                        onClick={() => moveCanonEntry(index, 1)}
                      >
                        ↓
                      </Button>
                      <Button
                        variant="secondary"
                        aria-label={`Remove ${STANDARD_WORK_LABELS[work]}`}
                        disabled={readOnly}
                        onClick={() =>
                          update(
                            "canonPriority",
                            draft.canonPriority.filter((entry) => entry !== work),
                          )
                        }
                      >
                        Remove
                      </Button>
                    </li>
                  ))}
                </ol>
              )}

              {!readOnly && unselectedWorks.length > 0 && (
                <div className="flex flex-wrap gap-2">
                  {unselectedWorks.map((work) => (
                    <Button
                      key={work}
                      variant="secondary"
                      onClick={() =>
                        update("canonPriority", [...draft.canonPriority, work])
                      }
                    >
                      Add {STANDARD_WORK_LABELS[work]}
                    </Button>
                  ))}
                </div>
              )}
            </div>

            <Input
              id="ai-scripture-max"
              label="Most scriptures to suggest"
              type="number"
              inputMode="numeric"
              min={0}
              max={MAX_SCRIPTURE_REFERENCES}
              step={1}
              value={draft.maxReferences}
              onChange={(event) => update("maxReferences", event.target.value)}
            />

            <label
              htmlFor="ai-scripture-notes"
              className="flex flex-col gap-1 text-sm font-medium text-foreground"
            >
              Notes on choosing scriptures
              <textarea
                id="ai-scripture-notes"
                rows={2}
                value={draft.relevanceNotes}
                onChange={(event) => update("relevanceNotes", event.target.value)}
                className={TEXTAREA_CLASSES}
              />
            </label>
          </fieldset>
        </Card>

        <Card>
          <fieldset className="flex flex-col gap-3" disabled={readOnly}>
            <legend className="text-sm font-medium text-foreground">
              Conference talk preferences
            </legend>

            <Input
              id="ai-conference-years"
              label="Only talks from the last … years"
              type="number"
              inputMode="numeric"
              min={1}
              max={MAX_CONFERENCE_YEARS}
              step={1}
              placeholder="Any year"
              value={draft.maxYearsOld}
              onChange={(event) => update("maxYearsOld", event.target.value)}
            />
            <p className="-mt-2 text-xs text-muted">
              Leave this blank for no limit — talks from any year are welcome.
            </p>

            <Input
              id="ai-conference-max"
              label="Most talks to suggest"
              type="number"
              inputMode="numeric"
              min={0}
              max={MAX_CONFERENCE_TALKS}
              step={1}
              value={draft.maxTalks}
              onChange={(event) => update("maxTalks", event.target.value)}
            />

            <label
              htmlFor="ai-conference-knowledge"
              className="flex min-h-11 items-center gap-2 text-sm font-medium text-foreground"
            >
              <input
                id="ai-conference-knowledge"
                type="checkbox"
                checked={draft.preferKnowledgeBase}
                onChange={(event) => update("preferKnowledgeBase", event.target.checked)}
                className="size-5"
              />
              Prefer the ward&apos;s own knowledge base
            </label>
          </fieldset>
        </Card>

        <Card>
          <label
            htmlFor="ai-topics"
            className="flex flex-col gap-1 text-sm font-medium text-foreground"
          >
            Topic generation preferences
            <span className="text-xs font-normal text-muted">
              What makes a good topic for this ward, and what to avoid.
            </span>
            <textarea
              id="ai-topics"
              rows={3}
              value={draft.topicPreferences}
              disabled={readOnly}
              onChange={(event) => update("topicPreferences", event.target.value)}
              className={TEXTAREA_CLASSES}
            />
          </label>
        </Card>

        <Card>
          <label
            htmlFor="ai-ward-context"
            className="flex flex-col gap-1 text-sm font-medium text-foreground"
          >
            Ward context
            <span className="text-xs font-normal text-muted">
              Who this ward is. Circumstances a draft should be aware of.
            </span>
            <textarea
              id="ai-ward-context"
              rows={5}
              value={draft.wardContext}
              disabled={readOnly}
              onChange={(event) => update("wardContext", event.target.value)}
              className={TEXTAREA_CLASSES}
            />
          </label>
        </Card>

        <Card>
          <label
            htmlFor="ai-thank-you"
            className="flex flex-col gap-1 text-sm font-medium text-foreground"
          >
            Thank you preferences
            <span className="text-xs font-normal text-muted">
              How a thank-you message after a talk should read.
            </span>
            <textarea
              id="ai-thank-you"
              rows={3}
              value={draft.thankYouPreferences}
              disabled={readOnly}
              onChange={(event) => update("thankYouPreferences", event.target.value)}
              className={TEXTAREA_CLASSES}
            />
          </label>
        </Card>

        <FormError message={formError} />

        {savedNote && (
          <p role="status" className="text-sm text-muted">
            {savedNote}
          </p>
        )}

        {canManage && (
          <Button type="submit" disabled={isSaving}>
            {isSaving ? "Saving…" : "Save as a new version"}
          </Button>
        )}
      </form>

      {canManage && <PreviewPanel draft={toDraftInput(draft)} />}
    </div>
  );
}
