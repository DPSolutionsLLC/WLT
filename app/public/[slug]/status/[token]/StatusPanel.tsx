"use client";

import { useState, useSyncExternalStore } from "react";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { FormError } from "@/components/ui/FormError";
import type { ZoomRegistrationStatus } from "@/types/domain";

// What a registrant sees on their own status page (ITER-052). The join URL lives only in this
// component's props; it is never logged or stored by this page.
//
// "Share with a friend" shares the SIGN-UP page with this person's referral code (P13) — never this
// page and never the join link, which is theirs alone.

export type StatusPanelProps = {
  displayName: string;
  wardName: string;
  status: ZoomRegistrationStatus;
  linkGiven: boolean;
  joinUrl: string | null;
  // Absolute when the site URL is configured; otherwise the page builds it from its own address.
  shareUrl: string | null;
  sharePath: string;
};

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

async function copyText(text: string): Promise<void> {
  await navigator.clipboard.writeText(text);
}

function ShareWithAFriend({
  wardName,
  shareUrl,
  sharePath,
}: {
  wardName: string;
  shareUrl: string | null;
  sharePath: string;
}) {
  const canShare = useSyncExternalStore(subscribeToNothing, readCanShare, readServerCanShare);
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState<string | undefined>();

  function resolvedUrl(): string {
    return shareUrl ?? new URL(sharePath, window.location.origin).toString();
  }

  async function share() {
    setError(undefined);
    setCopied(false);
    const url = resolvedUrl();
    try {
      if (canShare) {
        await navigator.share({
          text: `You can watch ${wardName} sacrament meeting online. Ask for a link here:`,
          url,
        });
        return;
      }
      await copyText(url);
      setCopied(true);
    } catch (caught) {
      if (isAbort(caught)) return;
      console.error("Could not share the Zoom sign-up page", caught);
      setError("This phone wouldn't share the link. Copy this page's address and change it instead.");
    }
  }

  return (
    <div className="flex flex-col gap-2">
      <Button variant="secondary" onClick={() => void share()}>
        Share with a friend
      </Button>
      {copied ? (
        <p role="status" className="text-sm text-muted">
          The sign-up link is copied. Paste it in a message to a friend.
        </p>
      ) : null}
      <FormError message={error} />
    </div>
  );
}

function JoinLink({ joinUrl }: { joinUrl: string }) {
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState<string | undefined>();

  async function copy() {
    setError(undefined);
    try {
      await copyText(joinUrl);
      setCopied(true);
    } catch (caught) {
      console.error("Could not copy a Zoom join link", caught);
      setError("This phone wouldn't copy the link. Press and hold Join the stream to copy it instead.");
    }
  }

  return (
    <div className="flex flex-col gap-3">
      <a
        href={joinUrl}
        rel="noreferrer noopener"
        className={
          "inline-flex min-h-12 items-center justify-center rounded-md bg-primary px-4 py-3 text-base " +
          "font-semibold text-primary-foreground hover:opacity-90 focus-visible:outline-2 " +
          "focus-visible:outline-offset-2 focus-visible:outline-primary"
        }
      >
        Join the stream
      </a>
      <Button variant="secondary" onClick={() => void copy()}>
        {copied ? "Link copied" : "Copy link"}
      </Button>
      <FormError message={error} />
      <p className="text-sm text-foreground">
        This link is just for you — please don&apos;t share it. Use Share with a friend instead.
      </p>
    </div>
  );
}

function HomeScreenHelp() {
  return (
    <Card className="flex flex-col gap-2">
      <h2 className="text-sm font-semibold text-foreground">Keep this page handy</h2>
      <p className="text-sm text-muted">Add this page to your home screen so it&apos;s there on Sunday.</p>
      <ul className="flex list-disc flex-col gap-1 pl-5 text-sm text-muted">
        <li>iPhone: tap Share, then Add to Home Screen.</li>
        <li>Android: tap ⋮, then Add to Home screen.</li>
      </ul>
    </Card>
  );
}

function CheckAgain() {
  return (
    <Button variant="secondary" onClick={() => window.location.reload()}>
      Check again
    </Button>
  );
}

export function StatusPanel({
  displayName,
  wardName,
  status,
  linkGiven,
  joinUrl,
  shareUrl,
  sharePath,
}: StatusPanelProps) {
  const share = <ShareWithAFriend wardName={wardName} shareUrl={shareUrl} sharePath={sharePath} />;

  if (status === "declined") {
    return (
      <main className="flex flex-col gap-4">
        <h1 className="text-xl font-semibold text-foreground">{wardName} stream</h1>
        <p className="text-sm text-foreground">
          We weren&apos;t able to give you a stream link right now. Please speak with the bishop.
        </p>
      </main>
    );
  }

  if (status === "approved" && linkGiven && joinUrl) {
    return (
      <main className="flex flex-col gap-5">
        <div className="flex flex-col gap-1">
          <h1 className="text-xl font-semibold text-foreground">You&apos;re all set, {displayName}</h1>
          <p className="text-sm text-muted">Your personal link to watch {wardName} sacrament meeting.</p>
        </div>
        <JoinLink joinUrl={joinUrl} />
        <HomeScreenHelp />
        {share}
      </main>
    );
  }

  if (status === "approved") {
    return (
      <main className="flex flex-col gap-4">
        <h1 className="text-xl font-semibold text-foreground">You&apos;re approved, {displayName}</h1>
        <p className="text-sm text-foreground">Your link is on its way — check back here.</p>
        <HomeScreenHelp />
        <CheckAgain />
        {share}
      </main>
    );
  }

  return (
    <main className="flex flex-col gap-4">
      <h1 className="text-xl font-semibold text-foreground">Thanks, {displayName}</h1>
      <p className="text-sm text-foreground">
        Your request is with the bishopric. Keep this page — your link will appear here.
      </p>
      <HomeScreenHelp />
      <CheckAgain />
      {share}
    </main>
  );
}
