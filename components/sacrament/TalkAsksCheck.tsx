"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Check } from "lucide-react";
import { TALKS_LOCK_REASON_TEXT, type TalksAskState } from "@/lib/sacrament/talkAsks";

// THE TALKS PILL'S CHECK, AND SEND ASKS — Sacrament slice f1.
//
// The Topics and Refs pills each carry a finalize checkmark attached to their right edge
// (FinalizeToggle). The Talks pill carries this instead: not a toggle, because nobody "finalizes"
// talks. It is where the asks stand, computed by talksAskState() from the talks' outcomes and
// their open ask to-dos:
//   locked     dimmed, with the reason as a tooltip AND as screen-reader text
//   not_asked  "N not yet asked"
//   pending    gold, "Asks sent"
//   accepted   green, a solid fill with a check — StatusPill's measured `complete` pair
//   declined   rust, "N declined"
//
// THE TAB GEOMETRY IS FinalizeToggle's pill variant: 22px high, `rounded-l-none rounded-r-full
// border-l-0`, butted against the pill with no gap, so it reads as part of the pill
// (sacrament-topics-finalize-and-history: a free-standing circle read as unattached).
//
// DIMMED IS ALLOWED HERE AND ONLY HERE. StatusPill's rule against a dimmed pill is about a LINK
// that looks broken. This tab is a status and has no link, and the plan asks for the dim with its
// reason visible.
//
// SEND ASKS (N) is a separate small button after the tab, shown only when there are speakers to ask
// and the reader holds `talks.request`. It posts, then refreshes the page. There is no local copy
// of the state that could drift from the server's.
//
// "SENDING…" LASTS UNTIL THE REFRESH HAS LANDED (defect 078-D1). The POST returns before the
// re-rendered page arrives, and for those seconds the button read "Send asks (3)" again, enabled,
// over asks that already existed. A second press was answered with a red "Everyone on this Sunday
// has been asked." The refresh runs inside a transition, and the button stays busy while it is
// pending.

// WHOLE LITERALS, never interpolated (components/ui/Pill.tsx, rule 1).
const TAB_TONES: Record<TalksAskState["kind"], string> = {
  locked: "border-border text-muted opacity-60",
  not_asked: "border-stage-plan text-stage-plan",
  pending: "border-gold text-gold",
  accepted: "border-stage-complete bg-stage-complete text-background",
  declined: "border-rust text-rust",
};

function tabText(state: TalksAskState): string | null {
  switch (state.kind) {
    case "locked":
    case "accepted":
      return null;
    case "not_asked":
      return `${state.count} not yet asked`;
    case "pending":
      return "Asks sent";
    case "declined":
      return `${state.count} declined`;
  }
}

function spokenText(state: TalksAskState): string {
  switch (state.kind) {
    case "locked":
      return `Asks locked: ${TALKS_LOCK_REASON_TEXT[state.reason]}`;
    case "not_asked":
      return `${state.count} not yet asked`;
    case "pending":
      return "Asks sent, waiting for answers";
    case "accepted":
      return "Every speaker accepted";
    case "declined":
      return `${state.count} declined`;
  }
}

export type TalkAsksCheckProps = {
  state: TalksAskState;
  sundayId: string;
  sundayLabel: string;
  // Speakers Send asks would ask right now. Can be non-zero beside a `declined` state: a declined
  // slot with a new speaker chosen still needs its ask.
  asksToSend: number;
};

export function TalkAsksCheck({ state, sundayId, sundayLabel, asksToSend }: TalkAsksCheckProps) {
  const router = useRouter();
  const [isSending, setIsSending] = useState(false);
  const [isRefreshing, startRefresh] = useTransition();
  const isBusy = isSending || isRefreshing;
  const [errorMessage, setErrorMessage] = useState<string>();

  const text = tabText(state);
  const reason = state.kind === "locked" ? TALKS_LOCK_REASON_TEXT[state.reason] : undefined;

  async function sendAsks(): Promise<void> {
    setErrorMessage(undefined);
    setIsSending(true);

    try {
      const response = await fetch(`/api/sundays/${sundayId}/asks`, { method: "POST" });

      if (!response.ok) {
        const payload: { error?: string } = await response.json().catch(() => ({}));
        setErrorMessage(payload.error ?? "Could not send the asks. Please try again.");
        return;
      }

      startRefresh(() => router.refresh());
    } catch (error) {
      console.error("Could not send a Sunday's asks", { sundayId, error });
      setErrorMessage("Could not reach the server. Check your connection and try again.");
    } finally {
      setIsSending(false);
    }
  }

  return (
    <>
      <span className="inline-flex h-11 items-center" title={reason}>
        <span
          aria-hidden="true"
          className={`inline-flex h-[22px] items-center gap-1 rounded-l-none rounded-r-full border border-l-0 px-2 text-xs font-medium ${TAB_TONES[state.kind]}`}
        >
          {text === null ? <Check className="h-3.5 w-3.5" /> : text}
        </span>
        <span className="sr-only">
          {spokenText(state)} — {sundayLabel}
        </span>
      </span>

      {asksToSend > 0 && state.kind !== "locked" && (
        <button
          type="button"
          onClick={sendAsks}
          disabled={isBusy}
          aria-label={`Send asks to ${asksToSend} ${asksToSend === 1 ? "speaker" : "speakers"} — ${sundayLabel}`}
          className="group ml-1 inline-flex min-h-11 items-center focus-visible:outline-none disabled:opacity-60"
        >
          <span
            aria-hidden="true"
            className="inline-flex h-7 items-center rounded-md border border-border px-2 text-xs font-medium text-foreground group-hover:bg-surface group-focus-visible:outline-2 group-focus-visible:outline-offset-2 group-focus-visible:outline-primary"
          >
            {isBusy ? "Sending…" : `Send asks (${asksToSend})`}
          </span>
        </button>
      )}

      {errorMessage !== undefined && (
        <span role="alert" className="text-xs text-danger">
          {errorMessage}
        </span>
      )}
    </>
  );
}
