"use client";

import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { GaugePill, NeutralPill } from "@/app/(app)/visits/GaugePill";
import { HouseholdCadenceControl } from "@/app/(app)/visits/HouseholdCadenceControl";
import { VisitProgressBanner } from "@/app/(app)/visits/VisitProgressBanner";
import { Card } from "@/components/ui/Card";
import { FormError } from "@/components/ui/FormError";
import { compareByPriority } from "@/lib/visits/householdStatus";
// Type-only, so nothing from the server-only module survives the build (roster-b).
import type { VisitProgress, VisitProgressRow } from "@/lib/visits/progress";
import { formatVisitDate } from "@/lib/visits/visitDates";

// The progress dashboard: one organization's households, and where each one stands.
//
// EVERY ROW READS A POSITION, A DUE DATE, OR "NEVER VISITED". No cell anywhere on this page reads
// "Visited" any more — that word was one half of visits-b's contradiction, where a row could say
// "✓ Visited" directly beneath a banner counting the same household as unvisited.
//
// SORTING IS CLIENT-SIDE over the already-fetched rows. This is one organization's households,
// not a paginated set, so a round trip per column click would be latency bought for nothing —
// and a sort parameter the handler does not read is silently ignored rather than refused
// (plans/retros/roster-b-picker-and-orgs.md), which is a bug that looks like a working button.
//
// Only the ORGANIZATION is a refetch, and only the bishopric can change it.

export const VISIT_PROGRESS_QUERY_KEY = "visit-progress";

export type VisitProgressTableProps = {
  initialProgress: VisitProgress | null;
  organizations: { id: string; label: string }[];
  // Both resolved ONCE on the server and passed down. A client component never re-derives a
  // permission — it has no role access to resolve against, and a second answer that disagreed
  // with the route's would be a UI offering a control the API refuses.
  canSwitchOrganizations: boolean;
  canManageGoals: boolean;
};

type SortColumn =
  | "familyName"
  | "lastVisitedOn"
  | "lastAttemptedOn"
  | "dueOn"
  | "priority"
  | "conductedBy";

type Sort = { column: SortColumn; ascending: boolean };

const SELECT_CLASSES =
  "min-h-11 rounded-md border border-border bg-surface-raised px-3 text-base text-foreground focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary";

// THE BAND CLASSES, FILLS AND MARKS LIVE IN app/(app)/visits/bandStyles.ts, not here.
//
// They were lifted out when AllOrganizationsTable arrived rather than copied into it: two tables
// rendering the same four states from two literals would drift on the next colour change. That
// file carries the full reasoning about why the colour is text-and-border rather than a solid
// fill, and why the fill is a tint.
//
// THE PILL IS THE GAUGE, and it lives in app/(app)/visits/GaugePill.tsx — shared with the
// all-organizations table rather than implemented twice. That file carries the reasoning about
// the fill, the overdue wording and the greyscale-safe marks.
//
// THIS TABLE ALWAYS SHOWS THE BAND WORD. Dropping it is a choice the all-organizations view makes
// because a reader there has three or four pills on one row and has already learned the colours
// here. This is where they learn them, so the word stays.
function PriorityBadge({ row, asOf }: { row: VisitProgressRow; asOf: Date }) {
  // Do-not-contact gets its OWN neutral badge rather than a band. It is not on the scale at all:
  // shown, marked, and in no numerator and no denominator (Decision 4).
  if (row.doNotContact) {
    return <NeutralPill>Do not contact</NeutralPill>;
  }

  if (row.priority === null) {
    return <NeutralPill>No goal set</NeutralPill>;
  }

  return <GaugePill priority={row.priority} asOf={asOf} />;
}

// A SEPARATE MARK FROM THE BAND (ITER-018 part 5). `attempted_never_reached` used to be a band,
// which meant a household somebody had knocked on three times could not ALSO read "overdue" —
// the reason displaced the urgency. It is a reason, not a position, so it sits beside the badge
// at every level of urgency instead of replacing one.
function AttemptsMark({ row }: { row: VisitProgressRow }) {
  if (row.attemptsSinceLastVisit < 1) return null;

  return (
    <span className="ml-1.5 whitespace-nowrap text-xs text-warning">
      Attempted ×{row.attemptsSinceLastVisit}
    </span>
  );
}

