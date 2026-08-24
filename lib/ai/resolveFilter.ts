import { z } from "zod";
import { parseConferenceDate } from "@/lib/knowledge/conferenceMetadata";
import {
  SPEAKER_ROLES,
  SPEAKER_ROLE_LABELS,
  type ResolvedFilter,
  type SpeakerRole,
} from "@/types/domain";
import { MAX_FILTER_LABEL, MAX_SPEAKER_NAME } from "@/lib/validation/knowledge";

// PURE. It builds a schema, a system prompt and a narrowing function; app/api/knowledge/filters/
// resolve/route.ts does the calling. Same reason lib/ai/topicSuggestions.ts and
// lib/ai/systemPrompt.ts are pure: a function of its inputs is a function a test can reach
// without a network.

export const MAX_RESOLVED_SPEAKERS = 10;
export const MAX_EXPLANATION = 400;

// ---------------------------------------------------------------------------------------------
// What Claude is asked to return
// ---------------------------------------------------------------------------------------------
//
// A FLAT OBJECT WITH NULLABLE FIELDS, NOT A DISCRIMINATED UNION, even though ResolvedFilter is
// one. Structured output is far more reliable over a flat shape than over a union of three
// object types, and the coherence rules — a `filter` needs a label and at least one axis, a
// `semantic` needs an explanation — are checked HERE in toResolvedFilter() where a violation
// becomes a written sentence rather than a retry loop.
//
// `speakerRoles` reuses the SPEAKER_ROLES union, so a resolution cannot carry a role that
// migration 033's CHECK constraint would reject. The two lists being one list is what stops this
// producing a 400 nobody can diagnose from the panel.
export const resolvedFilterSchema = z.object({
  kind: z.enum(["filter", "semantic", "unresolvable"]),
  label: z.string().max(MAX_FILTER_LABEL).nullable(),
  speakerRoles: z.array(z.enum(SPEAKER_ROLES)).nullable(),
  speakers: z.array(z.string().max(MAX_SPEAKER_NAME)).max(MAX_RESOLVED_SPEAKERS).nullable(),
  // A month and year — "April 2021" or "2021-04". parseConferenceDate normalises it, and
  // anything it cannot read becomes null rather than a thrown error.
  since: z.string().max(40).nullable(),
  explanation: z.string().max(MAX_EXPLANATION).nullable(),
});

export type RawResolvedFilter = z.infer<typeof resolvedFilterSchema>;

function cleanStrings(values: readonly string[] | null): readonly string[] | null {
  if (values === null) return null;
  const cleaned = [...new Set(values.map((value) => value.trim()).filter((v) => v !== ""))];
  return cleaned.length === 0 ? null : cleaned;
}

function cleanRoles(values: readonly SpeakerRole[] | null): readonly SpeakerRole[] | null {
  if (values === null) return null;
  const cleaned = [...new Set(values)];
  return cleaned.length === 0 ? null : cleaned;
}

// Turns what the model returned into the union the rest of the app uses, and REFUSES anything
// incoherent rather than passing it on.
//
// The two failure modes this exists for are both real. A `filter` with every axis null narrows
// nothing — migration 034's CHECK would refuse it at insert, which is far too late, after the
// user has read a proposal and pressed accept. And an empty array is worse than null: `= any
// ('{}')` matches NOTHING, so it would save a filter that silently returns zero documents while
// looking exactly like "no restriction on this axis". cleanStrings and cleanRoles collapse both
// to null so that state cannot leave this function.
export function toResolvedFilter(raw: RawResolvedFilter): ResolvedFilter {
  if (raw.kind === "semantic") {
    return {
      kind: "semantic",
      explanation:
        raw.explanation?.trim() ||
        "That describes what a talk is about. Every search already looks for that — the scope here decides which talks are searched at all.",
    };
  }

  if (raw.kind === "unresolvable") {
    return {
      kind: "unresolvable",
      explanation:
        raw.explanation?.trim() ||
        "That could not be turned into a filter. Try naming a speaker, a calling, or how far back to look.",
    };
  }

  const speakerRoles = cleanRoles(raw.speakerRoles);
  const speakers = cleanStrings(raw.speakers);
  const since = raw.since === null ? null : parseConferenceDate(raw.since);
  const label = raw.label?.trim() ?? "";

  if (speakerRoles === null && speakers === null && since === null) {
    return {
      kind: "unresolvable",
      explanation:
        "That did not name a speaker, a calling, or a date to start from, so there is nothing to narrow the talks by.",
    };
  }

  return {
    kind: "filter",
    // A filter with no name is unusable in a checkbox list. Falling back to the phrase itself is
    // better than refusing an otherwise-good resolution over a missing string.
    label: label === "" ? "Saved filter" : label,
    speakerRoles,
    speakers,
    since,
  };
}

// ---------------------------------------------------------------------------------------------
// The prompt
// ---------------------------------------------------------------------------------------------
//
// NOT buildSystemPrompt, and that is deliberate rather than an oversight. This call has nothing
// to do with the ward's tone, its doctrinal emphasis or its context — it is a PARSER, matching a
// phrase against a fixed vocabulary. Handing it the ward's settings would spend cache on
// material that cannot change the answer and would invite the model to be thoughtful where
// literal is wanted.
//
// Kept plain. Current models follow instructions closely, and step-by-step scripts and emphatic
// ALL-CAPS directives DEGRADE the output. State the task, name the constraints once, and stop.

const ROLE_VOCABULARY = SPEAKER_ROLES.map(
  (role) => `${role} — ${SPEAKER_ROLE_LABELS[role]}`,
).join("\n");

export function buildFilterResolverPrompt(today: string): string {
  return [
    "You turn a phrase about general conference talks into a filter over stored metadata.",
    "",
    "Three fields are stored for each talk, and nothing else is filterable: the speaker's name, " +
      "the calling they held, and the month of the conference.",
    "",
    "The callings are:",
    ROLE_VOCABULARY,
    "",
    // THE ROLE-AT-TIME-OF-TALK RULE. The column stores the calling held WHEN THE TALK WAS GIVEN,
    // so this is the only reading the data can answer. Saying it here, in describeFilter(), and
    // in migration 033 keeps all three honest — a filter that means one thing in the prompt and
    // another in the database is a filter nobody can trust.
    "A calling is the one the speaker held when they gave the talk, not the one they hold now. " +
      "A talk given in 2015 by a member of the Quorum of the Twelve is `apostle`, even if that " +
      "person is President of the Church today. If someone asks for talks by prophets, that " +
      "means talks given while serving as President of the Church.",
    "",
    `Today is ${today}. Turn a relative period like "the last five years" into a month and year.`,
    "",
    "Return kind `filter` when the phrase names speakers, callings, or a period, with a short " +
      "label a person would recognise in a checkbox list.",
    "",
    "Return kind `semantic` when the phrase describes what talks are ABOUT — a subject, a theme, " +
      "a doctrine. Searching by subject is what already happens on every single search, so a " +
      "filter would narrow nothing and mislead. Explain that in a sentence a bishopric member " +
      "would find convincing, not as a validation error.",
    "",
    "Return kind `unresolvable` when the phrase means neither of those. Explain briefly what " +
      "would work instead.",
    "",
    "Set every field you are not using to null. Never return an empty list.",
  ].join("\n");
}
