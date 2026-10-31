"use client";

import { useState } from "react";
import { Button } from "@/components/ui/Button";
import { FormError } from "@/components/ui/FormError";
import { Input } from "@/components/ui/Input";
import { Modal } from "@/components/ui/Modal";
import type { RegistrationQuestion } from "@/lib/zoom/registrationQuestions";
import type {
  ZoomRegistrationQuestionAudience,
  ZoomRegistrationQuestionKind,
} from "@/types/domain";

// THE SIGN-UP QUESTIONS WINDOW (ITER-052, plan P8). The bishopric, the ward clerk and the executive
// secretary edit the ward's own questions. A question is never deleted — it is turned off — and its
// kind is shown but cannot change, because answers already given were given to that kind.
//
// A follow-up (migration 097) is listed indented under its yes/no question and moves with it, so it
// has no arrows of its own. "Ask it" offers only the questions a follow-up may follow: yes/no, and
// not themselves follow-ups. The server checks the same rule and answers with a sentence.

export const AUDIENCE_LABELS: Record<ZoomRegistrationQuestionAudience, string> = {
  everyone: "Everyone",
  members: "Members only",
  non_members: "Non-members only",
};

const KIND_LABELS: Record<ZoomRegistrationQuestionKind, string> = {
  yes_no: "Yes / no",
  short_text: "Short answer",
};

const SELECT_CLASS =
  "min-h-11 rounded-md border border-border bg-surface-raised px-3 py-2 text-base text-foreground " +
  "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary";

async function readError(response: Response, fallback: string): Promise<string> {
  try {
    const parsed = (await response.json()) as { error?: unknown };
    return typeof parsed.error === "string" ? parsed.error : fallback;
  } catch {
    return "The server sent a response this page could not read.";
  }
}

