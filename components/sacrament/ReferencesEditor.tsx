"use client";

import { useId, useState, type ReactNode } from "react";
import Link from "next/link";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Search, Plus, X } from "lucide-react";
import { ManualReferenceDialog } from "@/components/sacrament/ManualReferenceDialog";
import { ReferenceSearchDialog } from "@/components/sacrament/ReferenceSearchDialog";
import { talkHeading, type NewReference } from "@/components/sacrament/referenceShared";
import { Button } from "@/components/ui/Button";
import { Chip } from "@/components/ui/Chip";
import { FormError } from "@/components/ui/FormError";
import {
  REFERENCE_KIND_LABELS,
  type ReferencesDecision,
  type ReferencesTalk,
  type SundayReferences,
  type TalkReference,
} from "@/types/domain";

// THE REFERENCES MODAL'S BODY — p4-sacrament-c. The prototype's `ReferencesModal`, over WLT's
// semantic retrieval instead of its keyword match.
//
// ---------------------------------------------------------------------------
// THE PAGE SHOWS WHAT WAS CHOSEN; THE CHOOSING HAPPENS IN ITS OWN WINDOW
// ---------------------------------------------------------------------------
// Decided with the user walking scenario 074: a search box and a manual row under every talk made
// the modal "busy and messy". Each talk now carries two buttons on its title row — Search, which
// opens ReferenceSearchDialog already searching the topic (and lets the words be changed), and
// Add manually, which opens ManualReferenceDialog. What remains here is the list itself.
//
// NOTHING IS CHOSEN FOR ANYBODY. Search returns real passages from the loaded scriptures and
// conference talks; a person ticks the ones they want (CLAUDE.md rule 3).
//
// BISHOPRIC ONLY (migration 080). The route refuses everybody else and the pill is not rendered
// for them, so there is no read-only mode to maintain.
//
// AFTER EVERY WRITE: refetch this modal's data AND call onChanged(), which refreshes the hub, so
// the pill and its checkmark behind the modal move with it (ITER-022's two-numbers-one-state).

export const SUNDAY_REFERENCES_QUERY_KEY = "sunday-references";

export type ReferencesEditorProps = {
  sundayId: string;
  onChanged: () => void;
};

// The server refuses this too (PATCH /api/sundays/[id]/references-decision, defect 074-D1).
export const REMOVE_BEFORE_SKIP = "Remove the references first to skip this Sunday.";

// `free` is the search above all the talks: no topic, empty words, and an "Add to" picker.
type OpenDialog =
  | { kind: "search"; talk: ReferencesTalk; free: boolean }
  | { kind: "manual"; talk: ReferencesTalk }
  | null;

async function readJson(response: Response): Promise<Record<string, unknown>> {
  try {
    return (await response.json()) as Record<string, unknown>;
  } catch {
    throw new Error("The server sent a response this page could not read.");
  }
}

async function fetchSundayReferences(sundayId: string): Promise<SundayReferences> {
  const response = await fetch(`/api/sundays/${sundayId}/references`);
  const payload = await readJson(response);

  if (!response.ok) {
    throw new Error(
      typeof payload.error === "string"
        ? payload.error
        : "Could not load this Sunday's references.",
    );
  }

  return payload as unknown as SundayReferences;
}

function pluralReferences(count: number): string {
  return `${count} ${count === 1 ? "reference" : "references"}`;
}

