"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { EditInviteeModal } from "@/app/(app)/zoom/EditInviteeModal";
import { HandOutModal, type HandOutResult } from "@/app/(app)/zoom/HandOutModal";
import { LinkHandoff } from "@/app/(app)/zoom/LinkHandoff";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { FormError } from "@/components/ui/FormError";
import { Modal } from "@/components/ui/Modal";
import { SearchBox } from "@/components/ui/SearchBox";
import { describeInviteeRow, matchesInviteeSearch } from "@/lib/zoom/inviteeRow";
import type { ZoomInvitee } from "@/lib/zoom/invitees";
import type { SessionUser } from "@/types/domain";

// THE INVITEES TAB (ITER-053, z2b) — everyone holding a Zoom join link, or waiting for one.
//
// The bishopric, the ward clerk and the executive secretary read it (migration 095's SELECT
// policy). Only the bishopric gets a button: Give a Zoom link at the top, Give a link on a waiting
// row, and a small window per row with Show link and Edit. A reader who cannot manage sees names and
// placeholders and nothing that writes — and never a URL, which only the bishopric's routes return.
//
// Rendered from props and refreshed with router.refresh() after every write, because the panel
// remounts from the server's data on each tab switch (the zoom-remote-links retro).

const SEARCH_FROM_ROWS = 10;

async function readError(response: Response, fallback: string): Promise<string> {
  try {
    const parsed = (await response.json()) as { error?: unknown };
    return typeof parsed.error === "string" ? parsed.error : fallback;
  } catch {
    return "The server sent a response this page could not read.";
  }
}

export type InviteesPanelProps = {
  invitees: ZoomInvitee[];
  canManage: boolean;
  user: SessionUser;
  wardName: string | null;
};

export function InviteesPanel({ invitees, canManage, user, wardName }: InviteesPanelProps) {
  const router = useRouter();
  const [isHandingOut, setIsHandingOut] = useState(false);
  const [search, setSearch] = useState("");
  const [openId, setOpenId] = useState<string | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);

  const visible = invitees.filter((invitee) => matchesInviteeSearch(invitee, search));
  const waiting = visible.filter((invitee) => invitee.linkGivenAt === null);
  const given = visible.filter((invitee) => invitee.linkGivenAt !== null);

  const openInvitee = invitees.find((invitee) => invitee.id === openId) ?? null;
  const editingInvitee = invitees.find((invitee) => invitee.id === editingId) ?? null;

  function refresh() {
    router.refresh();
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm text-muted">
          {invitees.length === 0
            ? "Nobody has a Zoom link yet."
            : `${invitees.length} ${invitees.length === 1 ? "person" : "people"}`}
        </p>
        {canManage ? <Button onClick={() => setIsHandingOut(true)}>Give a Zoom link</Button> : null}
      </div>

      {invitees.length > SEARCH_FROM_ROWS ? (
        <SearchBox
          id="zoom-invitee-search"
          label="Search invitees by name"
          placeholder="Search by name"
          value={search}
          onValueChange={setSearch}
          onClear={() => setSearch("")}
        />
      ) : null}

      {waiting.length > 0 ? (
        <section className="flex flex-col gap-2" aria-labelledby="zoom-invitees-waiting">
          <h2 id="zoom-invitees-waiting" className="text-sm font-semibold text-foreground">
            Waiting for a link
          </h2>
          <ul className="flex flex-col gap-1">
            {waiting.map((invitee) => (
              <InviteeRowItem
                key={invitee.id}
                invitee={invitee}
                canManage={canManage}
                onOpen={() => setOpenId(invitee.id)}
              />
            ))}
          </ul>
        </section>
      ) : null}

      {given.length > 0 ? (
        <section className="flex flex-col gap-2" aria-labelledby="zoom-invitees-given">
          {waiting.length > 0 ? (
            <h2 id="zoom-invitees-given" className="text-sm font-semibold text-foreground">
              Have a link
            </h2>
          ) : (
            <h2 id="zoom-invitees-given" className="sr-only">
              Have a link
            </h2>
          )}
          <ul className="flex flex-col gap-1">
            {given.map((invitee) => (
              <InviteeRowItem
                key={invitee.id}
                invitee={invitee}
                canManage={canManage}
                onOpen={() => setOpenId(invitee.id)}
              />
            ))}
          </ul>
        </section>
      ) : null}

      {invitees.length > 0 && visible.length === 0 ? (
        <p className="text-sm text-muted">Nobody matches that name.</p>
      ) : null}

      {canManage ? (
        <HandOutModal
          isOpen={isHandingOut}
          onClose={() => setIsHandingOut(false)}
          onSaved={refresh}
          user={user}
          wardName={wardName}
        />
      ) : null}

      {canManage && openInvitee ? (
        <InviteeWindow
          key={openInvitee.id}
          invitee={openInvitee}
          wardName={wardName}
          onClose={() => setOpenId(null)}
          onEdit={() => {
            setOpenId(null);
            setEditingId(openInvitee.id);
          }}
          onChanged={refresh}
        />
      ) : null}

      {canManage && editingInvitee ? (
        <EditInviteeModal
          key={editingInvitee.id}
          invitee={editingInvitee}
          user={user}
          onClose={() => setEditingId(null)}
          onSaved={() => {
            setEditingId(null);
            refresh();
          }}
        />
      ) : null}
    </div>
  );
}

