import { describe, expect, it } from "vitest";
import {
  MAX_ACTIVITY_NAME,
  MAX_ACTIVITY_NOTES,
  MAX_EVENT_LOCATION,
  MAX_EVENT_TITLE,
  MAX_SCHOOL_ORG,
  MAX_SEASON_SCHEDULE,
  PROFILE_MEMBER_CATEGORIES,
  assignAttendeeSchema,
  createActivityEventSchema,
  createActivityProfileSchema,
  eventInstantSchema,
  listActivityEventsQuerySchema,
  updateActivityEventSchema,
  updateActivityProfileSchema,
} from "@/lib/validation/youth";
import {
  offsetSuffix,
  toLocalInputValue,
  toOffsetBearingInstant,
} from "@/lib/youth/eventInstant";

// Pure, no database. The two things worth pinning here are the LENGTH BOUNDARIES (one under, one
// over, per boundary — a schema that is off by one is off by one silently) and THE INSTANT RULE.
//
// The instant rule is the one that earns its place. Slice B's whole job is reading times out of
// an ICS feed correctly, and it inherits this column. Writing the REJECTION case now is what
// makes slice B's ics-timezone suite an extension of this one rather than a rewrite of it — and
// it is what stops slice A quietly filling the column with floating times that slice B would then
// have to guess at.

const VALID_UUID = "3f1e0c8a-2b5d-4e7f-9a10-6c4b2d8e1f30";
const SECOND_UUID = "8a2b4c6d-1e3f-4a5b-8c7d-9e0f1a2b3c4d";

function profile(overrides: Record<string, unknown> = {}) {
  return {
    memberId: VALID_UUID,
    activityName: "Varsity basketball",
    activityType: "sport",
    ...overrides,
  };
}

function event(overrides: Record<string, unknown> = {}) {
  return {
    profileId: VALID_UUID,
    title: "Game against Lincoln",
    eventDate: "2026-09-04T19:30:00-06:00",
    ...overrides,
  };
}

describe("the one answer to which member an activity profile may name", () => {
  // The route and ActivityProfileForm's MemberPicker filter both read this. If it ever grows a
  // second value, both move together — which is the whole reason it is a constant rather than a
  // literal in two files (plans/retros/visits-b-*, visits-f-*).
  it("is youth, and only youth", () => {
    expect([...PROFILE_MEMBER_CATEGORIES]).toEqual(["youth"]);
  });
});

describe("eventInstantSchema", () => {
  it("accepts an instant carrying an explicit offset", () => {
    expect(eventInstantSchema.parse("2026-09-04T19:30:00-06:00")).toBe(
      "2026-09-04T19:30:00-06:00",
    );
  });

  it("accepts an instant carrying a compact offset", () => {
    expect(eventInstantSchema.safeParse("2026-09-04T19:30:00-0600").success).toBe(true);
  });

  it("accepts an instant in UTC", () => {
    expect(eventInstantSchema.parse("2026-09-05T01:30:00Z")).toBe("2026-09-05T01:30:00Z");
  });

  it("accepts a positive offset", () => {
    expect(eventInstantSchema.safeParse("2026-09-04T19:30:00+13:00").success).toBe(true);
  });

  // THE CASE THAT MATTERS. A bare local time is half past seven in no particular place, and the
  // server would read it in whatever zone the server happens to run in.
  it("refuses a floating time and names the problem", () => {
    const result = eventInstantSchema.safeParse("2026-09-04T19:30");

    expect(result.success).toBe(false);
    expect(result.error?.issues[0]?.message).toContain("time zone");
  });

  it("refuses a bare date", () => {
    expect(eventInstantSchema.safeParse("2026-09-04").success).toBe(false);
  });

  it("refuses an empty string", () => {
    expect(eventInstantSchema.safeParse("").success).toBe(false);
  });

  // Offset-bearing but not a real moment. The two refinements are separate on purpose: the first
  // says "you did not tell me where", the second says "that is not a date at all".
  it("refuses something that looks offset-bearing but is not a date", () => {
    const result = eventInstantSchema.safeParse("not-a-date+01:00");

    expect(result.success).toBe(false);
    expect(result.error?.issues[0]?.message).toContain("not a date and time");
  });
});

