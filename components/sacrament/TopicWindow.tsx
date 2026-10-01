"use client";

import { useId, useState } from "react";
import { ApprovalSafeSave } from "@/components/sacrament/ApprovalSafeSave";
import { Button } from "@/components/ui/Button";
import { FormError } from "@/components/ui/FormError";
import { Input } from "@/components/ui/Input";
import { Modal } from "@/components/ui/Modal";
import type { Assignment } from "@/lib/assignments/queries";
import { saveAssignment } from "@/lib/assignments/saveAssignment";
import { formatSundayLabelWithYear, type DateOnly } from "@/lib/calendar/dates";
import {
  HINT_LOOKBACK_MONTHS,
  similarTopicUses,
  timeAgoLabel,
  withinMonths,
  type TopicHistoryEntry,
} from "@/lib/topics/topicHistory";
import { MAX_TOPIC_TITLE } from "@/types/domain";

// THE TOPIC WINDOW on the Topics screen — the prototype's AssignTopicModal (Topics rebuild t3,
// upgraded in t5). A topic is the words typed for it (migration 086). It edits the topic and
// nothing else. On an OPEN slot, Save creates the talk as a sacrament talk.
//
// "USED BEFORE" is the ward's topic history, checked while you type (lib/topics/topicHistory.ts):
// one line per similar topic, its most recent use, newest first, over the last year and anything
// already planned. CHECK TOPIC says it in a sentence.
// Both need the history, which is bishopric-only (`topics.view`); without it they are absent.
//
// SUGGEST TOPICS asks Claude for ideas that avoid what the ward has heard lately and what is
// already planned (POST /api/assignments/topic-suggestions). They are DRAFTS: tapping one only
// fills the box, and nothing reaches the talk until Save (CLAUDE.md rule 3). The route stores none.

type TopicIdea = { title: string; why: string };

export type TopicWindowProps = {
  sundayId: string;
  slotNumber: number;
  totalTalks: number;
  assignment: Assignment | null;
  approvedNames: readonly string[];
  // Who changing the topic would affect — scheduled or accepted (ITER-036, D4). Null for nobody.
  changeWarning: string | null;
  // Null for a reader without `topics.view`: no hint and no Check topic.
  history: readonly TopicHistoryEntry[] | null;
  today: DateOnly;
  onClose: () => void;
  onSaved: () => void;
};

function usedLabel(entry: TopicHistoryEntry, today: DateOnly): string {
  return entry.isUpcoming
    ? `coming up ${formatSundayLabelWithYear(entry.date)}`
    : timeAgoLabel(entry.date, today);
}

function checkSentence(
  text: string,
  history: readonly TopicHistoryEntry[],
  today: DateOnly,
): string {
  const [match] = similarTopicUses(text, history);
  if (match === undefined) return "No similar topic found in the ward's history.";
  return match.isUpcoming
    ? `Similar topic “${match.topicTitle}” is already planned for ${formatSundayLabelWithYear(match.date)}.`
    : `Similar topic “${match.topicTitle}” was used ${timeAgoLabel(match.date, today)}.`;
}

