// @vitest-environment node
//
// PURE. buildFilterResolverPrompt builds a string; toResolvedFilter narrows a flat object. No
// model, no network, no database — the route does the calling.
//
// THE FIRST GROUP IS A REGRESSION GUARD FOR A DEFECT WALKING SCENARIO 027 FOUND.
// The prompt originally said only "explain briefly what would work instead" for the
// `unresolvable` case. Given that freedom the model ended an explanation with "or a subject
// you'd like talks about" — which is exactly what the `semantic` branch refuses one screen
// earlier, so a person following the advice was refused again for doing as they were told.
//
// A prompt cannot be unit-tested for what a model will say. What CAN be pinned is that the
// constraint is still in the prompt at all, which is the thing that regressed.

import { describe, expect, it } from "vitest";
import {
  buildFilterResolverPrompt,
  toResolvedFilter,
  type RawResolvedFilter,
} from "@/lib/ai/resolveFilter";
import { SPEAKER_ROLES } from "@/types/domain";

const TODAY = "2026-08-24";

function raw(overrides: Partial<RawResolvedFilter> = {}): RawResolvedFilter {
  return {
    kind: "filter",
    label: "A filter",
    speakerRoles: null,
    speakers: null,
    since: null,
    explanation: null,
    ...overrides,
  };
}

describe("buildFilterResolverPrompt", () => {
  const prompt = buildFilterResolverPrompt(TODAY);

  describe("the unresolvable branch", () => {
    it("RULES OUT suggesting a subject", () => {
      // The defect. Without this sentence the model advises the one thing the app refuses.
      expect(prompt).toMatch(/do not suggest naming a subject/i);
    });

    it("names the three axes that actually work", () => {
      const instruction = prompt.slice(prompt.indexOf("unresolvable"));
      expect(instruction).toMatch(/speaker/i);
      expect(instruction).toMatch(/calling/i);
      expect(instruction).toMatch(/period/i);
    });
  });

  describe("the vocabulary it teaches", () => {
    it("lists every speaker role, so a resolution cannot carry one the CHECK rejects", () => {
      for (const role of SPEAKER_ROLES) {
        expect(prompt).toContain(role);
      }
    });

    it("states the role-at-time-of-talk rule", () => {
      // Migration 033, describeFilter() and this prompt must all agree, or a filter means
      // something different depending on where you read it.
      expect(prompt).toMatch(/not the one they hold now/i);
      expect(prompt).toMatch(/while serving as President of the Church/i);
    });

    it("carries today's date so a relative period can be resolved", () => {
      expect(prompt).toContain(TODAY);
    });

    it("tells the model never to return an empty list", () => {
      // An empty array reaches SQL as `= any ('{}')`, which matches NOTHING while reading as
      // "no restriction". cleanStrings/cleanRoles collapse it anyway; this asks first.
      expect(prompt).toMatch(/never return an empty list/i);
    });
  });
});

describe("toResolvedFilter", () => {
  it("keeps a well-formed filter", () => {
    const result = toResolvedFilter(raw({ speakers: ["Russell M. Nelson"], label: "Nelson" }));

    expect(result).toEqual({
      kind: "filter",
      label: "Nelson",
      speakerRoles: null,
      speakers: ["Russell M. Nelson"],
      since: null,
    });
  });

  it("normalises a conference date to the first of its month", () => {
    const result = toResolvedFilter(raw({ since: "April 2021" }));

    expect(result).toMatchObject({ kind: "filter", since: "2021-04-01" });
  });

  it("collapses an EMPTY ARRAY to null rather than passing it on", () => {
    // `= any ('{}')` matches nothing. An empty array would save a filter returning zero
    // documents while reading as "no restriction on this axis".
    const result = toResolvedFilter(raw({ speakerRoles: [], speakers: [], since: "April 2021" }));

    expect(result).toMatchObject({ kind: "filter", speakerRoles: null, speakers: null });
  });

  it("turns a filter that narrows NOTHING into unresolvable", () => {
    // Migration 034's CHECK would refuse this at insert — far too late, after somebody has read
    // a proposal and pressed accept.
    const result = toResolvedFilter(raw({ speakerRoles: null, speakers: null, since: null }));

    expect(result.kind).toBe("unresolvable");
  });

  it("treats an unreadable date as no date, not as a crash", () => {
    const result = toResolvedFilter(raw({ speakers: ["Dallin H. Oaks"], since: "next spring" }));

    expect(result).toMatchObject({ kind: "filter", since: null });
  });

  it("falls back to a usable label rather than refusing over a missing string", () => {
    const result = toResolvedFilter(raw({ label: "  ", speakerRoles: ["apostle"] }));

    expect(result).toMatchObject({ kind: "filter", label: "Saved filter" });
  });

  it("carries a semantic explanation through", () => {
    const result = toResolvedFilter(
      raw({ kind: "semantic", explanation: "That is a subject." }),
    );

    expect(result).toEqual({ kind: "semantic", explanation: "That is a subject." });
  });

  it("supplies its own wording when the model returns none", () => {
    const semantic = toResolvedFilter(raw({ kind: "semantic", explanation: null }));
    const unresolvable = toResolvedFilter(raw({ kind: "unresolvable", explanation: null }));

    expect(semantic.kind).toBe("semantic");
    expect((semantic as { explanation: string }).explanation).toBeTruthy();

    // The fallback names only the three real axes — it must not reintroduce the defect the
    // prompt guard above exists to prevent.
    const text = (unresolvable as { explanation: string }).explanation;
    expect(text).toBeTruthy();
    expect(text).not.toMatch(/subject|topic/i);
  });

  it("de-duplicates repeated values", () => {
    const result = toResolvedFilter(
      raw({ speakers: ["Dallin H. Oaks", "Dallin H. Oaks", "  "] }),
    );

    expect(result).toMatchObject({ kind: "filter", speakers: ["Dallin H. Oaks"] });
  });
});
