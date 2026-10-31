"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { RegistrationCard } from "@/app/(app)/zoom/RegistrationCard";
import { RegistrationQuestionsModal } from "@/app/(app)/zoom/RegistrationQuestionsModal";
import { RegistrationSettingsModal } from "@/app/(app)/zoom/RegistrationSettingsModal";
import { Button } from "@/components/ui/Button";
import { FormError } from "@/components/ui/FormError";
import type { RegistrationQuestion } from "@/lib/zoom/registrationQuestions";
import {
  type BishopricPerson,
  describeRegistrationRow,
  splitRegistrations,
  waitingOnNames,
} from "@/lib/zoom/registrationRow";
import type { ZoomRegistration } from "@/lib/zoom/registrations";
import type { RegistrationSettings } from "@/lib/zoom/registrationSettings";
import type { SessionUser } from "@/types/domain";

// THE SIGN-UPS TAB (ITER-052) — public requests for a stream link. The bishopric, the ward clerk and
// the executive secretary read it (migration 096). Waiting requests first, oldest first; then the
// decided ones, newest first, shortened after ten. Each list is grouped by the day the request
// arrived, with alternating shading (the user's standing rule for chronological lists).
//
// Rendered from props and refreshed with router.refresh() after every write, as the Invitees tab is.

const RECENT_SHOWN = 10;

export type RegistrationsPanelProps = {
  registrations: ZoomRegistration[];
  settings: RegistrationSettings | null;
  registrationUrl: string | null;
  siteIsTemporary: boolean;
  questions: RegistrationQuestion[];
  canManage: boolean;
  canManageQuestions: boolean;
  // Who serves in the bishopric now. "Waiting on" is computed against it on read (z3b).
  bishopric: BishopricPerson[];
  // Private decline notes, keyed by sign-up id. Empty for anybody but the bishopric (migration 098).
  declineNotes: Record<string, string>;
  user: SessionUser;
};

type CardContext = {
  all: ZoomRegistration[];
  bishopric: BishopricPerson[];
  declineNotes: Record<string, string>;
  canManage: boolean;
  user: SessionUser;
  onChanged: () => void;
};

type DayGroup = { dayKey: string; registrations: ZoomRegistration[] };

function groupByDay(registrations: ZoomRegistration[], all: ZoomRegistration[]): DayGroup[] {
  const groups: DayGroup[] = [];
  for (const registration of registrations) {
    const { dayKey } = describeRegistrationRow(registration, all);
    const last = groups[groups.length - 1];
    if (last && last.dayKey === dayKey) last.registrations.push(registration);
    else groups.push({ dayKey, registrations: [registration] });
  }
  return groups;
}

function DayGroups({ registrations, context }: { registrations: ZoomRegistration[]; context: CardContext }) {
  return (
    <ul className="flex flex-col gap-2">
      {groupByDay(registrations, context.all).map((group, index) => (
        <li
          key={group.dayKey}
          className={`flex flex-col gap-2 rounded-lg p-2 ${index % 2 === 1 ? "bg-gold-soft" : ""}`}
        >
          <ul className="flex flex-col gap-1">
            {group.registrations.map((registration) => (
              <li key={registration.id}>
                <RegistrationCard
                  row={describeRegistrationRow(registration, context.all)}
                  approval={
                    registration.status === "pending"
                      ? waitingOnNames(registration, context.bishopric, context.user.id)
                      : null
                  }
                  saysMember={registration.saysMember}
                  memberId={registration.memberId}
                  isDeclined={registration.status === "declined"}
                  canManage={context.canManage}
                  declineNote={context.declineNotes[registration.id] ?? null}
                  user={context.user}
                  onChanged={context.onChanged}
                />
              </li>
            ))}
          </ul>
        </li>
      ))}
    </ul>
  );
}

function settingsSentence(settings: RegistrationSettings): string {
  if (!settings.isOpen) return "The sign-up page is closed.";
  return settings.autoApprove
    ? "The sign-up page is open. Requests are approved automatically."
    : "The sign-up page is open. Every serving member of the bishopric approves each request.";
}

