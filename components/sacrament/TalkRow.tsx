"use client";

import { useId, useState, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import type { ReliabilityFlagKind } from "@/components/roster/ReliabilityFlag";
import { SpeakerWindow, type SpeakerDirectoryEntry } from "@/components/sacrament/SpeakerWindow";
import { TalkDetailsWindow } from "@/components/sacrament/TalkDetailsWindow";
import { TopicWindow } from "@/components/sacrament/TopicWindow";
import { Button } from "@/components/ui/Button";
import { FormError } from "@/components/ui/FormError";
import { Pill } from "@/components/ui/Pill";
import { describeInvalidation } from "@/lib/assignments/invalidation";
import type { Assignment, SpeakerHistoryRow } from "@/lib/assignments/queries";
import type { DateOnly } from "@/lib/calendar/dates";
import type { TopicHistoryEntry } from "@/lib/topics/topicHistory";
import { saveAssignment } from "@/lib/assignments/saveAssignment";
import type { TalkAskInput } from "@/lib/sacrament/talkAsks";
import { speakerTag, topicTag } from "@/lib/sacrament/talkRowStatus";
import { ASSIGNMENT_TYPE_LABELS } from "@/types/domain";

// ONE TALK ON THE TOPICS SCREEN (Topics rebuild t3) — the prototype's ModuleView row. A title line
// with Details and Delete, then a SPEAKER line and a TOPIC line, each opening its own window and
// each carrying its own tag and Clear.
//
// CLEAR IS A SIBLING OF THE LINE'S BUTTON, never inside it: a button inside a button is invalid
// HTML and a screen reader cannot reach the inner one.
//
// WITHOUT `talks.plan` the lines are plain text and there is no Clear, Delete or window — absent,
// never disabled (StatusPill's rule).
//
// Every edit here clears the talk's approvals, so Clear and both windows WARN first when there are
// any (describeInvalidation). Delete does not need to: the talk is cancelled whole.
//
// Small visible buttons keep 44px tap targets through `min-h-11` (the StatusPill pattern).

export type TalkRowProps = {
  // The speaker window's list: active members (slim), their speaking history (null unless the reader
  // is in the bishopric, talks-d) and the day "last spoke …" is measured to.
  speakerDirectory: {
    members: readonly SpeakerDirectoryEntry[];
    historyByMember: Readonly<Record<string, readonly SpeakerHistoryRow[]>> | null;
    today: DateOnly;
  };
  sundayId: string;
  slotNumber: number;
  totalTalks: number;
  // Null is an OPEN slot: nothing planned yet. Its first save creates the talk.
  assignment: Assignment | null;
  // Resolved on the server through speakerDisplayName(), so the row never holds the roster.
  speakerName: string | null;
  ask: TalkAskInput;
  approvedNames: readonly string[];
  speakerFlags?: Readonly<Record<string, readonly ReliabilityFlagKind[]>>;
  // The ward's topic history for the topic window's "Used before" hint and Check topic. Null
  // without `topics.view` (bishopric-only), which leaves both absent.
  topicHistory: readonly TopicHistoryEntry[] | null;
  // Who will find "let them know" on their To Do if this talk is deleted — "You", a name, or null
  // when nobody was ever asked. Resolved on the server through whoLetsThemKnow().
  tellerName: string | null;
  canPlan: boolean;
  // `talks.plan` AND `calendar.manage` — what the remove action asserts.
  canRemove: boolean;
  // The Details window's panels, rendered by the server page. Null for an open slot.
  details: { approvals: ReactNode; contacting: ReactNode; comments: ReactNode } | null;
};

const SMALL_BUTTON =
  "min-h-11 px-2 text-sm text-primary underline-offset-4 hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary disabled:opacity-60";

const LINE_BUTTON =
  "flex min-h-11 min-w-0 flex-1 items-center rounded-md px-1 text-left focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary hover:bg-surface";

type Window = "speaker" | "topic" | "details" | null;
type Clearing = "speaker" | "topic" | null;

export function TalkRow({
  speakerDirectory,
  sundayId,
  slotNumber,
  totalTalks,
  assignment,
  speakerName,
  ask,
  approvedNames,
  speakerFlags,
  tellerName,
  topicHistory,
  canPlan,
  canRemove,
  details,
}: TalkRowProps) {
  const router = useRouter();
  const warningId = useId();
  const [openWindow, setOpenWindow] = useState<Window>(null);
  const [confirmingClear, setConfirmingClear] = useState<Clearing>(null);
  const [confirmingRemove, setConfirmingRemove] = useState(false);
  const [isBusy, setIsBusy] = useState(false);
  const [rowError, setRowError] = useState<string>();
  const [rowWarning, setRowWarning] = useState<string>();

  const topicTitle = assignment?.topicTitle ?? null;
  const speaker = speakerTag(ask);
  const topic = topicTag(topicTitle);
  const hasSpeaker = speakerName !== null || ask.hasSpeaker;
  const hasApprovals = approvedNames.length > 0;
  const category =
    assignment?.assignmentType && assignment.assignmentType !== "sacrament_talk"
      ? ASSIGNMENT_TYPE_LABELS[assignment.assignmentType]
      : null;

  function saved(): void {
    setOpenWindow(null);
    router.refresh();
  }

  async function clear(what: "speaker" | "topic"): Promise<void> {
    if (assignment === null) return;
    if (hasApprovals && confirmingClear !== what) {
      setConfirmingClear(what);
      return;
    }

    setIsBusy(true);
    setRowError(undefined);
    const result = await saveAssignment({
      kind: "update",
      assignmentId: assignment.id,
      fields:
        what === "speaker" ? { memberId: null, externalSpeaker: null } : { topicTitle: null },
    });
    setIsBusy(false);
    setConfirmingClear(null);

    if (!result.ok) {
      setRowError(result.message);
      return;
    }
    router.refresh();
  }

  async function remove(): Promise<void> {
    if (assignment === null) return;
    setIsBusy(true);
    setRowError(undefined);

    try {
      const response = await fetch(`/api/assignments/${assignment.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "remove" }),
      });
      const payload = (await response.json().catch(() => ({}))) as {
        error?: string;
        warning?: string | null;
      };

      if (!response.ok) {
        setRowError(payload.error ?? "Could not remove that talk. Please try again.");
        return;
      }
      if (payload.warning) setRowWarning(payload.warning);
      setConfirmingRemove(false);
      router.refresh();
    } catch (error) {
      console.error("Could not remove a talk", error);
      setRowError("Could not reach the server. Check your connection and try again.");
    } finally {
      setIsBusy(false);
    }
  }

  const speakerText = (
    <span className={speakerName === null ? "text-muted" : "font-medium text-foreground"}>
      {speakerName ?? "Nobody yet"}
    </span>
  );
  const topicText = (
    <span className={`text-sm ${topicTitle === null ? "text-muted" : "text-foreground"}`}>
      {topicTitle ?? "No topic yet"}
    </span>
  );

  return (
    <div className="flex flex-col gap-1 border-b border-border py-2 last:border-b-0">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-sm font-semibold text-foreground">
          Talk {slotNumber}
          {category !== null && (
            <Pill tone="neutral" className="ml-2 align-middle font-normal">
              {category}
            </Pill>
          )}
        </h2>
        {assignment !== null && (
          <div className="flex items-center gap-1">
            <button type="button" className={SMALL_BUTTON} onClick={() => setOpenWindow("details")}>
              Details
            </button>
            {canRemove && totalTalks > 1 && (
              <button
                type="button"
                className={`${SMALL_BUTTON} text-danger`}
                onClick={() => setConfirmingRemove(true)}
                disabled={isBusy}
              >
                Delete
              </button>
            )}
          </div>
        )}
      </div>

      {confirmingRemove && (
        <div role="group" aria-labelledby={`${warningId}-remove`} className="flex flex-col gap-2 rounded-md border border-danger p-3">
          <p id={`${warningId}-remove`} className="text-sm text-foreground">
            Remove talk {slotNumber}?
            {tellerName !== null &&
              speakerName !== null &&
              ` ${tellerName} will be asked to let ${speakerName} know.`}
            {slotNumber < totalTalks && " Later talks move up."}
          </p>
          <div className="flex flex-wrap gap-2">
            <Button type="button" variant="danger" onClick={remove} disabled={isBusy}>
              {isBusy ? "Removing…" : "Remove talk"}
            </Button>
            <Button type="button" variant="secondary" onClick={() => setConfirmingRemove(false)} disabled={isBusy}>
              Keep
            </Button>
          </div>
        </div>
      )}

      <div className="flex items-center gap-2">
        {canPlan ? (
          <button type="button" className={LINE_BUTTON} onClick={() => setOpenWindow("speaker")}>
            <span className="sr-only">Speaker for talk {slotNumber}:</span>{" "}
            {speakerText}
          </button>
        ) : (
          <span className="flex min-h-11 flex-1 items-center px-1">{speakerText}</span>
        )}
        <Pill tone={speaker.tone}>{speaker.label}</Pill>
        {canPlan && assignment !== null && hasSpeaker && (
          <button type="button" className={SMALL_BUTTON} onClick={() => clear("speaker")} disabled={isBusy}>
            {confirmingClear === "speaker" ? "Clear and reset approvals" : "Clear"}
            {" "}
            <span className="sr-only">the speaker for talk {slotNumber}</span>
          </button>
        )}
      </div>

      <div className="flex items-center gap-2">
        {canPlan ? (
          <button type="button" className={LINE_BUTTON} onClick={() => setOpenWindow("topic")}>
            <span className="sr-only">Topic for talk {slotNumber}:</span>{" "}
            {topicText}
          </button>
        ) : (
          <span className="flex min-h-11 flex-1 items-center px-1">{topicText}</span>
        )}
        <Pill tone={topic.tone}>{topic.label}</Pill>
        {canPlan && assignment !== null && topicTitle !== null && (
          <button type="button" className={SMALL_BUTTON} onClick={() => clear("topic")} disabled={isBusy}>
            {confirmingClear === "topic" ? "Clear and reset approvals" : "Clear"}
            {" "}
            <span className="sr-only">the topic for talk {slotNumber}</span>
          </button>
        )}
      </div>

      {confirmingClear !== null && (
        <p className="text-sm text-warning" role="status">
          {describeInvalidation(approvedNames.length, approvedNames, "clear")}
        </p>
      )}
      <FormError message={rowError} />
      {rowWarning !== undefined && (
        <p className="text-sm text-warning" role="status">
          {rowWarning}
        </p>
      )}

      {openWindow === "speaker" && (
        <SpeakerWindow
          sundayId={sundayId}
          slotNumber={slotNumber}
          totalTalks={totalTalks}
          assignment={assignment}
          speakerName={speakerName}
          approvedNames={approvedNames}
          members={speakerDirectory.members}
          historyByMember={speakerDirectory.historyByMember}
          speakerFlags={speakerFlags}
          today={speakerDirectory.today}
          onClose={() => setOpenWindow(null)}
          onSaved={saved}
        />
      )}
      {openWindow === "topic" && (
        <TopicWindow
          sundayId={sundayId}
          slotNumber={slotNumber}
          totalTalks={totalTalks}
          assignment={assignment}
          approvedNames={approvedNames}
          history={topicHistory}
          today={speakerDirectory.today}
          onClose={() => setOpenWindow(null)}
          onSaved={saved}
        />
      )}
      {openWindow === "details" && assignment !== null && details !== null && (
        <TalkDetailsWindow
          slotNumber={slotNumber}
          assignmentId={assignment.id}
          slotLengthMinutes={assignment.slotLengthMinutes}
          canPlan={canPlan}
          approvedNames={approvedNames}
          approvals={details.approvals}
          contacting={details.contacting}
          comments={details.comments}
          onClose={() => setOpenWindow(null)}
          onSaved={() => router.refresh()}
        />
      )}
    </div>
  );
}
