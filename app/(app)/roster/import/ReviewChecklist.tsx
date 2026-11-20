"use client";

import type { ReactNode } from "react";
import { formatBirthDate } from "@/lib/calendar/dates";
import type { FieldChange, RosterReview } from "@/lib/roster/paste/buildRosterDiff";
import type { PasteCallingRow } from "@/lib/roster/paste/callingRows";

// The groups of a paste's differences. UNTICK ONLY: nothing is editable here. To fix a value, fix
// it in LCR and paste again, or edit the member afterwards (the user's decision, ITER-040).
//
// CALLINGS START UNTICKED (ITER-058 cr3): a calling change moves somebody's access, so each one is
// chosen by a person. Releases are ticked one at a time, as move-outs are. A release for somebody
// this paste leaves off sits inside their No longer listed row, one person, one checkbox.

export type ReviewChecklistProps = {
  review: RosterReview;
  selectedIds: ReadonlySet<string>;
  onChange: (next: Set<string>) => void;
  moveOutTickAllLocked: boolean;
  disabled: boolean;
};

const CATEGORY_LABELS: Record<string, string> = {
  adult: "Adult",
  youth: "Youth",
  child: "Child",
};

const GENDER_LABELS: Record<string, string> = {
  male: "Male",
  female: "Female",
};

function displayValue(change: FieldChange, value: string): string {
  if (change.field === "birthDate") return formatBirthDate(value);
  if (change.field === "gender") return GENDER_LABELS[value] ?? value;
  return value;
}

function describeChange(change: FieldChange): string {
  if (change.kind === "added" && change.after !== null) {
    return `${change.label}: Added ${displayValue(change, change.after)}`;
  }
  if (change.kind === "removed" && change.before !== null) {
    return `${change.label}: Removed (was ${displayValue(change, change.before)})`;
  }
  return `${change.label}: ${displayValue(change, change.before ?? "")} → ${displayValue(change, change.after ?? "")}`;
}

// Exported for the Calling review on Admin → Users (ITER-058 cr2), which is the same checklist.
export type GroupProps = {
  title: string;
  emptyText: string;
  ids: readonly string[];
  selectedIds: ReadonlySet<string>;
  onChange: (next: Set<string>) => void;
  tickAllDisabled?: boolean;
  disabled: boolean;
  children: ReactNode;
};

export function ChecklistGroup({
  title,
  emptyText,
  ids,
  selectedIds,
  onChange,
  tickAllDisabled = false,
  disabled,
  children,
}: GroupProps) {
  const tickedCount = ids.filter((id) => selectedIds.has(id)).length;

  function setAll(ticked: boolean): void {
    const next = new Set(selectedIds);
    for (const id of ids) {
      if (ticked) next.add(id);
      else next.delete(id);
    }
    onChange(next);
  }

  return (
    <details open className="rounded-md border border-border bg-surface">
      <summary className="flex min-h-11 cursor-pointer items-center justify-between gap-2 px-3 py-2 text-sm font-semibold text-foreground">
        <span>
          {title} <span className="font-normal text-muted">({ids.length})</span>
        </span>
        {ids.length > 0 && (
          <span className="text-xs font-normal text-muted">{tickedCount} ticked</span>
        )}
      </summary>

      <div className="border-t border-border px-3 py-2">
        {ids.length === 0 ? (
          <p className="text-sm text-muted">{emptyText}</p>
        ) : (
          <>
            <div className="mb-2 flex gap-2">
              <button
                type="button"
                className="min-h-11 rounded-md border border-border px-3 text-xs text-foreground hover:bg-surface-raised disabled:cursor-not-allowed disabled:opacity-60"
                onClick={() => setAll(true)}
                disabled={disabled || tickAllDisabled}
              >
                Tick all
              </button>
              <button
                type="button"
                className="min-h-11 rounded-md border border-border px-3 text-xs text-foreground hover:bg-surface-raised disabled:cursor-not-allowed disabled:opacity-60"
                onClick={() => setAll(false)}
                disabled={disabled}
              >
                Untick all
              </button>
            </div>
            <ul className="flex max-h-96 flex-col overflow-y-auto">{children}</ul>
          </>
        )}
      </div>
    </details>
  );
}

type ItemProps = {
  id: string;
  name: string;
  selectedIds: ReadonlySet<string>;
  onChange: (next: Set<string>) => void;
  disabled: boolean;
  children: ReactNode;
};

export function ChecklistItem({ id, name, selectedIds, onChange, disabled, children }: ItemProps) {
  const inputId = `review-${id}`;

  function toggle(): void {
    const next = new Set(selectedIds);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    onChange(next);
  }

  return (
    <li className="flex items-start gap-3 border-t border-border py-2 first:border-t-0">
      <input
        id={inputId}
        type="checkbox"
        checked={selectedIds.has(id)}
        onChange={toggle}
        disabled={disabled}
        className="mt-0.5 h-5 w-5 shrink-0 rounded border-border focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
      />
      <label htmlFor={inputId} className="flex min-h-11 min-w-0 flex-1 cursor-pointer flex-col">
        <span className="block text-sm font-medium text-foreground">{name}</span>
        <span className="block text-xs text-muted">{children}</span>
      </label>
    </li>
  );
}

function CallingRowText({ row }: { row: PasteCallingRow }) {
  return (
    <>
      {row.details.map((detail) => (
        <span key={detail} className="block break-words">
          {detail}
        </span>
      ))}
    </>
  );
}

