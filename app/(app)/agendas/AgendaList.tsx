"use client";

import { useState } from "react";
import Link from "next/link";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { FormError } from "@/components/ui/FormError";
import { Input } from "@/components/ui/Input";
import { openActionItems, type ActionItem } from "@/lib/agendas/carryForward";
import type { Agenda } from "@/lib/agendas/queries";
import { formatMeetingDateLabel } from "@/lib/calendar/dates";
import { MEETING_TYPES, MEETING_TYPE_LABELS, type MeetingType } from "@/types/domain";

// The list of meetings, and the form that starts a new one.
//
// It imports `Agenda` as a TYPE from lib/agendas/queries.ts, which is server-only — a type import
// is erased at compile time and pulls nothing into the bundle. The VALUES it uses come from
// lib/agendas/carryForward.ts and lib/calendar/dates.ts, both pure. That split is the whole reason
// the agenda modules are three files rather than one.

export const AGENDAS_QUERY_KEY = "agendas";

type AgendaListPayload = {
  agendas: Agenda[];
  actionItems: Record<string, ActionItem[]>;
};

async function fetchAgendas(): Promise<AgendaListPayload> {
  const response = await fetch("/api/agendas");
  if (!response.ok) {
    const body = (await response.json().catch(() => ({}))) as { error?: string };
    throw new Error(body.error ?? "Could not load the agendas.");
  }
  return (await response.json()) as AgendaListPayload;
}

// The next occurrence of a weekday, as a YYYY-MM-DD string in the BROWSER's zone.
//
// A default for the date field, not a stored value — the person confirms or changes it before
// anything is written. The browser's zone is right here for the same reason it is wrong for an
// event time: this is "what day is it where the person typing is", not an instant anybody has to
// turn up at.
function defaultMeetingDate(): string {
  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, "0");
  const day = String(now.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

type AgendaListProps = {
  initialAgendas: Agenda[];
  initialActionItems: Record<string, ActionItem[]>;
  canManage: boolean;
  canPublish: boolean;
};

export function AgendaList({
  initialAgendas,
  initialActionItems,
  canManage,
}: AgendaListProps) {
  const queryClient = useQueryClient();

  const [creating, setCreating] = useState(false);
  const [meetingType, setMeetingType] = useState<MeetingType>("ward_council");
  const [meetingDate, setMeetingDate] = useState(defaultMeetingDate);
  const [error, setError] = useState<string | undefined>(undefined);

  const agendasQuery = useQuery({
    queryKey: [AGENDAS_QUERY_KEY],
    queryFn: fetchAgendas,
    initialData: { agendas: initialAgendas, actionItems: initialActionItems },
  });

  const createMutation = useMutation({
    mutationFn: async (input: { meetingType: MeetingType; meetingDate: string }) => {
      const response = await fetch("/api/agendas", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(input),
      });
      const body = (await response.json().catch(() => ({}))) as {
        error?: string;
        carriedActionItems?: number;
      };
      if (!response.ok) throw new Error(body.error ?? "Could not create the agenda.");
      return body;
    },
    onSuccess: () => {
      setCreating(false);
      setError(undefined);
      void queryClient.invalidateQueries({ queryKey: [AGENDAS_QUERY_KEY] });
    },
    onError: (mutationError: Error) => setError(mutationError.message),
  });

  const agendas = agendasQuery.data?.agendas ?? [];
  const actionItems = agendasQuery.data?.actionItems ?? {};

  return (
    <div className="flex flex-col gap-4">
      {canManage ? (
        <Card>
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <h2 className="text-base font-semibold text-foreground">Start an agenda</h2>
              <p className="mt-1 text-sm text-muted">
                Open action items and anything flagged for the ward council are added for you.
              </p>
            </div>
            <Button variant="secondary" onClick={() => setCreating((open) => !open)}>
              {creating ? "Never mind" : "New agenda"}
            </Button>
          </div>

          {creating ? (
            <form
              className="mt-4 flex flex-col gap-3"
              onSubmit={(event) => {
                event.preventDefault();
                createMutation.mutate({ meetingType, meetingDate });
              }}
            >
              {/* min-w-0 on the flex children: a flex item defaults to min-width:auto and refuses
                  to shrink below its content, which is what overflowed a <select> at 375px in
                  scenario 059. */}
              <div className="flex flex-wrap gap-3">
                <div className="flex min-w-0 flex-1 flex-col gap-1.5">
                  <label
                    htmlFor="agenda-meeting-type"
                    className="text-sm font-medium text-foreground"
                  >
                    Meeting
                  </label>
                  <select
                    id="agenda-meeting-type"
                    className="min-h-11 w-full rounded-md border border-border bg-surface-raised px-3 py-2 text-base text-foreground focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
                    value={meetingType}
                    onChange={(event) => setMeetingType(event.target.value as MeetingType)}
                  >
                    {MEETING_TYPES.map((type) => (
                      <option key={type} value={type}>
                        {MEETING_TYPE_LABELS[type]}
                      </option>
                    ))}
                  </select>
                </div>

                <div className="min-w-0 flex-1">
                  <Input
                    id="agenda-meeting-date"
                    label="Date"
                    type="date"
                    value={meetingDate}
                    onChange={(event) => setMeetingDate(event.target.value)}
                    required
                  />
                </div>
              </div>

              <FormError message={error} />

              <div>
                <Button type="submit" disabled={createMutation.isPending}>
                  {createMutation.isPending ? "Creating…" : "Create agenda"}
                </Button>
              </div>
            </form>
          ) : null}
        </Card>
      ) : null}

      {agendas.length === 0 ? (
        <Card>
          <p className="text-sm text-muted">
            No agendas yet.{" "}
            {canManage
              ? "Start one above and it will pick up anything waiting for the ward council."
              : "One will appear here once a secretary or a member of the bishopric creates it."}
          </p>
        </Card>
      ) : (
        <ul className="flex flex-col gap-3">
          {agendas.map((agenda) => {
            const items = actionItems[agenda.id] ?? [];
            const open = openActionItems(items).length;

            return (
              <li key={agenda.id}>
                <Card>
                  <div className="flex flex-wrap items-baseline justify-between gap-2">
                    <div>
                      <Link
                        href={`/agendas/${agenda.id}`}
                        className="text-base font-semibold text-primary underline underline-offset-4"
                      >
                        {MEETING_TYPE_LABELS[agenda.meetingType]}
                      </Link>
                      <p className="mt-1 text-sm text-foreground">
                        {formatMeetingDateLabel(agenda.meetingDate)}
                      </p>
                    </div>

                    <div className="flex flex-wrap items-center gap-2 text-xs">
                      {agenda.status === "published" ? (
                        <span className="rounded-full border border-border px-2 py-0.5 font-medium text-muted">
                          Published
                        </span>
                      ) : (
                        <span className="rounded-full border border-border px-2 py-0.5 font-medium text-muted">
                          Draft
                        </span>
                      )}
                      {agenda.emailSentAt === null ? null : (
                        <span className="rounded-full border border-border px-2 py-0.5 font-medium text-muted">
                          Emailed
                        </span>
                      )}
                    </div>
                  </div>

                  {/* The counts come off the same values the detail page renders — `itemCount` is
                      derived from `sections` in the mapper and never stored, so a card cannot
                      claim a number the page below it disagrees with (ITER-022). */}
                  <p className="mt-2 text-sm text-muted">
                    {agenda.itemCount === 1 ? "1 item" : `${agenda.itemCount} items`}
                    {open === 0
                      ? ""
                      : ` · ${open === 1 ? "1 open action item" : `${open} open action items`}`}
                  </p>
                </Card>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