describe("toOffsetBearingInstant", () => {
  // The property that matters is not which offset the machine running the tests happens to have —
  // it is that the WALL CLOCK SURVIVES. 19:30 in must be 19:30 out, plus a suffix.
  it("keeps the wall clock the person typed and appends an offset", () => {
    const result = toOffsetBearingInstant("2026-09-04T19:30");

    expect(result).not.toBeNull();
    expect(result!.startsWith("2026-09-04T19:30:00")).toBe(true);
    expect(eventInstantSchema.safeParse(result).success).toBe(true);
  });

  it("produces something the schema accepts, for a winter date too", () => {
    const result = toOffsetBearingInstant("2026-01-14T07:05");

    expect(result!.startsWith("2026-01-14T07:05:00")).toBe(true);
    expect(eventInstantSchema.safeParse(result).success).toBe(true);
  });

  it("returns null for an empty field rather than throwing", () => {
    expect(toOffsetBearingInstant("")).toBeNull();
    expect(toOffsetBearingInstant("   ")).toBeNull();
  });

  it("returns null for an unparseable value", () => {
    expect(toOffsetBearingInstant("half past seven")).toBeNull();
  });

  it("writes the offset ahead-of-UTC, the way ISO-8601 does", () => {
    // getTimezoneOffset() counts minutes BEHIND UTC; ISO writes minutes AHEAD. Inverting it is a
    // silent twenty-hour error, so the sign is pinned rather than assumed.
    const suffix = offsetSuffix(new Date("2026-07-01T12:00:00Z"));

    expect(suffix).toMatch(/^[+-]\d{2}:\d{2}$/);
  });
});

// ---------------------------------------------------------------------------
// THE DOUBLE-CONVERSION BUG, WHICH ONLY EVER APPEARS ON THE SECOND WRITE
// ---------------------------------------------------------------------------
// Fill the form from a stored instant, save, fill it again, save again. If either half converts
// between zones, 7:30pm walks by the offset every time — and a single save looks perfect, which
// is how this ships.
describe("editing an event twice does not shift it", () => {
  it("round-trips a wall clock unchanged, three times", () => {
    const first = toOffsetBearingInstant("2026-09-04T19:30")!;
    const backIntoTheField = toLocalInputValue(first);

    expect(backIntoTheField).toBe("2026-09-04T19:30");

    const second = toOffsetBearingInstant(backIntoTheField)!;
    const third = toOffsetBearingInstant(toLocalInputValue(second))!;

    expect(new Date(second).getTime()).toBe(new Date(first).getTime());
    expect(new Date(third).getTime()).toBe(new Date(first).getTime());
  });

  it("round-trips across a date that sits on the other side of a DST change", () => {
    const summer = toOffsetBearingInstant("2026-07-04T19:30")!;
    const winter = toOffsetBearingInstant("2026-01-04T19:30")!;

    expect(toLocalInputValue(summer)).toBe("2026-07-04T19:30");
    expect(toLocalInputValue(winter)).toBe("2026-01-04T19:30");
  });

  it("returns an empty field for an unreadable stored value rather than NaN", () => {
    expect(toLocalInputValue("not a date")).toBe("");
  });
});

describe("createActivityProfileSchema", () => {
  it("accepts the minimum a profile needs", () => {
    const result = createActivityProfileSchema.parse(profile());

    expect(result.memberId).toBe(VALID_UUID);
    expect(result.activityType).toBe("sport");
  });

  it("trims the activity name", () => {
    expect(createActivityProfileSchema.parse(profile({ activityName: "  Choir  " })).activityName)
      .toBe("Choir");
  });

  it("refuses an empty activity name", () => {
    expect(createActivityProfileSchema.safeParse(profile({ activityName: "   " })).success)
      .toBe(false);
  });

  it("refuses an activity type outside the enum", () => {
    expect(createActivityProfileSchema.safeParse(profile({ activityType: "chess" })).success)
      .toBe(false);
  });

  it("refuses a memberId that is not a uuid", () => {
    expect(createActivityProfileSchema.safeParse(profile({ memberId: "someone" })).success)
      .toBe(false);
  });

  it("accepts an explicit null on every optional text field", () => {
    const result = createActivityProfileSchema.parse(
      profile({ schoolOrg: null, seasonSchedule: null, notes: null }),
    );

    expect(result.schoolOrg).toBeNull();
    expect(result.notes).toBeNull();
  });

  it("accepts an orgId and leaves it undefined when absent", () => {
    expect(createActivityProfileSchema.parse(profile({ orgId: SECOND_UUID })).orgId)
      .toBe(SECOND_UUID);
    expect(createActivityProfileSchema.parse(profile()).orgId).toBeUndefined();
  });

  it.each([
    ["activityName", MAX_ACTIVITY_NAME],
    ["schoolOrg", MAX_SCHOOL_ORG],
    ["seasonSchedule", MAX_SEASON_SCHEDULE],
    ["notes", MAX_ACTIVITY_NOTES],
  ])("accepts %s at its limit and refuses one character more", (field, limit) => {
    expect(createActivityProfileSchema.safeParse(profile({ [field]: "x".repeat(limit) })).success)
      .toBe(true);
    expect(
      createActivityProfileSchema.safeParse(profile({ [field]: "x".repeat(limit + 1) })).success,
    ).toBe(false);
  });
});

