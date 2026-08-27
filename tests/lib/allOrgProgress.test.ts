import { describe, expect, it } from "vitest";
import { parseDateOnly, type DateOnly } from "@/lib/calendar/dates";
import type { HouseholdWithMembers, Member } from "@/lib/roster/queries";
import {
  buildAllOrgProgress,
  compareAllOrgRows,
  type AllOrgHouseholdRow,
  type AllOrgOrganization,
} from "@/lib/visits/allOrgProgress";
import type { Cadence } from "@/lib/visits/cadence";
import type { HouseholdVisitCadence } from "@/lib/visits/householdCadences";
import type { VisitGoal, VisitLogWithContext } from "@/lib/visits/queries";
import type { HouseholdStewardship } from "@/lib/visits/stewardship";

// PURE, against hand-built fixtures. buildAllOrgProgress() takes already-fetched data precisely so
// this suite needs no database.
//
// ---------------------------------------------------------------------------------------------
// THE ASSERTIONS THIS FILE EXISTS FOR
// ---------------------------------------------------------------------------------------------
// 1. AN ORGANIZATION THAT HAS NARROWED NOTHING CLAIMS EVERY HOUSEHOLD. That is what zero rows
//    means, so on ship day nothing is unclaimed and this view reads as a plain ward roster with
//    bands. If that inverted, every ward would open this page to a wall of red on day one.
//
// 2. AN ORGANIZATION WITH NO USABLE GOAL CLAIMS NOTHING. A ward has seven organizations and most
//    of them never visit households; counting Sunday School as a claimant of every family made
//    `unclaimed` impossible to reach in any real ward, which walking scenario 048 made plain.
//    This replaced a hardcoded "not the Bishopric" exclusion — a special case standing in for the
//    general rule it could not express.
//
// 3. AN ATTEMPT NEVER WINS "LAST SEEN". A ward being told it reached a family it never got past
//    the door of is the untruth visits-d exists to have removed.

const YEAR: Cadence = { amount: 1, unit: "year" };
const TWO_MONTHS: Cadence = { amount: 2, unit: "month" };

const EQ = "org-eq";
const RS = "org-rs";
const PRIMARY = "org-primary";
const BISHOPRIC = "org-bishopric";

// Stands for every organization a ward has that does not visit households — Young Men, Young
// Women, Sunday School. It is never given a goal in any fixture below, so it must never appear as
// a steward. Under the old "not the Bishopric" rule it claimed every household in the ward.
const SUNDAY_SCHOOL = "org-sunday-school";

// The Bishopric is FIRST in listWardOrganizations, as it is in the real query. It is no longer
// excluded BY TYPE — it simply never carries a visit goal, and that is now the whole test.
const ORGANIZATIONS: AllOrgOrganization[] = [
  { id: BISHOPRIC, name: "Bishopric", type: "bishopric" },
  { id: EQ, name: "Elders Quorum", type: "elders_quorum" },
  { id: PRIMARY, name: "Primary", type: "primary" },
  { id: RS, name: "Relief Society", type: "relief_society" },
  { id: SUNDAY_SCHOOL, name: "Sunday School", type: "sunday_school" },
];

let memberCounter = 0;

function member(householdId: string): Member {
  memberCounter += 1;
  return {
    id: `member-${memberCounter}`,
    householdId,
    firstName: "A",
    lastName: `Person${memberCounter}`,
    category: "adult",
    gender: null,
    status: "active",
    phone: null,
    createdAt: "2026-01-01T00:00:00.000Z",
  };
}

// Mirrors what listHouseholds() ACTUALLY returns: the household is always present and the status
// filter has already been applied to `members`.
function household(
  id: string,
  familyName: string,
  { empty = false, doNotContact = false } = {},
): HouseholdWithMembers {
  return {
    id,
    familyName,
    address: null,
    latitude: null,
    longitude: null,
    doNotContact,
    createdAt: "2026-01-01T00:00:00.000Z",
    members: empty ? [] : [member(id)],
  };
}

let logCounter = 0;

function log(
  householdId: string,
  orgId: string | null,
  visitDate: DateOnly,
  outcome: "completed" | "attempted" = "completed",
  conductedByLabel: string | null = "Miguel Cortez",
): VisitLogWithContext {
  logCounter += 1;
  return {
    id: `log-${logCounter}`,
    orgId,
    householdId,
    recordedBy: "user-1",
    visitDate,
    visitType: "in_home",
    outcome,
    arrangement: "drop_in",
    sharedNotes: null,
    flaggedForWardCouncil: false,
    flagSentAt: null,
    createdAt: `${visitDate}T00:00:00.000Z`,
    householdName: null,
    recordedByName: "Peter Nakamura",
    participants: [],
    conductedByLabel,
  };
}