async function readJson(response: Response): Promise<Record<string, unknown>> {
  try {
    return (await response.json()) as Record<string, unknown>;
  } catch {
    throw new Error("The server sent a response this page could not read.");
  }
}

// The parameter name is `orgId`, checked against app/api/visits/progress/route.ts rather than
// assumed. A name that handler does not read is silently IGNORED (roster-b).
async function fetchProgress(orgId: string): Promise<VisitProgress> {
  const response = await fetch(`/api/visits/progress?orgId=${encodeURIComponent(orgId)}`);
  const payload = await readJson(response);

  if (!response.ok) {
    throw new Error(
      typeof payload.error === "string"
        ? payload.error
        : "Could not load the visit progress.",
    );
  }

  return payload.progress as VisitProgress;
}

// A MISSING VALUE ALWAYS SORTS LAST, in both directions.
//
// Reversing the nulls with the direction is the behaviour that makes a table feel scrambled:
// "never visited" would jump from one end to the other and a reader loses the group they were
// looking at. Sorting by last-visited is a question about the households that HAVE a date; the
// ones that do not are the remainder, and they stay together.
function compareNullable(
  left: string | number | null,
  right: string | number | null,
  ascending: boolean,
): number {
  if (left === null && right === null) return 0;
  if (left === null) return 1;
  if (right === null) return -1;

  const order = left < right ? -1 : left > right ? 1 : 0;
  return ascending ? order : -order;
}

function sortRows(rows: readonly VisitProgressRow[], sort: Sort): VisitProgressRow[] {
  const sorted = [...rows];

  sorted.sort((left, right) => {
    let order = 0;

    if (sort.column === "priority") {
      // compareByPriority is the SERVER'S default order, imported rather than approximated, so
      // clicking the column back to ascending returns the list to exactly what arrived. It reads
      // rank first and then the elapsed fraction, so the most-overdue household leads the
      // overdue group instead of the alphabetically-first one.
      const delta = compareByPriority(left, right);
      order = sort.ascending ? delta : -delta;
    } else if (sort.column === "familyName") {
      const delta = left.familyName.localeCompare(right.familyName);
      order = sort.ascending ? delta : -delta;
    } else if (sort.column === "dueOn") {
      order = compareNullable(
        left.priority?.dueOn ?? null,
        right.priority?.dueOn ?? null,
        sort.ascending,
      );
    } else {
      order = compareNullable(left[sort.column], right[sort.column], sort.ascending);
    }

    // Family name is the tie-break on every column, so two households in the same state hold a
    // stable, readable order rather than whatever the fetch happened to return.
    return order === 0 ? left.familyName.localeCompare(right.familyName) : order;
  });

  return sorted;
}

// `Visits this period` is gone with the period. `Due` takes its place and is far more
// actionable: a date somebody can put in a diary, rather than a count against a boundary that
// moved underneath them.
const COLUMNS: { key: SortColumn; label: string }[] = [
  { key: "familyName", label: "Household" },
  { key: "lastVisitedOn", label: "Last visited" },
  { key: "lastAttemptedOn", label: "Last attempted" },
  { key: "dueOn", label: "Due" },
  { key: "priority", label: "Priority" },
  { key: "conductedBy", label: "Conducted by" },
];

// "12 Aug 2026 (3)" — the date somebody last knocked, and how many times they have knocked since
// anyone last got in. ONE attempt needs no number; a standing pattern of them is the whole point
// of the column, and a bare date renders those two identically.
function attemptedLabel(row: VisitProgressRow): string {
  const date = formatVisitDate(row.lastAttemptedOn);
  if (row.lastAttemptedOn === null || row.attemptsSinceLastVisit < 2) return date;
  return `${date} (${row.attemptsSinceLastVisit})`;
}

// Null is a STATEMENT, not a blank. A visit with nobody on its participant list reads "Nobody
// recorded" and never falls back to whoever typed it in — visits-d split `recorded_by` from
// `visit_participants` precisely so this column cannot quietly credit the wrong person.
const NOBODY_RECORDED = "Nobody recorded";