describe("updateActivityProfileSchema", () => {
  it("accepts a single field", () => {
    expect(updateActivityProfileSchema.parse({ activityName: "Jazz band" }).activityName)
      .toBe("Jazz band");
  });

  // An empty patch is not a no-op, it is a mistake — a form that sent nothing, or a caller
  // sending the wrong field names. Saying so beats a silent 200 (updateVisitGoalSchema does the
  // same and words it the same way).
  it("refuses an empty object with a sentence", () => {
    const result = updateActivityProfileSchema.safeParse({});

    expect(result.success).toBe(false);
    expect(result.error?.issues[0]?.message).toBe("Nothing was changed.");
  });

  // memberId and orgId are NOT patchable. Zod strips unknown keys rather than refusing them, so
  // the assertion is that they do not survive into the parsed patch — which is what keeps
  // updateActivityProfile() from ever building a patch that moves a profile.
  it("drops a memberId or an orgId rather than applying it", () => {
    const result = updateActivityProfileSchema.parse({
      activityName: "Choir",
      memberId: SECOND_UUID,
      orgId: SECOND_UUID,
    });

    expect(result).not.toHaveProperty("memberId");
    expect(result).not.toHaveProperty("orgId");
  });
});

describe("createActivityEventSchema", () => {
  // ---------------------------------------------------------------------------
  // ABSENT MUST STAY DISTINGUISHABLE FROM AN EXPLICIT "tbd"
  // ---------------------------------------------------------------------------
  // It used to read `.default("tbd")`, and that one word made classification impossible: with a
  // default, "the leader left the field alone" and "the leader chose Not yet known" reach the
  // route as the same value, so classifying anything would mean overriding an explicit human
  // choice. Slice C dropped it, and this pair of cases is what stops it being restored as an
  // obvious tidy-up.
  it("leaves an unstated event type undefined rather than defaulting it to tbd", () => {
    expect(createActivityEventSchema.parse(event()).eventType).toBeUndefined();
  });

  it("keeps an explicit tbd, because a person choosing it is a decision", () => {
    expect(createActivityEventSchema.parse(event({ eventType: "tbd" })).eventType).toBe("tbd");
  });

  it("accepts home and away", () => {
    expect(createActivityEventSchema.parse(event({ eventType: "away" })).eventType).toBe("away");
  });

  it("refuses a floating eventDate", () => {
    const result = createActivityEventSchema.safeParse(event({ eventDate: "2026-09-04T16:00" }));

    expect(result.success).toBe(false);
    expect(result.error?.issues[0]?.message).toContain("time zone");
  });

  it("refuses a profileId that is not a uuid", () => {
    expect(createActivityEventSchema.safeParse(event({ profileId: "the team" })).success)
      .toBe(false);
  });

  it.each([
    ["title", MAX_EVENT_TITLE],
    ["location", MAX_EVENT_LOCATION],
  ])("accepts %s at its limit and refuses one character more", (field, limit) => {
    expect(createActivityEventSchema.safeParse(event({ [field]: "x".repeat(limit) })).success)
      .toBe(true);
    expect(
      createActivityEventSchema.safeParse(event({ [field]: "x".repeat(limit + 1) })).success,
    ).toBe(false);
  });

  // A calendar id would make a hand-entered row look like something an ICS feed produced, and
  // slice B's re-import matches on exactly that.
  it("drops a calendarId rather than accepting one", () => {
    expect(createActivityEventSchema.parse(event({ calendarId: SECOND_UUID })))
      .not.toHaveProperty("calendarId");
  });
});