function goal(orgId: string, cadence: Cadence = YEAR): VisitGoal {
  return {
    id: `goal-${orgId}`,
    orgId,
    title: "Visit every household",
    targetType: "all_households",
    cadence,
    notice: TWO_MONTHS,
    deadline: null,
    createdBy: "user-1",
    createdAt: "2026-01-01T00:00:00.000Z",
  };
}

function stewardship(orgId: string, householdId: string): HouseholdStewardship {
  return {
    id: `stewardship-${orgId}-${householdId}`,
    householdId,
    orgId,
    createdBy: "user-1",
    createdAt: "2026-01-01T00:00:00.000Z",
  };
}

function override(orgId: string, householdId: string, cadence: Cadence): HouseholdVisitCadence {
  return {
    id: `override-${orgId}-${householdId}`,
    householdId,
    orgId,
    cadence,
    createdBy: "user-1",
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
  };
}

function build({
  households = [household("h-1", "Brooks")],
  logs = [],
  goals = [goal(EQ), goal(RS), goal(PRIMARY)],
  householdCadences = [],
  stewardships = [],
  organizations = ORGANIZATIONS,
  asOf = "2026-06-01" as DateOnly,
}: {
  households?: HouseholdWithMembers[];
  logs?: VisitLogWithContext[];
  goals?: VisitGoal[];
  householdCadences?: HouseholdVisitCadence[];
  stewardships?: HouseholdStewardship[];
  organizations?: AllOrgOrganization[];
  asOf?: DateOnly;
} = {}) {
  return buildAllOrgProgress({
    households,
    logs,
    goals,
    householdCadences,
    stewardships,
    organizations,
    asOf: parseDateOnly(asOf),
  });
}

function rowFor(
  progress: ReturnType<typeof build>,
  householdId: string,
): AllOrgHouseholdRow {
  const row = progress.rows.find((candidate) => candidate.householdId === householdId);
  if (row === undefined) throw new Error(`No row for ${householdId}`);
  return row;
}

describe("claiming", () => {
  // SHIP DAY. Nothing narrowed, so nothing unclaimed — and this page reads as a plain ward
  // roster with bands rather than as a wall of red.
  it("makes every organization a steward of every household when nothing is narrowed", () => {
    const progress = build({
      households: [household("h-1", "Brooks"), household("h-2", "Okonkwo")],
    });

    expect(progress.unclaimedCount).toBe(0);

    for (const row of progress.rows) {
      expect(row.stewards.map((steward) => steward.orgId).sort()).toEqual(
        [EQ, PRIMARY, RS].sort(),
      );
      expect(row.unclaimed).toBe(false);
    }
  });

  // THE TEST THAT KEEPS `unclaimed` MEANINGFUL. A ward has seven organizations and most never
  // visit households; if they all claimed everything, no household could ever be unclaimed and
  // the view would be unable to surface the one failure it exists for.
  //
  // Neither of these has a goal in this fixture, and neither is excluded by name or by type —
  // having no goal is the whole rule.
  it("never counts an organization with no visit goal as a steward", () => {
    const progress = build({ households: [household("h-1", "Brooks")] });
    const stewardIds = rowFor(progress, "h-1").stewards.map((steward) => steward.orgId);

    expect(stewardIds).not.toContain(BISHOPRIC);
    expect(stewardIds).not.toContain(SUNDAY_SCHOOL);
    expect(stewardIds.sort()).toEqual([EQ, PRIMARY, RS].sort());
  });

  // The rule is about the GOAL, not the name. An organization whose goal row carries no usable
  // cadence cannot produce a band, so it has nothing to put on a chip and does not claim.
  it("does not count an organization whose goal has no usable cadence", () => {
    const progress = build({
      households: [household("h-1", "Brooks")],
      goals: [goal(EQ), { ...goal(RS), cadence: null }],
    });

    const stewardIds = rowFor(progress, "h-1").stewards.map((steward) => steward.orgId);

    expect(stewardIds).toEqual([EQ]);
  });

  // ...and it is not about the type either. Give the Bishopric a real goal and it claims like
  // anybody else — which is the honest answer, because a bishopric that has set a visit goal has
  // said it intends to visit households.
  it("counts the Bishopric as a steward once it has a goal of its own", () => {
    const progress = build({
      households: [household("h-1", "Brooks")],
      goals: [goal(BISHOPRIC), goal(EQ)],
    });

    expect(rowFor(progress, "h-1").stewards.map((steward) => steward.orgId).sort()).toEqual(
      [BISHOPRIC, EQ].sort(),
    );
  });

  it("keeps an un-narrowed organization claiming everything while a narrowed one does not", () => {
    const progress = build({
      households: [household("h-1", "Brooks"), household("h-2", "Okonkwo")],
      // Primary claims h-1 only. EQ and RS have narrowed nothing.
      stewardships: [stewardship(PRIMARY, "h-1")],
    });

    expect(rowFor(progress, "h-1").stewards.map((steward) => steward.orgId).sort()).toEqual(
      [EQ, PRIMARY, RS].sort(),
    );
    expect(rowFor(progress, "h-2").stewards.map((steward) => steward.orgId).sort()).toEqual(
      [EQ, RS].sort(),
    );
  });

  // THE PASTORAL FAILURE MODE, which is the whole reason ITER-019 D3 was safe to take: a
  // household outside every organization's stewardship is invisible on every dashboard, and this
  // is the one place it is visible.
  it("marks a household no organization has claimed, and sorts it first", () => {
    const progress = build({
      households: [
        household("h-claimed", "Aardvark"),
        household("h-orphan", "Zulu"),
      ],
      stewardships: [
        stewardship(EQ, "h-claimed"),
        stewardship(RS, "h-claimed"),
        stewardship(PRIMARY, "h-claimed"),
      ],
    });

    expect(rowFor(progress, "h-orphan").unclaimed).toBe(true);
    expect(rowFor(progress, "h-orphan").stewards).toEqual([]);
    expect(progress.unclaimedCount).toBe(1);

    // Alphabetically Aardvark would lead. Being unclaimed is what puts Zulu first.
    expect(progress.rows[0].householdId).toBe("h-orphan");
  });

  it("leaves a household nobody lives in off the page entirely", () => {
    const progress = build({
      households: [household("h-1", "Brooks"), household("h-gone", "Departed", { empty: true })],
    });

    expect(progress.rows.map((row) => row.householdId)).toEqual(["h-1"]);
  });
});

