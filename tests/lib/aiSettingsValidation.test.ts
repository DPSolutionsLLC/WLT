import { describe, expect, it } from "vitest";
import {
  MAX_CONFERENCE_TALKS,
  MAX_PREVIEW_PROMPT,
  MAX_SCRIPTURE_REFERENCES,
  MAX_WARD_CONTEXT,
  aiSettingsInputSchema,
  conferencePreferencesSchema,
  previewRequestSchema,
  scripturePreferencesSchema,
} from "@/lib/validation/aiSettings";

// The boundaries, and the two places a schema mistake would produce a WRONG INSTRUCTION rather
// than a rejected form: maxYearsOld null vs zero, and maxReferences zero vs unset.
//
// Every message here is surfaced verbatim by respondToRouteError, so the assertions check that
// the refusals are sentences rather than Zod's defaults.

const EMPTY_SETTINGS = {
  toneVoice: null,
  doctrinalEmphasis: null,
  scripturePreferences: null,
  conferencePreferences: null,
  topicPreferences: null,
  wardContext: null,
  thankYouPreferences: null,
};

describe("scripturePreferencesSchema", () => {
  it("accepts an ordered canon priority with no duplicates", () => {
    const parsed = scripturePreferencesSchema.safeParse({
      canonPriority: ["book_of_mormon", "new_testament"],
      maxReferences: 3,
      relevanceNotes: null,
    });

    expect(parsed.success).toBe(true);
  });

  // Rejecting is honest. Silently de-duplicating would change the priority order the bishopric
  // asked for without telling them.
  it("refuses a duplicate book with a sentence", () => {
    const parsed = scripturePreferencesSchema.safeParse({
      canonPriority: ["book_of_mormon", "book_of_mormon"],
      maxReferences: 3,
      relevanceNotes: null,
    });

    expect(parsed.success).toBe(false);
    expect(parsed.error?.issues[0]?.message).toBe("List each book of scripture only once.");
  });

  it("accepts an empty canon priority", () => {
    const parsed = scripturePreferencesSchema.safeParse({
      canonPriority: [],
      maxReferences: 0,
      relevanceNotes: null,
    });

    expect(parsed.success).toBe(true);
  });

  // Zero is a REAL choice — "do not suggest scriptures" — and must pass the boundary.
  it("accepts zero references and refuses one above the ceiling", () => {
    expect(
      scripturePreferencesSchema.safeParse({
        canonPriority: [],
        maxReferences: 0,
        relevanceNotes: null,
      }).success,
    ).toBe(true);

    const tooMany = scripturePreferencesSchema.safeParse({
      canonPriority: [],
      maxReferences: MAX_SCRIPTURE_REFERENCES + 1,
      relevanceNotes: null,
    });

    expect(tooMany.success).toBe(false);
    expect(tooMany.error?.issues[0]?.message).toContain("at most");
  });

  it("refuses an unknown book of scripture", () => {
    const parsed = scripturePreferencesSchema.safeParse({
      canonPriority: ["apocrypha"],
      maxReferences: 1,
      relevanceNotes: null,
    });

    expect(parsed.success).toBe(false);
  });
});

describe("conferencePreferencesSchema", () => {
  // null is "no recency limit". A schema that coerced it to zero would silently forbid every
  // conference talk ever given.
  it("accepts a null recency limit", () => {
    const parsed = conferencePreferencesSchema.safeParse({
      maxYearsOld: null,
      maxTalks: 2,
      preferKnowledgeBase: true,
    });

    expect(parsed.success).toBe(true);
    expect(parsed.data?.maxYearsOld).toBeNull();
  });

  // Zero years is not "no limit" — it is a limit nobody meant, so the schema refuses it and
  // points at the blank field instead.
  it("refuses a zero-year recency limit and names the alternative", () => {
    const parsed = conferencePreferencesSchema.safeParse({
      maxYearsOld: 0,
      maxTalks: 2,
      preferKnowledgeBase: true,
    });

    expect(parsed.success).toBe(false);
    expect(parsed.error?.issues[0]?.message).toContain("blank for no limit");
  });

  it("accepts zero talks and refuses more than the ceiling", () => {
    expect(
      conferencePreferencesSchema.safeParse({
        maxYearsOld: 5,
        maxTalks: 0,
        preferKnowledgeBase: false,
      }).success,
    ).toBe(true);

    expect(
      conferencePreferencesSchema.safeParse({
        maxYearsOld: 5,
        maxTalks: MAX_CONFERENCE_TALKS + 1,
        preferKnowledgeBase: false,
      }).success,
    ).toBe(false);
  });

  it("refuses a fractional year count with a sentence", () => {
    const parsed = conferencePreferencesSchema.safeParse({
      maxYearsOld: 2.5,
      maxTalks: 2,
      preferKnowledgeBase: false,
    });

    expect(parsed.success).toBe(false);
    expect(parsed.error?.issues[0]?.message).toContain("whole number");
  });
});

describe("aiSettingsInputSchema", () => {
  it("accepts a ward that has set nothing at all", () => {
    expect(aiSettingsInputSchema.safeParse(EMPTY_SETTINGS).success).toBe(true);
  });

  it("trims free text and enforces the ward-context ceiling", () => {
    const parsed = aiSettingsInputSchema.safeParse({
      ...EMPTY_SETTINGS,
      toneVoice: "  Warm and brief.  ",
    });

    expect(parsed.success).toBe(true);
    expect(parsed.data?.toneVoice).toBe("Warm and brief.");

    const tooLong = aiSettingsInputSchema.safeParse({
      ...EMPTY_SETTINGS,
      wardContext: "x".repeat(MAX_WARD_CONTEXT + 1),
    });

    expect(tooLong.success).toBe(false);
    expect(tooLong.error?.issues[0]?.message).toContain(String(MAX_WARD_CONTEXT));
  });

  it("refuses a missing field rather than defaulting it", () => {
    const withoutTone: Record<string, unknown> = { ...EMPTY_SETTINGS };
    delete withoutTone.toneVoice;

    expect(aiSettingsInputSchema.safeParse(withoutTone).success).toBe(false);
  });
});

describe("previewRequestSchema", () => {
  it("accepts draft settings plus a prompt", () => {
    const parsed = previewRequestSchema.safeParse({
      settings: EMPTY_SETTINGS,
      prompt: "Write a note to a speaker.",
    });

    expect(parsed.success).toBe(true);
  });

  it("refuses an empty prompt with something a person can act on", () => {
    const parsed = previewRequestSchema.safeParse({
      settings: EMPTY_SETTINGS,
      prompt: "   ",
    });

    expect(parsed.success).toBe(false);
    expect(parsed.error?.issues[0]?.message).toBe(
      "Type something for the preview to respond to.",
    );
  });

  it("refuses a prompt above the ceiling", () => {
    const parsed = previewRequestSchema.safeParse({
      settings: EMPTY_SETTINGS,
      prompt: "x".repeat(MAX_PREVIEW_PROMPT + 1),
    });

    expect(parsed.success).toBe(false);
  });
});
