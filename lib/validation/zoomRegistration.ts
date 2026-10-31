import { z } from "zod";
import { inviteeDisplayName, inviteeEmail, inviteePhone } from "@/lib/validation/zoom";
import {
  ZOOM_REGISTRATION_QUESTION_AUDIENCES,
  ZOOM_REGISTRATION_QUESTION_KINDS,
} from "@/types/domain";

// THE PUBLIC ZOOM SIGN-UP AND ITS SETTINGS (ITER-052). The name, phone and email fields are the
// Invitees form's own builders, so an empty optional field becomes NULL, never "".
//
// Whether each answer fits the ward's live questions is checked in lib/zoom/registrations.ts
// (checkAnswers), not here: that needs the questions, which a schema cannot see.

export const MAX_SHORT_TEXT_ANSWER = 500;
export const MAX_REGISTRATION_ANSWERS = 8;

const REFERRAL_CODE_PATTERN = /^[A-Za-z0-9]{10}$/;

// A shared link with a mangled ?ref= must still let the friend sign up, so a bad code is treated as
// no code at all rather than refused.
const referralCode = z.preprocess(
  (value) => (typeof value === "string" && REFERRAL_CODE_PATTERN.test(value) ? value : null),
  z.string().nullable(),
);

const registrationAnswer = z.object({
  questionId: z.uuid("One of the questions is not one this page knows about. Reload and try again."),
  answer: z.union([
    z.boolean(),
    z
      .string()
      .trim()
      .max(MAX_SHORT_TEXT_ANSWER, `Answers can be at most ${MAX_SHORT_TEXT_ANSWER} characters.`),
  ]),
});

export const publicRegistrationSchema = z.object({
  slug: z.string().trim().min(1).max(100),
  displayName: inviteeDisplayName,
  phone: inviteePhone.pipe(z.string({ error: "Enter a phone number we can reach you on." })),
  email: inviteeEmail.optional().transform((value) => value ?? null),
  saysMember: z.boolean({ error: "Tell us whether you're a member of the ward." }),
  answers: z
    .array(registrationAnswer)
    .max(MAX_REGISTRATION_ANSWERS, "That is more answers than this page asks for.")
    .default([]),
  ref: referralCode.optional().transform((value) => value ?? null),
  // The honeypot. A person never sees it; the route treats any non-empty value as a bot.
  website: z.string().max(1000).optional(),
});

export type PublicRegistrationInput = z.infer<typeof publicRegistrationSchema>;

export const registrationSettingsSchema = z
  .object({
    isOpen: z.boolean().optional(),
    autoApprove: z.boolean().optional(),
    emailBishopricOnNew: z.boolean().optional(),
  })
  .refine((value) => Object.values(value).some((field) => field !== undefined), {
    error: "Change at least one setting before saving.",
  });

export type RegistrationSettingsInput = z.infer<typeof registrationSettingsSchema>;

const questionPrompt = z
  .string({ error: "Write the question." })
  .trim()
  .min(1, "Write the question.")
  .max(200, "Questions can be at most 200 characters.");

const questionAudience = z.enum(ZOOM_REGISTRATION_QUESTION_AUDIENCES, {
  error: "Choose who is asked this question.",
});

// A follow-up names the yes/no question it follows (migration 097). Whether that question exists,
// is yes/no and is not itself a follow-up is checked in lib/zoom/registrationQuestions.ts.
const shownWhenYesTo = z.uuid("Choose a question from the list.").nullable();

export const createQuestionSchema = z.object({
  prompt: questionPrompt,
  kind: z.enum(ZOOM_REGISTRATION_QUESTION_KINDS, { error: "Choose yes/no or a short answer." }),
  audience: questionAudience,
  isRequired: z.boolean().default(false),
  shownWhenYesTo: shownWhenYesTo.default(null),
});

export type CreateQuestionInput = z.infer<typeof createQuestionSchema>;

// `kind` is deliberately absent: answers already given were given to that kind of question.
const KIND_IS_FIXED =
  "A question's kind can't be changed once it's made. Turn it off and add a new one.";

export const updateQuestionSchema = z
  .strictObject(
    {
      prompt: questionPrompt.optional(),
      audience: questionAudience.optional(),
      isRequired: z.boolean().optional(),
      isActive: z.boolean().optional(),
      shownWhenYesTo: shownWhenYesTo.optional(),
      move: z.enum(["up", "down"]).optional(),
    },
    { error: (issue) => (issue.code === "unrecognized_keys" ? KIND_IS_FIXED : undefined) },
  )
  .refine((value) => Object.values(value).some((field) => field !== undefined), {
    error: "Change at least one thing before saving.",
  });

export type UpdateQuestionInput = z.infer<typeof updateQuestionSchema>;

export const questionIdSchema = z.uuid("That question is not one this page knows about.");