function InviteeRowItem({
  invitee,
  canManage,
  onOpen,
}: {
  invitee: ZoomInvitee;
  canManage: boolean;
  onOpen: () => void;
}) {
  const row = describeInviteeRow(invitee);

  const body = (
    <div className="flex min-w-0 flex-1 flex-col gap-0.5 text-left">
      <span className="flex flex-wrap items-center gap-x-2 gap-y-0.5">
        <span className="min-w-0 break-words text-sm font-medium text-foreground">
          {row.displayName}
        </span>
        {row.isMember ? (
          <span className="rounded-full border border-border px-1.5 text-xs text-muted">Member</span>
        ) : null}
      </span>
      <span className={`text-xs ${row.isWaiting ? "text-warning" : "text-muted"}`}>{row.linkLine}</span>
      {row.givenLine ? <span className="text-xs text-muted">{row.givenLine}</span> : null}
      <span className="text-xs text-muted">
        Last watched {row.lastWatchedLine} · Sundays watched {row.sundaysWatchedLine}
      </span>
    </div>
  );

  if (!canManage) {
    return (
      <li>
        <Card className="flex px-3 py-2">{body}</Card>
      </li>
    );
  }

  return (
    <li>
      <Card className="p-0">
        <button
          type="button"
          onClick={onOpen}
          aria-label={`${row.displayName} — ${row.isWaiting ? "give a link" : "show link or edit"}`}
          className="flex min-h-11 w-full items-center gap-2 rounded-md px-3 py-2 hover:bg-surface focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
        >
          {body}
          <span aria-hidden="true" className="shrink-0 text-muted">
            ›
          </span>
        </button>
      </Card>
    </li>
  );
}

// One person's window: Give a link (when waiting) or Show link, plus Edit.
function InviteeWindow({
  invitee,
  wardName,
  onClose,
  onEdit,
  onChanged,
}: {
  invitee: ZoomInvitee;
  wardName: string | null;
  onClose: () => void;
  onEdit: () => void;
  onChanged: () => void;
}) {
  const [joinUrl, setJoinUrl] = useState<string | null>(null);
  const [poolSentence, setPoolSentence] = useState<string | null>(null);
  const [error, setError] = useState<string | undefined>();
  const [isBusy, setIsBusy] = useState(false);

  const isWaiting = invitee.linkGivenAt === null && joinUrl === null;

  async function showLink() {
    setIsBusy(true);
    setError(undefined);
    try {
      const response = await fetch(`/api/zoom/invitees/${invitee.id}/link`);
      if (!response.ok) {
        throw new Error(await readError(response, "Could not read the link. Please try again."));
      }
      const parsed = (await response.json()) as { joinUrl: string };
      setJoinUrl(parsed.joinUrl);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Could not read the link.");
    } finally {
      setIsBusy(false);
    }
  }

  async function giveLink() {
    setIsBusy(true);
    setError(undefined);
    try {
      const response = await fetch(`/api/zoom/invitees/${invitee.id}/link`, { method: "POST" });
      if (!response.ok) {
        throw new Error(await readError(response, "Could not give the link. Please try again."));
      }
      const parsed = (await response.json()) as HandOutResult;
      setJoinUrl(parsed.joinUrl);
      setPoolSentence(parsed.pool.sentence);
      onChanged();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Could not give the link.");
    } finally {
      setIsBusy(false);
    }
  }

  return (
    <Modal isOpen onClose={onClose} title={invitee.displayName}>
      <div className="flex flex-col gap-4">
        {joinUrl ? (
          <>
            <LinkHandoff
              displayName={invitee.displayName}
              phone={invitee.phone}
              wardName={wardName}
              joinUrl={joinUrl}
            />
            {poolSentence ? (
              <p role="status" className="text-sm text-warning">
                {poolSentence}
              </p>
            ) : null}
          </>
        ) : (
          <div className="flex flex-wrap gap-2">
            {isWaiting ? (
              <Button onClick={() => void giveLink()} disabled={isBusy}>
                {isBusy ? "Giving…" : "Give a link"}
              </Button>
            ) : (
              <Button onClick={() => void showLink()} disabled={isBusy}>
                {isBusy ? "Opening…" : "Show link"}
              </Button>
            )}
            <Button variant="secondary" onClick={onEdit} disabled={isBusy}>
              Edit
            </Button>
          </div>
        )}

        <FormError message={error} />
      </div>
    </Modal>
  );
}
