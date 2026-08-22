"use client";

import { useState, useSyncExternalStore } from "react";
import { Button } from "@/components/ui/Button";
import { buildSmsLink } from "@/lib/assignments/smsLink";

// The `sms:` handoff and its fallback, side by side with equal weight — never the link alone.
//
// The link is dead in a desktop browser, truncates differently on every phone, and gives no
// delivery confirmation at all (CLAUDE.md §9). Copy is not a lesser option here; on half the
// devices this app runs on it is the only one that works.

export type SmsHandoffProps = {
  phone: string | null;
  body: string;
  // Whether this platform can act on an sms: link at all. Resolved by the component, but
  // overridable so a test can render both branches without a user agent.
  supportsSmsLinks?: boolean;
};

const DESKTOP_EXPLANATION =
  "This computer has no messaging app, so there is no link to tap. Copy the message and send " +
  "it from your phone.";

const TRUNCATION_WARNING =
  "This message is long enough that some phones will cut it short when it opens. Copy it and " +
  "paste it in if that happens.";

// A coarse pointer stands in for "this device has a messaging app". Read through
// useSyncExternalStore rather than into state from an effect: the server has no window, so the
// server snapshot is `false`, and React reconciles the real answer without a second render pass
// and without the hydration mismatch that reading matchMedia during render would cause.
//
// matchMedia is absent in jsdom and in older embedded browsers. Answering "no messaging app" is
// the safe fallback — it renders Copy with its explanation rather than a link that would do
// nothing when tapped.
function hasMatchMedia(): boolean {
  return typeof window !== "undefined" && typeof window.matchMedia === "function";
}

function subscribeToPointer(onChange: () => void): () => void {
  if (!hasMatchMedia()) return () => {};

  const query = window.matchMedia("(pointer: coarse)");
  query.addEventListener("change", onChange);
  return () => query.removeEventListener("change", onChange);
}

function readPointer(): boolean {
  return hasMatchMedia() ? window.matchMedia("(pointer: coarse)").matches : false;
}

function readServerPointer(): boolean {
  return false;
}

export function SmsHandoff({ phone, body, supportsSmsLinks }: SmsHandoffProps) {
  const [copied, setCopied] = useState(false);
  const [copyError, setCopyError] = useState<string>();

  const detected = useSyncExternalStore(
    subscribeToPointer,
    readPointer,
    readServerPointer,
  );

  const canOpenSms = supportsSmsLinks ?? detected;
  const { href, truncationRisk } = buildSmsLink({ phone, body });

  async function handleCopy(): Promise<void> {
    setCopyError(undefined);

    try {
      await navigator.clipboard.writeText(body);
      setCopied(true);
    } catch (error) {
      // Clipboard access is refused outright in some browsers and over plain HTTP. Saying so is
      // the only useful answer; a Copy button that silently does nothing is worse than none.
      console.error("Could not copy the message to the clipboard", error);
      setCopyError("This browser would not let the page copy. Select the message and copy it.");
    }
  }

  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-col gap-2 md:flex-row">
        {/* A null href renders NO LINK AT ALL, never a disabled-looking anchor. "There is no
            number on file for this person" and "this is broken" are different messages and only
            one of them is true (lib/assignments/smsLink.ts). */}
        {canOpenSms && href !== null && (
          <a
            href={href}
            className="inline-flex min-h-11 items-center justify-center rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:opacity-90 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
          >
            Open in Messages
          </a>
        )}

        <Button type="button" variant="secondary" onClick={() => void handleCopy()}>
          {copied ? "Copied" : "Copy message"}
        </Button>
      </div>

      {phone === null && (
        <p className="text-sm text-muted">
          There is no phone number on file for this speaker, so there is nothing to open. Copy
          the message and send it however you normally reach them.
        </p>
      )}

      {!canOpenSms && phone !== null && (
        <p className="text-sm text-muted">{DESKTOP_EXPLANATION}</p>
      )}

      {truncationRisk && <p className="text-sm text-warning">{TRUNCATION_WARNING}</p>}

      {copyError && (
        <p role="alert" className="text-sm text-danger">
          {copyError}
        </p>
      )}
    </div>
  );
}
