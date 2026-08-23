"use client";

import { useState } from "react";
import Link from "next/link";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { AssignmentModal } from "@/app/(app)/assignments/AssignmentModal";
import { SpeakerLine } from "@/components/assignments/SpeakerLine";
import { StageBadge } from "@/components/assignments/StageBadge";
import { SundayTypeBadge } from "@/components/calendar/SundayTypeBadge";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
// Type-only, so nothing from the server-only module survives the build. A VALUE import of
// lib/assignments/queries.ts here would pull in next/headers and fail `npm run build` while
// passing both lint and typecheck (plans/retros/roster-b-picker-and-orgs.md). Same shape as
// MemberPicker's import of lib/roster/queries.
import type { Assignment } from "@/lib/assignments/queries";
import type { TopicOption } from "@/lib/topics/queries";
import { formatSundayLabel, lastDayOfMonth, type DateOnly } from "@/lib/calendar/dates";
import type { Sunday } from "@/lib/calendar/queries";
import type { SessionUser } from "@/types/domain";

export const ASSIGNMENTS_QUERY_KEY = "assignments";

export type MonthAssignments = {
  assignments: Assignment[];
  approvalCounts: Record<string, number>;
};

export type MonthPlannerBoardProps = {
  user: SessionUser;
  month: DateOnly;
  sundays: Sunday[];
  initialAssignments: Assignment[];
  approvalCounts: Record<string, number>;
  memberNames: Record<string, string>;
  topics: TopicOption[];
  bishopricCount: number;
  canPlan: boolean;
};

// Which slot the modal is editing. A slot with no assignment yet is a real target — the modal
// creates it — so the assignment is nullable and the Sunday and slot number are not.
type OpenSlot = {
  sunday: Sunday;
  slotNumber: number;
  assignment: Assignment | null;
};

async function readJson(response: Response): Promise<Record<string, unknown>> {
  try {
    return (await response.json()) as Record<string, unknown>;
  } catch {
    throw new Error("The server sent a response this page could not read.");
  }
}

// The parameter names are `from` and `to`, checked against app/api/assignments/route.ts rather
// than assumed. A name that handler does not read is silently IGNORED, not refused — which is
// how the members route's `status` versus `statuses` slipped through (roster-b).
async function fetchMonthAssignments(month: DateOnly): Promise<MonthAssignments> {
  const params = new URLSearchParams({ from: month, to: lastDayOfMonth(month) });

  const response = await fetch(`/api/assignments?${params.toString()}`);
  const payload = await readJson(response);

  if (!response.ok) {
    throw new Error(
      typeof payload.error === "string"
        ? payload.error
        : "Could not load this month's speaking assignments.",
    );
  }

  const counts = (payload.approvalCounts ?? []) as Array<{
    assignmentId: string;
    approvedCount: number;
  }>;

  return {
    assignments: (payload.assignments ?? []) as Assignment[],
    approvalCounts: Object.fromEntries(
      counts.map((count) => [count.assignmentId, count.approvedCount]),
    ),
  };
}

// A sentence, never "2/3". The bare number tells a bishopric nothing about what to do next. The
// fuller "waiting on the bishop, by name" reading needs the approval ROWS, which the month read
// deliberately does not carry — that version lives on the detail page's ApprovalPanel.
export function describeApprovalProgress(
  approvedCount: number,
  bishopricCount: number,
): string | null {
  if (bishopricCount === 0) return "No bishopric members are set up to approve this.";
  if (approvedCount === 0) return null;

  const outstanding = bishopricCount - approvedCount;

  if (outstanding <= 0) return "Every approval is in";
  return `Waiting on ${outstanding} more ${outstanding === 1 ? "approval" : "approvals"}`;
}

