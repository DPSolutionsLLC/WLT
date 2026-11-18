import type { SupabaseClient } from "@supabase/supabase-js";
import { writeAuditLog } from "@/lib/audit/writeAuditLog";
import { countActiveBishops, displayName } from "@/lib/auth/adminUsers";
import { describeRowTarget, type CallingReviewRow } from "@/lib/callings/callingReview";
import { loadCallingReview } from "@/lib/callings/loadCallingReview";
import { createCalling, endCalling, updateCalling } from "@/lib/callings/writeCalling";
import { notifyOtherBishopric } from "@/lib/notifications/notifyOtherBishopric";
import type { Database } from "@/types/database";
import type { SessionUser } from "@/types/domain";

// APPLYING THE TICKED ROWS OF A CALLING REVIEW (ITER-058 cr2, plan P6 and P10).
//
// RECOMPUTE FIRST, NEVER TRUST THE CLIENT'S ROWS. Only the ticked IDS come from the browser. The
// review is rebuilt from the database, and a ticked id it no longer produces is counted as STALE,
// never guessed — `staleSelections` in the paste import, for the same reason. A row's id carries its
// target (lib/callings/callingReview.ts), so a roster that changed since the page loaded makes the
// tick stale rather than applying a change nobody saw.
//
// THE THREE WRITERS AND NOTHING ELSE (P6). createCalling / updateCalling / endCalling remain the
// only writers of a calling, and the update and end paths retire stale Zoom remote links on the way
// (tests/lib/remoteLinkRetireSites.test.ts).
//
// EACH GUARD REFUSES ONLY ITS OWN ROW, with a sentence, and the rest still apply (P10):
//   - the ward's last active bishop is never released or changed away;
//   - nobody applies a change to their OWN calling unless they are the super admin;
//   - a row the review cannot apply (P8) stays refused.
// Writes are sequential. One that fails is logged and reported on its own row — never swallowed —
// and does not stop the others.
//
// The caller has already passed canManageMemberLinks(); `service` is the service-role client.

export const OWN_CALLING_MESSAGE =
  "You can't apply a change to your own calling. Another member of the bishopric needs to.";

export function lastBishopMessage(name: string): string {
  return `${name} is the only active bishop. Apply the new bishop's calling first.`;
}

export const ROW_WRITE_FAILED_MESSAGE = "Could not apply this change. Please try again.";

export const ROW_GONE_MESSAGE =
  "This person no longer holds that calling. Reload the page to see the review as it is now.";

export type AppliedRow = { id: string; summary: string };
export type RefusedRow = { id: string; sentence: string };

export type ApplyCallingReviewResult = {
  applied: AppliedRow[];
  refused: RefusedRow[];
  stale: number;
};

export type ApplyCallingReviewParams = {
  actor: SessionUser;
  wardId: string;
  selectedIds: readonly string[];
};

function losesBishop(reviewRow: CallingReviewRow): boolean {
  return reviewRow.current?.role === "bishop" && reviewRow.target?.role !== "bishop";
}

function gainsBishop(reviewRow: CallingReviewRow): boolean {
  return reviewRow.target?.role === "bishop" && reviewRow.current?.role !== "bishop";
}

function isUniqueViolation(error: unknown): boolean {
  const cause = error instanceof Error ? (error.cause as { code?: string } | undefined) : undefined;
  return cause?.code === "23505";
}

async function writeRow(
  reviewRow: CallingReviewRow,
  actorUserId: string,
  wardId: string,
  service: SupabaseClient<Database>,
): Promise<boolean> {
  if (reviewRow.kind === "call" && reviewRow.target) {
    await createCalling(
      {
        userId: reviewRow.userId,
        wardId,
        role: reviewRow.target.role,
        orgId: reviewRow.target.orgId,
        counselorPosition: reviewRow.target.counselorPosition,
        createdBy: actorUserId,
        source: "roster",
      },
      service,
    );
    return true;
  }

  if (reviewRow.target) {
    const updated = await updateCalling(
      {
        userId: reviewRow.userId,
        wardId,
        changes: {
          role: reviewRow.target.role,
          orgId: reviewRow.target.orgId,
          counselorPosition: reviewRow.target.counselorPosition,
        },
        actorUserId,
        source: "roster",
      },
      service,
    );
    return updated !== null;
  }

  const ended = await endCalling({ userId: reviewRow.userId, wardId, actorUserId }, service);
  return ended !== null;
}

