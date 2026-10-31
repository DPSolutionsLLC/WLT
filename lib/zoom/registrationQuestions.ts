import type { SupabaseClient } from "@supabase/supabase-js";
import { InvalidInputError } from "@/lib/auth/errors";
import type { CreateQuestionInput, UpdateQuestionInput } from "@/lib/validation/zoomRegistration";
import type { Database } from "@/types/database";
import type {
  ZoomRegistrationQuestionAudience,
  ZoomRegistrationQuestionKind,
} from "@/types/domain";

// THE WARD'S OWN QUESTIONS ON THE PUBLIC ZOOM SIGN-UP PAGE (ITER-052, migration 096c, plan P8).
//
// Never deleted: a question is turned off, and an answer already given keeps the question's wording
// as a snapshot on the registration. At most eight are active at once. Read through the caller's
// client; every write is the service role behind canManageRegistrationQuestions() and filters
// `ward_id` (rule 1).
//
// FOLLOW-UPS (migration 097) go ONE level deep and follow a YES/NO question — checked here, before
// every write, because a CHECK constraint cannot read another row. A follow-up is listed straight
// under its question, moves with it, and counts toward the eight.

type Client = SupabaseClient<Database>;

export const MAX_ACTIVE_QUESTIONS = 8;

const TOO_MANY_ACTIVE =
  `A sign-up page can ask at most ${MAX_ACTIVE_QUESTIONS} questions. Turn one off first.`;

export type RegistrationQuestion = {
  id: string;
  prompt: string;
  kind: ZoomRegistrationQuestionKind;
  audience: ZoomRegistrationQuestionAudience;
  isRequired: boolean;
  position: number;
  isActive: boolean;
  shownWhenYesTo: string | null;
};

type QuestionRow = {
  id: string;
  prompt: string;
  kind: string;
  audience: string;
  is_required: boolean;
  position: number;
  is_active: boolean;
  shown_when_yes_to: string | null;
  created_at: string;
};

const QUESTION_COLUMNS =
  "id, prompt, kind, audience, is_required, position, is_active, shown_when_yes_to, created_at";

function toQuestion(row: QuestionRow): RegistrationQuestion {
  return {
    id: row.id,
    prompt: row.prompt,
    kind: row.kind as ZoomRegistrationQuestionKind,
    audience: row.audience as ZoomRegistrationQuestionAudience,
    isRequired: row.is_required,
    position: row.position,
    isActive: row.is_active,
    shownWhenYesTo: row.shown_when_yes_to,
  };
}

function byActiveThenPosition(a: RegistrationQuestion, b: RegistrationQuestion): number {
  if (a.isActive !== b.isActive) return a.isActive ? -1 : 1;
  return a.position - b.position;
}

// Active first in position order, then the turned-off ones — each followed straight away by its
// own follow-ups. A follow-up whose question is missing is listed as an ordinary question rather
// than lost.
export function orderQuestions(questions: readonly RegistrationQuestion[]): RegistrationQuestion[] {
  const ids = new Set(questions.map((question) => question.id));
  const isFollowUp = (question: RegistrationQuestion) =>
    question.shownWhenYesTo !== null && ids.has(question.shownWhenYesTo);

  const ordered: RegistrationQuestion[] = [];
  for (const question of questions.filter((entry) => !isFollowUp(entry)).sort(byActiveThenPosition)) {
    ordered.push(question);
    ordered.push(
      ...questions
        .filter((entry) => entry.shownWhenYesTo === question.id)
        .sort(byActiveThenPosition),
    );
  }
  return ordered;
}

const FOLLOW_UP_UNKNOWN = "That question isn't on this sign-up page.";
const FOLLOW_UP_NOT_YES_NO = "A follow-up can only follow a yes/no question.";
const FOLLOW_UP_ONE_LEVEL =
  "Follow-ups go one level deep: a follow-up can't have follow-ups of its own.";

// Throws a sentence when `parentId` cannot be followed by `questionId` (null while adding).
export function checkFollowUpLink(
  questions: readonly RegistrationQuestion[],
  questionId: string | null,
  parentId: string,
): void {
  const parent = questions.find((question) => question.id === parentId);
  if (!parent || parent.id === questionId) throw new InvalidInputError(FOLLOW_UP_UNKNOWN);
  if (parent.kind !== "yes_no") throw new InvalidInputError(FOLLOW_UP_NOT_YES_NO);
  if (parent.shownWhenYesTo !== null) throw new InvalidInputError(FOLLOW_UP_ONE_LEVEL);
  if (questionId !== null && questions.some((question) => question.shownWhenYesTo === questionId)) {
    throw new InvalidInputError(FOLLOW_UP_ONE_LEVEL);
  }
}

export async function listQuestions(
  wardId: string,
  supabase: Client,
): Promise<RegistrationQuestion[]> {
  const { data, error } = await supabase
    .from("zoom_registration_questions")
    .select(QUESTION_COLUMNS)
    .eq("ward_id", wardId)
    .order("position", { ascending: true })
    .order("created_at", { ascending: true })
    .returns<QuestionRow[]>();

  if (error) {
    console.error(`Could not read the Zoom sign-up questions — ${error.message}`, { wardId });
    throw new Error(`Could not read the sign-up questions: ${error.message}`);
  }

  return orderQuestions((data ?? []).map(toQuestion));
}