describe("the ward-wide last visit", () => {
  // THE QUESTION NO ORG-SCOPED QUERY CAN ANSWER, and the reason this view exists.
  it("takes the most recent completed visit across organizations and names the right one", () => {
    const progress = build({
      households: [household("h-1", "Brooks")],
      logs: [
        log("h-1", EQ, "2026-01-10", "completed", "Miguel Cortez"),
        log("h-1", RS, "2026-04-20", "completed", "Ruth Delacroix"),
      ],
    });

    const row = rowFor(progress, "h-1");

    expect(row.lastVisitedOn).toBe("2026-04-20");
    expect(row.lastVisitedByOrgId).toBe(RS);
    expect(row.lastVisitedByOrgName).toBe("Relief Society");
    expect(row.conductedBy).toBe("Ruth Delacroix");
  });

  // AN ATTEMPT NEVER WINS. It is more recent and it is not a visit; folding it in would tell the
  // ward it had reached a family it never got past the door of.
  it("never lets a more recent attempt displace an older completed visit", () => {
    const progress = build({
      households: [household("h-1", "Brooks")],
      logs: [
        log("h-1", RS, "2026-04-20", "completed", "Ruth Delacroix"),
        log("h-1", EQ, "2026-05-30", "attempted", "Miguel Cortez"),
      ],
    });

    const row = rowFor(progress, "h-1");

    expect(row.lastVisitedOn).toBe("2026-04-20");
    expect(row.conductedBy).toBe("Ruth Delacroix");
  });

  it("reads null for a household nobody has ever completed a visit to", () => {
    const progress = build({
      households: [household("h-1", "Brooks")],
      logs: [log("h-1", EQ, "2026-05-30", "attempted")],
    });

    const row = rowFor(progress, "h-1");

    expect(row.lastVisitedOn).toBeNull();
    expect(row.lastVisitedByOrgName).toBeNull();
    expect(row.conductedBy).toBeNull();
  });

  // A bishopric-authored visit carries `org_id = null` because it was not made on behalf of an
  // organization. It still counts as the family having been SEEN — this row is a ward-wide fact —
  // and its organization simply reads as unattributed rather than being credited to somebody.
  it("counts an unattributed visit as the family having been seen, naming no organization", () => {
    const progress = build({
      households: [household("h-1", "Brooks")],
      logs: [log("h-1", null, "2026-05-01", "completed", "Mark Andersen")],
    });

    const row = rowFor(progress, "h-1");

    expect(row.lastVisitedOn).toBe("2026-05-01");
    expect(row.lastVisitedByOrgId).toBeNull();
    expect(row.lastVisitedByOrgName).toBeNull();
    expect(row.conductedBy).toBe("Mark Andersen");
  });
});

