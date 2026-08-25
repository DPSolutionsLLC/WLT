"use client";

import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { AiEditPanel } from "@/app/(app)/program/[sunday_id]/AiEditPanel";
import { MeetingOrderForm, SNAPSHOT_NOTE } from "@/app/(app)/program/[sunday_id]/MeetingOrderForm";
import { MissingPanel } from "@/app/(app)/program/[sunday_id]/MissingPanel";
import { RefreshButton } from "@/app/(app)/program/[sunday_id]/RefreshButton";
import { PENDING_LINE_NOTE, ProgramPreview } from "@/components/program/ProgramPreview";
import { ProgramStatusBadge } from "@/components/program/ProgramStatusBadge";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { FormError } from "@/components/ui/FormError";
import { programDraftSchema, type ProgramDraft } from "@/lib/program/draft";
import { missingItems } from "@/lib/program/missingMessages";
import { messageFromPayload, readJsonPayload } from "@/lib/program/requests";
import type { ProgramStatus } from "@/types/domain";

// The editor shell: the draft on screen, the cache behind it, and the four things that can
// change it — typing, a refresh, an AI edit, and reloading from the server.
//
// ---------------------------------------------------------------------------------------------
// THE ai-a TRAP, WHICH IS THE MOST LIKELY BUG ON THIS SCREEN
// ---------------------------------------------------------------------------------------------
// router.refresh() PRESERVES CLIENT STATE. Restoring a settings version left the form holding
// the old values while every server-side test passed, because the server was right and the form
// was never told (plans/retros/ai-a-settings-and-preview.md).
//
// This screen has exactly that shape twice over — applying a refresh, and applying an AI edit —
// so neither of them refreshes. applyDraft() REPLACES the form state from the draft it is given
// and writes the same draft into the cache, and tests/components/program/ProgramBuilder.test.tsx
// asserts it on the RENDERED INPUT VALUES rather than on a refetch call, because a refetch call
// is exactly what passed while the bug was live.
//
// ---------------------------------------------------------------------------------------------
// SAVING SENDS THE WHOLE DRAFT
// ---------------------------------------------------------------------------------------------
// A partial patch of a snapshot is ambiguous about the fields it omits: unchanged, or
// deliberately cleared? Both readings are defensible, which is why updateProgramSchema does not
// permit the question (lib/validation/program.ts).
//
// ---------------------------------------------------------------------------------------------
// `missing` IS PART OF THE SNAPSHOT AND IS NOT RECOMPUTED HERE
// ---------------------------------------------------------------------------------------------
// It moves when a refresh or an AI edit brings a new draft, not while somebody types. That is
// program-a's rule — recomputing it on the client would make the snapshot a live view through
// the back door — and it means a field filled in by hand keeps its line in the missing panel
// until the next refresh. Said out loud under the panel rather than left to be discovered.

export const PROGRAM_QUERY_KEY = "program";

export const SAVED_NOTE = "Saved.";

export const REFRESH_APPLIED_NOTE = "The program now matches the current speakers and prayers.";

// NOT "Saved". The AI edit route writes nothing, and this apply only changed what is on screen —
// saying otherwise would be the lie CLAUDE.md rule 3 exists to prevent.
export const AI_APPLIED_NOTE = "The change is on the program. Save it to keep it.";

export const MISSING_IS_A_SNAPSHOT =
  "This list moves when you check for changes. A field you fill in here keeps its line until " +
  "then.";

export const SUBMIT_WITH_GAPS =
  "This program still has gaps. You can send it for approval anyway — the bishopric will see " +
  "the same list.";

type ProgramState = {
  status: ProgramStatus;
  draft: ProgramDraft;
};

export type ProgramBuilderProps = {
  sundayId: string;
  sundayLabel: string;
  programId: string;
  initialStatus: ProgramStatus;
  initialDraft: ProgramDraft;
  canBuild: boolean;
};

function isLocked(status: ProgramStatus): boolean {
  return status === "approved" || status === "distributed";
}