function dueLabel(row: VisitProgressRow): string {
  if (row.doNotContact) return "—";
  return formatVisitDate(row.priority?.dueOn ?? null);
}

// The muted treatment for a do-not-contact row. It stays in the list, stays sorted last, and
// reads as set aside rather than as missing.
function rowTone(row: VisitProgressRow): string {
  return row.doNotContact ? "opacity-70" : "";
}

export function VisitProgressTable({
  initialProgress,
  organizations,
  canSwitchOrganizations,
  canManageGoals,
}: VisitProgressTableProps) {
  const [orgId, setOrgId] = useState<string | null>(initialProgress?.orgId ?? null);
  const [sort, setSort] = useState<Sort>({ column: "priority", ascending: true });

  // Not memoised: TanStack Query hashes the key structurally, so a fresh object each render is
  // the same key (roster-b).
  const progressQuery = useQuery({
    queryKey: [VISIT_PROGRESS_QUERY_KEY, orgId],
    queryFn: () => fetchProgress(orgId!),
    enabled: orgId !== null,
    // The server rendered ONE organization. Any other is a real fetch, so seeding it here would
    // show the wrong organization's households for a moment.
    initialData: orgId === initialProgress?.orgId ? (initialProgress ?? undefined) : undefined,
  });

  function toggleSort(column: SortColumn): void {
    setSort((current) =>
      current.column === column
        ? { column, ascending: !current.ascending }
        : { column, ascending: true },
    );
  }

  if (orgId === null) {
    return (
      <Card>
        <h2 className="text-base font-semibold text-foreground">Visit progress</h2>
        <p className="mt-3 text-sm text-muted">
          {canSwitchOrganizations
            ? "This ward has no organizations yet, so there is nothing to measure progress for."
            : "Your account is not attached to an organization, so there is no visit goal to " +
              "measure against. Ask a member of the bishopric to set your organization."}
        </p>
      </Card>
    );
  }

  const progress = progressQuery.data;
  const rows = progress === undefined ? [] : sortRows(progress.rows, sort);

  // Parsed ONCE per render from the server's own instant, never `new Date()` — see the comment on
  // VisitProgress.asOf. Every badge below is judged against the same moment the bands were.
  const asOf = progress === undefined ? new Date(0) : new Date(progress.asOf);

  // The cadence control needs an organization to write against, and the row's own resolved
  // cadence to show. A do-not-contact household has no priority and therefore no cadence to
  // offer — it is not on the scale at all.
  function cadenceControl(row: VisitProgressRow) {
    if (row.priority === null) return null;

    return (
      <HouseholdCadenceControl
        householdId={row.householdId}
        orgId={orgId!}
        cadence={row.priority.cadence}
        source={row.priority.cadenceSource}
        canManage={canManageGoals}
      />
    );
  }

  return (
    <div className="flex flex-col gap-4">
      {canSwitchOrganizations && organizations.length > 1 ? (
        <div className="flex flex-col gap-1.5">
          <label htmlFor="progress-org" className="text-sm font-medium text-foreground">
            Organization
          </label>
          <select
            id="progress-org"
            className={SELECT_CLASSES}
            value={orgId}
            onChange={(event) => setOrgId(event.target.value)}
          >
            {organizations.map((organization) => (
              <option key={organization.id} value={organization.id}>
                {organization.label}
              </option>
            ))}
          </select>
        </div>
      ) : null}

      {progress === undefined ? (
        <Card>
          <p className="text-sm text-muted">
            {progressQuery.isError ? "" : "Loading this organization's progress…"}
          </p>
          <FormError
            message={
              progressQuery.isError
                ? (progressQuery.error as Error).message
                : undefined
            }
          />
        </Card>
      ) : (
        <>
          <VisitProgressBanner
            statistics={progress.statistics}
            goal={progress.goal}
            goalHasNoCadence={progress.goalHasNoCadence}
            stewardship={progress.stewardship}
          />

          <Card>
            <h2 className="text-base font-semibold text-foreground">Households</h2>
            <p className="mt-1 text-sm text-muted">
              Attempts are shown and never counted — a visit nobody answered the door for is
              still a household waiting to be reached.
            </p>

            {rows.length === 0 ? (
              <p className="mt-3 text-sm text-muted">
                No households with active members, so there is nothing to visit yet.
              </p>
            ) : (
              <>
                {/* Same data, two layouts (the calendar does this too). A six-column table at
                    375px is unusable. */}
                <div className="mt-3 hidden overflow-x-auto md:block">
                  <table className="w-full text-left text-sm">
                    <thead>
                      <tr className="border-b border-border">
                        {COLUMNS.map((column) => (
                          <th key={column.key} scope="col" className="py-2 pr-3 font-medium">
                            <button
                              type="button"
                              onClick={() => toggleSort(column.key)}
                              aria-label={`Sort by ${column.label}`}
                              className="inline-flex items-center gap-1 text-sm font-medium text-foreground focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
                            >
                              {column.label}
                              <span aria-hidden="true" className="text-muted">
                                {sort.column === column.key
                                  ? sort.ascending
                                    ? "▲"
                                    : "▼"
                                  : "↕"}
                              </span>
                            </button>
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {rows.map((row) => (
                        <tr
                          key={row.householdId}
                          className={`border-b border-border ${rowTone(row)}`}
                        >
                          <td className="py-2 pr-3 font-medium text-foreground">
                            {row.familyName}
                          </td>
                          <td className="py-2 pr-3 text-muted">
                            {formatVisitDate(row.lastVisitedOn)}
                          </td>
                          <td className="py-2 pr-3 text-muted">{attemptedLabel(row)}</td>
                          <td className="py-2 pr-3 text-muted">{dueLabel(row)}</td>
                          <td className="py-2 pr-3">
                            <div className="flex flex-wrap items-center">
                              <PriorityBadge row={row} asOf={asOf} />
                              <AttemptsMark row={row} />
                            </div>
                            {cadenceControl(row)}
                          </td>
                          <td className="py-2 pr-3 text-muted">
                            {row.conductedBy ?? NOBODY_RECORDED}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>

                <div className="mt-3 flex flex-col gap-3 md:hidden">
                  {/* The sort control survives the collapse. A phone reader wants "show me the
                      overdue ones" as much as a desktop reader does, and hiding the header row
                      would have taken sorting away with it. */}
                  <div className="flex flex-col gap-1.5">
                    <label htmlFor="progress-sort" className="text-sm font-medium text-foreground">
                      Sort by
                    </label>
                    <select
                      id="progress-sort"
                      className={SELECT_CLASSES}
                      value={sort.column}
                      onChange={(event) =>
                        setSort({ column: event.target.value as SortColumn, ascending: true })
                      }
                    >
                      {COLUMNS.map((column) => (
                        <option key={column.key} value={column.key}>
                          {column.label}
                        </option>
                      ))}
                    </select>
                  </div>

                  {/* A phone shows these cards as the ONLY separation between one household and
                      the next, and bg-surface sitting on a bg-surface-raised Card is barely a
                      step. The ring and shadow do the work the near-identical fills could not. */}
                  {rows.map((row) => (
                    <div
                      key={row.householdId}
                      className={`rounded-md border border-border bg-surface p-3 shadow-sm ring-1 ring-black/5 dark:ring-white/10 ${rowTone(row)}`}
                    >
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <p className="text-sm font-medium text-foreground">{row.familyName}</p>
                        <div className="flex flex-wrap items-center">
                          <PriorityBadge row={row} asOf={asOf} />
                          <AttemptsMark row={row} />
                        </div>
                      </div>

                      <dl className="mt-2 grid grid-cols-2 gap-x-3 gap-y-1 text-sm">
                        <dt className="text-muted">Last visited</dt>
                        <dd className="text-foreground">{formatVisitDate(row.lastVisitedOn)}</dd>

                        <dt className="text-muted">Last attempted</dt>
                        <dd className="text-foreground">{attemptedLabel(row)}</dd>

                        <dt className="text-muted">Due</dt>
                        <dd className="text-foreground">{dueLabel(row)}</dd>

                        <dt className="text-muted">Conducted by</dt>
                        <dd className="text-foreground">
                          {row.conductedBy ?? NOBODY_RECORDED}
                        </dd>
                      </dl>

                      {cadenceControl(row)}
                    </div>
                  ))}
                </div>
              </>
            )}
          </Card>
        </>
      )}
    </div>
  );
}
