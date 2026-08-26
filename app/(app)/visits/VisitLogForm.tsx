"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { FormError } from "@/components/ui/FormError";
import { Input } from "@/components/ui/Input";
import { MAX_PRIVATE_NOTES, MAX_SHARED_NOTES } from "@/lib/validation/visit";
import { VISIT_TYPES, VISIT_TYPE_LABELS, type VisitType } from "@/types/domain";

export type HouseholdOption = { id: string; label: string };

export type VisitLogFormProps = {
  households: HouseholdOption[];
  today: string;
};

const SELECT_CLASSES =
  "min-h-11 rounded-md border border-border bg-surface-raised px-3 text-base text-foreground focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary";

const TEXTAREA_CLASSES =
  "min-h-24 rounded-md border border-border bg-surface-raised px-3 py-2 text-base text-foreground placeholder:text-muted focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary";

// Same box, different ink. The words a leader types into the shared field come out in the
// attention colour, so the thing that marks it out is the content itself rather than a panel
// drawn around it — you cannot type into this field without seeing that it is not the other one.
const SHARED_TEXTAREA_CLASSES =
  "min-h-24 rounded-md border border-warning bg-surface-raised px-3 py-2 text-base text-warning placeholder:text-muted focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary";

type Draft = {
  householdId: string;
  visitDate: string;
  visitType: VisitType;
  sharedNotes: string;
  privateNotes: string;
};

async function readJson(response: Response): Promise<Record<string, unknown>> {
  try {
    return (await response.json()) as Record<string, unknown>;
  } catch {
    throw new Error("The server sent a response this page could not read.");
  }
}

function errorFrom(payload: Record<string, unknown>, fallback: string): string {
  return typeof payload.error === "string" ? payload.error : fallback;
}