export async function addQuestion(
  params: { wardId: string; actorUserId: string; input: CreateQuestionInput },
  service: Client,
): Promise<RegistrationQuestion> {
  const { wardId, actorUserId, input } = params;
  const existing = await listQuestions(wardId, service);

  if (existing.filter((question) => question.isActive).length >= MAX_ACTIVE_QUESTIONS) {
    throw new InvalidInputError(TOO_MANY_ACTIVE);
  }

  if (input.shownWhenYesTo !== null) checkFollowUpLink(existing, null, input.shownWhenYesTo);

  const nextPosition = existing.reduce((highest, question) => Math.max(highest, question.position), 0) + 1;

  const { data, error } = await service
    .from("zoom_registration_questions")
    .insert({
      ward_id: wardId,
      prompt: input.prompt,
      kind: input.kind,
      audience: input.audience,
      is_required: input.isRequired,
      shown_when_yes_to: input.shownWhenYesTo,
      position: nextPosition,
      created_by: actorUserId,
    })
    .select(QUESTION_COLUMNS)
    .returns<QuestionRow[]>()
    .single();

  if (error) {
    console.error(`Could not add a Zoom sign-up question — ${error.message}`, { wardId });
    throw new Error(`Could not add the question: ${error.message}`);
  }
  return toQuestion(data);
}

export const QUESTION_FIELDS = [
  "prompt",
  "audience",
  "isRequired",
  "isActive",
  "shownWhenYesTo",
  "position",
] as const;
export type QuestionField = (typeof QUESTION_FIELDS)[number];

// The neighbour a question swaps with when moved, among ACTIVE ordinary questions only, so a
// turned-off question never becomes an invisible step in the order. A follow-up has no neighbour:
// it moves with its question. Null at either end.
export function moveTarget(
  questions: readonly RegistrationQuestion[],
  questionId: string,
  direction: "up" | "down",
): RegistrationQuestion | null {
  const active = questions
    .filter((question) => question.isActive && question.shownWhenYesTo === null)
    .sort((a, b) => a.position - b.position);
  const index = active.findIndex((question) => question.id === questionId);
  if (index === -1) return null;
  return active[direction === "up" ? index - 1 : index + 1] ?? null;
}

async function setPosition(
  params: { wardId: string; questionId: string; position: number },
  service: Client,
): Promise<void> {
  const { error } = await service
    .from("zoom_registration_questions")
    .update({ position: params.position, updated_at: new Date().toISOString() })
    .eq("ward_id", params.wardId)
    .eq("id", params.questionId);

  if (error) {
    console.error(`Could not move a Zoom sign-up question — ${error.message}`, params);
    throw new Error(`Could not move the question: ${error.message}`);
  }
}

export type UpdateQuestionResult = {
  question: RegistrationQuestion;
  changedFields: QuestionField[];
} | null;

export async function updateQuestion(
  params: { wardId: string; questionId: string; input: UpdateQuestionInput },
  service: Client,
): Promise<UpdateQuestionResult> {
  const { wardId, questionId, input } = params;
  const questions = await listQuestions(wardId, service);
  const current = questions.find((question) => question.id === questionId);
  if (!current) return null;

  const changedFields: QuestionField[] = [];
  const patch: Database["public"]["Tables"]["zoom_registration_questions"]["Update"] = {};

  if (input.prompt !== undefined && input.prompt !== current.prompt) {
    patch.prompt = input.prompt;
    changedFields.push("prompt");
  }
  if (input.audience !== undefined && input.audience !== current.audience) {
    patch.audience = input.audience;
    changedFields.push("audience");
  }
  if (input.isRequired !== undefined && input.isRequired !== current.isRequired) {
    patch.is_required = input.isRequired;
    changedFields.push("isRequired");
  }
  if (input.isActive !== undefined && input.isActive !== current.isActive) {
    const activeCount = questions.filter((question) => question.isActive).length;
    if (input.isActive && activeCount >= MAX_ACTIVE_QUESTIONS) {
      throw new InvalidInputError(TOO_MANY_ACTIVE);
    }
    patch.is_active = input.isActive;
    changedFields.push("isActive");
  }
  if (input.shownWhenYesTo !== undefined && input.shownWhenYesTo !== current.shownWhenYesTo) {
    if (input.shownWhenYesTo !== null) checkFollowUpLink(questions, questionId, input.shownWhenYesTo);
    patch.shown_when_yes_to = input.shownWhenYesTo;
    changedFields.push("shownWhenYesTo");
  }

  if (Object.keys(patch).length > 0) {
    const { error } = await service
      .from("zoom_registration_questions")
      .update({ ...patch, updated_at: new Date().toISOString() })
      .eq("ward_id", wardId)
      .eq("id", questionId);

    if (error) {
      console.error(`Could not change a Zoom sign-up question — ${error.message}`, { wardId, questionId });
      throw new Error(`Could not save the question: ${error.message}`);
    }
  }

  if (input.move) {
    const neighbour = moveTarget(questions, questionId, input.move);
    if (neighbour) {
      await setPosition({ wardId, questionId, position: neighbour.position }, service);
      await setPosition({ wardId, questionId: neighbour.id, position: current.position }, service);
      changedFields.push("position");
    }
  }

  const after = (await listQuestions(wardId, service)).find((question) => question.id === questionId);
  if (!after) return null;
  return { question: after, changedFields };
}
