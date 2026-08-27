"use client";

import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { VISIT_PROGRESS_QUERY_KEY } from "@/app/(app)/visits/VisitProgressTable";
import { Button } from "@/components/ui/Button";
import { FormError } from "@/components/ui/FormError";
import { describeCadence, type Cadence } from "@/lib/visits/cadence";
import { MAX_CADENCE_BY_UNIT } from "@/lib/validation/visit";
import { CADENCE_UNITS, CADENCE_UNIT_LABELS, type CadenceUnit } from "@/types/domain";

// One household's cadence, for ONE organization.
//
// This is what makes ITER-018 part 4 reachable — "they decide that a particular family needs a
// little more attention than that". The same family can be on a 3-month cadence for the Elders
// Quorum and a 12-month one for the Relief Society at the same time, which is why the override
// lives in a join table rather than in a column on `households` (Decision 2).
//
// PAGE.TSX MUST NOT IMPORT ANY VALUE FROM THIS FILE. A constant imported from a "use client"
// module reaches a Server Component as a function rather than as a string, which is the bug that
// made visits-d's "Log this visit" flow silently dead
// (plans/retros/visits-d-attempts-appointments-and-participants.md). Types only, and even those
// through `import type`.

export type HouseholdCadenceControlProps = {
  householdId: string;
  orgId: string;
  cadence: Cadence;
  source: "household" | "goal";
  // Resolved ONCE on the server from can(user, "visits.manage_goals", roleAccess) and threaded
  // down. A client component never re-derives a permission — it has no role access to resolve
  // against, and a second answer that disagreed with the route's would offer a control the API
  // refuses.
  canManage: boolean;
};

const SELECT_CLASSES =
  "min-h-11 rounded-md border border-border bg-surface-raised px-2 text-sm text-foreground focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary";

const INPUT_CLASSES =
  "min-h-11 w-20 rounded-md border border-border bg-surface-raised px-2 text-sm text-foreground focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary";

async function readJson(response: Response): Promise<Record<string, unknown>> {
  try {
    return (await response.json()) as Record<string, unknown>;
  } catch {
    throw new Error("The server sent a response this page could not read.");
  }
}

