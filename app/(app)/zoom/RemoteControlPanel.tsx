import { Video } from "lucide-react";
import { Card } from "@/components/ui/Card";
import type { RemoteLinkOwnState } from "@/lib/zoom/remoteLinks";

// THE READER'S OWN STREAM REMOTE (ITER-051). This component is never given the link: the button
// points at GET /api/zoom/remote-control, which redirects to it, so the URL appears nowhere in the
// page's HTML. No "use client": no state, no handlers.

export type RemoteControlPanelProps = {
  state: RemoteLinkOwnState;
  // The redirect came back with `?remote=none`: the link went away between page load and press.
  linkWentAway?: boolean;
};

// The Button primitive's primary classes, on an <a>. A link opening a new tab is an anchor, not a
// button with an onClick.
const LINK_BUTTON_CLASSES =
  "inline-flex min-h-14 w-full items-center justify-center gap-3 rounded-md px-6 py-3 " +
  "text-lg font-semibold transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 " +
  "focus-visible:outline-primary bg-primary text-primary-foreground hover:opacity-90 sm:w-auto";

function Message({ children }: { children: string }) {
  return <p className="text-base text-muted">{children}</p>;
}

export function RemoteControlPanel({ state, linkWentAway = false }: RemoteControlPanelProps) {
  return (
    <Card>
      <div className="flex flex-col gap-3">
        {linkWentAway && state === "none" ? (
          <Message>That link is no longer set. Ask the bishopric for a new one.</Message>
        ) : state === "live" ? (
          <>
            <a
              href="/api/zoom/remote-control"
              target="_blank"
              rel="noopener noreferrer"
              className={LINK_BUTTON_CLASSES}
            >
              <Video aria-hidden="true" className="size-6" />
              Remote control
            </a>
            <p className="text-sm text-muted">Opens your stream remote in a new tab.</p>
          </>
        ) : state === "none" ? (
          <Message>No remote link set — ask the bishopric.</Message>
        ) : (
          <Message>Your calling has no stream remote.</Message>
        )}
      </div>
    </Card>
  );
}
