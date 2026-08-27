"use client";

import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { VISIT_PROGRESS_QUERY_KEY } from "@/app/(app)/visits/VisitProgressTable";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { FormError } from "@/components/ui/FormError";

// WHAT THIS ORGANIZATION IS MEASURED AGAINST, said out loud, with the one control that changes it.
//
// The Primary is never going to visit two hundred households; it will visit the families with a
// child in Primary. This panel is where that is expressed — in one press, from
// `member_organizations`, rather than by ticking eight boxes out of two hundred.
//
// ---------------------------------------------------------------------------
// A NUMBER THAT SILENTLY SHRANK IS THE SAME PROBLEM AS ONE THAT SILENTLY GREW
// ---------------------------------------------------------------------------
// visits-b recorded that counting households an organization cannot visit makes every org look
// behind and erodes trust in the number. The mirror of that is a denominator dropping from 200 to
// 38 with no sentence beside it, and a president wondering what the app decided on their behalf.
// So every state below SAYS what it is measuring against and how many are outside it, and the
// drift banner NAMES THE HOUSEHOLDS rather than only counting them — a count nobody can check is
// a count nobody will act on.
//
// ---------------------------------------------------------------------------
// EVERY TAP TARGET IS AT LEAST 44x44
// ---------------------------------------------------------------------------
// The cadence control shipped at 176x16, which failed the rule every other control on this page
// keeps (plans/retros/visits-e-cadence-and-priority.md). These are the primary controls this
// slice adds and they are on the same page. Button already carries `min-h-11`; the checkbox rows
// below carry it explicitly.
//
// PAGE.TSX MUST NOT IMPORT ANY VALUE FROM THIS FILE. A constant imported from a "use client"
// module reaches a Server Component as a function rather than as a string, which is the bug that
// made visits-d's "Log this visit" flow silently dead. Types only, and even those through
// `import type`.

export const VISIT_STEWARDSHIP_QUERY_KEY = "visit-stewardship";

// The shape GET /api/visits/stewardship returns, matching the route field for field.
export type StewardshipPayload = {
  orgId: string;
  narrowed: boolean;
  householdIds: string[];
  matchingHouseholdIds: string[];
  drift: { toAdd: string[]; toRemove: string[] };
};

export type StewardshipPanelProps = {
  // Null when the caller has no organization — an org leader whose org_id was never set. The
  // panel says so rather than rendering a control that would 409.
  orgId: string | null;
  orgName: string | null;
  // Resolved ONCE on the server from can(user, "visits.manage_goals", roleAccess) and threaded
  // down. A client component never re-derives a permission — it has no role access to resolve
  // against, and a second answer that disagreed with the route's would offer a control the API
  // refuses. An org_secretary holds `visits.view` and `visits.create` but NOT
  // `visits.manage_goals`, so they see the sentence and no controls.
  canManageGoals: boolean;
  // Every visitable household in the ward, for the picker and for naming a drifted family. Ward
  // household count is the denominator's ceiling, so it doubles as the "of 200" in the sentence.
  households: { id: string; label: string }[];
  initialStewardship: StewardshipPayload | null;
};

const CHECKBOX_ROW_CLASSES =
  "flex min-h-11 items-center gap-3 rounded-md px-2 text-sm text-foreground " +
  "focus-within:outline-2 focus-within:outline-offset-2 focus-within:outline-primary";

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

// The parameter name is `orgId`, checked against app/api/visits/stewardship/route.ts and the
// schema in lib/validation/visit.ts rather than assumed. A name that handler does not read is
// silently IGNORED, not refused (plans/retros/roster-b-picker-and-orgs.md).
async function fetchStewardship(orgId: string): Promise<StewardshipPayload> {
  const response = await fetch(
    `/api/visits/stewardship?orgId=${encodeURIComponent(orgId)}`,
  );
  const payload = await readJson(response);

  if (!response.ok) {
    throw new Error(errorFrom(payload, "Could not load the stewardship."));
  }

  return payload.stewardship as StewardshipPayload;
}