export function RegistrationsPanel({
  registrations,
  settings,
  registrationUrl,
  siteIsTemporary,
  questions,
  canManage,
  canManageQuestions,
  bishopric,
  declineNotes,
  user,
}: RegistrationsPanelProps) {
  const router = useRouter();
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const [isQuestionsOpen, setIsQuestionsOpen] = useState(false);
  const [showAllRecent, setShowAllRecent] = useState(false);
  const [isSettingUp, setIsSettingUp] = useState(false);
  const [error, setError] = useState<string | undefined>();

  const { waiting, recent } = splitRegistrations(registrations);
  const shownRecent = showAllRecent ? recent : recent.slice(0, RECENT_SHOWN);
  const context: CardContext = {
    all: registrations,
    bishopric,
    declineNotes,
    canManage,
    user,
    onChanged: () => router.refresh(),
  };

  async function setUp() {
    setIsSettingUp(true);
    setError(undefined);
    try {
      const response = await fetch("/api/zoom/registration-settings", { method: "POST" });
      if (!response.ok) {
        let message = "Could not set up sign-ups. Please try again.";
        try {
          const parsed = (await response.json()) as { error?: unknown };
          if (typeof parsed.error === "string") message = parsed.error;
        } catch {
          message = "The server sent a response this page could not read.";
        }
        throw new Error(message);
      }
      router.refresh();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Could not set up sign-ups.");
    } finally {
      setIsSettingUp(false);
    }
  }

  if (!settings) {
    return (
      <div className="flex flex-col gap-3">
        <p className="text-sm text-muted">
          A public page where people can ask for a link to watch the stream.{" "}
          {canManage ? "It starts closed." : "The bishopric can set it up here."}
        </p>
        {canManage ? (
          <div>
            <Button onClick={() => void setUp()} disabled={isSettingUp}>
              {isSettingUp ? "Setting up…" : "Set up sign-ups"}
            </Button>
          </div>
        ) : null}
        <FormError message={error} />
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm text-muted">{settingsSentence(settings)}</p>
        <div className="flex gap-2">
          {canManage ? (
            <Button variant="secondary" onClick={() => setIsSettingsOpen(true)}>
              Settings
            </Button>
          ) : null}
          {canManageQuestions ? (
            <Button variant="secondary" onClick={() => setIsQuestionsOpen(true)}>
              Questions
            </Button>
          ) : null}
        </div>
      </div>

      {registrations.length === 0 ? <p className="text-sm text-muted">Nobody has signed up yet.</p> : null}

      {waiting.length > 0 ? (
        <section className="flex flex-col gap-2" aria-labelledby="zoom-signups-waiting">
          <h2 id="zoom-signups-waiting" className="text-sm font-semibold text-foreground">
            Waiting
          </h2>
          <DayGroups registrations={waiting} context={context} />
        </section>
      ) : null}

      {recent.length > 0 ? (
        <section className="flex flex-col gap-2" aria-labelledby="zoom-signups-recent">
          <h2 id="zoom-signups-recent" className="text-sm font-semibold text-foreground">
            Recent
          </h2>
          <DayGroups registrations={shownRecent} context={context} />
          {recent.length > RECENT_SHOWN ? (
            <div>
              <Button variant="secondary" onClick={() => setShowAllRecent(!showAllRecent)}>
                {showAllRecent ? "Show fewer" : `Show ${recent.length - RECENT_SHOWN} more`}
              </Button>
            </div>
          ) : null}
        </section>
      ) : null}

      {canManage ? (
        <RegistrationSettingsModal
          isOpen={isSettingsOpen}
          onClose={() => setIsSettingsOpen(false)}
          onSaved={() => router.refresh()}
          settings={settings}
          registrationUrl={registrationUrl}
          siteIsTemporary={siteIsTemporary}
        />
      ) : null}

      {canManageQuestions ? (
        <RegistrationQuestionsModal
          isOpen={isQuestionsOpen}
          onClose={() => setIsQuestionsOpen(false)}
          onSaved={() => router.refresh()}
          questions={questions}
        />
      ) : null}
    </div>
  );
}
