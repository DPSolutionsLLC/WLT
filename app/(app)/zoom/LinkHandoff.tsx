"use client";

import { useState, useSyncExternalStore } from "react";
import { SmsHandoff } from "@/components/assignments/SmsHandoff";
import { Button } from "@/components/ui/Button";
import { FormError } from "@/components/ui/FormError";
import { buildJoinLinkMessage } from "@/lib/zoom/joinLinkMessage";
import { joinLinkQrDataUri } from "@/lib/zoom/joinLinkQr";

// HANDING SOMEBODY THEIR OWN ZOOM LINK (ITER-053, z2b): Text it, Share, or Show QR code.
//
// The URL lives only in this component's props and state. It is never logged, never stored in the
// browser, and never written anywhere by this app — the leader's own phone sends it.

type Mode = "text" | "qr" | null;

function subscribeToNothing(): () => void {
  return () => {};
}

function readCanShare(): boolean {
  return typeof navigator !== "undefined" && typeof navigator.share === "function";
}

function readServerCanShare(): boolean {
  return false;
}

function isAbort(error: unknown): boolean {
  return error instanceof DOMException && error.name === "AbortError";
}

export type LinkHandoffProps = {
  displayName: string;
  phone: string | null;
  wardName: string | null;
  joinUrl: string;
};

export function LinkHandoff({ displayName, phone, wardName, joinUrl }: LinkHandoffProps) {
  const [mode, setMode] = useState<Mode>(null);
  const [qrDataUri, setQrDataUri] = useState<string | null>(null);
  const [error, setError] = useState<string | undefined>();

  // Read through useSyncExternalStore so the server render (no navigator) and the first client
  // render agree, and Share appears only where the browser can actually share.
  const canShare = useSyncExternalStore(subscribeToNothing, readCanShare, readServerCanShare);

  const message = buildJoinLinkMessage({ displayName, wardName, joinUrl });

  async function share() {
    setError(undefined);
    try {
      await navigator.share({ text: message });
    } catch (caught) {
      if (isAbort(caught)) return;
      console.error("Could not open the share sheet for a Zoom link", caught);
      setError("This phone would not open its share sheet. Use Text it or Show QR code instead.");
    }
  }

  async function showQr() {
    setError(undefined);
    setMode("qr");
    if (qrDataUri) return;
    try {
      setQrDataUri(await joinLinkQrDataUri(joinUrl));
    } catch (caught) {
      console.error("Could not draw a QR code for a Zoom link", caught);
      setError("Could not draw the QR code. Use Text it instead.");
    }
  }

  const buttonClass = "flex-1 basis-0";

  return (
    <div className="flex flex-col gap-3">
      <div className="flex gap-2">
        <Button
          className={buttonClass}
          variant={mode === "text" ? "primary" : "secondary"}
          aria-pressed={mode === "text"}
          onClick={() => {
            setError(undefined);
            setMode("text");
          }}
        >
          Text it
        </Button>
        {canShare ? (
          <Button className={buttonClass} variant="secondary" onClick={() => void share()}>
            Share
          </Button>
        ) : null}
        <Button
          className={buttonClass}
          variant={mode === "qr" ? "primary" : "secondary"}
          aria-pressed={mode === "qr"}
          onClick={() => void showQr()}
        >
          Show QR code
        </Button>
      </div>

      <FormError message={error} />

      {mode === "text" ? <SmsHandoff phone={phone} body={message} subject="person" /> : null}

      {mode === "qr" && qrDataUri ? (
        <figure className="flex flex-col items-center gap-2">
          {/* A data URI drawn in the browser; next/image adds nothing for it. */}
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={qrDataUri}
            alt={`QR code for ${displayName}'s Zoom link`}
            width={280}
            height={280}
            className="h-auto w-full max-w-[280px] rounded-md bg-white"
          />
          <figcaption className="text-center text-sm text-muted">
            Have them scan this with their phone camera.
          </figcaption>
        </figure>
      ) : null}
    </div>
  );
}
