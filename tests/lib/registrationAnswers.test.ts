import { describe, expect, it } from "vitest";
import { type AskedQuestion, checkAnswers, questionsFor } from "@/lib/zoom/registrationAnswers";

// Which questions a Zoom sign-up is asked, and whether its answers fit (ITER-052, plan P8).

const MISSIONARIES: AskedQuestion = {
  id: "11111111-1111-4111-8111-111111111111",
  prompt: "Would you welcome a visit from the missionaries?",
  kind: "yes_no",
  audience: "non_members",
  isRequired: false,
  shownWhenYesTo: null,
};

const HEARD: AskedQuestion = {
  id: "22222222-2222-4222-8222-222222222222",
  prompt: "How did you hear about us?",
  kind: "short_text",
  audience: "everyone",
  isRequired: true,
  shownWhenYesTo: null,
};

const CALLING: AskedQuestion = {
  id: "33333333-3333-4333-8333-333333333333",
  prompt: "Do you hold a calling?",
  kind: "yes_no",
  audience: "members",
  isRequired: false,
  shownWhenYesTo: null,
};

const QUESTIONS = [MISSIONARIES, HEARD, CALLING];

const NO_YES = () => false;

// The address is a follow-up to the missionary question (migration 097).
const ADDRESS: AskedQuestion = {
  id: "55555555-5555-4555-8555-555555555555",
  prompt: "What's your address?",
  kind: "short_text",
  audience: "non_members",
  isRequired: true,
  shownWhenYesTo: MISSIONARIES.id,
};

const WITH_ADDRESS = [MISSIONARIES, HEARD, CALLING, ADDRESS];

describe("questionsFor", () => {
  it("asks a member the everyone and members questions", () => {
    expect(questionsFor(QUESTIONS, true, NO_YES).map((question) => question.id)).toEqual([HEARD.id, CALLING.id]);
  });

  it("asks a non-member the everyone and non-members questions", () => {
    expect(questionsFor(QUESTIONS, false, NO_YES).map((question) => question.id)).toEqual([
      MISSIONARIES.id,
      HEARD.id,
    ]);
  });
});

describe("checkAnswers", () => {
  it("keeps the prompt beside each answer, in question order", () => {
    const result = checkAnswers(QUESTIONS, false, [
      { questionId: HEARD.id, answer: "  A friend  " },
      { questionId: MISSIONARIES.id, answer: true },
    ]);
    expect(result).toEqual({
      ok: true,
      answers: [
        { questionId: MISSIONARIES.id, prompt: MISSIONARIES.prompt, kind: "yes_no", answer: true },
        { questionId: HEARD.id, prompt: HEARD.prompt, kind: "short_text", answer: "A friend" },
      ],
    });
  });

  it("drops an answer to a question this person was not asked", () => {
    const result = checkAnswers(QUESTIONS, true, [
      { questionId: HEARD.id, answer: "A friend" },
      { questionId: MISSIONARIES.id, answer: true },
    ]);
    expect(result.ok && result.answers.map((answer) => answer.questionId)).toEqual([HEARD.id]);
  });

  it("drops an answer to a question the ward no longer asks", () => {
    const result = checkAnswers(QUESTIONS, true, [
      { questionId: HEARD.id, answer: "A friend" },
      { questionId: "44444444-4444-4444-8444-444444444444", answer: "stale" },
    ]);
    expect(result.ok && result.answers).toHaveLength(1);
  });

  it("refuses a missing required answer with the question's words", () => {
    expect(checkAnswers(QUESTIONS, true, [])).toEqual({
      ok: false,
      error: "Please answer: How did you hear about us?",
    });
  });

  it("treats a blank short answer as missing", () => {
    expect(checkAnswers(QUESTIONS, true, [{ questionId: HEARD.id, answer: "   " }]).ok).toBe(false);
  });

  it("skips an optional question left unanswered", () => {
    const result = checkAnswers(QUESTIONS, false, [{ questionId: HEARD.id, answer: "A friend" }]);
    expect(result.ok && result.answers.map((answer) => answer.questionId)).toEqual([HEARD.id]);
  });

  it("refuses an answer of the wrong kind", () => {
    const result = checkAnswers(QUESTIONS, false, [
      { questionId: HEARD.id, answer: "A friend" },
      { questionId: MISSIONARIES.id, answer: "yes please" },
    ]);
    expect(result).toEqual({
      ok: false,
      error: "That answer doesn't fit the question: Would you welcome a visit from the missionaries?",
    });
  });
});

describe("follow-up questions", () => {
  const heard = { questionId: HEARD.id, answer: "A friend" };

  it("asks the follow-up straight after its question once it is answered Yes", () => {
    const yesTo = (id: string) => id === MISSIONARIES.id;
    expect(questionsFor(WITH_ADDRESS, false, yesTo).map((question) => question.id)).toEqual([
      MISSIONARIES.id,
      ADDRESS.id,
      HEARD.id,
    ]);
  });

  it("does not ask the follow-up after No or no answer", () => {
    expect(questionsFor(WITH_ADDRESS, false, NO_YES).map((question) => question.id)).not.toContain(
      ADDRESS.id,
    );
  });

  it("does not ask the follow-up when its question is not asked of this person", () => {
    const yesToEverything = () => true;
    expect(questionsFor(WITH_ADDRESS, true, yesToEverything).map((question) => question.id)).not.toContain(
      ADDRESS.id,
    );
  });

  it("does not ask a follow-up whose question is turned off (missing from the list)", () => {
    expect(questionsFor([HEARD, ADDRESS], false, () => true)).toEqual([HEARD]);
  });

  it("does not ask a follow-up of a follow-up", () => {
    const deeper: AskedQuestion = { ...ADDRESS, id: "66666666-6666-4666-8666-666666666666", shownWhenYesTo: ADDRESS.id };
    const asked = questionsFor([...WITH_ADDRESS, deeper], false, () => true);
    expect(asked.map((question) => question.id)).not.toContain(deeper.id);
  });

  it("does not ask a follow-up of a short-answer question", () => {
    const afterHeard: AskedQuestion = { ...ADDRESS, id: "77777777-7777-4777-8777-777777777777", shownWhenYesTo: HEARD.id };
    expect(questionsFor([HEARD, afterHeard], false, () => true)).toEqual([HEARD]);
  });

  it("requires the address after Yes to the missionaries", () => {
    expect(
      checkAnswers(WITH_ADDRESS, false, [heard, { questionId: MISSIONARIES.id, answer: true }]),
    ).toEqual({ ok: false, error: "Please answer: What's your address?" });
  });

  it("stores the address after Yes, straight after the missionary answer", () => {
    const result = checkAnswers(WITH_ADDRESS, false, [
      heard,
      { questionId: MISSIONARIES.id, answer: true },
      { questionId: ADDRESS.id, answer: " 12 Elm Street " },
    ]);
    expect(result.ok && result.answers.map((answer) => answer.answer)).toEqual([
      true,
      "12 Elm Street",
      "A friend",
    ]);
  });

  it("does not require the address after No", () => {
    const result = checkAnswers(WITH_ADDRESS, false, [heard, { questionId: MISSIONARIES.id, answer: false }]);
    expect(result.ok).toBe(true);
  });

  it("does not store an address sent with a No", () => {
    const result = checkAnswers(WITH_ADDRESS, false, [
      heard,
      { questionId: MISSIONARIES.id, answer: false },
      { questionId: ADDRESS.id, answer: "12 Elm Street" },
    ]);
    expect(result.ok && result.answers.map((answer) => answer.questionId)).toEqual([
      MISSIONARIES.id,
      HEARD.id,
    ]);
  });
});