describe("each steward's band", () => {
  // MEASURED FROM THAT ORGANIZATION'S OWN VISITS. The ward-wide "last seen" on the row and a
  // steward's band can legitimately disagree, and that disagreement is what this view is for.
  it("judges each organization against only the visits it made", () => {
    const progress = build({
      households: [household("h-1", "Brooks")],
      logs: [
        // The Relief Society went last month; the Elders Quorum went two years ago.
        log("h-1", RS, "2026-05-01", "completed"),
        log("h-1", EQ, "2024-05-01", "completed"),
      ],
      goals: [goal(EQ), goal(RS)],
      organizations: [
        { id: BISHOPRIC, name: "Bishopric", type: "bishopric" },
        { id: EQ, name: "Elders Quorum", type: "elders_quorum" },
        { id: RS, name: "Relief Society", type: "relief_society" },
      ],
    });

    const row = rowFor(progress, "h-1");
    const bandOf = (orgId: string) =>
      row.stewards.find((steward) => steward.orgId === orgId)?.priority?.band;

    expect(row.lastVisitedOn).toBe("2026-05-01");
    expect(bandOf(RS)).toBe("on_track");
    expect(bandOf(EQ)).toBe("overdue");
  });

  // EVERY CHIP THAT EXISTS CARRIES A BAND, and that is the shape migration 053 produced.
  //
  // This test used to assert the opposite: that a goal absent from the input meant a reader who
  // could not read it, and that the steward came back with a chip and a null band. The page then
  // had to explain per chip why a number was missing — and walking scenario 048 found that
  // explanation was wrong more often than it was right, because "no goal at all" and "a goal you
  // may not read" arrived here identically.
  //
  // Both halves of that ambiguity are gone. A goal this reader cannot read no longer happens on
  // this page (053), and an organization with no goal is not a claimant (so has no chip).
  it("gives every steward a band, so no chip needs explaining", () => {
    const progress = build({
      households: [household("h-1", "Brooks")],
      logs: [log("h-1", EQ, "2026-05-01", "completed")],
      goals: [goal(EQ), goal(RS), goal(PRIMARY)],
    });

    const row = rowFor(progress, "h-1");

    expect(row.stewards).toHaveLength(3);
    expect(row.stewards.every((steward) => steward.priority !== null)).toBe(true);
    expect(
      row.stewards.find((steward) => steward.orgId === EQ)?.priority?.band,
    ).toBe("on_track");
  });

  it("reports every organization as banded for a reader who can see them all", () => {
    const progress = build({ households: [household("h-1", "Brooks")] });

    expect(progress.bandedOrgIds.sort()).toEqual([EQ, PRIMARY, RS].sort());
  });

  // A household override belongs to ONE organization, so the same family reads different bands
  // for different organizations from the same visit history.
  it("applies a household cadence override to only the organization that set it", () => {
    const progress = build({
      households: [household("h-1", "Brooks")],
      logs: [
        log("h-1", EQ, "2026-02-01", "completed"),
        log("h-1", RS, "2026-02-01", "completed"),
      ],
      goals: [goal(EQ), goal(RS)],
      // The Elders Quorum holds this family to every month; the Relief Society to its yearly goal.
      householdCadences: [override(EQ, "h-1", { amount: 1, unit: "month" })],
      organizations: [
        { id: EQ, name: "Elders Quorum", type: "elders_quorum" },
        { id: RS, name: "Relief Society", type: "relief_society" },
      ],
    });

    const row = rowFor(progress, "h-1");
    const stewardFor = (orgId: string) =>
      row.stewards.find((steward) => steward.orgId === orgId);

    expect(stewardFor(EQ)?.priority?.band).toBe("overdue");
    expect(stewardFor(EQ)?.priority?.cadenceSource).toBe("household");
    expect(stewardFor(RS)?.priority?.band).toBe("on_track");
    expect(stewardFor(RS)?.priority?.cadenceSource).toBe("goal");
  });

  // A do-not-contact household is SHOWN and has NO band for anybody. It is not on the scale at
  // all (ITER-018 Decision 4), and that stays true on this page.
  it("gives a do-not-contact household no band from any organization", () => {
    const progress = build({
      households: [household("h-dnc", "Sorensen", { doNotContact: true })],
      logs: [log("h-dnc", EQ, "2020-01-01", "completed")],
    });

    const row = rowFor(progress, "h-dnc");

    expect(row.doNotContact).toBe(true);
    expect(row.lastVisitedOn).toBe("2020-01-01");
    expect(row.stewards.every((steward) => steward.priority === null)).toBe(true);
  });

  // A ward where NOBODY has set a visit goal has nothing to say on this page, and says nothing
  // rather than rendering a row of nameplates. Every household is then unclaimed, which is
  // truthful: no organization has taken responsibility for visiting anybody yet.
  it("shows no stewards at all when no organization has a goal", () => {
    const progress = build({
      households: [household("h-1", "Brooks")],
      goals: [],
    });

    const row = rowFor(progress, "h-1");

    expect(row.stewards).toEqual([]);
    expect(row.unclaimed).toBe(true);
    expect(progress.bandedOrgIds).toEqual([]);
  });
});