async function fetchProgram(sundayId: string): Promise<ProgramState> {
  const response = await fetch(`/api/programs/by-sunday/${sundayId}`);
  const payload = await readJsonPayload(response);

  if (!response.ok) {
    throw new Error(messageFromPayload(payload, "Could not load this program."));
  }

  const program = payload.program as
    | { status: ProgramStatus; draft: ProgramDraft | null; draftError: string | null }
    | undefined;

  // draftError is surfaced rather than swallowed (CLAUDE.md rule 7). A stored draft that no
  // longer parses is unusable, and an empty editor would look like it was never written.
  if (!program?.draft) {
    throw new Error(
      program?.draftError ?? "This program has no draft yet. Build it before editing it.",
    );
  }

  return { status: program.status, draft: program.draft };
}

export function ProgramBuilder({
  sundayId,
  sundayLabel,
  programId,
  initialStatus,
  initialDraft,
  canBuild,
}: ProgramBuilderProps) {
  const queryClient = useQueryClient();

  // Seeded from the server render so the first paint has data, then owned by the cache. Not
  // memoised: TanStack Query hashes the key structurally, so a fresh object each render is the
  // same key (plans/retros/roster-b-picker-and-orgs.md).
  const programQuery = useQuery({
    queryKey: [PROGRAM_QUERY_KEY, sundayId],
    queryFn: () => fetchProgram(sundayId),
    initialData: { status: initialStatus, draft: initialDraft },
  });

  // THE FORM STATE. Separate from the cache on purpose: the cache holds what the server last
  // said, and this holds what is on screen including edits nobody has saved.
  //
  // Only the DRAFT is held here. The status is the server's to know — it changes by approval,
  // which happens on somebody else's screen — so it is read from the cache and never mirrored
  // into a second piece of state that could disagree with it.
  const [draft, setDraft] = useState<ProgramDraft>(initialDraft);
  const status = programQuery.data.status;

  const [isSaving, setIsSaving] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isReopening, setIsReopening] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string>();
  const [note, setNote] = useState<string>();

  const locked = isLocked(status);
  const disabled = !canBuild || locked;
  const gaps = missingItems(draft);

  // The ai-a fix, in one place both callers go through. It REPLACES the form state — it does not
  // refetch and hope, and it does not router.refresh().
  //
  // `note` differs by caller because the two are genuinely different: a refresh has ALREADY been
  // written by its route, and an AI edit has not been written by anything. Saying "Saved" after
  // an AI apply would be a lie of exactly the kind rule 3 exists to prevent.
  async function applyDraft(next: ProgramDraft, applied: string): Promise<void> {
    setDraft(next);
    setErrorMessage(undefined);
    setNote(applied);

    // Cancelled FIRST. A refetch already in flight resolves with what the server said before
    // this change and would overwrite the cache a moment after we write it — the ai-a failure in
    // another costume: stale data winning over fresh, with no error anywhere to show for it.
    await queryClient.cancelQueries({ queryKey: [PROGRAM_QUERY_KEY, sundayId] });

    queryClient.setQueryData<ProgramState>([PROGRAM_QUERY_KEY, sundayId], (current) => ({
      status: current?.status ?? initialStatus,
      draft: next,
    }));
  }

  async function save(): Promise<void> {
    setErrorMessage(undefined);
    setNote(undefined);

    // The SAME schema the route validates with. One schema, both sides (CLAUDE.md §6) — a form
    // that could produce a body the route refuses is a form that reports the refusal as a
    // server error.
    const parsed = programDraftSchema.safeParse(draft);
    if (!parsed.success) {
      setErrorMessage(
        parsed.error.issues[0]?.message ?? "Check the program and try again.",
      );
      return;
    }

    setIsSaving(true);

    try {
      const response = await fetch("/api/programs", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "save", programId, draft: parsed.data }),
      });

      const payload = await readJsonPayload(response);

      if (!response.ok) {
        setErrorMessage(
          messageFromPayload(payload, "Could not save that program. Please try again."),
        );
        return;
      }

      setNote(SAVED_NOTE);

      await queryClient.cancelQueries({ queryKey: [PROGRAM_QUERY_KEY, sundayId] });

      queryClient.setQueryData<ProgramState>([PROGRAM_QUERY_KEY, sundayId], {
        status,
        draft: parsed.data,
      });
    } catch (error) {
      console.error("Could not save a program", error);
      setErrorMessage("Could not reach the server. Check your connection and try again.");
    } finally {
      setIsSaving(false);
    }
  }

  // Visible to anyone holding program.build, so a bishopric member can do it themselves when the
  // secretary is away — and the secretary can do everything except approve.
  async function submitForApproval(): Promise<void> {
    setErrorMessage(undefined);
    setNote(undefined);
    setIsSubmitting(true);

    try {
      const response = await fetch("/api/programs", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "status",
          programId,
          to: "pending_approval",
        }),
      });

      const payload = await readJsonPayload(response);

      if (!response.ok) {
        setErrorMessage(
          messageFromPayload(payload, "Could not send that program for approval."),
        );
        return;
      }

      const program = payload.program as { status?: ProgramStatus } | undefined;
      const next = program?.status ?? "pending_approval";

      // Same cancel-then-write as applyDraft, for the same reason.
      await queryClient.cancelQueries({ queryKey: [PROGRAM_QUERY_KEY, sundayId] });

      queryClient.setQueryData<ProgramState>([PROGRAM_QUERY_KEY, sundayId], {
        status: next,
        draft,
      });
      // NOT "the bishopric has been notified". emitNotification is fire-and-forget and returns
      // silently when a trigger key is unknown, so this screen cannot know whether anybody was
      // notified — and walking scenario 031 caught it claiming so while zero rows were written.
      // Say the thing this button actually did.
      setNote("Sent for approval.");
    } catch (error) {
      console.error("Could not submit a program for approval", error);
      setErrorMessage("Could not reach the server. Check your connection and try again.");
    } finally {
      setIsSubmitting(false);
    }
  }

  // Reopening an APPROVED program as a draft.
  //
  // The screen has said "Reopen it as a draft to change it" since program-b, and until now there
  // was no button to do it with: the sentence rendered inside the locked branch while every action
  // sat inside `!locked`, so the instruction appeared exactly where the control did not. Walking
  // scenario 033 found it. A sentence telling somebody to do something the app gives them no way
  // to do is worse than no sentence.
  //
  // ONLY from `approved`. There is no path out of `distributed` — LEGAL_TRANSITIONS in
  // lib/program/queries.ts gives it none, because a PDF that has been emailed cannot be recalled.
  // The route would answer 409 and a button that is always refused should not be drawn.
  //
  // This also clears programs.public_data in the same UPDATE that moves the status, so the public
  // page goes dark rather than serving a projection of a program somebody is midway through
  // changing (setProgramStatus). The note below says so, because "reopen" does not sound like
  // "unpublish" and a bishopric member deserves to know it did both.
  async function reopenAsDraft(): Promise<void> {
    setErrorMessage(undefined);
    setNote(undefined);
    setIsReopening(true);

    try {
      const response = await fetch("/api/programs", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "status", programId, to: "draft" }),
      });

      const payload = await readJsonPayload(response);

      if (!response.ok) {
        setErrorMessage(messageFromPayload(payload, "Could not reopen that program."));
        return;
      }

      const program = payload.program as { status?: ProgramStatus } | undefined;
      const next = program?.status ?? "draft";

      // Same cancel-then-write as applyDraft and submitForApproval. A cache write can be
      // overwritten by a refetch already in flight (walking scenario 031).
      await queryClient.cancelQueries({ queryKey: [PROGRAM_QUERY_KEY, sundayId] });

      queryClient.setQueryData<ProgramState>([PROGRAM_QUERY_KEY, sundayId], {
        status: next,
        draft,
      });

      setNote("Reopened as a draft. It is no longer on the public page.");
    } catch (error) {
      console.error("Could not reopen a program", error);
      setErrorMessage("Could not reach the server. Check your connection and try again.");
    } finally {
      setIsReopening(false);
    }
  }

  const loadError =
    programQuery.error instanceof Error ? programQuery.error.message : undefined;

  return (
    <div className="flex flex-col gap-4 lg:flex-row lg:items-start">
      {/* One long column on a phone; the editor beside its panels from lg up. The meeting order
          does not become a table at any width — it is a list of fields read top to bottom. */}
      <div className="flex min-w-0 flex-1 flex-col gap-4">
        <Card>
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h2 className="text-base font-semibold text-foreground">Meeting order</h2>
            <ProgramStatusBadge status={status} />
          </div>

          <p className="mt-2 text-sm text-muted">{SNAPSHOT_NOTE}</p>

          {/* Two different sentences, because the two locked states are not the same. An approved
              program can be reopened and there is now a button below to do it. A DISTRIBUTED one
              cannot: LEGAL_TRANSITIONS gives it no path out, because the PDF has already been
              emailed and cannot be recalled. Saying "reopen it" there would be an instruction
              nobody can follow. */}
          {status === "approved" && (
            <p className="mt-2 text-sm text-muted">
              This program is approved. Reopen it as a draft to change it — that also takes it
              off the public page until it is approved and distributed again.
            </p>
          )}

          {status === "distributed" && (
            <p className="mt-2 text-sm text-muted">
              This program has been distributed and cannot be reopened. The PDF has already gone
              out; build the next Sunday&rsquo;s program instead.
            </p>
          )}

          {!canBuild && !locked && (
            <p className="mt-2 text-sm text-muted">
              You can read this program. A member of the bishopric or the ward secretary edits
              it.
            </p>
          )}

          <div className="mt-4">
            <MeetingOrderForm draft={draft} onChange={setDraft} disabled={disabled} />
          </div>

          <div className="mt-6 flex flex-col gap-2 border-t border-border pt-4">
            {loadError && <FormError message={loadError} />}
            <FormError message={errorMessage} />
            {note && <p className="text-sm text-success">{note}</p>}

            {canBuild && !locked && (
              <div className="flex flex-col gap-2 sm:flex-row">
                <Button type="button" disabled={isSaving} onClick={() => void save()}>
                  {isSaving ? "Saving…" : "Save the program"}
                </Button>

                {status === "draft" && (
                  <Button
                    type="button"
                    variant="secondary"
                    disabled={isSubmitting}
                    onClick={() => void submitForApproval()}
                  >
                    {isSubmitting ? "Sending…" : "Send for approval"}
                  </Button>
                )}
              </div>
            )}

            {/* The control the sentence above refers to. Held behind program.build, the same
                permission as Save and Send for approval — a ward secretary can reopen a program
                the bishopric approved, which is deliberate: they are the one who edits it. */}
            {canBuild && status === "approved" && (
              <div className="flex flex-col gap-2 sm:flex-row">
                <Button
                  type="button"
                  variant="secondary"
                  disabled={isReopening}
                  onClick={() => void reopenAsDraft()}
                >
                  {isReopening ? "Reopening…" : "Reopen as a draft"}
                </Button>
              </div>
            )}

            {/* A warning, never a block. A program with gaps is the normal Thursday state, and
                refusing to submit it would make the feature unusable in the week it is used. */}
            {canBuild && !locked && status === "draft" && gaps.length > 0 && (
              <p className="text-sm text-muted">{SUBMIT_WITH_GAPS}</p>
            )}
          </div>
        </Card>

        <Card>
          <h2 className="text-base font-semibold text-foreground">Preview</h2>
          <p className="mt-1 text-sm text-muted">
            The meeting order in reading order. The printed layout comes with the PDF.{" "}
            {PENDING_LINE_NOTE}
          </p>
          <div className="mt-4">
            <ProgramPreview draft={draft} />
          </div>
        </Card>
      </div>

      <div className="flex w-full flex-col gap-4 lg:max-w-sm">
        <div className="flex flex-col gap-2">
          <MissingPanel draft={draft} />
          <p className="px-1 text-sm text-muted">{MISSING_IS_A_SNAPSHOT}</p>
        </div>

        {/* HIDDEN, not disabled, once the program is approved or distributed. Both routes refuse
            it with a 409, and a UI should not offer a thing it knows will be refused. */}
        {canBuild && !locked && (
          <>
            <Card>
              <h2 className="text-base font-semibold text-foreground">
                Check for changes
              </h2>
              <div className="mt-3">
                <RefreshButton
                  programId={programId}
                  onApplied={(next) => void applyDraft(next, REFRESH_APPLIED_NOTE)}
                  disabled={disabled}
                />
              </div>
            </Card>

            <Card>
              <h2 className="text-base font-semibold text-foreground">
                Change it by describing it
              </h2>
              <p className="mt-1 text-sm text-muted">
                For {sundayLabel}.
              </p>
              <div className="mt-3">
                <AiEditPanel
                  programId={programId}
                  draft={draft}
                  onApply={(next) => void applyDraft(next, AI_APPLIED_NOTE)}
                  disabled={disabled}
                />
              </div>
            </Card>
          </>
        )}
      </div>
    </div>
  );
}