export function HouseholdCadenceControl({
  householdId,
  orgId,
  cadence,
  source,
  canManage,
}: HouseholdCadenceControlProps) {
  const queryClient = useQueryClient();

  const [open, setOpen] = useState(false);
  const [amount, setAmount] = useState(String(cadence.amount));
  const [unit, setUnit] = useState<CadenceUnit>(cadence.unit);
  const [error, setError] = useState<string | undefined>(undefined);
  const [saving, setSaving] = useState(false);

  // Absent entirely rather than disabled. A leader who cannot set cadences has no use for a
  // greyed-out control on every row of a long table; the goal panel already says out loud that
  // the role is view-only.
  if (!canManage) {
    return (
      <p className="inline-flex min-h-11 items-center text-xs text-muted">
        {describeCadence(cadence)}
        {source === "household" ? " (this household)" : ""}
      </p>
    );
  }

  // Invalidating is what makes the row AND the statistics above it move. router.refresh() alone
  // is not enough: TanStack reads `initialData` once, on first mount, so a fresh server payload
  // arriving as a new prop would be ignored (plans/retros/visits-b-progress-dashboard.md — the
  // mutation that page got wrong twice).
  //
  // THE ROUND TRIP TAKES ~3.7 SECONDS against the hosted project. There is deliberately no
  // optimistic update: hiding that latency would mean also writing the rollback path for a
  // failure, and a row that silently reverted three seconds later is worse than a row that took
  // three seconds to change.
  async function refresh(): Promise<void> {
    await queryClient.invalidateQueries({ queryKey: [VISIT_PROGRESS_QUERY_KEY] });
  }

  async function save(): Promise<void> {
    setError(undefined);

    const value = Number(amount);

    if (!Number.isInteger(value) || value < 1 || value > MAX_CADENCE_BY_UNIT[unit]) {
      setError(`Give a whole number, 1 to ${MAX_CADENCE_BY_UNIT[unit]} ${unit}s.`);
      return;
    }

    setSaving(true);

    try {
      const response = await fetch(`/api/households/${householdId}/visit-cadence`, {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ orgId, cadenceAmount: value, cadenceUnit: unit }),
      });

      const payload = await readJson(response);

      if (!response.ok) {
        setError(
          typeof payload.error === "string"
            ? payload.error
            : "Could not save that cadence.",
        );
        return;
      }

      setOpen(false);
      await refresh();
    } catch {
      setError("Could not reach the server. Check your connection and try again.");
    } finally {
      setSaving(false);
    }
  }

  async function clear(): Promise<void> {
    setError(undefined);
    setSaving(true);

    try {
      // The parameter name is `orgId`, checked against the schema in lib/validation/visit.ts and
      // the handler in app/api/households/[id]/visit-cadence/route.ts rather than assumed. A name
      // that handler does not read is silently IGNORED, not refused (roster-b).
      const response = await fetch(
        `/api/households/${householdId}/visit-cadence?orgId=${encodeURIComponent(orgId)}`,
        { method: "DELETE" },
      );

      const payload = await readJson(response);

      if (!response.ok) {
        setError(
          typeof payload.error === "string"
            ? payload.error
            : "Could not clear that cadence.",
        );
        return;
      }

      setOpen(false);
      await refresh();
    } catch {
      setError("Could not reach the server. Check your connection and try again.");
    } finally {
      setSaving(false);
    }
  }

  if (!open) {
    return (
      // `min-h-11` is 44px, and `-mx-1 px-1` gives it horizontal slack without shifting the
      // text out of line with the badge above it. Walking scenario 045 measured this control at
      // 176x16, which fails the 44x44 rule every other control on the page keeps — a link-sized
      // hit area on the one control this slice added.
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="-mx-1 inline-flex min-h-11 items-center px-1 text-left text-xs text-muted underline decoration-dotted underline-offset-2 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
      >
        {describeCadence(cadence)}
        {source === "household" ? " (this household)" : " (organization default)"}
      </button>
    );
  }

  return (
    <div className="mt-1 flex flex-col gap-2">
      {/* A SENTENCE THAT READS INTO THE CONTROLS — "1 visit every [3] [months]" — rather than two
          bare field labels reading "Every" and "Unit". Walking scenario 045, the control was
          judged to look changeable but not to say plainly WHAT it sets; a number beside a unit
          could as easily be a filter or a reminder.

          It deliberately does not say "goal". The organization's goal is a different object with
          its own form one section down, and using the same word for both is how somebody comes to
          believe they have just changed the quorum's cadence for every household. */}
      <p className="text-xs font-medium text-foreground">
        Visit this household once every
      </p>

      <div className="flex flex-wrap items-end gap-2">
        <label className="flex flex-col gap-1 text-xs text-muted">
          <span className="sr-only">How many</span>
          <input
            type="number"
            min={1}
            max={MAX_CADENCE_BY_UNIT[unit]}
            aria-label="How many"
            className={INPUT_CLASSES}
            value={amount}
            onChange={(event) => setAmount(event.target.value)}
          />
        </label>

        <label className="flex flex-col gap-1 text-xs text-muted">
          <span className="sr-only">Unit</span>
          <select
            className={SELECT_CLASSES}
            aria-label="Unit"
            value={unit}
            onChange={(event) => setUnit(event.target.value as CadenceUnit)}
          >
            {CADENCE_UNITS.map((candidate) => (
              <option key={candidate} value={candidate}>
                {CADENCE_UNIT_LABELS[candidate].many}
              </option>
            ))}
          </select>
        </label>
      </div>

      <FormError message={error} />

      <div className="flex flex-wrap gap-2">
        <Button onClick={() => void save()} disabled={saving}>
          {saving ? "Saving…" : "Save"}
        </Button>

        {/* Offered only when there IS an override to clear. Absent means "use the organization's
            goal", so there is nothing to remove when the cadence already came from the goal. */}
        {source === "household" ? (
          <Button variant="secondary" onClick={() => void clear()} disabled={saving}>
            Use the organization&rsquo;s cadence
          </Button>
        ) : null}

        <Button variant="secondary" onClick={() => setOpen(false)} disabled={saving}>
          Cancel
        </Button>
      </div>
    </div>
  );
}
