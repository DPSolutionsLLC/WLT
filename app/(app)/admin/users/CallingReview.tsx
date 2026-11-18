"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { ChecklistGroup, ChecklistItem } from "@/app/(app)/roster/import/ReviewChecklist";
import { Button } from "@/components/ui/Button";
import { FormError } from "@/components/ui/FormError";
import type { ApplyCallingReviewResult } from "@/lib/callings/applyCallingReview";
import type { CallingReviewRow } from "@/lib/callings/callingReview";

// THE CALLING REVIEW ON ADMIN → USERS (ITER-058 cr2). The ward list against the app, for every
// account linked to someone on it. EVERY ROW STARTS UNTICKED (P9): a calling change moves access,
// so nothing applies without a person ticking it. Tick all is offered for changes; releases are
// ticked one at a time, as the paste import's move-outs are.
//
// Only the ticked ids are sent; the server recomputes the review before applying anything, and
// reports each row it refused with its own sentence.

export type CallingReviewProps = {
  rows: CallingReviewRow[];
  actorUserId: string;
  actorIsSuperAdmin: boolean;
};

function RowText({ row }: { row: CallingReviewRow }) {
  return (
    <>
      {row.details.map((detail) => (
        <span key={detail} className="block">
          {detail}
        </span>
      ))}
    </>
  );
}

export function CallingReview({ rows, actorUserId, actorIsSuperAdmin }: CallingReviewProps) {
  const router = useRouter();
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [isApplying, setIsApplying] = useState(false);
  const [error, setError] = useState<string>();
  const [result, setResult] = useState<ApplyCallingReviewResult | null>(null);
  // Captured when Apply is pressed: the refresh that follows removes the applied rows.
  const [sentenceOf, setSentenceOf] = useState<ReadonlyMap<string, string>>(new Map());
  // Hidden as soon as the server says they applied, rather than when the refresh lands — until
  // then they sat under "Applied …" looking untouched (defect 103b-D3). A row id carries its
  // target, so a later change for the same account is a different id and is not hidden.
  const [appliedIds, setAppliedIds] = useState<ReadonlySet<string>>(new Set());
  const [isRefreshing, startRefresh] = useTransition();

  const isOwn = (row: CallingReviewRow) => row.userId === actorUserId && !actorIsSuperAdmin;
  const visibleRows = rows.filter((row) => !appliedIds.has(row.id));
  const selectable = visibleRows.filter((row) => row.canApply && !isOwn(row));
  const changes = selectable.filter((row) => row.kind !== "release");
  const releases = selectable.filter((row) => row.kind === "release");
  const notHere = visibleRows.filter((row) => !row.canApply || isOwn(row));
  const isBusy = isApplying || isRefreshing;

  async function apply() {
    setError(undefined);
    setResult(null);
    setIsApplying(true);
    try {
      const response = await fetch("/api/callings/review", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ selectedIds: [...selectedIds] }),
      });
      const body: ApplyCallingReviewResult & { error?: string } = await response.json();
      if (!response.ok) {
        setError(body.error ?? "Could not apply the calling changes. Please try again.");
        return;
      }
      setSentenceOf(new Map(rows.map((row) => [row.id, row.sentence])));
      setResult(body);
      setAppliedIds((previous) => new Set([...previous, ...body.applied.map((applied) => applied.id)]));
      setSelectedIds(new Set());
      startRefresh(() => router.refresh());
    } catch (caught) {
      console.error("Could not reach the server to apply the calling review", {
        error: caught instanceof Error ? caught.message : String(caught),
      });
      setError("Could not reach the server. Check your connection and try again.");
    } finally {
      setIsApplying(false);
    }
  }

  if (visibleRows.length === 0 && !result && !error) return null;

  return (
    <section aria-labelledby="calling-review-heading" className="flex flex-col gap-3">
      <div>
        <h2 id="calling-review-heading" className="text-sm font-semibold text-foreground">
          Calling review <span className="font-normal text-muted">({visibleRows.length})</span>
        </h2>
        <p className="mt-1 text-xs text-muted">
          Where the ward list and the app disagree about a linked account&apos;s calling. Nothing
          changes until you tick it and press Apply.
        </p>
      </div>

      {changes.length > 0 && (
        <ChecklistGroup
          title="Calling changes"
          emptyText=""
          ids={changes.map((row) => row.id)}
          selectedIds={selectedIds}
          onChange={setSelectedIds}
          disabled={isBusy}
        >
          {changes.map((row) => (
            <ChecklistItem
              key={row.id}
              id={row.id}
              name={row.sentence}
              selectedIds={selectedIds}
              onChange={setSelectedIds}
              disabled={isBusy}
            >
              <RowText row={row} />
            </ChecklistItem>
          ))}
        </ChecklistGroup>
      )}

      {releases.length > 0 && (
        <ChecklistGroup
          title="Releases"
          emptyText=""
          ids={releases.map((row) => row.id)}
          selectedIds={selectedIds}
          onChange={setSelectedIds}
          tickAllDisabled
          disabled={isBusy}
        >
          {releases.map((row) => (
            <ChecklistItem
              key={row.id}
              id={row.id}
              name={row.sentence}
              selectedIds={selectedIds}
              onChange={setSelectedIds}
              disabled={isBusy}
            >
              <RowText row={row} />
            </ChecklistItem>
          ))}
        </ChecklistGroup>
      )}

      {notHere.length > 0 && (
        <div className="rounded-md border border-border bg-surface px-3 py-2">
          <p className="text-sm font-semibold text-foreground">
            Can&apos;t apply here <span className="font-normal text-muted">({notHere.length})</span>
          </p>
          <ul className="mt-1 flex flex-col">
            {notHere.map((row) => (
              <li key={row.id} className="border-t border-border py-2 first:border-t-0">
                <span className="block text-sm text-foreground">{row.sentence}</span>
                <span className="block text-xs text-muted">
                  {isOwn(row)
                    ? "This is your own calling. Another member of the bishopric applies it."
                    : row.refusal}
                </span>
                <span className="block text-xs text-muted">
                  <RowText row={row} />
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}

      {selectable.length > 0 && (
        <div>
          <Button onClick={() => void apply()} disabled={isBusy || selectedIds.size === 0}>
            {isApplying ? "Applying…" : isRefreshing ? "Updating…" : `Apply ticked (${selectedIds.size})`}
          </Button>
        </div>
      )}

      <FormError message={error} />

      {result && (
        <div role="status" className="rounded-md border border-border bg-surface px-3 py-2 text-sm">
          <p className="text-foreground">
            {result.applied.length === 0
              ? "No calling changed."
              : `Applied ${result.applied.length} calling ${result.applied.length === 1 ? "change" : "changes"}.`}
          </p>
          {result.refused.length > 0 && (
            <ul className="mt-1 flex flex-col gap-1">
              {result.refused.map((refusal) => (
                <li key={refusal.id} className="text-xs text-muted">
                  Not applied — {sentenceOf.get(refusal.id) ?? "a change"} {refusal.sentence}
                </li>
              ))}
            </ul>
          )}
          {result.stale > 0 && (
            <p className="mt-1 text-xs text-muted">
              {result.stale === 1 ? "One tick was" : `${result.stale} ticks were`} out of date and
              not applied. The review below shows the ward list as it is now.
            </p>
          )}
        </div>
      )}
    </section>
  );
}
