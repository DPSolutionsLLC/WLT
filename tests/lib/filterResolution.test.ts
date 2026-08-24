// @vitest-environment node
//
// PURE. No database, no model, no network.
//
// The most important thing in this file is the group at the bottom: matchesConferenceScope is a
// TypeScript mirror of migration 033's SQL predicate, and the scope panel's count sentence is
// rendered from it. If the two ever disagree, a bishopric is shown a number that is not what the
// database will return — and the disagreement would be invisible until somebody counted by hand.

import { describe, expect, it } from "vitest";
import {
  describeFilter,
  isApplicable,
  isUnfilteredScope,
  matchesConferenceScope,
  mergeConferenceScope,
} from "@/lib/knowledge/filterResolution";
import type {
  ConferenceScope,
  ConferenceScopeSettings,
  KnowledgeDocument,
  ResolvedFilter,
  SavedFilter,
} from "@/types/domain";

const TODAY = "2026-08-24";

function savedFilter(overrides: Partial<SavedFilter> & { id: string }): SavedFilter {
  return {
    label: `Filter ${overrides.id}`,
    sourcePhrase: "a phrase",
    speakerRoles: null,
    speakers: null,
    since: null,
    createdBy: null,
    createdByName: null,
    createdAt: "2026-08-01T00:00:00.000Z",
    ...overrides,
  };
}

function settings(overrides: Partial<ConferenceScopeSettings> = {}): ConferenceScopeSettings {
  return { sinceYears: null, speakerRoles: [], savedFilterIds: [], ...overrides };
}

type ScopableDocument = Pick<
  KnowledgeDocument,
  "typeTag" | "speaker" | "speakerRole" | "conferenceDate"
>;

function talk(overrides: Partial<ScopableDocument> = {}): ScopableDocument {
  return {
    typeTag: "general_conference",
    speaker: "Russell M. Nelson",
    speakerRole: "prophet",
    conferenceDate: "2026-04-01",
    ...overrides,
  };
}

const SCRIPTURE: ScopableDocument = {
  typeTag: "standard_works",
  speaker: null,
  speakerRole: null,
  conferenceDate: null,
};

describe("isApplicable", () => {
  it("narrows a filter arm and rejects the other two", () => {
    const filter: ResolvedFilter = {
      kind: "filter",
      label: "Prophets",
      speakerRoles: ["prophet"],
      speakers: null,
      since: null,
    };
    const semantic: ResolvedFilter = { kind: "semantic", explanation: "…" };
    const unresolvable: ResolvedFilter = { kind: "unresolvable", explanation: "…" };

    expect(isApplicable(filter)).toBe(true);
    expect(isApplicable(semantic)).toBe(false);
    expect(isApplicable(unresolvable)).toBe(false);
  });
});

describe("mergeConferenceScope", () => {
  it("returns the empty scope when the ward has never set one", () => {
    // The state a ward that has never opened the panel must stay in: every axis null, which
    // filters nothing.
    expect(mergeConferenceScope(null, [], TODAY)).toEqual({
      since: null,
      speakerRoles: null,
      speakers: null,
    });
  });

  it("NEVER produces an empty array, only null", () => {
    // `= any ('{}')` matches NOTHING. An empty array on an axis would narrow the corpus to zero
    // while reading exactly like "no restriction on this axis" — the single most dangerous shape
    // this function could emit.
    const scope = mergeConferenceScope(settings({ speakerRoles: [] }), [], TODAY);

    expect(scope.speakerRoles).toBeNull();
    expect(scope.speakers).toBeNull();
    expect(isUnfilteredScope(scope)).toBe(true);
  });

  it("resolves relative recency against the day it is called for", () => {
    expect(mergeConferenceScope(settings({ sinceYears: 2 }), [], TODAY).since).toBe(
      "2024-08-01",
    );
  });

  it("UNIONS values within an axis — two roles mean either, not both", () => {
    // That is what a checkbox group has always meant and what `= any (...)` does in SQL.
    // Intersecting here would make ticking two things return nothing.
    const scope = mergeConferenceScope(
      settings({
        speakerRoles: ["apostle"],
        savedFilterIds: ["filter-1"],
      }),
      [savedFilter({ id: "filter-1", speakerRoles: ["seventy"] })],
      TODAY,
    );

    expect([...(scope.speakerRoles ?? [])].sort()).toEqual(["apostle", "seventy"]);
  });

  it("de-duplicates a role the panel and a saved filter both name", () => {
    const scope = mergeConferenceScope(
      settings({ speakerRoles: ["apostle"], savedFilterIds: ["filter-1"] }),
      [savedFilter({ id: "filter-1", speakerRoles: ["apostle"] })],
      TODAY,
    );

    expect(scope.speakerRoles).toEqual(["apostle"]);
  });

  it("takes the MOST RESTRICTIVE date across axes — that is what AND means on a date", () => {
    const scope = mergeConferenceScope(
      settings({ sinceYears: 10, savedFilterIds: ["filter-1"] }),
      [savedFilter({ id: "filter-1", since: "2025-04-01" })],
      TODAY,
    );

    // 10 years back is 2016-08-01; the saved filter says 2025-04-01. The narrower bound wins.
    expect(scope.since).toBe("2025-04-01");
  });

  it("takes the panel's date when it is the narrower one", () => {
    const scope = mergeConferenceScope(
      settings({ sinceYears: 1, savedFilterIds: ["filter-1"] }),
      [savedFilter({ id: "filter-1", since: "2020-04-01" })],
      TODAY,
    );

    expect(scope.since).toBe("2025-08-01");
  });

  it("uses only the filters that are actually ticked", () => {
    const scope = mergeConferenceScope(
      settings({ savedFilterIds: ["filter-1"] }),
      [
        savedFilter({ id: "filter-1", speakers: ["Russell M. Nelson"] }),
        savedFilter({ id: "filter-2", speakers: ["Dallin H. Oaks"] }),
      ],
      TODAY,
    );

    expect(scope.speakers).toEqual(["Russell M. Nelson"]);
  });

  it("IGNORES an id naming a filter that no longer exists", () => {
    // A REACHABLE STATE, NOT CORRUPTION. `retrieval_filters` rows are deletable and
    // `ai_settings` is append-only, so a saved scope can outlive the filter it names. Ignoring
    // it widens the corpus rather than narrowing it, which is the safe direction to be wrong in:
    // the ward sees more of its own material, never less and never another ward's.
    const scope = mergeConferenceScope(
      settings({ savedFilterIds: ["deleted-filter"] }),
      [],
      TODAY,
    );

    expect(isUnfilteredScope(scope)).toBe(true);
  });
});

