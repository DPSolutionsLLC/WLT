"use client";

import { useState } from "react";
import { GaugePill, NeutralPill } from "@/app/(app)/visits/GaugePill";
import { Card } from "@/components/ui/Card";
// FROM lib/visits/allOrgRows.ts, NOT lib/visits/allOrgProgress.ts. The comparator is needed as a
// VALUE for the client-side sort, and allOrgProgress.ts imports listHouseholds — so one import
// from there would pull next/headers into this bundle and break the page
// (plans/retros/roster-b-picker-and-orgs.md). allOrgRows.ts imports types and pure comparators
// and nothing else.
import {
  compareAllOrgRows,
  type AllOrgHouseholdRow,
  type AllOrgProgress,
  type AllOrgSteward,
} from "@/lib/visits/allOrgRows";
import { formatVisitDate } from "@/lib/visits/visitDates";
import { VISIT_CONDUCTED_PREFIX, VISIT_NOBODY_RECORDED } from "@/types/domain";

// Every household once, with each organization's standing beside it.
//
// SORTING IS CLIENT-SIDE over the already-fetched rows. This is one ward's households, not a
// paginated set, so a round trip per column click would be latency bought for nothing — and a
// sort parameter a handler does not read is silently ignored rather than refused (roster-b),
// which is a bug that looks like a working button. There is no API route behind this page at
// all, so there is no second read path to keep in step either.
//
// ---------------------------------------------------------------------------
// THE CHIP IS THE SAME GAUGE PILL AS THE PER-ORGANIZATION TABLE, WITHOUT THE WORD
// ---------------------------------------------------------------------------
// One organization's name, that organization's colour, and the fill showing how far through the
// interval that family is — the identical component VisitProgressTable renders, from
// app/(app)/visits/GaugePill.tsx.
//
// THE BAND WORD IS DROPPED HERE and nowhere else, by a product decision on 2026-08-27: a reader
// who has learned the four colours managing their own organization reads them without the word,
// and three or four worded pills on one row is a wall of text at 375px. `never_visited` keeps its
// word regardless — an empty pill with no word is indistinguishable from a household at the very
// start of its interval, and those are opposite situations. GaugePill owns that exception so the
// two callers cannot disagree about it.
//
// THE DUE DATE IS ON HOVER, for any band that has one, and is a convenience rather than the only
// carrier — a `title` is unreachable by touch and by keyboard, and the per-organization table has
// the due date as a column.
//
// THERE IS NO LONGER ANY EXPLANATORY WORDING ON A CHIP, and its absence is the fix rather than an
// omission. Chips used to carry "Only this organization can see how it is doing." for any missing
// band — a sentence naming one of four possible causes, which walking scenario 048 found to be
// wrong in two of the three states it reached. Both causes it was covering are now gone: an
// organization with no usable goal is not a claimant at all (so has no chip), and migration 053
// makes every goal readable to every reader who can reach this page. What remains is a
// do-not-contact household, which is a fact about the household and is stated once on the row.

export type AllOrganizationsTableProps = {
  progress: AllOrgProgress;
};

type SortColumn = "familyName" | "lastVisitedOn" | "stewards" | "default";

type Sort = { column: SortColumn; ascending: boolean };

const SELECT_CLASSES =
  "min-h-11 rounded-md border border-border bg-surface-raised px-3 text-base text-foreground focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary";

const COLUMNS: { key: SortColumn; label: string }[] = [
  { key: "default", label: "Priority" },
  { key: "familyName", label: "Household" },
  { key: "lastVisitedOn", label: "Last seen" },
  { key: "stewards", label: "Organizations" },
];

const UNCLAIMED_MESSAGE = "No organization has claimed this household";

// The organization's name on the shared gauge pill, with the band word dropped — see the header.
//
// A null priority here means one thing only: the household is do-not-contact, so it is not on the
// scale for anybody. The row already says so beside the family name, so the chip states the
// organization plainly rather than repeating it once per organization.
function StewardChip({ steward, asOf }: { steward: AllOrgSteward; asOf: Date }) {
  if (steward.priority === null) {
    return <NeutralPill>{steward.orgName}</NeutralPill>;
  }

  return (
    <GaugePill
      priority={steward.priority}
      prefix={steward.orgName}
      showBandWord={false}
      asOf={asOf}
    />
  );
}

