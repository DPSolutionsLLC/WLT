"use client";

import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { LastPrayedLabel } from "@/components/prayers/LastPrayedLabel";
import { lastPrayedLabel } from "@/lib/prayers/lastPrayed";
import { MemberPicker } from "@/components/roster/MemberPicker";
import { SundayTypeBadge } from "@/components/calendar/SundayTypeBadge";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { FormError } from "@/components/ui/FormError";
import { formatSundayLabel, lastDayOfMonth, type DateOnly } from "@/lib/calendar/dates";
import type { Sunday } from "@/lib/calendar/queries";
// Type-only, so nothing from the server-only module survives the build. A VALUE import of
// lib/prayers/queries.ts here would pull in next/headers and fail `npm run build` while passing
// both lint and typecheck (plans/retros/roster-b-picker-and-orgs.md).
import type { Prayer } from "@/lib/prayers/queries";
import type { LastPrayed } from "@/lib/prayers/lastPrayed";
import { canTransitionPrayer, nextPrayerStage } from "@/lib/prayers/prayerPipeline";
import {
  PRAYER_STAGE_LABELS,
  PRAYER_TYPES,
  PRAYER_TYPE_LABELS,
  type PrayerType,
  type SessionUser,
} from "@/types/domain";

export const PRAYERS_QUERY_KEY = "prayers";

export type PrayerBoardProps = {
  user: SessionUser;
  month: DateOnly;
  sundays: Sunday[];
  initialPrayers: Prayer[];
  memberNames: Record<string, string>;
  lastPrayed: LastPrayed[];
  canPlan: boolean;
};

async function readJson(response: Response): Promise<Record<string, unknown>> {
  try {
    return (await response.json()) as Record<string, unknown>;
  } catch {
    throw new Error("The server sent a response this page could not read.");
  }
}

// The parameter names are `from` and `to`, checked against app/api/prayers/route.ts rather than
// assumed. A name that handler does not read is silently IGNORED, not refused (roster-b).
async function fetchMonthPrayers(month: DateOnly): Promise<Prayer[]> {
  const params = new URLSearchParams({ from: month, to: lastDayOfMonth(month) });

  const response = await fetch(`/api/prayers?${params.toString()}`);
  const payload = await readJson(response);

  if (!response.ok) {
    throw new Error(
      typeof payload.error === "string"
        ? payload.error
        : "Could not load this month's prayers.",
    );
  }

  return (payload.prayers ?? []) as Prayer[];
}

function keyFor(sundayId: string, prayerType: PrayerType): string {
  return `${sundayId}:${prayerType}`;
}

