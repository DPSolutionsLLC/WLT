import { describe, expect, it } from "vitest";
import type { ReportReadState } from "@/lib/reports/readStatus";
// Re-pointed in youth-d: `toPreviewText` and `PREVIEW_MAX_CHARACTERS` moved to
// lib/reports/preview.ts so the youth mapper could share them without importing a visits module.
// NOT ONE ASSERTION IN THIS FILE CHANGED — if one had needed to, the move would not have been
// behaviour-preserving.
import { PREVIEW_MAX_CHARACTERS, toPreviewText } from "@/lib/reports/preview";
import { toReportTiles } from "@/lib/visits/reportTiles";
import type { VisitLogWithContext } from "@/lib/visits/queries";

// Pure. No database, no client, no clock — which is the point of keeping the mapper out of the
// component and out of the route.
//
// What these pin is the set of decisions a tile can get quietly wrong: an empty preview that
// looks like a note which failed to load, a truncation mid-word that looks like a rendering
// fault, a read state defaulted the wrong way on a report nobody has opened, and — the one that
// matters most — "who went" silently falling back to "who typed it in".

const ORGANIZATION_ID = "5f2a6f1c-0000-4000-8000-000000000001";

const ORGANIZATIONS = new Map([
  [ORGANIZATION_ID, { name: "Elders Quorum", type: "elders_quorum" as const }],
]);

function visitLog(overrides: Partial<VisitLogWithContext> = {}): VisitLogWithContext {
  return {
    id: "11111111-0000-4000-8000-000000000001",
    orgId: ORGANIZATION_ID,
    householdId: "22222222-0000-4000-8000-000000000001",
    recordedBy: "33333333-0000-4000-8000-000000000001",
    visitDate: "2026-04-05",
    visitType: "in_home",
    outcome: "completed",
    arrangement: "drop_in",
    sharedNotes: "Brought a meal round.",
    flaggedForWardCouncil: false,
    flagSentAt: null,
    createdAt: "2026-04-05T18:00:00.000Z",
    householdName: "Andersen",
    recordedByName: "Wendy Secretary",
    participants: [],
    conductedByLabel: "Miguel Cortez",
    ...overrides,
  };
}

function tileFor(
  visit: VisitLogWithContext,
  readStatus: Map<string, ReportReadState> = new Map(),
) {
  const [tile] = toReportTiles([visit], {
    organizations: ORGANIZATIONS,
    readStatus,
  });

  if (tile === undefined) throw new Error("toReportTiles returned nothing");
  return tile;
}

describe("toPreviewText", () => {
  it("returns null rather than an empty string when there is no shared note", () => {
    expect(toPreviewText(null)).toBeNull();
  });

  // "" would render as a tile with a blank gap where the note goes, which reads as a note that
  // failed to load. The tile says "No shared note" instead, and that only happens on null.
  it("returns null for a note that is only whitespace", () => {
    expect(toPreviewText("   ")).toBeNull();
    expect(toPreviewText("\n\n")).toBeNull();
  });

  it("previews the FIRST line only", () => {
    expect(toPreviewText("They are doing well.\nThe roof still leaks.")).toBe(
      "They are doing well.",
    );
  });

  it("trims the line it previews", () => {
    expect(toPreviewText("  They are doing well.  \nmore")).toBe("They are doing well.");
  });

  it("leaves a note shorter than the limit exactly as it is", () => {
    const note = "Brought a meal round.";
    expect(toPreviewText(note)).toBe(note);
  });

  // Slicing mid-word produces "…stayed for co…", which looks like a rendering fault rather than
  // a deliberate summary.
  it("truncates at a word boundary with an ellipsis", () => {
    const note = `${"word ".repeat(40)}end`;
    const preview = toPreviewText(note);

    expect(preview).not.toBeNull();
    expect(preview!.endsWith("…")).toBe(true);
    expect(preview!.length).toBeLessThanOrEqual(PREVIEW_MAX_CHARACTERS + 1);
    // No half-word before the ellipsis.
    expect(preview!.slice(0, -1).endsWith("word")).toBe(true);
  });

  // A single word longer than the limit has no boundary to find. Cutting it where it falls is
  // still better than a tile a hundred characters taller than its neighbours.
  it("cuts a single over-long word rather than giving up on truncating", () => {
    const preview = toPreviewText("a".repeat(400));

    expect(preview).toBe(`${"a".repeat(PREVIEW_MAX_CHARACTERS)}…`);
  });
});

