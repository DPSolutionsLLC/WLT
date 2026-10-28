"use client";

import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import { RemoveButton } from "@/app/(app)/todos/SmallButton";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { FormError } from "@/components/ui/FormError";
import { Modal } from "@/components/ui/Modal";
import type { PoolLink, PoolSummary } from "@/lib/zoom/joinLinkPool";
import { parseJoinLinkPaste } from "@/lib/zoom/joinLinkPaste";

// THE BISHOPRIC'S LINK POOL TAB (ITER-053). Paste placeholder links in bulk; see what is free and
// who holds the rest; ✕ removes a FREE link (a typo in a paste). A given link has no ✕ (D2).
//
// NO URL ANYWHERE ON THIS PAGE. The pool is read through the reader's own client, which cannot
// select `join_url` (migration 095). The pasted text is the only place a URL appears, and only
// while it is being pasted.
//
// Rendered straight from props and refreshed with router.refresh() after every write, because the
// panel remounts from the server's data on each tab switch.

const ARM_TIMEOUT_MS = 4000;

function plural(count: number, one: string, many: string): string {
  return `${count} ${count === 1 ? one : many}`;
}

async function readError(response: Response, fallback: string): Promise<string> {
  try {
    const parsed = (await response.json()) as { error?: unknown };
    return typeof parsed.error === "string" ? parsed.error : fallback;
  } catch {
    return "The server sent a response this page could not read.";
  }
}

type AddResult = { addedCount: number; alreadyInPool: number[]; waitingCount: number };

function describeAddResult(result: AddResult): string {
  const parts = [`Added ${plural(result.addedCount, "link", "links")}.`];
  if (result.alreadyInPool.length > 0) {
    parts.push(
      `${result.alreadyInPool.length} ${result.alreadyInPool.length === 1 ? "was" : "were"} already in the pool.`,
    );
  }
  if (result.waitingCount > 0) {
    parts.push(
      `${plural(result.waitingCount, "person is", "people are")} waiting for a link — give them one on the Invitees tab.`,
    );
  }
  return parts.join(" ");
}

export type LinkPoolPanelProps = {
  initialPool: PoolSummary;
};