export function MonthPlannerBoard({
  user,
  month,
  sundays,
  initialAssignments,
  approvalCounts,
  memberNames,
  topics,
  bishopricCount,
  canPlan,
}: MonthPlannerBoardProps) {
  const queryClient = useQueryClient();
  const [openSlot, setOpenSlot] = useState<OpenSlot | null>(null);

  // Seeded from the server render so the first paint has data, then owned by the cache. Not
  // memoised: TanStack Query hashes the key structurally, so a fresh object each render is the
  // same key (roster-b).
  const monthQuery = useQuery({
    queryKey: [ASSIGNMENTS_QUERY_KEY, month],
    queryFn: () => fetchMonthAssignments(month),
    initialData: { assignments: initialAssignments, approvalCounts },
  });

  const { assignments, approvalCounts: counts } = monthQuery.data;

  const bySunday = new Map<string, Assignment[]>();
  for (const assignment of assignments) {
    if (assignment.sundayId === null) continue;
    bySunday.set(assignment.sundayId, [
      ...(bySunday.get(assignment.sundayId) ?? []),
      assignment,
    ]);
  }

  async function handleSaved(): Promise<void> {
    setOpenSlot(null);
    await queryClient.invalidateQueries({ queryKey: [ASSIGNMENTS_QUERY_KEY, month] });
  }

  const errorMessage =
    monthQuery.error instanceof Error ? monthQuery.error.message : undefined;

  return (
    <div className="flex flex-col gap-3">
      {errorMessage && (
        <p role="alert" className="text-sm text-danger">
          {errorMessage}
        </p>
      )}

      {sundays.map((sunday) => {
        const forSunday = bySunday.get(sunday.id) ?? [];
        const bySlot = new Map(
          forSunday.flatMap((assignment) =>
            assignment.slotNumber === null
              ? []
              : [[assignment.slotNumber, assignment] as const],
          ),
        );

        return (
          <Card key={sunday.id}>
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h2 className="text-base font-semibold text-foreground">
                {formatSundayLabel(sunday.date)}
              </h2>
              <div className="flex items-center gap-3">
                <SundayTypeBadge type={sunday.type} />
                <Link
                  href={`/assignments/${sunday.id}`}
                  className="text-sm text-primary underline underline-offset-4"
                >
                  Open this Sunday
                </Link>
              </div>
            </div>

            {/* Keyed off the SLOT COUNT, never the Sunday type. A Sunday with no meeting already
                carries speaking_slots = 0, so this one branch covers stake conference, general
                conference, a holiday, and a standard Sunday somebody set to zero — without this
                component knowing what any of those mean (talks-a Decision 6). */}
            {sunday.speakingSlots === 0 ? (
              <p className="mt-2 text-sm text-muted">No speaking slots</p>
            ) : (
              <ul className="mt-3 flex flex-col gap-2">
                {Array.from({ length: sunday.speakingSlots }, (_, index) => {
                  const slotNumber = index + 1;
                  const assignment = bySlot.get(slotNumber) ?? null;
                  const approvalNote =
                    assignment && assignment.stage === "review"
                      ? describeApprovalProgress(counts[assignment.id] ?? 0, bishopricCount)
                      : null;

                  return (
                    <li
                      key={slotNumber}
                      className="flex flex-col gap-2 rounded-md border border-border p-3 md:flex-row md:items-center md:justify-between"
                    >
                      <div className="min-w-0">
                        <p className="text-sm">
                          <span className="text-muted">Slot {slotNumber} — </span>
                          {assignment ? (
                            <SpeakerLine
                              speaker={assignment}
                              memberNames={memberNames}
                              emptyLabel="No speaker yet"
                            />
                          ) : (
                            <span className="text-muted">open</span>
                          )}
                        </p>

                        <div className="mt-1 flex flex-wrap items-center gap-2">
                          {assignment && <StageBadge stage={assignment.stage} />}
                          {approvalNote && (
                            <span className="text-xs text-muted">{approvalNote}</span>
                          )}
                        </div>
                      </div>

                      {canPlan && (
                        <Button
                          type="button"
                          variant="secondary"
                          onClick={() => setOpenSlot({ sunday, slotNumber, assignment })}
                        >
                          {assignment ? "Edit" : "Plan"}
                          <span className="sr-only">
                            {" "}
                            slot {slotNumber} on {formatSundayLabel(sunday.date)}
                          </span>
                        </Button>
                      )}
                    </li>
                  );
                })}
              </ul>
            )}
          </Card>
        );
      })}

      {openSlot && (
        <AssignmentModal
          isOpen
          onClose={() => setOpenSlot(null)}
          onSaved={handleSaved}
          user={user}
          sundayId={openSlot.sunday.id}
          sundayLabel={formatSundayLabel(openSlot.sunday.date)}
          slotNumber={openSlot.slotNumber}
          assignment={openSlot.assignment}
          topics={topics}
          approvedCount={openSlot.assignment ? (counts[openSlot.assignment.id] ?? 0) : 0}
        />
      )}
    </div>
  );
}
