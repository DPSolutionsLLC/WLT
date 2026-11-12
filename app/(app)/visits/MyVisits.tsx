"use client";

import { useState } from "react";
import { AppointmentPanel, type AppointmentRow } from "@/app/(app)/visits/AppointmentPanel";
import { ContactPanel, type HouseholdContact } from "@/app/(app)/visits/ContactPanel";
import { HouseholdPriorityCard } from "@/app/(app)/visits/HouseholdPriorityCard";
import type { LeaderOption } from "@/app/(app)/visits/VisitParticipantsField";
import { VisitLogForm, type HouseholdOption } from "@/app/(app)/visits/VisitLogForm";
import { Modal } from "@/components/ui/Modal";
import { compareSweepStatus } from "@/lib/visits/sweep";
import { compareByPriority } from "@/lib/visits/householdStatus";
// Type-only, so nothing from the server-only module survives the build (roster-b).
import type { VisitProgressRow } from "@/lib/visits/progress";
import type { SessionUser } from "@/types/domain";

// "My visits" (ITER-055 bv5): the households the bishopric gave THIS member, as the same cards the
// Households tab shows, with the same Contact and Log visit windows. A finished visit closes the
// household's "Visit the ___ family" to-do and it leaves this list; one that still needs a visit
// stays here, marked partly reached.

export type MyVisitsProps = {
  // Null when the bishopric has no active goal, so nothing can be assigned.
  rows: VisitProgressRow[] | null;
  asOf: string;
  canLog: boolean;
  user: SessionUser;
  householdOptions: HouseholdOption[];
  householdContacts: Record<string, HouseholdContact[]>;
  appointments: AppointmentRow[];
  wardTimeZone: string;
  today: string;
  leaders: LeaderOption[];
  memberNames: Record<string, string>;
};

type OpenWindow =
  | { kind: "log"; householdId: string }
  | { kind: "contact"; row: VisitProgressRow }
  | { kind: "appointments"; householdId: string }
  | null;

function compareRows(left: VisitProgressRow, right: VisitProgressRow): number {
  const order =
    left.sweep !== null || right.sweep !== null
      ? compareSweepStatus(left.sweep, right.sweep)
      : compareByPriority(left, right);
  return order === 0 ? left.familyName.localeCompare(right.familyName) : order;
}

export function MyVisits({
  rows,
  asOf,
  canLog,
  user,
  householdOptions,
  householdContacts,
  appointments,
  wardTimeZone,
  today,
  leaders,
  memberNames,
}: MyVisitsProps) {
  const [openWindow, setOpenWindow] = useState<OpenWindow>(null);
  // Each window closes only itself (defect 100-D1): Contact → Schedule swaps one for another.
  const closeWindow = (kind: NonNullable<OpenWindow>["kind"]) =>
    setOpenWindow((current) => (current?.kind === kind ? null : current));

  if (rows === null) {
    return (
      <p className="text-sm text-muted">
        The bishopric has no visit goal right now, so no households are assigned.
      </p>
    );
  }

  const sorted = [...rows].sort(compareRows);
  const asOfDate = new Date(asOf);

  return (
    <div className="flex flex-col gap-3">
      <p className="text-sm text-muted">
        The households the bishopric gave you to visit. A finished visit takes one off this list
        and off your To Do.
      </p>

      {sorted.length === 0 ? (
        <p className="text-sm text-muted">No households are assigned to you right now.</p>
      ) : (
        <ul className="flex flex-col gap-2">
          {sorted.map((row) => (
            <HouseholdPriorityCard
              key={row.householdId}
              row={row}
              asOf={asOfDate}
              onContact={row.doNotContact ? undefined : () => setOpenWindow({ kind: "contact", row })}
              onLogVisit={
                canLog && !row.doNotContact
                  ? () => setOpenWindow({ kind: "log", householdId: row.householdId })
                  : undefined
              }
            />
          ))}
        </ul>
      )}

      <Modal isOpen={openWindow?.kind === "log"} onClose={() => closeWindow("log")} title="Log a visit">
        {openWindow?.kind === "log" ? (
          <VisitLogForm
            key={openWindow.householdId}
            households={householdOptions}
            today={today}
            user={user}
            leaders={leaders}
            memberNames={memberNames}
            initialHouseholdId={openWindow.householdId}
          />
        ) : null}
      </Modal>

      <Modal
        isOpen={openWindow?.kind === "contact"}
        onClose={() => closeWindow("contact")}
        title={openWindow?.kind === "contact" ? `Contact — ${openWindow.row.familyName}` : "Contact"}
      >
        {openWindow?.kind === "contact" ? (
          <ContactPanel
            key={openWindow.row.householdId}
            householdId={openWindow.row.householdId}
            familyName={openWindow.row.familyName}
            contacts={householdContacts[openWindow.row.householdId] ?? []}
            canLog={canLog}
            today={today}
            onSchedule={
              canLog
                ? () => setOpenWindow({ kind: "appointments", householdId: openWindow.row.householdId })
                : undefined
            }
          />
        ) : null}
      </Modal>

      <Modal
        isOpen={openWindow?.kind === "appointments"}
        onClose={() => closeWindow("appointments")}
        title="Appointments"
      >
        {openWindow?.kind === "appointments" ? (
          <AppointmentPanel
            key={openWindow.householdId}
            appointments={appointments}
            households={householdOptions}
            canBook={canLog}
            wardTimeZone={wardTimeZone}
            initialHouseholdId={openWindow.householdId}
          />
        ) : null}
      </Modal>
    </div>
  );
}