export function ReferencesEditor({ sundayId, onChanged }: ReferencesEditorProps) {
  const queryClient = useQueryClient();
  const [isSaving, setIsSaving] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string>();
  const [openDialog, setOpenDialog] = useState<OpenDialog>(null);
  const skipId = useId();
  const skipHintId = useId();

  const referencesQuery = useQuery({
    queryKey: [SUNDAY_REFERENCES_QUERY_KEY, sundayId],
    queryFn: () => fetchSundayReferences(sundayId),
  });

  async function refresh(): Promise<void> {
    await queryClient.invalidateQueries({ queryKey: [SUNDAY_REFERENCES_QUERY_KEY, sundayId] });
    onChanged();
  }

  // Returns the server's sentence on failure, or null on success, so a dialog can show the error
  // in place and stay open.
  async function request(call: () => Promise<Response>, fallback: string): Promise<string | null> {
    try {
      const response = await call();
      const payload = await readJson(response);
      if (!response.ok) return typeof payload.error === "string" ? payload.error : fallback;
      return null;
    } catch (error) {
      // Never swallowed: a failed save that looks like a successful one is worse than an error
      // (CLAUDE.md rule 7).
      return error instanceof Error ? error.message : fallback;
    }
  }

  // ONE AT A TIME, stopping at the first refusal, then ONE refresh. The rows that did save are
  // real and stay; the sentence says which one failed.
  async function addReferences(inputs: readonly NewReference[]): Promise<string | null> {
    setIsSaving(true);
    try {
      for (const input of inputs) {
        const failure = await request(
          () =>
            fetch(`/api/sundays/${sundayId}/references`, {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify(input),
            }),
          "Could not add that reference.",
        );
        if (failure !== null) return `${input.citation}: ${failure}`;
      }
      return null;
    } finally {
      await refresh();
      setIsSaving(false);
    }
  }

  async function mutate(call: () => Promise<Response>, fallback: string): Promise<void> {
    setIsSaving(true);
    setErrorMessage(undefined);
    try {
      const failure = await request(call, fallback);
      if (failure !== null) setErrorMessage(failure);
      await refresh();
    } finally {
      setIsSaving(false);
    }
  }

  function removeReference(referenceId: string): Promise<void> {
    return mutate(
      () => fetch(`/api/sundays/${sundayId}/references/${referenceId}`, { method: "DELETE" }),
      "Could not remove that reference.",
    );
  }

  function decide(decision: ReferencesDecision): Promise<void> {
    return mutate(
      () =>
        fetch(`/api/sundays/${sundayId}/references-decision`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ decision }),
        }),
      "Could not save that.",
    );
  }

  if (referencesQuery.isPending) {
    return <p className="text-sm text-muted">Loading this Sunday&apos;s references…</p>;
  }

  if (referencesQuery.isError) {
    return (
      <div className="flex flex-col gap-3">
        <FormError message={referencesQuery.error.message} />
        <div>
          <Button variant="secondary" onClick={() => referencesQuery.refetch()}>
            Try again
          </Button>
        </div>
      </div>
    );
  }

  const { decision, talks, references } = referencesQuery.data;

  if (talks.length === 0) {
    return (
      <p className="text-sm text-muted">
        No topics yet. Add them on{" "}
        <Link
          href={`/assignments/${sundayId}`}
          className="text-foreground underline underline-offset-4"
        >
          this Sunday&apos;s page
        </Link>{" "}
        first.
      </p>
    );
  }

  const total = references.length;
  const skipBlocked = decision !== "skipped" && total > 0;

  const referencesFor = (talk: ReferencesTalk) =>
    references.filter((reference) => reference.assignmentId === talk.assignmentId);

  return (
    <div className="flex flex-col gap-5">
      <p className="text-sm text-muted">
        Searches the scriptures and general conference talks by meaning. Nothing is chosen for
        you: pick the ones you want, or add one yourself.
      </p>

      <FormError message={errorMessage} />

      {/* THE FREE SEARCH — decided with the user walking scenario 074: a variation on a topic, or
          a related one, without being tied to the words of any talk's topic. */}
      <div>
        <Button
          variant="secondary"
          onClick={() => setOpenDialog({ kind: "search", talk: talks[0], free: true })}
        >
          <Search aria-hidden="true" className="h-4 w-4" />
          Search any topic
        </Button>
      </div>

      {talks.map((talk) => (
        <TalkReferencesSection
          key={talk.assignmentId}
          talk={talk}
          references={referencesFor(talk)}
          isSaving={isSaving}
          onSearch={() => setOpenDialog({ kind: "search", talk, free: false })}
          onAddManually={() => setOpenDialog({ kind: "manual", talk })}
          onRemove={removeReference}
        />
      ))}

      <div className="flex flex-col gap-3 border-t border-border pt-4">
        <div className="flex flex-col gap-1">
          <label htmlFor={skipId} className="flex min-h-11 items-center gap-3 text-sm">
            <input
              id={skipId}
              type="checkbox"
              className="h-5 w-5 shrink-0"
              checked={decision === "skipped"}
              disabled={decision === "finalized" || skipBlocked || isSaving}
              aria-describedby={skipBlocked ? skipHintId : undefined}
              onChange={(event) => decide(event.target.checked ? "skipped" : null)}
            />
            <span>Not giving references this round — skip this Sunday</span>
          </label>
          {skipBlocked && (
            <p id={skipHintId} className="pl-8 text-xs text-muted">
              {REMOVE_BEFORE_SKIP}
            </p>
          )}
        </div>

        {decision === "finalized" ? (
          <div className="flex flex-wrap items-center gap-3">
            <p className="text-sm text-foreground">
              ✓ Finalized — {pluralReferences(total)} ready.
            </p>
            <Button variant="secondary" disabled={isSaving} onClick={() => decide(null)}>
              Undo
            </Button>
          </div>
        ) : decision === "skipped" ? (
          <p className="text-sm text-muted">Skipped for this Sunday — nothing to finalize.</p>
        ) : (
          <div>
            <Button disabled={isSaving || total === 0} onClick={() => decide("finalized")}>
              Finalize references
            </Button>
          </div>
        )}
      </div>

      {openDialog?.kind === "search" && (
        <ReferenceSearchDialog
          sundayId={sundayId}
          talks={talks}
          references={references}
          initialTalk={openDialog.talk}
          free={openDialog.free}
          onAdd={addReferences}
          onClose={() => setOpenDialog(null)}
        />
      )}

      {openDialog?.kind === "manual" && (
        <ManualReferenceDialog
          talk={openDialog.talk}
          onAdd={addReferences}
          onClose={() => setOpenDialog(null)}
        />
      )}
    </div>
  );
}

