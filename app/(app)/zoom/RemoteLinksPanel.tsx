"use client";

import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { FormError } from "@/components/ui/FormError";
import { Input } from "@/components/ui/Input";
import { Modal } from "@/components/ui/Modal";
import type { PillTone } from "@/components/ui/Pill";
import { StatusTag } from "@/components/ui/StatusTag";
import type { RemoteLinkRow, RemoteLinkRowState } from "@/lib/zoom/remoteLinkRow";
import type { RemoteLinkPosition } from "@/types/domain";

// THE BISHOPRIC'S REMOTE LINKS TAB (ITER-051). One compact row per position. A link is pasted
// and never read back (D3): the window opens EMPTY, and no row carries the URL.
//
// Every change also refreshes the server data: the reader's own Remote control tab may have just
// changed (a bishop turning off their own link), and this panel remounts from `initialRows` on
// every tab switch.

const TAG: Partial<Record<RemoteLinkRowState, { label: string; tone: PillTone }>> = {
  live: { label: "Live", tone: "ok" },
  needs_new_link: { label: "Needs a new link", tone: "pending" },
  turned_off: { label: "Turned off", tone: "neutral" },
};

async function readError(response: Response, fallback: string): Promise<string> {
  try {
    const parsed = (await response.json()) as { error?: unknown };
    return typeof parsed.error === "string" ? parsed.error : fallback;
  } catch {
    return "The server sent a response this page could not read.";
  }
}

async function sendRow(
  position: RemoteLinkPosition,
  init: RequestInit,
  fallback: string,
): Promise<RemoteLinkRow> {
  const response = await fetch(`/api/zoom/remote-links/${position}`, init);
  if (!response.ok) throw new Error(await readError(response, fallback));
  const parsed = (await response.json()) as { row: RemoteLinkRow };
  return parsed.row;
}

export type RemoteLinksPanelProps = {
  initialRows: RemoteLinkRow[];
};

export function RemoteLinksPanel({ initialRows }: RemoteLinksPanelProps) {
  const [rows, setRows] = useState(initialRows);
  const [pasting, setPasting] = useState<RemoteLinkRow | null>(null);
  const router = useRouter();

  function replaceRow(next: RemoteLinkRow) {
    setRows((current) => current.map((row) => (row.position === next.position ? next : row)));
    router.refresh();
  }

  return (
    <div className="flex flex-col gap-3">
      <p className="text-sm text-muted">
        Paste each leader&apos;s link from the remote app. Only that leader can open it — nobody
        here can see it again after it is saved.
      </p>

      <ul className="flex flex-col gap-2">
        {rows.map((row) => (
          <RemoteLinkRowItem
            key={row.position}
            row={row}
            onPaste={() => setPasting(row)}
            onChanged={replaceRow}
          />
        ))}
      </ul>

      <PasteLinkModal
        row={pasting}
        onClose={() => setPasting(null)}
        onSaved={(next) => {
          replaceRow(next);
          setPasting(null);
        }}
      />
    </div>
  );
}

function RemoteLinkRowItem({
  row,
  onPaste,
  onChanged,
}: {
  row: RemoteLinkRow;
  onPaste: () => void;
  onChanged: (row: RemoteLinkRow) => void;
}) {
  const [confirmingTurnOff, setConfirmingTurnOff] = useState(false);
  const [isWorking, setIsWorking] = useState(false);
  const [error, setError] = useState<string | undefined>();
  const tag = TAG[row.state];

  async function turnOff() {
    setIsWorking(true);
    setError(undefined);
    try {
      onChanged(
        await sendRow(
          row.position,
          { method: "DELETE" },
          "Could not turn off the remote link. Please try again.",
        ),
      );
      setConfirmingTurnOff(false);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Could not turn off the remote link.");
    } finally {
      setIsWorking(false);
    }
  }

  const whose = row.holderName ? `${row.holderName}'s` : "this";

  return (
    <li>
      <Card className="p-3">
        <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
          <div className="flex min-w-0 flex-col gap-0.5">
            <div className="flex flex-wrap items-center gap-2">
              <span className="font-semibold text-foreground">{row.positionLabel}</span>
              {tag ? <StatusTag tone={tag.tone}>{tag.label}</StatusTag> : null}
            </div>
            <span className="break-words text-sm text-foreground">{row.holderLine}</span>
            <span className="text-xs text-muted">{row.statusLine}</span>
          </div>

          {row.canPaste || row.canTurnOff ? (
            <div className="flex shrink-0 flex-wrap gap-2">
              {row.canPaste ? (
                <Button
                  variant="secondary"
                  onClick={onPaste}
                  disabled={isWorking}
                >
                  {row.state === "live" ? "Replace link" : "Paste link"}
                </Button>
              ) : null}
              {row.canTurnOff && !confirmingTurnOff ? (
                <Button
                  variant="secondary"
                  onClick={() => setConfirmingTurnOff(true)}
                  disabled={isWorking}
                >
                  Turn off
                </Button>
              ) : null}
            </div>
          ) : null}
        </div>

        {confirmingTurnOff ? (
          <div className="mt-2 flex flex-col gap-2 rounded-md border border-border p-2">
            <p className="text-sm text-foreground" aria-live="polite">
              Turn off {whose} remote link? They lose access straight away.
            </p>
            <div className="flex gap-2">
              <Button
                variant="danger"
                onClick={turnOff}
                disabled={isWorking}
              >
                {isWorking ? "Turning off…" : "Turn off"}
              </Button>
              <Button
                variant="secondary"
                onClick={() => setConfirmingTurnOff(false)}
                disabled={isWorking}
              >
                Cancel
              </Button>
            </div>
          </div>
        ) : null}

        <FormError message={error} />
      </Card>
    </li>
  );
}

function PasteLinkModal({
  row,
  onClose,
  onSaved,
}: {
  row: RemoteLinkRow | null;
  onClose: () => void;
  onSaved: (row: RemoteLinkRow) => void;
}) {
  const [url, setUrl] = useState("");
  const [error, setError] = useState<string | undefined>();
  const [isSaving, setIsSaving] = useState(false);

  function close() {
    setUrl("");
    setError(undefined);
    onClose();
  }

  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!row) return;
    setIsSaving(true);
    setError(undefined);
    try {
      const next = await sendRow(
        row.position,
        {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ url }),
        },
        "Could not save the remote link. Please try again.",
      );
      setUrl("");
      onSaved(next);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Could not save the remote link.");
    } finally {
      setIsSaving(false);
    }
  }

  const title = row
    ? `${row.state === "live" ? "Replace" : "Paste"} the ${row.positionLabel}'s link`
    : "Remote link";

  return (
    <Modal isOpen={row !== null} onClose={close} title={title}>
      <form onSubmit={save} noValidate className="flex flex-col gap-3">
        {row?.holderName ? (
          <p className="text-sm text-muted">For {row.holderName}.</p>
        ) : null}
        <Input
          id="zoom-remote-link-url"
          label="Link from the remote app"
          type="url"
          inputMode="url"
          autoComplete="off"
          spellCheck={false}
          placeholder="https://"
          value={url}
          onChange={(event) => setUrl(event.target.value)}
          error={error}
          required
        />
        <div className="flex justify-end gap-2">
          <Button variant="secondary" onClick={close} disabled={isSaving}>
            Cancel
          </Button>
          <Button type="submit" disabled={isSaving || url.trim().length === 0}>
            {isSaving ? "Saving…" : "Save"}
          </Button>
        </div>
      </form>
    </Modal>
  );
}
