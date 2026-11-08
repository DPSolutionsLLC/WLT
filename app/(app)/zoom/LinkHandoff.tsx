"use client";

import { useState, useSyncExternalStore } from "react";
import { SmsHandoff } from "@/components/assignments/SmsHandoff";
import { Button } from "@/components/ui/Button";
import { FormError } from "@/components/ui/FormError";
import { buildJoinLinkGreeting, buildJoinLinkMessage } from "@/lib/zoom/joinLinkMessage";
import { joinLinkQrDataUri } from "@/lib/zoom/joinLinkQr";

// HANDING SOMEBODY THEIR OWN ZOOM LINK (ITER-053, z2b): Text it, Share, Email it, or Show QR code.
//
// The URL lives only in this component's props and state. It is never logged, never stored in the
// browser, and never written anywhere by this app — the leader's own phone sends it. Email it is
// the exception that proves the rule: the browser sends only the invitee's id, and the server reads
// the link itself (plans/zoom-link-email-and-text.md).
//
// Text it is TWO texts when there is a number to open: a text cannot hide a link, but a text that is
// nothing but a link shows as a preview card on most phones.

type Mode = "text" | "qr" | null;

type EmailState = "idle" | "sending" | "sent";

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
  inviteeId: string;
  displayName: string;
  phone: string | null;
  email: string | null;
  wardName: string | null;
  joinUrl: string;
};

async function readError(response: Response, fallback: string): Promise<string> {
  try {
    const body = (await response.json()) as { error?: unknown };
    return typeof body.error === "string" ? body.error : fallback;
  } catch (caught) {
    console.error("Could not read the email route's error response", caught);
    return fallback;
  }
}

export function LinkHandoff({ inviteeId, displayName, phone, email, wardName, joinUrl }: LinkHandoffProps) {
  const [mode, setMode] = useState<Mode>(null);
  const [qrDataUri, setQrDataUri] = useState<string | null>(null);
  const [error, setError] = useState<string | undefined>();
  const [emailState, setEmailState] = useState<EmailState>("idle");

  // Read through useSyncExternalStore so the server render (no navigator) and the first client
  // render agree, and Share appears only where the browser can actually share.
  const canShare = useSyncExternalStore(subscribeToNothing, readCanShare, readServerCanShare);

  const message = buildJoinLinkMessage({ displayName, wardName, joinUrl });
  const greeting = buildJoinLinkGreeting({ displayName, wardName });

  async function share() {
    setError(undefined);
    try {
      await navigator.share({ text: greeting, url: joinUrl });
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

  async function sendEmail() {
    setError(undefined);
    setEmailState("sending");
    try {
      const response = await fetch(`/api/zoom/invitees/${inviteeId}/email`, { method: "POST" });
      if (!response.ok) {
        throw new Error(await readError(response, "The email could not be sent. Please try again."));
      }
      setEmailState("sent");
    } catch (caught) {
      console.error("Could not email a Zoom link", caught instanceof Error ? caught.message : caught);
      setError(caught instanceof Error ? caught.message : "The email could not be sent.");
      setEmailState("idle");
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

      <div className="flex flex-col gap-1">
        <Button
          variant="secondary"
          disabled={email === null || emailState === "sending"}
          onClick={() => void sendEmail()}
        >
          {emailState === "sending" ? "Emailing…" : emailState === "sent" ? "Email it again" : "Email it"}
        </Button>
        {email === null ? (
          <p className="text-sm text-muted">No email address on file. Add one with Edit.</p>
        ) : emailState === "sent" ? (
          <p role="status" className="text-sm text-foreground">
            Emailed to them.
          </p>
        ) : null}
      </div>

      <FormError message={error} />

      {mode === "text" && phone === null ? (
        <SmsHandoff phone={phone} body={message} subject="person" />
      ) : null}

      {mode === "text" && phone !== null ? (
        <ol className="flex flex-col gap-4">
          <li className="flex flex-col gap-2">
            <p className="text-sm font-semibold text-foreground">1. Send the greeting</p>
            <SmsHandoff phone={phone} body={greeting} subject="person" />
          </li>
          <li className="flex flex-col gap-2">
            <p className="text-sm font-semibold text-foreground">2. Then send the link on its own</p>
            <SmsHandoff phone={phone} body={joinUrl} subject="person" />
          </li>
        </ol>
      ) : null}

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
