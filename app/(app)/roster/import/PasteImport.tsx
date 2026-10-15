"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ReviewChecklist } from "@/app/(app)/roster/import/ReviewChecklist";
import { ImportProblemList } from "@/components/roster/ImportProblemList";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { FormError } from "@/components/ui/FormError";
import type { ApplyResult } from "@/lib/roster/paste/applyRosterPaste";
import { defaultSelectedIds, type RosterReview } from "@/lib/roster/paste/buildRosterDiff";
import type { ImportProblem } from "@/lib/roster/paste/normalizeReportRow";
import { parsePastedReport } from "@/lib/roster/paste/parsePastedReport";
import {
  describeDuplicateColumns,
  describeMissingColumns,
  matchReportColumns,
} from "@/lib/roster/paste/reportColumns";

// The paste is checked HERE first, but only for the headers, so a missing column is named before
// anything is posted. The server re-parses from scratch and its answer is the one that counts.

type Step = "paste" | "review" | "done";

type PreviewResponse = {
  pasteHash?: string;
  review?: RosterReview;
  problems?: ImportProblem[];
  problemsTruncated?: number;
  ignoredColumns?: string[];
  notSuppliedColumns?: string[];
  rowsRead?: number;
  rowsWithProblems?: number;
  error?: string;
};

type Preview = Required<Omit<PreviewResponse, "error">>;

type ApplyResponse = { result?: ApplyResult; error?: string };

const NETWORK_ERROR = "Could not reach the server. Check your connection and try again.";

function plural(count: number, one: string, many: string): string {
  return `${count} ${count === 1 ? one : many}`;
}

function checkHeadersLocally(text: string): string[] {
  const parsed = parsePastedReport(text);
  if (parsed.error !== null) return [parsed.error];

  const columns = matchReportColumns(parsed.headers);
  return [
    ...describeMissingColumns(columns.missing),
    ...describeDuplicateColumns(columns.duplicates),
  ];
}

function isCompletePreview(payload: PreviewResponse): payload is Preview & PreviewResponse {
  return (
    payload.pasteHash !== undefined &&
    payload.review !== undefined &&
    payload.problems !== undefined
  );
}