export function LinkPoolPanel({ initialPool }: LinkPoolPanelProps) {
  const router = useRouter();
  const [isPasting, setIsPasting] = useState(false);
  const [resultSentence, setResultSentence] = useState<string | null>(null);

  const freeLinks = initialPool.links.filter((link) => link.heldBy === null);
  const givenLinks = initialPool.links.filter((link) => link.heldBy !== null);

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm text-foreground">
          <span className="font-semibold">{initialPool.freeCount} free</span>
          <span className="text-muted"> · {initialPool.givenCount} given</span>
        </p>
        <Button
          onClick={() => {
            setResultSentence(null);
            setIsPasting(true);
          }}
        >
          Paste links
        </Button>
      </div>

      {resultSentence ? (
        <p role="status" className="text-sm text-foreground">
          {resultSentence}
        </p>
      ) : null}

      <section className="flex flex-col gap-2" aria-labelledby="zoom-pool-free">
        <h2 id="zoom-pool-free" className="text-sm font-semibold text-foreground">
          Free
        </h2>
        {freeLinks.length === 0 ? (
          <p className="text-sm text-muted">No free links. Paste more to hand them out.</p>
        ) : (
          <ul className="flex flex-col gap-1">
            {freeLinks.map((link) => (
              <FreeLinkRow key={link.id} link={link} onRemoved={() => router.refresh()} />
            ))}
          </ul>
        )}
      </section>

      {givenLinks.length > 0 ? (
        <section className="flex flex-col gap-2" aria-labelledby="zoom-pool-given">
          <h2 id="zoom-pool-given" className="text-sm font-semibold text-foreground">
            Given
          </h2>
          <ul className="flex flex-col gap-1">
            {givenLinks.map((link) => (
              <li key={link.id}>
                <Card className="flex min-h-11 flex-wrap items-center gap-x-2 px-3 py-2">
                  <span className="text-sm text-foreground">{link.placeholderName}</span>
                  <span className="text-sm text-muted" aria-hidden="true">
                    →
                  </span>
                  <span className="sr-only">given to</span>
                  <span className="min-w-0 break-words text-sm text-foreground">
                    {link.heldBy?.displayName}
                  </span>
                </Card>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      <PasteLinksModal
        isOpen={isPasting}
        onClose={() => setIsPasting(false)}
        onAdded={(result) => {
          setIsPasting(false);
          setResultSentence(describeAddResult(result));
          router.refresh();
        }}
      />
    </div>
  );
}

function FreeLinkRow({ link, onRemoved }: { link: PoolLink; onRemoved: () => void }) {
  const [isArmed, setIsArmed] = useState(false);
  const [isRemoving, setIsRemoving] = useState(false);
  const [error, setError] = useState<string | undefined>();

  useEffect(() => {
    if (!isArmed) return;
    const timer = setTimeout(() => setIsArmed(false), ARM_TIMEOUT_MS);
    return () => clearTimeout(timer);
  }, [isArmed]);

  async function remove() {
    setIsArmed(false);
    setIsRemoving(true);
    setError(undefined);
    try {
      const response = await fetch(`/api/zoom/join-links/${link.id}`, { method: "DELETE" });
      if (!response.ok) {
        throw new Error(await readError(response, "Could not remove the link. Please try again."));
      }
      onRemoved();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Could not remove the link.");
      setIsRemoving(false);
    }
  }

  return (
    <li>
      <Card className="flex items-center gap-2 py-0 pl-3 pr-1">
        <div className="flex min-w-0 flex-1 flex-col py-2">
          <span className="text-sm text-foreground">{link.placeholderName}</span>
          <span className="break-all text-xs text-muted">{link.placeholderEmail}</span>
        </div>
        <RemoveButton
          accessibleName={`Remove ${link.placeholderName}`}
          isArmed={isArmed}
          onArm={() => setIsArmed(true)}
          onConfirm={remove}
          disabled={isRemoving}
        />
      </Card>
      <FormError message={error} />
    </li>
  );
}

function PasteLinksModal({
  isOpen,
  onClose,
  onAdded,
}: {
  isOpen: boolean;
  onClose: () => void;
  onAdded: (result: AddResult) => void;
}) {
  const [text, setText] = useState("");
  const [error, setError] = useState<string | undefined>();
  const [isAdding, setIsAdding] = useState(false);

  const preview = useMemo(() => parseJoinLinkPaste(text), [text]);
  const canAdd = preview.lines.length > 0 && preview.problems.length === 0 && !isAdding;

  function close() {
    setText("");
    setError(undefined);
    onClose();
  }

  async function add() {
    setIsAdding(true);
    setError(undefined);
    try {
      const response = await fetch("/api/zoom/join-links", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text, apply: true }),
      });
      if (!response.ok) {
        throw new Error(await readError(response, "Could not add the links. Please try again."));
      }
      const result = (await response.json()) as AddResult;
      setText("");
      onAdded(result);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Could not add the links.");
    } finally {
      setIsAdding(false);
    }
  }

  return (
    <Modal isOpen={isOpen} onClose={close} title="Paste Zoom links">
      <div className="flex flex-col gap-3">
        <label htmlFor="zoom-pool-paste" className="text-sm text-muted">
          One link per line: name, email, link — in any order.
        </label>
        <textarea
          id="zoom-pool-paste"
          rows={6}
          value={text}
          onChange={(event) => setText(event.target.value)}
          disabled={isAdding}
          spellCheck={false}
          autoComplete="off"
          placeholder="Guest 01, guest01@example.com, https://…"
          className="block w-full rounded-md border border-border bg-surface-raised px-3 py-2 font-mono text-xs text-foreground focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
        />

        {text.trim().length > 0 ? (
          <div className="flex flex-col gap-1" aria-live="polite">
            <p className="text-sm text-foreground">
              {plural(preview.lines.length, "link", "links")} ready
              {preview.problems.length > 0
                ? ` · ${plural(preview.problems.length, "line needs", "lines need")} fixing`
                : ""}
            </p>
            {preview.problems.length > 0 ? (
              <ul className="flex flex-col gap-0.5">
                {preview.problems.map((problem) => (
                  <li key={problem.lineNumber} className="text-sm text-danger">
                    Line {problem.lineNumber}: {problem.message}
                  </li>
                ))}
              </ul>
            ) : null}
          </div>
        ) : null}

        <FormError message={error} />

        <div className="flex justify-end gap-2">
          <Button variant="secondary" onClick={close} disabled={isAdding}>
            Cancel
          </Button>
          <Button onClick={add} disabled={!canAdd}>
            {isAdding
              ? "Adding…"
              : preview.lines.length > 0
                ? `Add ${plural(preview.lines.length, "link", "links")}`
                : "Add links"}
          </Button>
        </div>
      </div>
    </Modal>
  );
}