describe("the comparator", () => {
  const row = (over: Partial<AllOrgHouseholdRow>): AllOrgHouseholdRow => ({
    householdId: "h",
    familyName: "Household",
    doNotContact: false,
    lastVisitedOn: "2026-05-01",
    lastVisitedByOrgId: EQ,
    lastVisitedByOrgName: "Elders Quorum",
    conductedBy: "Miguel Cortez",
    stewards: [],
    unclaimed: false,
    ...over,
  });

  const banded = (band: "never_visited" | "overdue" | "approaching" | "on_track") => ({
    orgId: EQ,
    orgName: "Elders Quorum",
    priority: {
      band,
      elapsedFraction: band === "never_visited" ? null : 0.5,
      dueOn: band === "never_visited" ? null : ("2026-12-01" as DateOnly),
      cadence: YEAR,
      cadenceSource: "goal" as const,
    },
  });

  it("puts an unclaimed household above everything, including an overdue one", () => {
    const unclaimed = row({ familyName: "Zulu", unclaimed: true });
    const overdue = row({ familyName: "Aardvark", stewards: [banded("overdue")] });

    expect(compareAllOrgRows(unclaimed, overdue)).toBeLessThan(0);
  });

  it("orders by the most urgent visible band next", () => {
    const overdue = row({ familyName: "Zulu", stewards: [banded("overdue")] });
    const onTrack = row({ familyName: "Aardvark", stewards: [banded("on_track")] });

    expect(compareAllOrgRows(overdue, onTrack)).toBeLessThan(0);
  });

  // The MOST urgent across the stewards, not the first one listed.
  it("reads the most urgent of several stewards", () => {
    const mixed = row({
      familyName: "Zulu",
      stewards: [banded("on_track"), banded("overdue")],
    });
    const settled = row({ familyName: "Aardvark", stewards: [banded("on_track")] });

    expect(compareAllOrgRows(mixed, settled)).toBeLessThan(0);
  });

  // A NULL BAND IS UNKNOWN, NOT SETTLED. A row whose only steward is invisible to this reader
  // must not be sorted as though it were on track — the answer simply is not available.
  it("does not treat an invisible band as least urgent", () => {
    const hidden = row({
      familyName: "Zulu",
      stewards: [{ orgId: RS, orgName: "Relief Society", priority: null }],
    });
    const onTrack = row({ familyName: "Aardvark", stewards: [banded("on_track")] });

    // on_track outranks "no band at all", which sorts last — the same rule priorityRank keeps.
    expect(compareAllOrgRows(onTrack, hidden)).toBeLessThan(0);
  });

  it("puts a never-seen household above a seen one when the bands tie", () => {
    const neverSeen = row({ familyName: "Zulu", lastVisitedOn: null });
    const seen = row({ familyName: "Aardvark", lastVisitedOn: "2026-05-01" });

    expect(compareAllOrgRows(neverSeen, seen)).toBeLessThan(0);
  });

  it("falls back to the family name", () => {
    const first = row({ familyName: "Aardvark" });
    const second = row({ familyName: "Zulu" });

    expect(compareAllOrgRows(first, second)).toBeLessThan(0);
    expect(compareAllOrgRows(second, first)).toBeGreaterThan(0);
  });
});

// ONE CLOCK READING PER RENDER, handed down as `asOf`, so every row is judged against the same
// instant — the rule readVisitProgress and the visits page already keep.
describe("the clock", () => {
  it("reports the instant it was given", () => {
    const progress = build({ asOf: "2026-06-01" });

    expect(progress.asOf).toBe(parseDateOnly("2026-06-01").toISOString());
  });
});