function StewardChips({ row, asOf }: { row: AllOrgHouseholdRow; asOf: Date }) {
  if (row.unclaimed) {
    return <span className="text-xs font-medium text-danger">{UNCLAIMED_MESSAGE}</span>;
  }

  return (
    <div className="flex flex-wrap gap-1.5">
      {row.stewards.map((steward) => (
        <StewardChip key={steward.orgId} steward={steward} asOf={asOf} />
      ))}
    </div>
  );
}

// "12 Jun 2026 · Elders Quorum · Visited by Miguel Cortez", or "Never visited".
//
// WHO WENT, NEVER WHO TYPED IT IN. The prefix follows the outcome through
// VISIT_CONDUCTED_PREFIX, and a visit with nobody on its participant list reads
// VISIT_NOBODY_RECORDED rather than falling back to the recorder — visits-d split those two
// columns precisely so this line cannot quietly credit the wrong person.
//
// Every row here is a COMPLETED visit (lib/visits/allOrgProgress.ts filters attempts out of
// `lastVisitedOn` entirely), so the "completed" key is the right one and never a variable.
function LastSeen({ row }: { row: AllOrgHouseholdRow }) {
  if (row.lastVisitedOn === null) {
    return <span className="text-muted">Never visited</span>;
  }

  return (
    <span className="text-muted">
      {formatVisitDate(row.lastVisitedOn)}
      {row.lastVisitedByOrgName === null ? "" : ` · ${row.lastVisitedByOrgName}`} ·{" "}
      {row.conductedBy === null
        ? VISIT_NOBODY_RECORDED.completed
        : `${VISIT_CONDUCTED_PREFIX.completed} ${row.conductedBy}`}
    </span>
  );
}

function FamilyName({ row }: { row: AllOrgHouseholdRow }) {
  return (
    <span className="font-medium text-foreground">
      {row.familyName}
      {row.doNotContact ? (
        <span className="ml-2 text-xs font-normal text-muted">(do not contact)</span>
      ) : null}
    </span>
  );
}

// A MISSING DATE ALWAYS SORTS LAST, in both directions — the rule VisitProgressTable already
// keeps. Reversing the nulls with the direction makes a table feel scrambled: "never visited"
// jumps from one end to the other and a reader loses the group they were looking at.
function compareNullableDate(
  left: string | null,
  right: string | null,
  ascending: boolean,
): number {
  if (left === null && right === null) return 0;
  if (left === null) return 1;
  if (right === null) return -1;

  const order = left < right ? -1 : left > right ? 1 : 0;
  return ascending ? order : -order;
}

function sortRows(rows: readonly AllOrgHouseholdRow[], sort: Sort): AllOrgHouseholdRow[] {
  const sorted = [...rows];

  sorted.sort((left, right) => {
    let order = 0;

    if (sort.column === "default") {
      // compareAllOrgRows is the SERVER'S order, imported rather than approximated, so clicking
      // back to ascending returns the list to exactly what arrived: unclaimed first, then the
      // most urgent visible band, then never-seen, then name.
      const delta = compareAllOrgRows(left, right);
      order = sort.ascending ? delta : -delta;
    } else if (sort.column === "familyName") {
      const delta = left.familyName.localeCompare(right.familyName);
      order = sort.ascending ? delta : -delta;
    } else if (sort.column === "lastVisitedOn") {
      order = compareNullableDate(left.lastVisitedOn, right.lastVisitedOn, sort.ascending);
    } else {
      // Fewest claimants first when ascending, so an unclaimed household and a household claimed
      // by one organization sit together — which is the question somebody sorting this column is
      // asking.
      const delta = left.stewards.length - right.stewards.length;
      order = sort.ascending ? delta : -delta;
    }

    // Family name is the tie-break on every column, so two households in the same state hold a
    // stable, readable order.
    return order === 0 ? left.familyName.localeCompare(right.familyName) : order;
  });

  return sorted;
}

