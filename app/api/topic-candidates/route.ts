import { NextResponse } from "next/server";
import { writeAuditLog } from "@/lib/audit/writeAuditLog";
import { assertCan, resolveRoleAccess } from "@/lib/auth/permissions";
import { readJsonBody, respondToRouteError } from "@/lib/auth/routeErrors";
import { requireSessionUser } from "@/lib/auth/session";
import {
  acceptCandidate,
  getCandidate,
  isDuplicateTopicTitleError,
  listCandidates,
  rejectCandidate,
} from "@/lib/topics/queries";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { reviewCandidateSchema } from "@/lib/validation/topic";

// The accept/reject boundary for AI-suggested topics, built BEFORE Phase 5 can put anything
// through it. That ordering is the point: the cheapest moment to find out that a candidate can
// reach `topics` without an accept is while there are no candidates.
//
// Phase 5 writes `pending` rows to `topic_candidates` and NEVER inserts into `topics`. If a
// Phase 5 plan proposes otherwise, that is the rule-3 violation this table exists to make
// impossible (CLAUDE.md rule 3).
//
// There is deliberately NO bulk path. Accept and reject take ONE candidateId, there is no array
// in the schema, and there is no "accept all" — a bulk accept is an auto-add wearing a button.

const NOT_FOUND = "That suggestion is not in your ward.";

const ALREADY_REVIEWED =
  "That suggestion has already been decided. Reload to see the current queue.";

const WRITE_REFUSED = "That suggestion could not be saved. Reload and try again.";

export async function GET() {
  const user = await requireSessionUser();

  try {
    const supabase = await createServerSupabaseClient();
    const roleAccess = await resolveRoleAccess(supabase, user.wardId);

    assertCan(user, "topics.view", roleAccess);

    const candidates = await listCandidates(user.wardId, "pending", supabase);

    return NextResponse.json({ candidates });
  } catch (error) {
    return respondToRouteError(error, {
      route: "GET /api/topic-candidates",
      fallbackMessage: "Could not load the suggested topics. Please try again.",
      detail: { wardId: user.wardId, userId: user.id },
    });
  }
}

export async function PATCH(request: Request) {
  const user = await requireSessionUser();

  try {
    const supabase = await createServerSupabaseClient();
    const roleAccess = await resolveRoleAccess(supabase, user.wardId);

    // `topics.manage`, not `topics.view`. Accepting a candidate CREATES a topic, so it is the
    // same authority as adding one by hand — reviewing is not a reading activity.
    assertCan(user, "topics.manage", roleAccess);

    const input = reviewCandidateSchema.parse(await readJsonBody(request));

    const existing = await getCandidate(user.wardId, input.candidateId, supabase);
    if (!existing) {
      return NextResponse.json({ error: NOT_FOUND }, { status: 404 });
    }

    // 409, not 400. The request was well formed; the candidate's STATE is what refuses. Without
    // this, a double-tap on Accept creates the topic twice.
    if (existing.status !== "pending") {
      return NextResponse.json({ error: ALREADY_REVIEWED }, { status: 409 });
    }

    if (input.status === "rejected") {
      const candidate = await rejectCandidate(
        user.wardId,
        input.candidateId,
        user.id,
        supabase,
      );

      if (!candidate) {
        return NextResponse.json({ error: WRITE_REFUSED }, { status: 404 });
      }

      await writeAuditLog(
        {
          wardId: user.wardId,
          userId: user.id,
          action: "topic_candidate_reviewed",
          module: "talks",
          detail: { candidateId: candidate.id, status: candidate.status },
        },
        supabase,
      );

      // Nothing was written to `topics`, and the response says so rather than leaving the caller
      // to infer it from an absent field.
      return NextResponse.json({ candidate, topic: null });
    }

    let accepted;
    try {
      accepted = await acceptCandidate(user.wardId, existing, user.id, supabase);
    } catch (error) {
      // 409, and the candidate stays PENDING. A suggestion that duplicates a topic the ward
      // already has is a decision for a person — reject it, or rename the existing one — and
      // silently accepting it is impossible anyway because of migration 018's unique index.
      if (isDuplicateTopicTitleError(error)) {
        return NextResponse.json(
          {
            error: `${error.message} Reject this suggestion, or rename the topic you already have.`,
          },
          { status: 409 },
        );
      }
      throw error;
    }

    if (!accepted) {
      return NextResponse.json({ error: WRITE_REFUSED }, { status: 404 });
    }

    await writeAuditLog(
      {
        wardId: user.wardId,
        userId: user.id,
        action: "topic_candidate_reviewed",
        module: "talks",
        detail: {
          candidateId: accepted.candidate.id,
          status: accepted.candidate.status,
          topicId: accepted.topic.id,
        },
      },
      supabase,
    );

    return NextResponse.json({ candidate: accepted.candidate, topic: accepted.topic });
  } catch (error) {
    return respondToRouteError(error, {
      route: "PATCH /api/topic-candidates",
      fallbackMessage: "Could not save that decision. Please try again.",
      detail: { wardId: user.wardId, userId: user.id },
    });
  }
}