describe("toReportTiles", () => {
  it("maps a visit onto the generic tile", () => {
    const tile = tileFor(visitLog());

    expect(tile).toMatchObject({
      reportType: "visit_log",
      contextId: ORGANIZATION_ID,
      contextLabel: "Elders Quorum",
      contextTone: "blue",
      subjectLabel: "Andersen",
      occurredOn: "2026-04-05",
      previewText: "Brought a meal round.",
    });
  });

  // THE ASSERTION THIS FILE EXISTS FOR. `authorLabel` is who WENT. A visit that records nobody
  // must not be credited to whoever typed it in — that is the exact ambiguity visits-d split the
  // column to remove, and a fallback here would put it straight back.
  it("leaves authorLabel null when nobody is recorded as having gone", () => {
    const tile = tileFor(visitLog({ conductedByLabel: null }));

    expect(tile.authorLabel).toBeNull();
    expect(tile.recordedByLabel).toBe("Wendy Secretary");
  });

  it("keeps who went and who recorded it as separate fields", () => {
    const tile = tileFor(visitLog());

    expect(tile.authorLabel).toBe("Miguel Cortez");
    expect(tile.recordedByLabel).toBe("Wendy Secretary");
  });

  // A label on every tile reading "Visited" is noise; the one reading "Attempted" is the point.
  it("labels the outcome only when the visit did not happen", () => {
    expect(tileFor(visitLog({ outcome: "completed" })).outcomeLabel).toBeNull();
    expect(tileFor(visitLog({ outcome: "attempted" })).outcomeLabel).toBe("Attempted");
  });

  // A bishopric-authored visit has no organization at all, so it carries no contextId and the
  // filter cannot select it — correct, because there is no organization to filter to.
  it("names a bishopric-authored visit rather than leaving the context blank", () => {
    const tile = tileFor(visitLog({ orgId: null }));

    expect(tile.contextLabel).toBe("Bishopric");
    expect(tile.contextId).toBeNull();
    expect(tile.contextTone).toBe("slate");
  });

  // An organization deleted since the visit was logged must not inherit some other
  // organization's colour off the end of a lookup.
  it("falls back to the bishopric tone when the organization row has gone", () => {
    const tile = tileFor(visitLog({ orgId: "99999999-0000-4000-8000-00000000ffff" }));

    expect(tile.contextLabel).toBe("Bishopric");
    expect(tile.contextId).toBeNull();
    expect(tile.contextTone).toBe("slate");
  });

  it("names a deleted household rather than leaving the subject blank", () => {
    expect(tileFor(visitLog({ householdName: null })).subjectLabel).toBe(
      "Unknown household",
    );
  });

  // A report with no row at all is unread and unbookmarked. Defaulting the other way would paint
  // a fresh feed as fully read.
  it("reads as unread when there is no read-status row", () => {
    const tile = tileFor(visitLog());

    expect(tile.isRead).toBe(false);
    expect(tile.bookmarked).toBe(false);
  });

  it("reads isRead from the timestamp, not from the row existing", () => {
    const visit = visitLog();

    // Bookmarked before it was read: the row exists, read_at is null. Both facts must survive.
    const readStatus = new Map<string, ReportReadState>([
      [visit.id, { reportId: visit.id, isRead: false, bookmarked: true }],
    ]);

    const tile = tileFor(visit, readStatus);

    expect(tile.isRead).toBe(false);
    expect(tile.bookmarked).toBe(true);
  });

  it("carries a read row through", () => {
    const visit = visitLog();
    const readStatus = new Map<string, ReportReadState>([
      [visit.id, { reportId: visit.id, isRead: true, bookmarked: false }],
    ]);

    expect(tileFor(visit, readStatus).isRead).toBe(true);
  });

  // The tile type has no private-note field, so this is a belt-and-braces assertion on the
  // SERIALIZED shape — the same reason tests/routes/visits.test.ts asserts on a JSON body.
  it("carries no field a private note could occupy", () => {
    const tile = tileFor(visitLog());

    expect(Object.keys(tile).sort()).toEqual([
      "authorLabel",
      "bookmarked",
      "contextId",
      "contextLabel",
      "contextTone",
      "isRead",
      "occurredOn",
      "outcomeLabel",
      "previewText",
      "recordedByLabel",
      "reportId",
      "reportType",
      "subjectLabel",
    ]);
  });
});