describe("matchesConferenceScope", () => {
  // -------------------------------------------------------------------------------------------
  // THE STANDARD-WORKS EXEMPTION
  // -------------------------------------------------------------------------------------------
  // The failure this whole plan exists to prevent: a ward sets "last two years" to narrow its
  // conference talks and silently loses the Book of Mormon from every suggestion. Nothing errors.
  // The drafts just get worse.
  describe("the standard-works exemption", () => {
    const NARROW: ConferenceScope = {
      since: "2026-01-01",
      speakerRoles: ["apostle"],
      speakers: ["Somebody Else"],
    };

    it("keeps scripture under a recency filter", () => {
      expect(matchesConferenceScope(SCRIPTURE, { ...NARROW })).toBe(true);
    });

    it("keeps scripture under every filter at once", () => {
      expect(matchesConferenceScope(SCRIPTURE, NARROW)).toBe(true);
    });

    it("keeps an UNTAGGED document too", () => {
      // `is distinct from` rather than `<>` in migration 033. A null type_tag is an "other"
      // document and must pass; `null <> 'general_conference'` evaluates to NULL, which would
      // fail the `or` and silently drop every untagged document the moment any filter was set.
      expect(
        matchesConferenceScope(
          { typeTag: null, speaker: null, speakerRole: null, conferenceDate: null },
          NARROW,
        ),
      ).toBe(true);
    });

    it("keeps an 'other' document — a stake letter is not filtered by conference metadata", () => {
      expect(
        matchesConferenceScope(
          { typeTag: "other", speaker: null, speakerRole: null, conferenceDate: null },
          NARROW,
        ),
      ).toBe(true);
    });
  });

  describe("conference talks", () => {
    it("includes everything when no axis is filtered", () => {
      expect(matchesConferenceScope(talk(), { ...{ since: null, speakerRoles: null, speakers: null } })).toBe(
        true,
      );
    });

    it("excludes a talk older than the recency bound and keeps one on the boundary", () => {
      const scope: ConferenceScope = {
        since: "2026-04-01",
        speakerRoles: null,
        speakers: null,
      };

      expect(matchesConferenceScope(talk({ conferenceDate: "2026-04-01" }), scope)).toBe(true);
      expect(matchesConferenceScope(talk({ conferenceDate: "2025-10-01" }), scope)).toBe(false);
    });

    it("matches any of the roles named, and none outside them", () => {
      const scope: ConferenceScope = {
        since: null,
        speakerRoles: ["apostle", "seventy"],
        speakers: null,
      };

      expect(matchesConferenceScope(talk({ speakerRole: "apostle" }), scope)).toBe(true);
      expect(matchesConferenceScope(talk({ speakerRole: "seventy" }), scope)).toBe(true);
      expect(matchesConferenceScope(talk({ speakerRole: "prophet" }), scope)).toBe(false);
    });

    it("ANDs across axes", () => {
      const scope: ConferenceScope = {
        since: "2026-01-01",
        speakerRoles: ["apostle"],
        speakers: null,
      };

      expect(
        matchesConferenceScope(
          talk({ speakerRole: "apostle", conferenceDate: "2026-04-01" }),
          scope,
        ),
      ).toBe(true);
      // Right role, wrong period.
      expect(
        matchesConferenceScope(
          talk({ speakerRole: "apostle", conferenceDate: "2020-04-01" }),
          scope,
        ),
      ).toBe(false);
      // Right period, wrong role.
      expect(
        matchesConferenceScope(
          talk({ speakerRole: "prophet", conferenceDate: "2026-04-01" }),
          scope,
        ),
      ).toBe(false);
    });
  });

  // -------------------------------------------------------------------------------------------
  // THE "NOT FILTERABLE" CASE, IN BOTH DIRECTIONS
  // -------------------------------------------------------------------------------------------
  // A conference talk with null metadata fails every ACTIVE filter — exactly as SQL's
  // `null >= date` and `null = any (...)` both evaluate to NULL rather than true — and passes
  // when there is no filter at all.
  //
  // Which means an unlabelled conference talk is SILENTLY ALWAYS INCLUDED for a ward that has
  // not scoped anything, and silently always excluded for one that has. Neither is wrong; both
  // are surprising. That asymmetry is exactly why DocumentList badges it "Not filterable".
  describe("a conference talk with no metadata", () => {
    const UNLABELLED = talk({ speaker: null, speakerRole: null, conferenceDate: null });

    it("is included when nothing is filtered", () => {
      expect(
        matchesConferenceScope(UNLABELLED, {
          since: null,
          speakerRoles: null,
          speakers: null,
        }),
      ).toBe(true);
    });

    it("is excluded by a recency filter, because a null date cannot satisfy one", () => {
      expect(
        matchesConferenceScope(UNLABELLED, {
          since: "2020-01-01",
          speakerRoles: null,
          speakers: null,
        }),
      ).toBe(false);
    });

    it("is excluded by a role filter", () => {
      expect(
        matchesConferenceScope(UNLABELLED, {
          since: null,
          speakerRoles: ["prophet"],
          speakers: null,
        }),
      ).toBe(false);
    });

    it("is excluded by a speaker filter", () => {
      expect(
        matchesConferenceScope(UNLABELLED, {
          since: null,
          speakerRoles: null,
          speakers: ["Russell M. Nelson"],
        }),
      ).toBe(false);
    });
  });
});