export function AllOrganizationsTable({ progress }: AllOrganizationsTableProps) {
  const [sort, setSort] = useState<Sort>({ column: "default", ascending: true });

  const rows = sortRows(progress.rows, sort);

  // Parsed ONCE per render from the server's own instant, never `new Date()` — the same rule
  // VisitProgressTable keeps. Every pill below is judged against the moment the bands were.
  const asOf = new Date(progress.asOf);

  function toggleSort(column: SortColumn): void {
    setSort((current) =>
      current.column === column
        ? { column, ascending: !current.ascending }
        : { column, ascending: true },
    );
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="rounded-lg border border-border bg-surface-raised p-4">
        <p className="text-base font-semibold text-foreground">
          {progress.unclaimedCount === 0
            ? "Every household is in at least one organization's stewardship."
            : `${progress.unclaimedCount} ${
                progress.unclaimedCount === 1 ? "household is" : "households are"
              } in no organization's stewardship.`}
        </p>

        {/* ONE SENTENCE, because there is now only one state to be in. The page used to have to
            say which of two tiers the reader was in, and an org leader saw plain organization
            names beside their own banded one. Migration 053 removed the second tier: everyone who
            can reach this page reads every organization's standing. */}
        <p className="mt-1 text-sm text-muted">
          Each pill is one organization&rsquo;s standing with that family, filled to show how far
          through its interval they are &mdash; the same pills as your own board. Hover a pill for
          the date the next visit is due.
        </p>
      </div>

      <Card>
        <h2 className="text-base font-semibold text-foreground">Households</h2>
        <p className="mt-1 text-sm text-muted">
          &ldquo;Last seen&rdquo; is ward-wide and all-time — the most recent completed visit by
          any organization, which is the question no single dashboard can answer. Attempts are
          never counted as a visit.
        </p>

        {rows.length === 0 ? (
          <p className="mt-3 text-sm text-muted">
            No households with active members, so there is nothing to show yet.
          </p>
        ) : (
          <>
            {/* Same data, two layouts, matching VisitProgressTable. A four-column table with
                chips in it is unusable at 375px. */}
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
                          className="inline-flex min-h-11 items-center gap-1 text-sm font-medium text-foreground focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
                        >
                          {column.label}
                          <span aria-hidden="true" className="text-muted">
                            {sort.column === column.key ? (sort.ascending ? "▲" : "▼") : "↕"}
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
                      className={`border-b border-border ${row.doNotContact ? "opacity-70" : ""}`}
                    >
                      <td className="py-2 pr-3">
                        {row.unclaimed ? (
                          <span aria-hidden="true" className="text-danger">
                            !
                          </span>
                        ) : (
                          <span aria-hidden="true" className="text-muted">
                            ·
                          </span>
                        )}
                      </td>
                      <td className="py-2 pr-3">
                        <FamilyName row={row} />
                      </td>
                      <td className="py-2 pr-3">
                        <LastSeen row={row} />
                      </td>
                      <td className="py-2 pr-3">
                        <StewardChips row={row} asOf={asOf} />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <div className="mt-3 flex flex-col gap-3 md:hidden">
              {/* The sort control survives the collapse. A phone reader wants "show me the
                  unclaimed ones" as much as a desktop reader does. */}
              <div className="flex flex-col gap-1.5">
                <label
                  htmlFor="all-orgs-sort"
                  className="text-sm font-medium text-foreground"
                >
                  Sort by
                </label>
                <select
                  id="all-orgs-sort"
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

              {rows.map((row) => (
                <div
                  key={row.householdId}
                  className={`rounded-md border bg-surface p-3 shadow-sm ring-1 ring-black/5 dark:ring-white/10 ${
                    row.unclaimed ? "border-danger" : "border-border"
                  } ${row.doNotContact ? "opacity-70" : ""}`}
                >
                  <FamilyName row={row} />

                  <p className="mt-1 text-sm">
                    <LastSeen row={row} />
                  </p>

                  <div className="mt-2">
                    <StewardChips row={row} asOf={asOf} />
                  </div>
                </div>
              ))}
            </div>
          </>
        )}
      </Card>
    </div>
  );
}