export function PasteImport() {
  const router = useRouter();

  const [step, setStep] = useState<Step>("paste");
  const [text, setText] = useState("");
  const [preview, setPreview] = useState<Preview | null>(null);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [goneAcknowledged, setGoneAcknowledged] = useState(false);
  const [result, setResult] = useState<ApplyResult | null>(null);
  const [errors, setErrors] = useState<string[]>([]);
  const [isBusy, setIsBusy] = useState(false);

  function restart(): void {
    setStep("paste");
    setText("");
    setPreview(null);
    setSelectedIds(new Set());
    setGoneAcknowledged(false);
    setResult(null);
    setErrors([]);
  }

  async function handleReview(): Promise<void> {
    const localErrors = checkHeadersLocally(text);
    if (localErrors.length > 0) {
      setErrors(localErrors);
      return;
    }

    setErrors([]);
    setIsBusy(true);

    try {
      const response = await fetch("/api/roster/import/preview", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text }),
      });
      const payload: PreviewResponse = await response.json();

      if (!response.ok || !isCompletePreview(payload)) {
        setErrors([payload.error ?? "Could not read that paste. Please try again."]);
        return;
      }

      setPreview({
        pasteHash: payload.pasteHash,
        review: payload.review,
        problems: payload.problems,
        problemsTruncated: payload.problemsTruncated ?? 0,
        ignoredColumns: payload.ignoredColumns ?? [],
        notSuppliedColumns: payload.notSuppliedColumns ?? [],
        rowsRead: payload.rowsRead ?? 0,
        rowsWithProblems: payload.rowsWithProblems ?? 0,
      });
      setSelectedIds(new Set(defaultSelectedIds(payload.review)));
      setGoneAcknowledged(false);
      setStep("review");
    } catch (error) {
      console.error("Could not review the roster paste", error);
      setErrors([NETWORK_ERROR]);
    } finally {
      setIsBusy(false);
    }
  }

  async function handleApply(): Promise<void> {
    if (!preview) return;

    setErrors([]);
    setIsBusy(true);

    try {
      const response = await fetch("/api/roster/import", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          text,
          pasteHash: preview.pasteHash,
          selectedIds: [...selectedIds],
        }),
      });
      const payload: ApplyResponse = await response.json();

      if (!response.ok || !payload.result) {
        setErrors([payload.error ?? "Could not apply those changes. Please try again."]);
        return;
      }

      setResult(payload.result);
      setStep("done");
      router.refresh();
    } catch (error) {
      console.error("Could not apply the roster paste", error);
      setErrors([NETWORK_ERROR]);
    } finally {
      setIsBusy(false);
    }
  }

  if (step === "done" && result) {
    return (
      <div className="flex flex-col gap-4">
        <Card>
          <h2 className="text-base font-semibold text-foreground">Changes applied</h2>
          <ul className="mt-3 flex flex-col gap-1 text-sm text-muted">
            <li>New people: {result.membersCreated} added</li>
            <li>
              Changed: {plural(result.membersChanged, "person", "people")} updated
              {result.membersReturned > 0 &&
                `, including ${result.membersReturned} back in the ward`}
            </li>
            <li>
              Households: {result.householdsCreated} created, {result.householdsUpdated} addresses
              updated
            </li>
            <li>No longer listed: {plural(result.membersMovedOut, "person", "people")} marked moved out</li>
            {result.silentFieldUpdates > 0 && (
              <li>
                Callings, classes and ministering details updated for{" "}
                {plural(result.silentFieldUpdates, "person", "people")}
              </li>
            )}
          </ul>

          {result.staleSelections > 0 && (
            <p className="mt-3 rounded-md border border-warning px-3 py-2 text-sm text-foreground">
              {plural(result.staleSelections, "item", "items")} changed while you were reviewing
              and {result.staleSelections === 1 ? "was" : "were"} skipped. Paste again to see{" "}
              {result.staleSelections === 1 ? "it" : "them"}.
            </p>
          )}

          <Link
            href="/roster"
            className="mt-4 inline-block text-sm text-primary underline underline-offset-4"
          >
            Go to the roster
          </Link>
        </Card>

        <div>
          <Button variant="secondary" onClick={restart}>
            Paste again
          </Button>
        </div>
      </div>
    );
  }

  if (step === "review" && preview) {
    const { review } = preview;
    const tickedCount = selectedIds.size;
    const hasSilentUpdates = review.silentUpdateCount > 0;
    const nothingToApply = tickedCount === 0 && !hasSilentUpdates;
    const moveOutLocked = review.guard.suspicious && !goneAcknowledged;

    return (
      <div className="flex flex-col gap-4">
        <Card>
          <h2 className="text-base font-semibold text-foreground">Nothing has changed yet</h2>
          <p className="mt-2 text-sm text-muted">
            {plural(preview.rowsRead, "row", "rows")} read
            {preview.rowsWithProblems > 0 &&
              ` (${plural(preview.rowsWithProblems, "row", "rows")} with problems)`}{" "}
            · {review.newPeople.length} new · {review.changedPeople.length} changed ·{" "}
            {plural(review.householdAddresses.length, "address", "addresses")} ·{" "}
            {review.movedOut.length} no longer listed · {review.unchangedCount} unchanged
          </p>
          {preview.ignoredColumns.length > 0 && (
            <p className="mt-2 text-xs text-muted">
              Ignored columns: {preview.ignoredColumns.join(", ")}
            </p>
          )}
          {preview.notSuppliedColumns.length > 0 && (
            <p className="mt-1 text-xs text-muted">
              Not in this paste, left unchanged: {preview.notSuppliedColumns.join(", ")}
            </p>
          )}
        </Card>

        {review.guard.suspicious && (
          <div
            role="alert"
            className="rounded-md border border-warning bg-surface px-3 py-3 text-sm text-foreground"
          >
            <p>
              This paste would mark {review.guard.movedOutCount} of {review.guard.activeCount}{" "}
              people as moved out. If part of the table didn&apos;t get copied, go back and paste it
              again.
            </p>
            <label className="mt-2 flex min-h-11 items-center gap-2">
              <input
                type="checkbox"
                checked={goneAcknowledged}
                onChange={(event) => setGoneAcknowledged(event.target.checked)}
                className="h-5 w-5 shrink-0 rounded border-border"
              />
              I checked. These people really are gone.
            </label>
          </div>
        )}

        <ReviewChecklist
          review={review}
          selectedIds={selectedIds}
          onChange={setSelectedIds}
          moveOutTickAllLocked={moveOutLocked}
          disabled={isBusy}
        />

        <ImportProblemList
          problems={preview.problems}
          problemsTruncated={preview.problemsTruncated}
          emptyMessage="Every row in this paste could be read."
        />

        <FormError message={errors.join(" ") || undefined} />

        <div className="flex flex-col gap-3 md:flex-row">
          <Button onClick={handleApply} disabled={isBusy || nothingToApply}>
            {isBusy
              ? "Applying…"
              : tickedCount === 0
                ? "Apply"
                : `Apply ${plural(tickedCount, "change", "changes")}`}
          </Button>
          <Button
            variant="secondary"
            onClick={() => {
              setErrors([]);
              setStep("paste");
            }}
            disabled={isBusy}
          >
            Back
          </Button>
        </div>
      </div>
    );
  }

  return (
    <Card>
      <label htmlFor="roster-paste" className="block text-sm font-medium text-foreground">
        Ward list report
      </label>
      <textarea
        id="roster-paste"
        aria-label="Paste the ward list report"
        rows={10}
        value={text}
        onChange={(event) => setText(event.target.value)}
        disabled={isBusy}
        spellCheck={false}
        className="mt-1.5 block w-full rounded-md border border-border bg-surface-raised px-3 py-2 font-mono text-xs text-foreground focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
        placeholder="Paste the whole table here"
      />

      {errors.length > 0 && (
        <div className="mt-2 flex flex-col gap-1">
          {errors.map((message) => (
            <FormError key={message} message={message} />
          ))}
        </div>
      )}

      <div className="mt-4">
        <Button onClick={handleReview} disabled={isBusy || text.trim() === ""}>
          {isBusy ? "Reading…" : "Review changes"}
        </Button>
      </div>
    </Card>
  );
}
