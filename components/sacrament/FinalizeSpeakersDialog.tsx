"use client";

import { useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/Button";
import { FormError } from "@/components/ui/FormError";
import { Modal } from "@/components/ui/Modal";
import type { PeopleKind } from "@/lib/calendar/queries";

// THE CONFIRM BEFORE FINALIZING OR UN-FINALIZING A SUNDAY'S SPEAKERS — ITER-036.
//
// AND ITS PRAYERS (ITER-036 fb). `kind` picks the route — speakers-finalized or prayers-finalized,
// which answer the same GET and PATCH — and the words. Generalized the second time it was needed
// rather than copied, so the two confirms cannot drift apart.
//
// Opened from the hub's Talks tab and from the Topics screen's panel. It reads
// GET /api/sundays/[id]/speakers-finalized first, so it can say:
//   - FINALIZE: whose To Do the asks go to, by name when that is somebody else (D6), and how many;
//   - UN-FINALIZE: that asks only on To Do are removed (D3), and who is already scheduled or has
//     accepted (D4) — built on the server, which formats the time in the ward's zone (rule 12).
//
// BUSY UNTIL THE REFRESH LANDS (defect 078-D1). The PATCH returns before the re-rendered page, so
// the refresh runs in a transition and the dialog stays "Saving…" until it is done, then closes.

type Preview = {
  hasConductor: boolean;
  conductorIsYou: boolean;
  conductorName: string | null;
  toAsk: number;
  unfinalizeWarning: string | null;
};

export type FinalizeSpeakersMode = "finalize" | "unfinalize";

// The words that differ between the two kinds. Everything else is one sentence for both.
const WORDS: Record<PeopleKind, { noun: string; askLine: string; loadError: string }> = {
  speakers: {
    noun: "speakers",
    askLine: "Each one not yet asked gets an \u201cAsk ___ to speak\u201d on To Do.",
    loadError: "Could not load this Sunday's speakers. Please try again.",
  },
  prayers: {
    noun: "prayers",
    askLine:
      "Each person not yet asked gets an \u201cAsk ___ to give the opening (or closing) prayer\u201d on To Do.",
    loadError: "Could not load this Sunday's prayers. Please try again.",
  },
};

export type FinalizeSpeakersDialogProps = {
  kind: PeopleKind;
  sundayId: string;
  sundayLabel: string;
  mode: FinalizeSpeakersMode;
  onClose: () => void;
};

function finalizeSentence(preview: Preview): string {
  if (!preview.hasConductor) {
    return "Nobody is conducting this Sunday yet. Choose who conducts first — the asks go to them.";
  }
  const where = preview.conductorIsYou
    ? "your To Do"
    : `${preview.conductorName ?? "the conductor"}'s To Do`;
  if (preview.toAsk === 0) return `Everyone has already been asked. Asks go to ${where}.`;
  const asks = preview.toAsk === 1 ? "The ask goes" : `The ${preview.toAsk} asks go`;
  return `${asks} to ${where}.`;
}

export function FinalizeSpeakersDialog({
  kind,
  sundayId,
  sundayLabel,
  mode,
  onClose,
}: FinalizeSpeakersDialogProps) {
  const words = WORDS[kind];
  const route = `/api/sundays/${sundayId}/${kind}-finalized`;
  const router = useRouter();
  const [preview, setPreview] = useState<Preview | null>(null);
  const [errorMessage, setErrorMessage] = useState<string>();
  const [isSaving, setIsSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [isRefreshing, startRefresh] = useTransition();
  const isBusy = isSaving || isRefreshing || saved;

  useEffect(() => {
    let cancelled = false;
    async function load(): Promise<void> {
      try {
        const response = await fetch(route);
        const payload = (await response.json().catch(() => ({}))) as Partial<Preview> & {
          error?: string;
        };
        if (cancelled) return;
        if (!response.ok) {
          setErrorMessage(payload.error ?? words.loadError);
          return;
        }
        setPreview({
          hasConductor: payload.hasConductor === true,
          conductorIsYou: payload.conductorIsYou === true,
          conductorName: payload.conductorName ?? null,
          toAsk: payload.toAsk ?? 0,
          unfinalizeWarning: payload.unfinalizeWarning ?? null,
        });
      } catch (error) {
        console.error("Could not load the finalize preview", { kind, sundayId, error });
        if (!cancelled) {
          setErrorMessage("Could not reach the server. Check your connection and try again.");
        }
      }
    }
    void load();
    return () => {
      cancelled = true;
    };
  }, [route, words.loadError, kind, sundayId]);

  useEffect(() => {
    if (saved && !isRefreshing) onClose();
  }, [saved, isRefreshing, onClose]);

  async function confirm(): Promise<void> {
    setErrorMessage(undefined);
    setIsSaving(true);
    try {
      const response = await fetch(route, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ finalized: mode === "finalize" }),
      });
      if (!response.ok) {
        const payload: { error?: string } = await response.json().catch(() => ({}));
        setErrorMessage(payload.error ?? "Could not save that. Please try again.");
        startRefresh(() => router.refresh());
        return;
      }
      setSaved(true);
      startRefresh(() => router.refresh());
    } catch (error) {
      console.error("Could not save the finalize", { kind, sundayId, mode, error });
      setErrorMessage("Could not reach the server. Check your connection and try again.");
    } finally {
      setIsSaving(false);
    }
  }

  const title =
    mode === "finalize"
      ? `Finalize ${words.noun} — ${sundayLabel}`
      : `Un-finalize ${words.noun} — ${sundayLabel}`;
  const canConfirm =
    preview !== null && (mode === "unfinalize" || preview.hasConductor) && !isBusy;

  return (
    <Modal isOpen onClose={isBusy ? () => undefined : onClose} title={title}>
      <div className="flex flex-col gap-3">
        {preview === null && errorMessage === undefined && (
          <p className="text-sm text-muted">Loading…</p>
        )}

        {preview !== null && mode === "finalize" && (
          <>
            <p className="text-sm text-foreground">
              Finalize when you&rsquo;ve prayed about these {words.noun} and decided.{" "}
              {words.askLine}
            </p>
            <p className="text-sm font-medium text-foreground">{finalizeSentence(preview)}</p>
          </>
        )}

        {preview !== null && mode === "unfinalize" && (
          <>
            <p className="text-sm text-foreground">
              Asks that are only on To Do are removed — deleted if nobody has worked on them yet,
              closed if they have.
            </p>
            {preview.unfinalizeWarning !== null && (
              <p role="status" className="text-sm text-warning">
                {preview.unfinalizeWarning}
              </p>
            )}
          </>
        )}

        <FormError message={errorMessage} />

        <div className="flex flex-col gap-2 sm:flex-row sm:justify-end">
          <Button type="button" variant="secondary" onClick={onClose} disabled={isBusy}>
            Cancel
          </Button>
          <Button type="button" onClick={() => void confirm()} disabled={!canConfirm}>
            {isBusy ? "Saving…" : mode === "finalize" ? `Finalize ${words.noun}` : "Un-finalize"}
          </Button>
        </div>
      </div>
    </Modal>
  );
}
