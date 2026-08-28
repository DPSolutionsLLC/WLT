import { toPreviewText } from "@/lib/reports/preview";
import type { ReportReadState } from "@/lib/reports/readStatus";
import type { ReportTile } from "@/lib/reports/types";
import type { VisitLogWithContext } from "@/lib/visits/queries";
import {
  ORGANIZATION_TYPE_TONES,
  VISIT_OUTCOME_LABELS,
  type ContextTone,
  type OrganizationType,
} from "@/types/domain";

// Visit logs, mapped into the generic tile the return-and-report feed renders.
//
// THIS IS THE VISIT-SPECIFIC HALF, and it lives outside components/ deliberately. ReportFeed
// knows nothing about visits; this file is the seam, and Phase 8 writes the matching
// lib/youth/reportTiles.ts rather than forking the component (visits-c §Designing for Phase 8).
//
// THIS FILE MUST NOT IMPORT lib/visits/privateNotes.ts, and there is no arrangement of it that
// could reach one: `previewText` is built from `shared_notes` alone, and the input type —
// VisitLogWithContext — has no private-note field to read even if somebody tried. That is the
// same structural promise lib/visits/queries.ts states in its own header (CLAUDE.md rule 5).
//
// PURE. No client, no await, no clock. tests/lib/reportTiles.test.ts therefore needs no database.
//
// `toPreviewText` AND `PREVIEW_MAX_CHARACTERS` MOVED TO lib/reports/preview.ts in youth-d, with
// no change to either. Phase 8's mapper needs the same one-line preview, and a lib/youth/* file
// importing lib/visits/* would say the two modules are related when they are not — so the shared
// half went to the directory that already holds types.ts and readStatus.ts, both module-agnostic
// by design. Behaviour here is unchanged; tests/lib/reportTiles.test.ts kept every assertion and
// only re-pointed its import.

export type VisitOrganization = {
  name: string;
  type: OrganizationType;
};

export type VisitReportTileContext = {
  // Organizations keyed by id. Resolved once by the caller rather than joined per log: visit_logs
  // carries org_id and both the name and the type live on `organizations`, and a
  // bishopric-authored visit has org_id null.
  organizations: ReadonlyMap<string, VisitOrganization>;
  readStatus: ReadonlyMap<string, ReportReadState>;
};

// A visit the bishopric logged has no organization. "Bishopric" is the honest label — migration
// 019 makes an `org_id = null` log bishopric-readable only, so nobody else ever sees this string.
const NO_ORGANIZATION_LABEL = "Bishopric";

// The tone for a visit with no organization, and for one whose organization row has been deleted.
// Slate is the same tone ORGANIZATION_TYPE_TONES gives `bishopric` and `other`, so the deleted
// case does not arrive wearing some other organization's colour.
const NO_ORGANIZATION_TONE: ContextTone = ORGANIZATION_TYPE_TONES.bishopric;

// A household deleted since the visit was logged. Never blank, for the same reason NO_DATE is an
// em dash in lib/visits/visitDates.ts: an empty cell reads as a page that failed to load.
const UNKNOWN_HOUSEHOLD_LABEL = "Unknown household";

export function toReportTile(
  visit: VisitLogWithContext,
  context: VisitReportTileContext,
): ReportTile {
  const state = context.readStatus.get(visit.id);
  const organization = visit.orgId === null ? undefined : context.organizations.get(visit.orgId);

  return {
    reportType: "visit_log",
    reportId: visit.id,
    // Null for a bishopric-authored visit. The filter cannot select it, which is correct: there
    // is no organization to filter to, and only the bishopric can see it at all.
    contextId: organization === undefined ? null : visit.orgId,
    contextLabel: organization?.name ?? NO_ORGANIZATION_LABEL,
    contextTone:
      organization === undefined
        ? NO_ORGANIZATION_TONE
        : ORGANIZATION_TYPE_TONES[organization.type],
    subjectLabel: visit.householdName ?? UNKNOWN_HOUSEHOLD_LABEL,
    occurredOn: visit.visitDate,

    // WHO WENT, never who typed it in. Null when the visit records nobody as having gone, and
    // the tile then says so in words — falling back to `recordedByName` would re-create the
    // exact ambiguity visits-d split the column to remove.
    authorLabel: visit.conductedByLabel,
    recordedByLabel: visit.recordedByName,

    // The EXCEPTION ONLY. A label on every tile reading "Visited" is noise; the one reading
    // "Attempted" is the point, because an attempt counts towards no goal (visits-b) and a feed
    // that rendered it identically to a completed visit would undo that distinction.
    outcomeLabel: visit.outcome === "completed" ? null : VISIT_OUTCOME_LABELS[visit.outcome],

    // SHARED notes only. There is no private-note field on VisitLogWithContext to read.
    previewText: toPreviewText(visit.sharedNotes),

    isRead: state?.isRead ?? false,
    bookmarked: state?.bookmarked ?? false,
  };
}

export function toReportTiles(
  visits: readonly VisitLogWithContext[],
  context: VisitReportTileContext,
): ReportTile[] {
  return visits.map((visit) => toReportTile(visit, context));
}