describe("updateActivityEventSchema", () => {
  it("accepts each of the two statuses", () => {
    for (const status of ["upcoming", "cancelled"]) {
      expect(updateActivityEventSchema.safeParse({ status }).success).toBe(true);
    }
  });

  // `covered` and `uncovered` went in migration 054c, `completed` in 056a, and all three for the
  // SAME reason: the clock decides them, and a stored value the clock decides goes stale the
  // moment nobody refreshes it. Nothing in this project refreshes anything.
  //
  // This schema narrowed for FREE when EVENT_STATUSES did, because it reads `z.enum(EVENT_STATUSES)`
  // rather than repeating the values — which is the point of spelling enums that way, and worth
  // an assertion so a future hand-written list is caught here.
  it.each(["covered", "uncovered", "completed"])(
    "refuses the removed status %s",
    (status) => {
      expect(updateActivityEventSchema.safeParse({ status }).success).toBe(false);
    },
  );

  it("refuses an empty object with a sentence", () => {
    const result = updateActivityEventSchema.safeParse({});

    expect(result.success).toBe(false);
    expect(result.error?.issues[0]?.message).toBe("Nothing was changed.");
  });

  it("refuses a floating eventDate on a patch too", () => {
    expect(updateActivityEventSchema.safeParse({ eventDate: "2026-09-04T16:00" }).success)
      .toBe(false);
  });

  // ---------------------------------------------------------------------------
  // `youthAttended` — THREE STATES PLUS ABSENCE, WHICH IS FOUR MEANINGS (migration 061)
  // ---------------------------------------------------------------------------
  it.each([true, false, null])("accepts %s", (youthAttended) => {
    const result = updateActivityEventSchema.safeParse({ youthAttended });

    expect(result.success).toBe(true);
    expect(result.success && result.data.youthAttended).toBe(youthAttended);
  });

  // ABSENT MEANS LEAVE IT ALONE, and updateActivityEvent()'s `!== undefined` test is what turns
  // that into a no-op rather than a clear.
  it("leaves the key ABSENT when it is not sent", () => {
    const result = updateActivityEventSchema.safeParse({ status: "cancelled" });

    expect(result.success).toBe(true);
    expect(result.success && "youthAttended" in result.data).toBe(false);
  });

  // A BOOLEAN, NEVER A STRING OR A NUMBER. `"false"` and `0` are both truthy-or-falsy in the
  // wrong direction somewhere downstream, and a coercing schema is how one of them arrives.
  it.each(["false", "true", 0, 1])("refuses %s", (youthAttended) => {
    expect(updateActivityEventSchema.safeParse({ youthAttended }).success).toBe(false);
  });

  // EXPLICIT NULL IS A CHANGE. It clears the answer back to "nobody has said", which is what makes
  // the control reversible — so the "Nothing was changed" refinement must not eat it.
  it("passes the Nothing-was-changed guard on its own with an explicit null", () => {
    const result = updateActivityEventSchema.safeParse({ youthAttended: null });

    expect(result.success).toBe(true);
  });

  // NOT ON THE CREATE SCHEMA, deliberately: a new event is created with null, and a create form
  // asking whether a young person will attend a game nobody has scheduled is a question with no
  // occasion.
  it("is not a field createActivityEventSchema accepts", () => {
    const result = createActivityEventSchema.safeParse({
      profileId: "3f8ec7a4-1c6f-4f5b-9c2e-6f1c9a4b7d21",
      title: "Game against Roosevelt",
      eventDate: "2027-01-16T02:30:00.000Z",
      youthAttended: false,
    });

    expect(result.success).toBe(true);
    expect(result.success && "youthAttended" in result.data).toBe(false);
  });
});

describe("listActivityEventsQuerySchema", () => {
  // A query string carries no booleans. Only the literal "true" widens the list; everything else,
  // including "1" and "TRUE" and absent, leaves it on upcoming only — a single spelling is easier
  // to keep right than a set of them.
  it("widens only on the literal true", () => {
    expect(listActivityEventsQuerySchema.parse({ includePast: "true" }).includePast).toBe(true);
    expect(listActivityEventsQuerySchema.parse({ includePast: "1" }).includePast).toBe(false);
    expect(listActivityEventsQuerySchema.parse({}).includePast).toBe(false);
  });

  it("accepts an offset-bearing window and refuses a floating one", () => {
    expect(
      listActivityEventsQuerySchema.safeParse({
        from: "2026-09-01T00:00:00Z",
        to: "2026-09-30T23:59:59Z",
      }).success,
    ).toBe(true);

    expect(listActivityEventsQuerySchema.safeParse({ from: "2026-09-01T00:00" }).success)
      .toBe(false);
  });

  it("refuses a profileId that is not a uuid", () => {
    expect(listActivityEventsQuerySchema.safeParse({ profileId: "basketball" }).success)
      .toBe(false);
  });
});

describe("assignAttendeeSchema", () => {
  it("accepts a user id", () => {
    expect(assignAttendeeSchema.safeParse({ userId: VALID_UUID }).success).toBe(true);
  });

  it("refuses a missing user with a sentence somebody can act on", () => {
    const result = assignAttendeeSchema.safeParse({});

    expect(result.success).toBe(false);
    expect(result.error?.issues[0]?.message).toBe("Choose who is going.");
  });

  it("refuses something that is not a uuid", () => {
    expect(assignAttendeeSchema.safeParse({ userId: "somebody" }).success).toBe(false);
  });

  // NEITHER COMES FROM THE BODY. `eventId` is the route parameter and `assignedBy` is the
  // session — a body that could name its own assigner is a body that can forge one, which is the
  // rule lib/validation/youth.ts's header already states for wardId and enteredBy.
  it("drops an eventId or an assignedBy rather than accepting one", () => {
    const parsed = assignAttendeeSchema.parse({
      userId: VALID_UUID,
      eventId: SECOND_UUID,
      assignedBy: SECOND_UUID,
    });

    expect(parsed).not.toHaveProperty("eventId");
    expect(parsed).not.toHaveProperty("assignedBy");
  });
});