// Logging a visit is where the notes rule becomes visible to a human.
//
// ---------------------------------------------------------------------------
// THE EMPHASIS IS ON THE SHARED FIELD, NOT THE PRIVATE ONE
// ---------------------------------------------------------------------------
// This reverses the first build, and the reason is worth keeping. Marking the PRIVATE box out as
// special says "be careful here" about the one field that is already safe — nobody but its author
// can ever read it. The field that deserves a person's caution is the SHARED one, because that is
// the text other leaders will read. Highlighting the private box also read as an error state:
// a tinted panel with a heavy border is how a form signals a validation failure.
//
// So the shared field carries the attention: its label, its helper text, AND THE TEXT BEING TYPED
// INTO IT are all in the attention colour. Seeing your own words come out in a different colour
// from everything else on the page is the reminder — this is the part somebody else reads. The
// private field is styled as an ordinary field, because writing privately is the ordinary case.
//
// Both sit inside ONE "Notes" section with two named categories, so the choice reads as two kinds
// of the same thing rather than as two unrelated boxes.
//
// Colour tokens carry both themes on their own: app/globals.css defines every --color-* on :root
// and redefines them under a `.dark` class on <html>, which components/layout/ThemeToggle sets.
// So there is no parallel set of dark: classes here for somebody to keep in step.
//
// The helper text is ALWAYS VISIBLE — never a placeholder, never a tooltip. A placeholder
// disappears the moment somebody starts typing, which is exactly when a leader writing a
// pastoral observation most needs to know who will read it.
export function VisitLogForm({ households, today }: VisitLogFormProps) {
  const router = useRouter();

  const emptyDraft: Draft = {
    householdId: "",
    visitDate: today,
    visitType: "in_home",
    sharedNotes: "",
    privateNotes: "",
  };

  const [draft, setDraft] = useState<Draft>(emptyDraft);
  const [error, setError] = useState<string | undefined>(undefined);
  const [notice, setNotice] = useState<string | undefined>(undefined);
  const [saving, setSaving] = useState(false);

  function update<K extends keyof Draft>(key: K, value: Draft[K]): void {
    setDraft((current) => ({ ...current, [key]: value }));
  }

  async function submit(): Promise<void> {
    setError(undefined);
    setNotice(undefined);

    if (draft.householdId === "") {
      setError("Choose which household this visit was to.");
      return;
    }

    if (draft.visitDate > today) {
      setError("A visit cannot be logged for a date in the future.");
      return;
    }

    setSaving(true);

    try {
      // The visit first. The private note is NEVER a field on this payload — it goes to its own
      // endpoint, in its own request, after the log exists, so the wire format carries the
      // boundary too and no server-side mistake could write it onto the log.
      const response = await fetch("/api/visits", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          householdId: draft.householdId,
          visitDate: draft.visitDate,
          visitType: draft.visitType,
          sharedNotes: draft.sharedNotes.trim() === "" ? null : draft.sharedNotes,
        }),
      });

      const payload = await readJson(response);

      if (!response.ok) {
        setError(errorFrom(payload, "Could not save that visit."));
        return;
      }

      const visit = payload.visit as { id: string } | undefined;
      const privateNotes = draft.privateNotes.trim();

      // A private note that failed to save is reported as its own sentence rather than rolled
      // into "could not save the visit" — the visit DID save, and telling somebody their note is
      // stored when it is not is the one failure this feature cannot afford.
      if (visit !== undefined && privateNotes !== "") {
        const noteResponse = await fetch(`/api/visits/${visit.id}/private-note`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ notes: privateNotes }),
        });

        if (!noteResponse.ok) {
          const notePayload = await readJson(noteResponse);
          setDraft({ ...emptyDraft, privateNotes });
          router.refresh();
          setError(
            `${errorFrom(notePayload, "Could not save your private note.")} The visit itself was saved.`,
          );
          return;
        }
      }

      setDraft(emptyDraft);
      setNotice("Visit logged.");
      router.refresh();
    } catch {
      setError("Could not reach the server. Check your connection and try again.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <Card>
      <h2 className="text-base font-semibold text-foreground">Log a visit</h2>

      <div className="mt-4 flex flex-col gap-4">
        <div className="flex flex-col gap-1.5">
          <label htmlFor="visit-household" className="text-sm font-medium text-foreground">
            Household
          </label>
          <select
            id="visit-household"
            className={SELECT_CLASSES}
            value={draft.householdId}
            onChange={(event) => update("householdId", event.target.value)}
          >
            <option value="">Choose a household…</option>
            {households.map((household) => (
              <option key={household.id} value={household.id}>
                {household.label}
              </option>
            ))}
          </select>
        </div>

        <Input
          id="visit-date"
          label="Visit date"
          type="date"
          max={today}
          value={draft.visitDate}
          onChange={(event) => update("visitDate", event.target.value)}
        />

        <div className="flex flex-col gap-1.5">
          <label htmlFor="visit-type" className="text-sm font-medium text-foreground">
            Visit type
          </label>
          <select
            id="visit-type"
            className={SELECT_CLASSES}
            value={draft.visitType}
            onChange={(event) => update("visitType", event.target.value as VisitType)}
          >
            {VISIT_TYPES.map((visitType) => (
              <option key={visitType} value={visitType}>
                {VISIT_TYPE_LABELS[visitType]}
              </option>
            ))}
          </select>
        </div>

        <fieldset className="m-0 flex flex-col gap-4 border-0 p-0">
          {/* A legend does not participate in the fieldset's flex layout, so its spacing is set
              here rather than left to the container's gap. */}
          <legend className="mb-2 text-sm font-semibold text-foreground">Notes</legend>

          <div className="flex flex-col gap-1.5">
            <label htmlFor="visit-shared-notes" className="text-sm font-medium text-warning">
              Shared
            </label>
            <p id="visit-shared-notes-help" className="text-sm text-warning">
              Anyone who reviews this visit will read these.
            </p>
            <textarea
              id="visit-shared-notes"
              aria-describedby="visit-shared-notes-help"
              className={SHARED_TEXTAREA_CLASSES}
              maxLength={MAX_SHARED_NOTES}
              value={draft.sharedNotes}
              onChange={(event) => update("sharedNotes", event.target.value)}
            />
          </div>

          <div className="flex flex-col gap-1.5">
            <label htmlFor="visit-private-notes" className="text-sm font-medium text-foreground">
              Private
            </label>
            <p id="visit-private-notes-help" className="text-sm text-muted">
              Only you will ever see these — for your own recollection later.
            </p>
            <textarea
              id="visit-private-notes"
              aria-describedby="visit-private-notes-help"
              className={TEXTAREA_CLASSES}
              maxLength={MAX_PRIVATE_NOTES}
              value={draft.privateNotes}
              onChange={(event) => update("privateNotes", event.target.value)}
            />
          </div>
        </fieldset>

        <FormError message={error} />
        {notice ? (
          <p role="status" className="text-sm text-success">
            {notice}
          </p>
        ) : null}

        <div>
          <Button onClick={() => void submit()} disabled={saving}>
            {saving ? "Saving…" : "Log visit"}
          </Button>
        </div>
      </div>
    </Card>
  );
}

export type VisitFlagButtonProps = {
  visitId: string;
  familyName: string;
  flagged: boolean;
};

// The other write control on a visit log, living beside the form because both write to
// visit_logs through the same two endpoints and visits-b replaces this whole surface anyway.
//
// The confirm NAMES WHO WILL BE TOLD. Flagging is the one action on this page that sends
// something to somebody who cannot open the visit, and a leader deciding whether to raise a
// family in ward council should be told that before they do it, not discover it afterwards.
export function VisitFlagButton({ visitId, familyName, flagged }: VisitFlagButtonProps) {
  const router = useRouter();

  const [error, setError] = useState<string | undefined>(undefined);
  const [saving, setSaving] = useState(false);

  async function toggle(): Promise<void> {
    const confirmed = window.confirm(
      flagged
        ? `Remove the ward council flag from ${familyName}?`
        : `Flag ${familyName} for ward council? The executive secretary will be notified — ` +
            "they will see the household name and nothing else, not your notes.",
    );

    if (!confirmed) return;

    setError(undefined);
    setSaving(true);

    try {
      const response = await fetch(`/api/visits/${visitId}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ flaggedForWardCouncil: !flagged }),
      });

      if (!response.ok) {
        const payload = await readJson(response);
        setError(errorFrom(payload, "Could not change that flag."));
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
      <Button variant="secondary" onClick={() => void toggle()} disabled={saving}>
        {flagged ? "Remove ward council flag" : "Flag for ward council"}
      </Button>
      <FormError message={error} />
    </div>
  );
}
