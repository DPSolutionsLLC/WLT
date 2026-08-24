import { NextResponse } from "next/server";
import { writeAuditLog } from "@/lib/audit/writeAuditLog";
import { assertCan, resolveRoleAccess } from "@/lib/auth/permissions";
import { readJsonBody, respondToRouteError } from "@/lib/auth/routeErrors";
import { requireSessionUser } from "@/lib/auth/session";
import {
  createSavedFilter,
  isDuplicateFilterLabelError,
  listSavedFilters,
} from "@/lib/knowledge/filterQueries";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { filterSaveSchema } from "@/lib/validation/knowledge";

// The ACCEPT half of propose-show-accept. /api/knowledge/filters/resolve returns a proposal and
// writes nothing; this is where a proposal a person read and agreed to becomes a row.
//
// That shape is CLAUDE.md rule 3, applied to a filter instead of a topic — the same pattern
// `topic_candidates` uses. The body carries the RESOLVED AXES rather than the phrase, so what
// gets stored is exactly what was on screen when the button was pressed. A route that re-ran the
// model at accept time could save something the user never saw.
//
// The session is resolved OUTSIDE the try: requireSessionUser() redirects by throwing an internal
// Next.js error, and catching that would turn a redirect into a 500.
//
// `resolveRoleAccess` is called ONCE per request and passed down. cache() does not dedupe it in a
// route handler (plans/retros/role-access-overrides.md).

export async function GET() {
  const user = await requireSessionUser();

  try {
    const supabase = await createServerSupabaseClient();
    const roleAccess = await resolveRoleAccess(supabase, user.wardId);

    // `knowledge.view`, not `manage`. Reading which filters exist is part of reading the scope
    // panel; only changing them needs manage.
    assertCan(user, "knowledge.view", roleAccess);

    // An empty array is a legitimate answer — a ward that has never saved a filter — and the
    // panel has a state for it rather than treating it as a failure.
    const filters = await listSavedFilters(user.wardId, supabase);

    return NextResponse.json({ filters });
  } catch (error) {
    return respondToRouteError(error, {
      route: "GET /api/knowledge/filters",
      fallbackMessage: "Could not load the saved filters. Please try again.",
      detail: { wardId: user.wardId, userId: user.id },
    });
  }
}

export async function POST(request: Request) {
  const user = await requireSessionUser();

  try {
    const supabase = await createServerSupabaseClient();
    const roleAccess = await resolveRoleAccess(supabase, user.wardId);

    assertCan(user, "knowledge.manage", roleAccess);

    const input = filterSaveSchema.parse(await readJsonBody(request));

    const filter = await createSavedFilter(
      user.wardId,
      {
        label: input.label,
        sourcePhrase: input.sourcePhrase,
        speakerRoles: input.speakerRoles,
        speakers: input.speakers,
        since: input.since,
      },
      user.id,
      supabase,
    );

    // THE PHRASE IS LOGGED, and that is a deliberate exception rather than an oversight. It is
    // the user's own words about their own corpus — not generated content, not a member's
    // private business — and it is the only thing that makes a confusing filter diagnosable six
    // months later. Contrast the retrieval query in lib/ai/retrieve.ts, which is never logged
    // because it can name a specific member.
    await writeAuditLog(
      {
        wardId: user.wardId,
        userId: user.id,
        action: "retrieval_filter_saved",
        module: "knowledge",
        detail: {
          filterId: filter.id,
          label: filter.label,
          sourcePhrase: filter.sourcePhrase,
          speakerRoles: filter.speakerRoles,
          speakers: filter.speakers,
          since: filter.since,
        },
      },
      supabase,
    );

    return NextResponse.json({ filter }, { status: 201 });
  } catch (error) {
    // 409 AND A SENTENCE, not a 500. Migration 034 refuses two filters with one label because a
    // checkbox list with two identical entries is unusable — and the person who just typed that
    // name is the one who can fix it, so they get told what happened rather than "please try
    // again", which would fail identically forever.
    if (isDuplicateFilterLabelError(error)) {
      return NextResponse.json({ error: error.message }, { status: 409 });
    }

    return respondToRouteError(error, {
      route: "POST /api/knowledge/filters",
      fallbackMessage: "Could not save the filter. Please try again.",
      detail: { wardId: user.wardId, userId: user.id },
    });
  }
}