describe("describeFilter", () => {
  it("names the speaker in a sentence somebody can agree to", () => {
    const sentence = describeFilter({
      kind: "filter",
      label: "Nelson",
      speakerRoles: null,
      speakers: ["Russell M. Nelson"],
      since: null,
    });

    expect(sentence).toContain("Russell M. Nelson");
    expect(sentence).toContain("Conference talks");
  });

  it("renders roles by their LABEL, never their raw column value", () => {
    const sentence = describeFilter({
      kind: "filter",
      label: "Prophets",
      speakerRoles: ["prophet"],
      speakers: null,
      since: null,
    });

    expect(sentence).toContain("President of the Church");
    expect(sentence).not.toContain("prophet");
  });

  it("STATES THE ROLE-AT-TIME-OF-TALK RULE where roles are involved", () => {
    // The one reading migration 033's column can answer. It belongs in the sentence somebody is
    // about to approve, not in a tooltip — "talks by prophets" means talks given WHILE serving.
    const withRole = describeFilter({
      kind: "filter",
      label: "Prophets",
      speakerRoles: ["prophet"],
      speakers: null,
      since: null,
    });
    const withoutRole = describeFilter({
      kind: "filter",
      label: "Recent",
      speakerRoles: null,
      speakers: null,
      since: "2024-04-01",
    });

    expect(withRole).toContain("held when the talk was given");
    // Not tacked onto a filter with no role in it, where it would be a non-sequitur.
    expect(withoutRole).not.toContain("held when the talk was given");
  });

  it("renders a date as a conference, not an ISO string", () => {
    const sentence = describeFilter({
      kind: "filter",
      label: "Recent",
      speakerRoles: null,
      speakers: null,
      since: "2024-04-01",
    });

    expect(sentence).toContain("April 2024");
    expect(sentence).not.toContain("2024-04-01");
  });

  it("joins several clauses readably", () => {
    const sentence = describeFilter({
      kind: "filter",
      label: "Recent apostles",
      speakerRoles: ["apostle"],
      speakers: null,
      since: "2024-04-01",
    });

    expect(sentence).toContain(" and ");
    expect(sentence).toContain("April 2024 onwards.");
    // Ends with the role note, because this filter names a role.
    expect(sentence.endsWith("held when the talk was given.")).toBe(true);
  });

  it("still renders words for a filter that narrows nothing", () => {
    // Unreachable through the routes — migration 034's CHECK refuses it and toResolvedFilter
    // turns it into `unresolvable`. A caller holding one must still show a sentence rather than
    // an empty span.
    expect(
      describeFilter({
        kind: "filter",
        label: "Empty",
        speakerRoles: null,
        speakers: null,
        since: null,
      }),
    ).toBeTruthy();
  });
});
