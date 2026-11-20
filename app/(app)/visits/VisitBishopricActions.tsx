"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/Button";
import { FormError } from "@/components/ui/FormError";
import { Input } from "@/components/ui/Input";
import { Modal } from "@/components/ui/Modal";
import { formatMeetingDateLabel } from "@/lib/calendar/dates";
import { MAX_FOLLOW_UP_TITLE } from "@/lib/validation/visit";

// THE BISHOPRIC'S TWO WAYS TO SEND A VISIT ONWARD (ITER-055 bv7). Rendered only for somebody who
// passes canAssignVisits(); the two routes check that again.
//
//   Add a follow-up              — a to-do on a bishopric member's list (yourself by default).
//   Discuss in bishopric meeting — one line on the next bishopric agenda; never the report.
//
// The status line is computed on the server from the visit and the draft bishopric agendas.

// `label` is the picker line ("Mark Andersen (Bishop)"); `name` is for the sentence afterwards.
export type FollowUpOwnerOption = { id: string; label: string; name: string };

export type VisitBishopricActionsProps = {
  visitId: string;
  familyName: string | null;
  discussInBishopric: boolean;
  bishopricDiscussedAt: string | null;
  // The meeting date of the draft bishopric agenda carrying the line, or null.
  placedOn: string | null;
  owners: FollowUpOwnerOption[];
  currentUserId: string;
};

const SELECT_CLASSES =
  "min-h-11 rounded-md border border-border bg-surface-raised px-3 text-base text-foreground focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary";

async function readError(response: Response, fallback: string): Promise<string> {
  try {
    const payload = (await response.json()) as { error?: unknown };
    return typeof payload.error === "string" ? payload.error : fallback;
  } catch {
    return fallback;
  }
}

export function discussionStatus(
  discuss: boolean,
  discussedAt: string | null,
  placedOn: string | null,
): string | null {
  if (!discuss) return null;
  if (discussedAt !== null) return "Discussed in bishopric meeting";
  if (placedOn !== null) return `On the bishopric agenda for ${formatMeetingDateLabel(placedOn)}`;
  return "Waiting for the next bishopric agenda";
}

export function VisitBishopricActions({
  visitId,
  familyName,
  discussInBishopric,
  bishopricDiscussedAt,
  placedOn,
  owners,
  currentUserId,
}: VisitBishopricActionsProps) {
  const router = useRouter();
  const [followUpOpen, setFollowUpOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | undefined>(undefined);

  const status = discussionStatus(discussInBishopric, bishopricDiscussedAt, placedOn);
  const pending = discussInBishopric && bishopricDiscussedAt === null;
  const discussLabel = !discussInBishopric
    ? "Discuss in bishopric meeting"
    : pending
      ? "Don't discuss"
      : "Discuss again";

  async function toggleDiscussion(): Promise<void> {
    setError(undefined);
    setSaving(true);
    try {
      const response = await fetch(`/api/visits/${visitId}/discussion`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ discuss: !pending }),
      });
      if (!response.ok) {
        setError(await readError(response, "Could not change that. Please try again."));
        return;
      }
      router.refresh();
    } catch {
      setError("Could not reach the server. Check your connection and try again.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="flex flex-col gap-1">
      {status === null ? null : <p className="text-xs font-medium text-foreground">{status}</p>}
      <div className="flex flex-wrap gap-2">
        <Button variant="secondary" onClick={() => setFollowUpOpen(true)} disabled={saving}>
          Add a follow-up
        </Button>
        <Button variant="secondary" onClick={() => void toggleDiscussion()} disabled={saving}>
          {discussLabel}
        </Button>
      </div>
      <FormError message={error} />

      <Modal
        isOpen={followUpOpen}
        onClose={() => setFollowUpOpen(false)}
        title={familyName === null ? "Add a follow-up" : `Follow-up — ${familyName} family`}
      >
        {followUpOpen ? (
          <FollowUpForm
            visitId={visitId}
            owners={owners}
            currentUserId={currentUserId}
            onDone={() => {
              setFollowUpOpen(false);
              router.refresh();
            }}
          />
        ) : null}
      </Modal>
    </div>
  );
}

function FollowUpForm({
  visitId,
  owners,
  currentUserId,
  onDone,
}: {
  visitId: string;
  owners: FollowUpOwnerOption[];
  currentUserId: string;
  onDone: () => void;
}) {
  const [title, setTitle] = useState("");
  const [ownerUserId, setOwnerUserId] = useState(
    owners.some((owner) => owner.id === currentUserId) ? currentUserId : (owners[0]?.id ?? ""),
  );
  const [dueDate, setDueDate] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | undefined>(undefined);
  const [saved, setSaved] = useState<string | null>(null);

  async function submit(event: React.FormEvent): Promise<void> {
    event.preventDefault();
    setError(undefined);
    setSaving(true);
    try {
      const response = await fetch(`/api/visits/${visitId}/follow-ups`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ ownerUserId, title, dueDate: dueDate === "" ? null : dueDate }),
      });
      if (!response.ok) {
        setError(await readError(response, "Could not add that follow-up. Please try again."));
        return;
      }
      const owner = owners.find((candidate) => candidate.id === ownerUserId);
      setSaved(
        ownerUserId === currentUserId
          ? "Added to your To Do."
          : owner === undefined
            ? "Added to their To Do."
            : `Added to ${owner.name}'s To Do.`,
      );
    } catch {
      setError("Could not reach the server. Check your connection and try again.");
    } finally {
      setSaving(false);
    }
  }

  if (saved !== null) {
    return (
      <div className="flex flex-col gap-3">
        <p className="text-sm text-foreground">{saved}</p>
        <Button onClick={onDone}>Done</Button>
      </div>
    );
  }

  if (owners.length === 0) {
    return <p className="text-sm text-muted">Nobody in the bishopric can be given a follow-up.</p>;
  }

  return (
    <form onSubmit={(event) => void submit(event)} className="flex flex-col gap-3">
      <Input
        id={`follow-up-title-${visitId}`}
        label="What needs following up?"
        value={title}
        maxLength={MAX_FOLLOW_UP_TITLE}
        onChange={(event) => setTitle(event.target.value)}
        required
      />
      <div className="flex flex-col gap-1.5">
        <label htmlFor={`follow-up-owner-${visitId}`} className="text-sm font-medium text-foreground">
          For
        </label>
        <select
          id={`follow-up-owner-${visitId}`}
          className={SELECT_CLASSES}
          value={ownerUserId}
          onChange={(event) => setOwnerUserId(event.target.value)}
        >
          {owners.map((owner) => (
            <option key={owner.id} value={owner.id}>
              {owner.id === currentUserId ? `${owner.label} (me)` : owner.label}
            </option>
          ))}
        </select>
      </div>
      <Input
        id={`follow-up-due-${visitId}`}
        label="Due (optional)"
        type="date"
        value={dueDate}
        onChange={(event) => setDueDate(event.target.value)}
      />
      <FormError message={error} />
      <Button type="submit" disabled={saving || title.trim() === "" || ownerUserId === ""}>
        {saving ? "Adding…" : "Add to To Do"}
      </Button>
    </form>
  );
}