type TalkReferencesSectionProps = {
  talk: ReferencesTalk;
  references: TalkReference[];
  isSaving: boolean;
  onSearch: () => void;
  onAddManually: () => void;
  onRemove: (referenceId: string) => Promise<void>;
};

function TalkReferencesSection({
  talk,
  references,
  isSaving,
  onSearch,
  onAddManually,
  onRemove,
}: TalkReferencesSectionProps) {
  const headingId = useId();
  const heading = talkHeading(talk);

  return (
    <section aria-labelledby={headingId} className="flex flex-col gap-2">
      <div className="flex flex-wrap items-start justify-between gap-x-3 gap-y-1">
        <div className="min-w-0 flex-1 basis-48">
          <h3 id={headingId} className="font-display text-base font-semibold text-foreground">
            {heading}
          </h3>
          <p className="text-sm text-muted">{talk.speakerName ?? "No speaker yet"}</p>
        </div>
        <div className="flex shrink-0">
          <IconTextButton label="Search" accessibleName={`Search — ${heading}`} onClick={onSearch}>
            <Search aria-hidden="true" className="h-3.5 w-3.5" />
          </IconTextButton>
          <IconTextButton
            label="Add manually"
            accessibleName={`Add manually — ${heading}`}
            onClick={onAddManually}
          >
            <Plus aria-hidden="true" className="h-3.5 w-3.5" />
          </IconTextButton>
        </div>
      </div>

      {references.length === 0 ? (
        <p className="text-sm text-muted">No references yet.</p>
      ) : (
        <ul className="flex flex-col">
          {references.map((reference) => (
            <li key={reference.id} className="flex min-w-0 items-center gap-2">
              <Chip className="shrink-0">{REFERENCE_KIND_LABELS[reference.kind]}</Chip>
              <span className="min-w-0 flex-1 break-words text-sm text-foreground">
                {reference.citation}
              </span>
              {/* A SMALL ICON, beside the citation in every case — decided with the user walking
                  scenario 074. The glyph is small; the button is still 44×44. */}
              <button
                type="button"
                disabled={isSaving}
                onClick={() => onRemove(reference.id)}
                aria-label={`Remove ${reference.citation}`}
                className="inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-md text-muted hover:bg-surface hover:text-danger focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary disabled:opacity-60"
              >
                <X aria-hidden="true" className="h-4 w-4" />
              </button>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

function IconTextButton({
  label,
  accessibleName,
  onClick,
  children,
}: {
  label: string;
  accessibleName: string;
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    // SMALL TO SEE, 44px TO TAP — the user asked for smaller buttons. The BUTTON keeps the 44px
    // target every control in this app clears; the bordered span inside is what you see, which is
    // StatusPill's pattern (the visible pill is badge-height, the link around it is not).
    <button
      type="button"
      onClick={onClick}
      aria-label={accessibleName}
      className="group inline-flex min-h-11 items-center px-0.5 focus-visible:outline-none"
    >
      <span
        aria-hidden="true"
        className="inline-flex h-7 items-center gap-1 rounded-md border border-border px-2 text-xs font-medium text-foreground group-hover:bg-surface group-focus-visible:outline-2 group-focus-visible:outline-offset-2 group-focus-visible:outline-primary"
      >
        {children}
        {label}
      </span>
    </button>
  );
}