function plural(count: number, word: string): string {
  return count === 1 ? word : `${word}s`;
}

// Names, not ids. A drift banner reading "3 households have changed" is a count nobody can check;
// "Okonkwo, Whitfield and Delgado" is something a president can act on this afternoon. Capped so
// a ward reconciling forty families does not get a paragraph — the count carries the remainder.
const MAX_NAMED = 5;

function nameList(ids: readonly string[], names: Map<string, string>): string {
  const named = ids.map((id) => names.get(id) ?? "a household");
  if (named.length <= MAX_NAMED) return named.join(", ");

  return `${named.slice(0, MAX_NAMED).join(", ")} and ${named.length - MAX_NAMED} more`;
}

export function StewardshipPanel({
  orgId,
  orgName,
  canManageGoals,
  households,
  initialStewardship,
}: StewardshipPanelProps) {
  const queryClient = useQueryClient();

  const [picking, setPicking] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [confirmingClear, setConfirmingClear] = useState(false);
  const [error, setError] = useState<string | undefined>(undefined);
  const [saving, setSaving] = useState(false);

  // Not memoised: TanStack Query hashes the key structurally, so a fresh object each render is
  // the same key (roster-b).
  const stewardshipQuery = useQuery({
    queryKey: [VISIT_STEWARDSHIP_QUERY_KEY, orgId],
    queryFn: () => fetchStewardship(orgId!),
    enabled: orgId !== null,
    // The server rendered ONE organization. Seeding any other would show the wrong
    // organization's stewardship for a moment — the same `initialData` guard VisitProgressTable
    // uses, for the same reason.
    initialData:
      orgId === initialStewardship?.orgId ? (initialStewardship ?? undefined) : undefined,
  });

  const householdNames = new Map(households.map((household) => [household.id, household.label]));
  const wardTotal = households.length;

  if (orgId === null) {
    return (
      <Card>
        <p className="text-sm text-muted">
          Your account is not attached to an organization, so there is no stewardship to set. Ask
          a member of the bishopric to set your organization.
        </p>
      </Card>
    );
  }

  const stewardship = stewardshipQuery.data;

  if (stewardship === undefined) {
    return (
      <Card>
        <p className="text-sm text-muted">
          {stewardshipQuery.isError ? "" : "Loading what this organization is measured against…"}
        </p>
        <FormError
          message={
            stewardshipQuery.isError ? (stewardshipQuery.error as Error).message : undefined
          }
        />
      </Card>
    );
  }

  const chosenCount = stewardship.householdIds.length;
  const outsideCount = Math.max(0, wardTotal - chosenCount);
  const hasDrift =
    stewardship.drift.toAdd.length > 0 || stewardship.drift.toRemove.length > 0;

  // Invalidating BOTH is what keeps the panel and the numbers above it in step. The denominator
  // has moved, and a stale dashboard beside a fresh panel is precisely the two-numbers-disagreeing
  // shape ITER-018 removed. router.refresh() alone is not enough: TanStack reads `initialData`
  // once, on first mount (plans/retros/visits-b-progress-dashboard.md).
  async function refresh(): Promise<void> {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: [VISIT_STEWARDSHIP_QUERY_KEY, orgId] }),
      queryClient.invalidateQueries({ queryKey: [VISIT_PROGRESS_QUERY_KEY, orgId] }),
    ]);
  }

  async function save(householdIds: readonly string[]): Promise<void> {
    setError(undefined);
    setSaving(true);

    try {
      const response = await fetch("/api/visits/stewardship", {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ orgId, householdIds }),
      });

      const payload = await readJson(response);

      if (!response.ok) {
        setError(errorFrom(payload, "Could not save that stewardship."));
        return;
      }

      setPicking(false);
      await refresh();
    } catch {
      setError("Could not reach the server. Check your connection and try again.");
    } finally {
      setSaving(false);
    }
  }

  async function stopNarrowing(): Promise<void> {
    setError(undefined);
    setSaving(true);

    try {
      const response = await fetch(
        `/api/visits/stewardship?orgId=${encodeURIComponent(orgId!)}`,
        { method: "DELETE" },
      );

      const payload = await readJson(response);

      if (!response.ok) {
        setError(errorFrom(payload, "Could not stop narrowing this stewardship."));
        return;
      }

      setConfirmingClear(false);
      await refresh();
    } catch {
      setError("Could not reach the server. Check your connection and try again.");
    } finally {
      setSaving(false);
    }
  }

  // Opens PRE-TICKED with the live derivation when nothing has been narrowed, and with the stored
  // set when something has. That is the whole "in one press": the Primary opens the list and the
  // eight families with a Primary child are already chosen.
  function openPicker(): void {
    setError(undefined);
    setSelected(
      new Set(
        stewardship!.narrowed ? stewardship!.householdIds : stewardship!.matchingHouseholdIds,
      ),
    );
    setPicking(true);
  }

  function toggle(householdId: string): void {
    setSelected((current) => {
      const next = new Set(current);
      if (next.has(householdId)) next.delete(householdId);
      else next.add(householdId);
      return next;
    });
  }

  if (picking) {
    return (
      <Card>
        <h3 className="text-sm font-semibold text-foreground">
          Which households are {orgName ?? "this organization"}&rsquo;s?
        </h3>
        <p className="mt-1 text-sm text-muted">
          Tick the families this organization visits. The ones already ticked are those with an
          active member of the organization. Everything unticked is left out of the numbers
          entirely.
        </p>

        <div className="mt-3 flex flex-wrap gap-2">
          <Button
            variant="secondary"
            onClick={() => setSelected(new Set(stewardship.matchingHouseholdIds))}
            disabled={saving}
          >
            Match my organization&rsquo;s members
          </Button>
          <Button
            variant="secondary"
            onClick={() => setSelected(new Set(households.map((household) => household.id)))}
            disabled={saving}
          >
            Tick every household
          </Button>
        </div>

        <p className="mt-3 text-sm font-medium text-foreground">
          {selected.size} of {wardTotal} {plural(wardTotal, "household")} chosen.
        </p>

        <div className="mt-2 max-h-96 overflow-y-auto rounded-md border border-border">
          {households.map((household) => (
            <label key={household.id} className={CHECKBOX_ROW_CLASSES}>
              <input
                type="checkbox"
                className="h-5 w-5 shrink-0"
                checked={selected.has(household.id)}
                onChange={() => toggle(household.id)}
              />
              <span>{household.label}</span>
            </label>
          ))}
        </div>

        <FormError message={error} />

        <div className="mt-3 flex flex-wrap gap-2">
          <Button onClick={() => void save([...selected])} disabled={saving || selected.size === 0}>
            {saving ? "Saving…" : "Save this stewardship"}
          </Button>
          <Button variant="secondary" onClick={() => setPicking(false)} disabled={saving}>
            Cancel
          </Button>
        </div>

        {/* THE EMPTY SET IS REFUSED, and it is said here rather than only in the route's error.
            Zero rows means the whole ward (migration 052), so "narrowed to nothing" and "not
            narrowed" would be the same rows — the alternative is named instead of guessed at. */}
        {selected.size === 0 ? (
          <p className="mt-2 text-sm text-warning">
            Keep at least one household, or cancel and choose &ldquo;Measure against the whole
            ward&rdquo; to stop narrowing.
          </p>
        ) : null}
      </Card>
    );
  }

  return (
    <Card>
      {/* THREE STATES, THREE DIFFERENT SENTENCES. Not one sentence with a number swapped in: "we
          have not narrowed" and "we have chosen everybody" are different facts, and the second is
          not even expressible under this model (see the panel header). */}
      {stewardship.narrowed ? (
        <p className="text-sm font-medium text-foreground">
          Measured against {chosenCount} {plural(chosenCount, "household")} you have chosen.{" "}
          {outsideCount} in the ward {outsideCount === 1 ? "is" : "are"} not in this stewardship.
        </p>
      ) : (
        <p className="text-sm font-medium text-foreground">
          Measured against every household in the ward ({wardTotal}).
        </p>
      )}

      {stewardship.narrowed ? null : (
        <p className="mt-1 text-sm text-muted">
          Nothing has been narrowed, so every family with an active member is counted. Most
          organizations want that; an organization that only visits some families — the Primary,
          say — should choose which.
        </p>
      )}

      {hasDrift ? (
        // NAMED, NOT ONLY COUNTED. Staleness is made visible rather than silent: the stored set
        // is authoritative, and this only ever OFFERS a reconciliation. Derivation is deliberately
        // not the storage model — an Elders Quorum's stewardship is a hand-drawn ministering
        // district, not "households containing an elder".
        <div className="mt-3 rounded-md border border-warning/40 bg-warning/10 p-3">
          <p className="text-sm font-medium text-warning">
            This stewardship no longer matches the organization&rsquo;s members.
          </p>
          <ul className="mt-1 flex flex-col gap-1 text-sm text-foreground">
            {stewardship.drift.toAdd.length > 0 ? (
              <li>
                {stewardship.drift.toAdd.length}{" "}
                {plural(stewardship.drift.toAdd.length, "household")} now{" "}
                {stewardship.drift.toAdd.length === 1 ? "has" : "have"} a member of this
                organization but {stewardship.drift.toAdd.length === 1 ? "is" : "are"} not in the
                stewardship: {nameList(stewardship.drift.toAdd, householdNames)}.
              </li>
            ) : null}
            {stewardship.drift.toRemove.length > 0 ? (
              <li>
                {stewardship.drift.toRemove.length}{" "}
                {plural(stewardship.drift.toRemove.length, "household")} in the stewardship no
                longer {stewardship.drift.toRemove.length === 1 ? "has" : "have"} one:{" "}
                {nameList(stewardship.drift.toRemove, householdNames)}.
              </li>
            ) : null}
          </ul>

          {canManageGoals ? (
            <div className="mt-2">
              <Button
                variant="secondary"
                onClick={() => void save(stewardship.matchingHouseholdIds)}
                disabled={saving || stewardship.matchingHouseholdIds.length === 0}
              >
                {saving ? "Updating…" : "Update to match"}
              </Button>
            </div>
          ) : null}
        </div>
      ) : null}

      <FormError message={error} />

      {canManageGoals ? (
        <div className="mt-3 flex flex-wrap gap-2">
          <Button onClick={openPicker} disabled={saving}>
            {stewardship.narrowed
              ? "Adjust which households are ours"
              : "Choose which households are ours"}
          </Button>

          {/* Behind a confirm, because it is a jump from a chosen few back to the whole ward and
              there is no undo — the rows themselves are what would have to be re-chosen. */}
          {stewardship.narrowed ? (
            confirmingClear ? (
              <>
                <Button variant="danger" onClick={() => void stopNarrowing()} disabled={saving}>
                  {saving ? "Working…" : `Yes, measure against all ${wardTotal}`}
                </Button>
                <Button
                  variant="secondary"
                  onClick={() => setConfirmingClear(false)}
                  disabled={saving}
                >
                  Cancel
                </Button>
              </>
            ) : (
              <Button
                variant="secondary"
                onClick={() => setConfirmingClear(true)}
                disabled={saving}
              >
                Measure against the whole ward
              </Button>
            )
          ) : null}
        </div>
      ) : (
        // READ-ONLY, and absent rather than disabled. A leader who cannot change this has no use
        // for a greyed-out button; the sentence above already told them what they are measured
        // against, which is the part they came for.
        <p className="mt-2 text-sm text-muted">
          Choosing which households an organization visits is a presidency decision.
        </p>
      )}
    </Card>
  );
}
