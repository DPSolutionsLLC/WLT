import type {
  ZoomRegistrationQuestionAudience,
  ZoomRegistrationQuestionKind,
} from "@/types/domain";

// WHICH QUESTIONS A SIGN-UP IS ASKED, AND WHETHER ITS ANSWERS FIT THEM (ITER-052, plan P8).
//
// Pure and browser-safe: the public form uses questionsFor() to show the right questions after
// "Yes" or "No", and the submit route uses checkAnswers() against the ward's LIVE questions, so a
// form left open while a question was edited cannot store an answer to something no longer asked.
//
// The result is a SNAPSHOT — the prompt is copied beside the answer — so editing or turning off a
// question later never rewrites what somebody said.
//
// A FOLLOW-UP (migration 097) is asked only when its yes/no question is asked of this person AND
// answered Yes, and it comes straight after that question. A follow-up whose question is turned off
// (absent from the list), is not yes/no, or is itself a follow-up is never asked. Required means
// required only while it is asked; an answer sent to a follow-up that is not asked is not stored.

export type AskedQuestion = {
  id: string;
  prompt: string;
  kind: ZoomRegistrationQuestionKind;
  audience: ZoomRegistrationQuestionAudience;
  isRequired: boolean;
  shownWhenYesTo: string | null;
};

export type SubmittedAnswer = { questionId: string; answer: string | boolean };

export type AnswerSnapshot = {
  questionId: string;
  prompt: string;
  kind: ZoomRegistrationQuestionKind;
  answer: string | boolean;
};

export type CheckAnswersResult =
  | { ok: true; answers: AnswerSnapshot[] }
  | { ok: false; error: string };

export function isAskedOf(audience: ZoomRegistrationQuestionAudience, saysMember: boolean): boolean {
  if (audience === "everyone") return true;
  return audience === "members" ? saysMember : !saysMember;
}

type QuestionShape = Pick<AskedQuestion, "id" | "kind" | "audience" | "shownWhenYesTo">;

export function questionsFor<T extends QuestionShape>(
  questions: readonly T[],
  saysMember: boolean,
  answeredYes: (questionId: string) => boolean,
): T[] {
  const asked: T[] = [];
  for (const question of questions) {
    if (question.shownWhenYesTo !== null || !isAskedOf(question.audience, saysMember)) continue;
    asked.push(question);
    if (question.kind !== "yes_no" || !answeredYes(question.id)) continue;
    for (const followUp of questions) {
      if (followUp.shownWhenYesTo === question.id && isAskedOf(followUp.audience, saysMember)) {
        asked.push(followUp);
      }
    }
  }
  return asked;
}

function isBlank(answer: string | boolean | undefined): boolean {
  return answer === undefined || (typeof answer === "string" && answer.trim() === "");
}

export function checkAnswers(
  questions: readonly AskedQuestion[],
  saysMember: boolean,
  submitted: readonly SubmittedAnswer[],
): CheckAnswersResult {
  const byQuestion = new Map(submitted.map((entry) => [entry.questionId, entry.answer]));
  const snapshot: AnswerSnapshot[] = [];

  const answeredYes = (questionId: string) => byQuestion.get(questionId) === true;

  for (const question of questionsFor(questions, saysMember, answeredYes)) {
    const answer = byQuestion.get(question.id);

    if (isBlank(answer)) {
      if (question.isRequired) return { ok: false, error: `Please answer: ${question.prompt}` };
      continue;
    }

    const fitsKind =
      question.kind === "yes_no" ? typeof answer === "boolean" : typeof answer === "string";
    if (!fitsKind) {
      return { ok: false, error: `That answer doesn't fit the question: ${question.prompt}` };
    }

    snapshot.push({
      questionId: question.id,
      prompt: question.prompt,
      kind: question.kind,
      answer: typeof answer === "string" ? answer.trim() : (answer as boolean),
    });
  }

  return { ok: true, answers: snapshot };
}