async function send(url: string, method: "POST" | "PATCH", body: unknown, fallback: string) {
  const response = await fetch(url, {
    method,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!response.ok) throw new Error(await readError(response, fallback));
}

type Draft = {
  prompt: string;
  kind: ZoomRegistrationQuestionKind;
  audience: ZoomRegistrationQuestionAudience;
  isRequired: boolean;
  shownWhenYesTo: string | null;
};

const EMPTY_DRAFT: Draft = {
  prompt: "",
  kind: "yes_no",
  audience: "everyone",
  isRequired: false,
  shownWhenYesTo: null,
};

function followableQuestions(
  questions: readonly RegistrationQuestion[],
  questionId: string | null,
): RegistrationQuestion[] {
  return questions.filter(
    (question) =>
      question.kind === "yes_no" && question.shownWhenYesTo === null && question.id !== questionId,
  );
}

function FollowUpSelect({
  id,
  value,
  options,
  onChange,
  disabled,
}: {
  id: string;
  value: string | null;
  options: RegistrationQuestion[];
  onChange: (value: string | null) => void;
  disabled: boolean;
}) {
  if (options.length === 0) return null;
  return (
    <div className="flex flex-col gap-1.5">
      <label htmlFor={id} className="text-sm font-medium text-foreground">
        Ask it
      </label>
      <select
        id={id}
        value={value ?? ""}
        disabled={disabled}
        onChange={(event) => onChange(event.target.value === "" ? null : event.target.value)}
        className={SELECT_CLASS}
      >
        <option value="">Always</option>
        {options.map((question) => (
          <option key={question.id} value={question.id}>
            Only after Yes to: {question.prompt}
          </option>
        ))}
      </select>
    </div>
  );
}

function AudienceSelect({
  id,
  value,
  onChange,
  disabled,
}: {
  id: string;
  value: ZoomRegistrationQuestionAudience;
  onChange: (value: ZoomRegistrationQuestionAudience) => void;
  disabled: boolean;
}) {
  return (
    <div className="flex flex-col gap-1.5">
      <label htmlFor={id} className="text-sm font-medium text-foreground">
        Who is asked
      </label>
      <select
        id={id}
        value={value}
        disabled={disabled}
        onChange={(event) => onChange(event.target.value as ZoomRegistrationQuestionAudience)}
        className={SELECT_CLASS}
      >
        {(Object.keys(AUDIENCE_LABELS) as ZoomRegistrationQuestionAudience[]).map((audience) => (
          <option key={audience} value={audience}>
            {AUDIENCE_LABELS[audience]}
          </option>
        ))}
      </select>
    </div>
  );
}

function RequiredBox({
  id,
  checked,
  onChange,
  disabled,
}: {
  id: string;
  checked: boolean;
  onChange: (checked: boolean) => void;
  disabled: boolean;
}) {
  return (
    <label htmlFor={id} className="flex min-h-11 items-center gap-2 text-sm text-foreground">
      <input
        id={id}
        type="checkbox"
        checked={checked}
        disabled={disabled}
        onChange={(event) => onChange(event.target.checked)}
        className="size-5"
      />
      They must answer it
    </label>
  );
}

function QuestionItem({
  question,
  parent,
  followableOptions,
  isFirstActive,
  isLastActive,
  isBusy,
  onPatch,
}: {
  question: RegistrationQuestion;
  parent: RegistrationQuestion | null;
  followableOptions: RegistrationQuestion[] | null;
  isFirstActive: boolean;
  isLastActive: boolean;
  isBusy: boolean;
  onPatch: (body: Record<string, unknown>) => Promise<boolean>;
}) {
  const [isEditing, setIsEditing] = useState(false);
  const [prompt, setPrompt] = useState(question.prompt);
  const [audience, setAudience] = useState(question.audience);
  const [isRequired, setIsRequired] = useState(question.isRequired);
  const [shownWhenYesTo, setShownWhenYesTo] = useState(question.shownWhenYesTo);

  async function saveEdit() {
    const body: Record<string, unknown> = { prompt, audience, isRequired };
    if (followableOptions !== null) body.shownWhenYesTo = shownWhenYesTo;
    const saved = await onPatch(body);
    if (saved) setIsEditing(false);
  }

  return (
    <li
      className={`flex flex-col gap-2 rounded-md border border-border px-3 py-2 ${parent ? "ml-6" : ""} ${question.isActive ? "" : "opacity-70"}`}
    >
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="flex min-w-40 flex-1 basis-40 flex-col gap-0.5">
          <span className="break-words text-sm text-foreground">
            {parent ? <span aria-hidden="true">↳ </span> : null}
            {question.prompt}
          </span>
          <span className="text-xs text-muted">
            {KIND_LABELS[question.kind]} · {AUDIENCE_LABELS[question.audience]}
            {parent ? " · Only after Yes above" : ""}
            {question.isRequired ? " · Must answer" : ""}
            {question.isActive ? "" : " · Turned off"}
            {parent && question.isActive && !parent.isActive ? " · Not asked while its question is off" : ""}
          </span>
        </div>
        <div className="flex shrink-0 gap-1">
          {question.isActive && !parent ? (
            <>
              <Button
                variant="secondary"
                className="px-3"
                aria-label={`Move "${question.prompt}" up`}
                disabled={isBusy || isFirstActive}
                onClick={() => void onPatch({ move: "up" })}
              >
                ↑
              </Button>
              <Button
                variant="secondary"
                className="px-3"
                aria-label={`Move "${question.prompt}" down`}
                disabled={isBusy || isLastActive}
                onClick={() => void onPatch({ move: "down" })}
              >
                ↓
              </Button>
            </>
          ) : null}
          <Button variant="secondary" className="px-3" disabled={isBusy} onClick={() => setIsEditing(!isEditing)}>
            Edit
          </Button>
          <Button
            variant="secondary"
            className="px-3"
            disabled={isBusy}
            onClick={() => void onPatch({ isActive: !question.isActive })}
          >
            {question.isActive ? "Turn off" : "Turn on"}
          </Button>
        </div>
      </div>

      {isEditing ? (
        <form
          className="flex flex-col gap-3 border-t border-border pt-3"
          onSubmit={(event) => {
            event.preventDefault();
            void saveEdit();
          }}
        >
          <Input
            id={`zoom-question-${question.id}-prompt`}
            label="Question"
            value={prompt}
            maxLength={200}
            disabled={isBusy}
            onChange={(event) => setPrompt(event.target.value)}
          />
          <AudienceSelect
            id={`zoom-question-${question.id}-audience`}
            value={audience}
            onChange={setAudience}
            disabled={isBusy}
          />
          {followableOptions !== null ? (
            <FollowUpSelect
              id={`zoom-question-${question.id}-follows`}
              value={shownWhenYesTo}
              options={followableOptions}
              onChange={setShownWhenYesTo}
              disabled={isBusy}
            />
          ) : null}
          <RequiredBox
            id={`zoom-question-${question.id}-required`}
            checked={isRequired}
            onChange={setIsRequired}
            disabled={isBusy}
          />
          <div className="flex justify-end gap-2">
            <Button variant="secondary" disabled={isBusy} onClick={() => setIsEditing(false)}>
              Cancel
            </Button>
            <Button type="submit" disabled={isBusy || prompt.trim() === ""}>
              Save
            </Button>
          </div>
        </form>
      ) : null}
    </li>
  );
}

export type RegistrationQuestionsModalProps = {
  isOpen: boolean;
  onClose: () => void;
  onSaved: () => void;
  questions: RegistrationQuestion[];
};

export function RegistrationQuestionsModal({
  isOpen,
  onClose,
  onSaved,
  questions,
}: RegistrationQuestionsModalProps) {
  const [draft, setDraft] = useState<Draft>(EMPTY_DRAFT);
  const [isBusy, setIsBusy] = useState(false);
  const [error, setError] = useState<string | undefined>();

  const byId = new Map(questions.map((question) => [question.id, question]));
  const parentOf = (question: RegistrationQuestion) =>
    question.shownWhenYesTo ? (byId.get(question.shownWhenYesTo) ?? null) : null;
  const active = questions.filter((question) => question.isActive && parentOf(question) === null);
  const hasFollowUps = (question: RegistrationQuestion) =>
    questions.some((entry) => entry.shownWhenYesTo === question.id);

  async function run(action: () => Promise<void>): Promise<boolean> {
    setIsBusy(true);
    setError(undefined);
    try {
      await action();
      onSaved();
      return true;
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Could not save the question.");
      return false;
    } finally {
      setIsBusy(false);
    }
  }

  async function add() {
    const added = await run(() =>
      send("/api/zoom/registration-questions", "POST", draft, "Could not add the question. Please try again."),
    );
    if (added) setDraft(EMPTY_DRAFT);
  }

  function patch(questionId: string) {
    return (body: Record<string, unknown>) =>
      run(() =>
        send(
          `/api/zoom/registration-questions/${questionId}`,
          "PATCH",
          body,
          "Could not save the question. Please try again.",
        ),
      );
  }

  return (
    <Modal isOpen={isOpen} onClose={onClose} title="Sign-up questions">
      <div className="flex flex-col gap-4">
        <p className="text-sm text-muted">
          Asked on the public sign-up page after name, phone and email. Up to 8 at a time.
        </p>

        {questions.length === 0 ? (
          <p className="text-sm text-muted">No questions yet.</p>
        ) : (
          <ul className="flex flex-col gap-2">
            {questions.map((question) => (
              <QuestionItem
                key={`${question.id}-${question.prompt}-${question.audience}-${question.isRequired}-${question.shownWhenYesTo}`}
                question={question}
                parent={parentOf(question)}
                followableOptions={hasFollowUps(question) ? null : followableQuestions(questions, question.id)}
                isFirstActive={active[0]?.id === question.id}
                isLastActive={active[active.length - 1]?.id === question.id}
                isBusy={isBusy}
                onPatch={patch(question.id)}
              />
            ))}
          </ul>
        )}

        <FormError message={error} />

        <form
          className="flex flex-col gap-3 border-t border-border pt-4"
          aria-labelledby="zoom-question-add"
          onSubmit={(event) => {
            event.preventDefault();
            if (draft.prompt.trim() !== "" && !isBusy) void add();
          }}
        >
          <h3 id="zoom-question-add" className="text-sm font-semibold text-foreground">
            Add a question
          </h3>
          <Input
            id="zoom-question-new-prompt"
            label="Question"
            value={draft.prompt}
            maxLength={200}
            disabled={isBusy}
            onChange={(event) => setDraft({ ...draft, prompt: event.target.value })}
          />
          <div className="flex flex-col gap-1.5">
            <label htmlFor="zoom-question-new-kind" className="text-sm font-medium text-foreground">
              Kind of answer
            </label>
            <select
              id="zoom-question-new-kind"
              value={draft.kind}
              disabled={isBusy}
              onChange={(event) =>
                setDraft({ ...draft, kind: event.target.value as ZoomRegistrationQuestionKind })
              }
              className={SELECT_CLASS}
            >
              {(Object.keys(KIND_LABELS) as ZoomRegistrationQuestionKind[]).map((kind) => (
                <option key={kind} value={kind}>
                  {KIND_LABELS[kind]}
                </option>
              ))}
            </select>
          </div>
          <AudienceSelect
            id="zoom-question-new-audience"
            value={draft.audience}
            onChange={(audience) => setDraft({ ...draft, audience })}
            disabled={isBusy}
          />
          <FollowUpSelect
            id="zoom-question-new-follows"
            value={draft.shownWhenYesTo}
            options={followableQuestions(questions, null)}
            onChange={(shownWhenYesTo) => setDraft({ ...draft, shownWhenYesTo })}
            disabled={isBusy}
          />
          <RequiredBox
            id="zoom-question-new-required"
            checked={draft.isRequired}
            onChange={(isRequired) => setDraft({ ...draft, isRequired })}
            disabled={isBusy}
          />
          <div className="flex justify-end gap-2">
            <Button variant="secondary" onClick={onClose} disabled={isBusy}>
              Done
            </Button>
            <Button type="submit" disabled={isBusy || draft.prompt.trim() === ""}>
              {isBusy ? "Saving…" : "Add question"}
            </Button>
          </div>
        </form>
      </div>
    </Modal>
  );
}