async function fetchIdeas(body: {
  sundayId: string;
  context: string;
  alreadyOffered: string[];
}): Promise<{ ok: true; ideas: TopicIdea[] } | { ok: false; message: string }> {
  try {
    const response = await fetch("/api/assignments/topic-suggestions", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    const payload = (await response.json().catch(() => ({}))) as {
      suggestions?: TopicIdea[];
      error?: string;
    };
    if (!response.ok) {
      return { ok: false, message: payload.error ?? "Could not suggest topics. Please try again." };
    }
    return { ok: true, ideas: payload.suggestions ?? [] };
  } catch (error) {
    console.error("Could not fetch topic suggestions", error);
    return { ok: false, message: "Could not reach the server. Check your connection and try again." };
  }
}

export function TopicWindow({
  sundayId,
  slotNumber,
  totalTalks,
  assignment,
  approvedNames,
  changeWarning,
  history,
  today,
  onClose,
  onSaved,
}: TopicWindowProps) {
  const hintId = useId();
  const [topic, setTopic] = useState(assignment?.topicTitle ?? "");
  const [isSaving, setIsSaving] = useState(false);
  const [formError, setFormError] = useState<string>();
  const [checkResult, setCheckResult] = useState<string>();
  const [showSuggest, setShowSuggest] = useState(false);
  const [context, setContext] = useState("");
  const [ideas, setIdeas] = useState<TopicIdea[]>([]);
  const [isThinking, setIsThinking] = useState(false);
  const [suggestError, setSuggestError] = useState<string>();

  // "Used before" and Check topic look back ONE YEAR (the user's decision walking scenario 084),
  // plus anything already planned. HINT_LOOKBACK_MONTHS is the one place to change it.
  const recentHistory =
    history === null ? null : withinMonths(history, HINT_LOOKBACK_MONTHS, today);
  const similar = recentHistory === null ? [] : similarTopicUses(topic, recentHistory);

  async function save(): Promise<void> {
    setFormError(undefined);
    setIsSaving(true);
    const fields = { topicTitle: topic.trim() };
    const result = await saveAssignment(
      assignment === null
        ? { kind: "create", sundayId, slotNumber, assignmentType: "sacrament_talk", fields }
        : { kind: "update", assignmentId: assignment.id, fields },
    );
    setIsSaving(false);

    if (!result.ok) {
      setFormError(result.message);
      return;
    }
    onSaved();
  }

  async function suggest(more: boolean): Promise<void> {
    setIsThinking(true);
    setSuggestError(undefined);
    const offered = more ? ideas.map((idea) => idea.title) : [];
    const result = await fetchIdeas({ sundayId, context, alreadyOffered: offered });
    setIsThinking(false);

    if (!result.ok) {
      setSuggestError(result.message);
      return;
    }
    const fresh = result.ideas.filter(
      (idea) => !offered.some((title) => title.toLowerCase() === idea.title.toLowerCase()),
    );
    setIdeas(more ? [...ideas, ...fresh] : fresh);
    if (fresh.length === 0) {
      setSuggestError("No new ideas this time. Try adding some context, or ask again.");
    }
  }

  return (
    <Modal isOpen onClose={onClose} title={assignment?.topicTitle ? "Change topic" : "Set a topic"}>
      <div className="flex flex-col gap-4">
        <p className="text-sm text-muted">
          Talk {slotNumber} of {totalTalks}
        </p>

        <div className="flex flex-col gap-2">
          <Input
            id="topic-window-topic"
            label="Topic"
            value={topic}
            maxLength={MAX_TOPIC_TITLE}
            placeholder="Type a topic…"
            autoFocus
            disabled={isSaving}
            aria-describedby={similar.length > 0 ? hintId : undefined}
            onChange={(event) => {
              setTopic(event.target.value);
              setCheckResult(undefined);
            }}
          />

          {similar.length > 0 && (
            <div id={hintId} className="rounded-md border border-warning px-3 py-2" role="status">
              <p className="text-xs font-semibold text-foreground">Used before, most recent first</p>
              <ul className="mt-1 flex flex-col gap-0.5">
                {similar.map((entry) => (
                  <li key={entry.assignmentId} className="text-sm text-foreground">
                    &ldquo;{entry.topicTitle}&rdquo;{" "}
                    <span className="text-muted">— {usedLabel(entry, today)}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}

          <div className="flex flex-wrap gap-2">
            {recentHistory !== null && (
              <Button
                type="button"
                variant="secondary"
                disabled={topic.trim() === ""}
                onClick={() => setCheckResult(checkSentence(topic, recentHistory, today))}
              >
                Check topic
              </Button>
            )}
            <Button
              type="button"
              variant="secondary"
              aria-expanded={showSuggest}
              onClick={() => setShowSuggest((open) => !open)}
            >
              Suggest topics
            </Button>
          </div>

          {checkResult !== undefined && (
            <p className="text-sm text-foreground" role="status">
              {checkResult}
            </p>
          )}
        </div>

        {showSuggest && (
          <section
            aria-label="Topic suggestions"
            className="flex flex-col gap-3 rounded-md border border-border p-3"
          >
            <Input
              id="topic-window-context"
              label="Add context to steer the suggestions (optional)"
              value={context}
              maxLength={300}
              placeholder="e.g. something for the youth, or the week after general conference"
              onChange={(event) => setContext(event.target.value)}
            />
            <Button type="button" onClick={() => suggest(false)} disabled={isThinking}>
              {isThinking && ideas.length === 0 ? "Thinking…" : "Get suggestions"}
            </Button>

            {ideas.length > 0 && (
              <ul className="flex flex-col gap-2">
                {ideas.map((idea) => (
                  <li key={idea.title}>
                    <button
                      type="button"
                      onClick={() => {
                        setTopic(idea.title);
                        setCheckResult(undefined);
                      }}
                      className="flex min-h-11 w-full flex-col items-start rounded-md border border-border px-3 py-2 text-left hover:bg-surface focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
                    >
                      <span className="text-sm font-medium text-foreground">{idea.title}</span>
                      <span className="text-xs text-muted">{idea.why}</span>
                    </button>
                  </li>
                ))}
              </ul>
            )}

            {ideas.length > 0 && (
              <Button
                type="button"
                variant="secondary"
                onClick={() => suggest(true)}
                disabled={isThinking}
              >
                {isThinking ? "Thinking…" : "More suggestions"}
              </Button>
            )}

            <FormError message={suggestError} />
            <p className="text-xs text-muted">
              Suggestions are drafts. Nothing is saved until you press Save.
            </p>
          </section>
        )}

        <FormError message={formError} />

        <ApprovalSafeSave
          onCancel={onClose}
          onSave={save}
          isSaving={isSaving}
          saveDisabled={topic.trim() === ""}
          approvedCount={approvedNames.length}
          approvedNames={approvedNames}
          extraWarning={changeWarning}
        />
      </div>
    </Modal>
  );
}