export function PrayerBoard({
  user,
  month,
  sundays,
  initialPrayers,
  memberNames,
  lastPrayed,
  canPlan,
}: PrayerBoardProps) {
  const queryClient = useQueryClient();
  const [busyKey, setBusyKey] = useState<string | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | undefined>(undefined);

  // Seeded from the server render so the first paint has data, then owned by the cache. Not
  // memoised: TanStack Query hashes the key structurally, so a fresh object each render is the
  // same key (roster-b).
  const monthQuery = useQuery({
    queryKey: [PRAYERS_QUERY_KEY, month],
    queryFn: () => fetchMonthPrayers(month),
    initialData: initialPrayers,
  });

  const bySlot = new Map(
    monthQuery.data.flatMap((prayer) =>
      prayer.sundayId === null || prayer.prayerType === null
        ? []
        : [[keyFor(prayer.sundayId, prayer.prayerType), prayer] as const],
    ),
  );

  const lastPrayedByMember = new Map(
    lastPrayed.map((entry) => [entry.memberId, entry.lastPrayedAt]),
  );

  // The annotation the picker renders beside each name. Only members WITH history get a key —
  // an absent key renders nothing, which is the whole point (lib/prayers/lastPrayed.ts).
  const pickerAnnotations = Object.fromEntries(
    lastPrayed.flatMap((entry) => {
      const label = lastPrayedLabel(entry.lastPrayedAt);
      return label === null ? [] : [[entry.memberId, label] as const];
    }),
  );

  async function refresh(): Promise<void> {
    await queryClient.invalidateQueries({ queryKey: [PRAYERS_QUERY_KEY, month] });
  }

  async function send(
    key: string,
    request: () => Promise<Response>,
    fallback: string,
  ): Promise<void> {
    setBusyKey(key);
    setErrorMessage(undefined);

    try {
      const response = await request();
      const payload = await readJson(response);

      if (!response.ok) {
        setErrorMessage(typeof payload.error === "string" ? payload.error : fallback);
        return;
      }

      await refresh();
    } catch (error) {
      // Never swallowed. A failed save that looks like a successful one is worse than an error
      // message (CLAUDE.md rule 7).
      setErrorMessage(error instanceof Error ? error.message : fallback);
    } finally {
      setBusyKey(null);
    }
  }

  async function assign(
    sunday: Sunday,
    prayerType: PrayerType,
    memberIds: string[],
  ): Promise<void> {
    await send(
      keyFor(sunday.id, prayerType),
      () =>
        fetch("/api/prayers", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            sundayId: sunday.id,
            prayerType,
            // `multiple={false}` still passes an array of length 0 or 1, so no consumer branches
            // on the shape (roster-b Decision 1). An empty array CLEARS the slot.
            memberId: memberIds[0] ?? null,
          }),
        }),
      "Could not save who is praying.",
    );
  }

  async function advance(prayer: Prayer, key: string): Promise<void> {
    const to = nextPrayerStage(prayer.stage);
    if (to === null) return;

    await send(
      key,
      () =>
        fetch(`/api/prayers/${prayer.id}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ action: "transition", to }),
        }),
      "Could not move that prayer on.",
    );
  }

  const queryError =
    monthQuery.error instanceof Error ? monthQuery.error.message : undefined;

  return (
    <div className="flex flex-col gap-3">
      <FormError message={errorMessage ?? queryError} />

      {sundays.map((sunday) => (
        <Card key={sunday.id}>
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h2 className="text-base font-semibold text-foreground">
              {formatSundayLabel(sunday.date)}
            </h2>
            <SundayTypeBadge type={sunday.type} />
          </div>

          {/* DELIBERATELY not gated on speakingSlots. A fast Sunday carries speaking_slots = 0
              and still has an invocation and a benediction — the slot count is a fact about
              SPEAKERS (lib/prayers/queries.ts, 04-talks-pipeline.md). */}
          <ul className="mt-3 flex flex-col gap-2">
            {PRAYER_TYPES.map((prayerType) => {
              const key = keyFor(sunday.id, prayerType);
              const prayer = bySlot.get(key) ?? null;
              const memberId = prayer?.memberId ?? null;
              const isBusy = busyKey === key;

              const to = prayer ? nextPrayerStage(prayer.stage) : null;
              const verdict =
                prayer && to
                  ? canTransitionPrayer(prayer.stage, to, {
                      memberId: prayer.memberId,
                      askedAt: prayer.askedAt,
                      confirmedAt: prayer.confirmedAt,
                      actorIsBishopric: false,
                    })
                  : null;

              return (
                <li
                  key={prayerType}
                  className="flex flex-col gap-2 rounded-md border border-border p-3"
                >
                  <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
                    <span className="text-sm font-medium text-foreground">
                      {PRAYER_TYPE_LABELS[prayerType]}
                    </span>
                    <span className="text-sm text-muted">
                      {memberId === null
                        ? "nobody yet"
                        : (memberNames[memberId] ?? "A member who has since left the ward")}
                    </span>
                    {memberId !== null && (
                      <LastPrayedLabel
                        lastPrayedAt={lastPrayedByMember.get(memberId) ?? null}
                      />
                    )}
                  </div>

                  <div className="flex flex-wrap items-center gap-2">
                    <span className="text-xs text-muted">
                      {prayer ? PRAYER_STAGE_LABELS[prayer.stage] : "Not assigned"}
                    </span>

                    {canPlan && prayer && to && (
                      <Button
                        type="button"
                        variant="secondary"
                        disabled={isBusy || verdict?.ok !== true}
                        onClick={() => advance(prayer, key)}
                      >
                        Move to {PRAYER_STAGE_LABELS[to]}
                        <span className="sr-only">
                          {" "}
                          — {PRAYER_TYPE_LABELS[prayerType]} on{" "}
                          {formatSundayLabel(sunday.date)}
                        </span>
                      </Button>
                    )}
                  </div>

                  {/* The refusal is shown as a SENTENCE beside the disabled control, so a
                      planner can see why it will not move without pressing it first. */}
                  {canPlan && verdict && !verdict.ok && (
                    <p className="text-xs text-muted">{verdict.message}</p>
                  )}

                  {canPlan && (
                    <MemberPicker
                      user={user}
                      value={memberId === null ? [] : [memberId]}
                      onChange={(memberIds) => void assign(sunday, prayerType, memberIds)}
                      multiple={false}
                      mode="modal"
                      disabled={isBusy}
                      annotations={pickerAnnotations}
                      label={`${PRAYER_TYPE_LABELS[prayerType]} — ${formatSundayLabel(sunday.date)}`}
                      triggerLabel={memberId === null ? "Choose someone" : "Change"}
                    />
                  )}
                </li>
              );
            })}
          </ul>
        </Card>
      ))}
    </div>
  );
}