export async function applyCallingReview(
  params: ApplyCallingReviewParams,
  service: SupabaseClient<Database>,
): Promise<ApplyCallingReviewResult> {
  const { actor, wardId } = params;
  const { rows, organizationNames } = await loadCallingReview(wardId, service);
  const rowsById = new Map(rows.map((reviewRow) => [reviewRow.id, reviewRow]));

  const selected = [...new Set(params.selectedIds)];
  const stale = selected.filter((id) => !rowsById.has(id)).length;

  // A new bishop is applied BEFORE anybody loses the calling, so a ticked handover between two
  // bishops is not refused for the order the ticks happened to arrive in.
  const ticked = selected
    .map((id) => rowsById.get(id))
    .filter((reviewRow): reviewRow is CallingReviewRow => reviewRow !== undefined)
    .sort((left, right) => Number(gainsBishop(right)) - Number(gainsBishop(left)));

  const applied: AppliedRow[] = [];
  const refused: RefusedRow[] = [];

  for (const reviewRow of ticked) {
    if (!reviewRow.canApply) {
      refused.push({ id: reviewRow.id, sentence: reviewRow.refusal ?? ROW_WRITE_FAILED_MESSAGE });
      continue;
    }

    if (reviewRow.userId === actor.id && !actor.isSuperAdmin) {
      refused.push({ id: reviewRow.id, sentence: OWN_CALLING_MESSAGE });
      continue;
    }

    // Counted afresh for every such row, so a bishop applied earlier in this same apply counts.
    if (losesBishop(reviewRow) && (await countActiveBishops(wardId, service)) <= 1) {
      refused.push({ id: reviewRow.id, sentence: lastBishopMessage(reviewRow.accountName) });
      continue;
    }

    try {
      const written = await writeRow(reviewRow, actor.id, wardId, service);
      if (!written) {
        refused.push({ id: reviewRow.id, sentence: ROW_GONE_MESSAGE });
        continue;
      }
    } catch (error) {
      console.error(
        `Could not apply a calling review row — ${error instanceof Error ? error.message : String(error)}`,
        { wardId, rowId: reviewRow.id, kind: reviewRow.kind },
      );
      refused.push({
        id: reviewRow.id,
        sentence: isUniqueViolation(error)
          ? "This person already holds a calling in this ward. Reload the page to see the review as it is now."
          : ROW_WRITE_FAILED_MESSAGE,
      });
      continue;
    }

    // Ids, roles and positions only — no names, and no key containing "note" or "token", which
    // writeAuditLog() redacts (P12).
    await writeAuditLog(
      {
        wardId,
        userId: actor.id,
        action: "calling_changed_from_roster",
        module: "admin",
        detail: {
          rowKind: reviewRow.kind,
          callingId: reviewRow.callingId,
          targetUserId: reviewRow.userId,
          beforeRole: reviewRow.current?.role ?? null,
          afterRole: reviewRow.target?.role ?? null,
          beforeOrgId: reviewRow.current?.orgId ?? null,
          afterOrgId: reviewRow.target?.orgId ?? null,
          beforeCounselorPosition: reviewRow.current?.counselorPosition ?? null,
          afterCounselorPosition: reviewRow.target?.counselorPosition ?? null,
        },
      },
      service,
    );

    applied.push({
      id: reviewRow.id,
      summary: `${reviewRow.accountName}: ${describeRowTarget(reviewRow, organizationNames)}`,
    });
  }

  // One notification for the whole apply, naming every change (CLAUDE.md §7).
  if (applied.length > 0) {
    await notifyOtherBishopric({
      wardId,
      actingUserId: actor.id,
      title: "Callings updated from the ward list",
      description:
        `${displayName(actor)} applied ${applied.length} calling ` +
        `${applied.length === 1 ? "change" : "changes"} from the ward list: ` +
        `${applied.map((entry) => entry.summary).join("; ")}.`,
    });
  }

  return { applied, refused, stale };
}