type CallingGroupsProps = {
  review: RosterReview;
  selectedIds: ReadonlySet<string>;
  onChange: (next: Set<string>) => void;
  disabled: boolean;
};

function CallingGroups({ review, selectedIds, onChange, disabled }: CallingGroupsProps) {
  const { rows, reviewedByBishopric } = review.callingChanges;
  const itemProps = { selectedIds, onChange, disabled };

  if (reviewedByBishopric) {
    return (
      <p className="rounded-md border border-border bg-surface px-3 py-2 text-sm text-muted">
        Calling changes are reviewed by the bishopric on Admin → Users.
      </p>
    );
  }

  const changes = rows.filter((row) => row.canApply && !row.isRelease);
  const releases = rows.filter((row) => row.canApply && row.isRelease && row.moveOutId === null);
  const notHere = rows.filter((row) => !row.canApply);

  return (
    <>
      {changes.length > 0 && (
        <ChecklistGroup
          title="Calling changes"
          emptyText=""
          ids={changes.map((row) => row.id)}
          {...itemProps}
        >
          {changes.map((row) => (
            <ChecklistItem key={row.id} id={row.id} name={row.sentence} {...itemProps}>
              <CallingRowText row={row} />
            </ChecklistItem>
          ))}
        </ChecklistGroup>
      )}

      {releases.length > 0 && (
        <ChecklistGroup
          title="Calling releases"
          emptyText=""
          ids={releases.map((row) => row.id)}
          tickAllDisabled
          {...itemProps}
        >
          {releases.map((row) => (
            <ChecklistItem key={row.id} id={row.id} name={row.sentence} {...itemProps}>
              <CallingRowText row={row} />
            </ChecklistItem>
          ))}
        </ChecklistGroup>
      )}

      {notHere.length > 0 && (
        <div className="rounded-md border border-border bg-surface px-3 py-2">
          <p className="text-sm font-semibold text-foreground">
            Calling changes you can&apos;t apply here{" "}
            <span className="font-normal text-muted">({notHere.length})</span>
          </p>
          <ul className="mt-1 flex flex-col">
            {notHere.map((row) => (
              <li key={row.id} className="border-t border-border py-2 first:border-t-0">
                <span className="block text-sm text-foreground">{row.sentence}</span>
                <span className="block text-xs text-muted">{row.refusal}</span>
                <span className="block text-xs text-muted">
                  <CallingRowText row={row} />
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </>
  );
}

export function ReviewChecklist({
  review,
  selectedIds,
  onChange,
  moveOutTickAllLocked,
  disabled,
}: ReviewChecklistProps) {
  const itemProps = { selectedIds, onChange, disabled };
  const releaseByMoveOut = new Map(
    review.callingChanges.rows
      .filter((row) => row.moveOutId !== null)
      .map((row) => [row.moveOutId, row]),
  );

  return (
    <div className="flex flex-col gap-3">
      <ChecklistGroup
        title="New people"
        emptyText="No new people."
        ids={review.newPeople.map((item) => item.id)}
        {...itemProps}
      >
        {review.newPeople.map((item) => (
          <ChecklistItem key={item.id} id={item.id} name={item.name} {...itemProps}>
            {item.householdLabel}
            {item.isNewHousehold && " (new household)"} · {CATEGORY_LABELS[item.category]} · Born{" "}
            {formatBirthDate(item.birthDate)}
          </ChecklistItem>
        ))}
      </ChecklistGroup>

      <ChecklistGroup
        title="Changed"
        emptyText="Nobody's details changed."
        ids={review.changedPeople.map((item) => item.id)}
        {...itemProps}
      >
        {review.changedPeople.map((item) => (
          <ChecklistItem key={item.id} id={item.id} name={item.name} {...itemProps}>
            {item.returning && <span className="block">Moved out → back in the ward</span>}
            {item.changes.map((change) => (
              <span key={change.field} className="block break-words">
                {describeChange(change)}
              </span>
            ))}
          </ChecklistItem>
        ))}
      </ChecklistGroup>

      <ChecklistGroup
        title="Household addresses"
        emptyText="No household addresses changed."
        ids={review.householdAddresses.map((item) => item.id)}
        {...itemProps}
      >
        {review.householdAddresses.map((item) => (
          <ChecklistItem key={item.id} id={item.id} name={item.name} {...itemProps}>
            <span className="block break-words">
              {item.after === null
                ? `Removed (was ${item.before ?? ""})`
                : item.before === null
                  ? `Added ${item.after}`
                  : `${item.before} → ${item.after}`}
            </span>
          </ChecklistItem>
        ))}
      </ChecklistGroup>

      <ChecklistGroup
        title="No longer listed"
        emptyText="Everyone in your roster is in this paste."
        ids={review.movedOut.map((item) => item.id)}
        tickAllDisabled={moveOutTickAllLocked}
        {...itemProps}
      >
        {review.movedOut.map((item) => {
          const release = releaseByMoveOut.get(item.id);
          return (
            <ChecklistItem key={item.id} id={item.id} name={item.name} {...itemProps}>
              {item.householdName ?? "No household"} · Ticking this marks them moved out
              {release?.releasedCallingLabel && (
                <span className="block">
                  and ends their {release.releasedCallingLabel} calling
                </span>
              )}
            </ChecklistItem>
          );
        })}
      </ChecklistGroup>

      <CallingGroups review={review} {...itemProps} />
    </div>
  );
}
