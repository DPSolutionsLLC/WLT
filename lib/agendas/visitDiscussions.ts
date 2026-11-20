import type { SupabaseClient } from "@supabase/supabase-js";
import { listAgendas, updateAgenda, type Agenda } from "@/lib/agendas/queries";
import {
  addVisitDiscussions,
  removeVisitDiscussion,
  visitDiscussionIds,
} from "@/lib/agendas/sections";
import type { Database } from "@/types/database";

// Where a "discuss in bishopric meeting" line sits on the agendas (ITER-055 bv7, P-B). SERVER ONLY.
//
// NO AGENDA IS EVER CREATED HERE. Turning the request on puts the line on the soonest DRAFT
// bishopric agenda dated today or later, if one exists; otherwise it waits and POST /api/agendas
// gathers it when somebody creates the next one. A published agenda is never edited.
//
// Through the CALLER's client: the caller is a bishopric member, who may edit any agenda in the
// ward (019's ward-wide policies), and an unreleased Agendas module simply reads as no drafts.

type Client = SupabaseClient<Database>;

export async function listDraftBishopricAgendas(
  wardId: string,
  asOf: Date,
  client: Client,
): Promise<Agenda[]> {
  const agendas = await listAgendas(
    wardId,
    { meetingType: "bishopric", includePast: true, asOf },
    client,
  );
  return agendas.filter((agenda) => agenda.status === "draft");
}

// Every visit id a draft bishopric agenda already carries, for the create route's exclusion and the
// visit card's "On the bishopric agenda for …" line.
export function discussionPlacements(drafts: readonly Agenda[]): Map<string, string> {
  const byVisit = new Map<string, string>();
  const soonestFirst = [...drafts].sort((left, right) =>
    left.meetingDate.localeCompare(right.meetingDate),
  );
  for (const agenda of soonestFirst) {
    for (const id of visitDiscussionIds(agenda.sections)) {
      if (!byVisit.has(id)) byVisit.set(id, agenda.meetingDate);
    }
  }
  return byVisit;
}

// The soonest draft bishopric agenda on or after `today` (a ward-zone date), or null.
export function nextDraftAgenda(drafts: readonly Agenda[], today: string): Agenda | null {
  return (
    [...drafts]
      .filter((agenda) => agenda.meetingDate >= today)
      .sort((left, right) => left.meetingDate.localeCompare(right.meetingDate))[0] ?? null
  );
}

// Returns the meeting date the line now sits on, or null when it is waiting for the next agenda.
export async function placeVisitDiscussion(
  params: { wardId: string; visitLogId: string; text: string; today: string; asOf: Date },
  client: Client,
): Promise<string | null> {
  const drafts = await listDraftBishopricAgendas(params.wardId, params.asOf, client);

  const already = discussionPlacements(drafts).get(params.visitLogId);
  if (already !== undefined) return already;

  const target = nextDraftAgenda(drafts, params.today);
  if (target === null) return null;

  const updated = await updateAgenda(
    params.wardId,
    target.id,
    {
      sections: addVisitDiscussions(target.sections, [
        { sourceId: params.visitLogId, text: params.text },
      ]),
    },
    client,
  );
  return updated === null ? null : updated.meetingDate;
}

// Takes the line off every draft that carries it. Returns how many drafts changed.
export async function withdrawVisitDiscussion(
  params: { wardId: string; visitLogId: string; asOf: Date },
  client: Client,
): Promise<number> {
  const drafts = await listDraftBishopricAgendas(params.wardId, params.asOf, client);
  let changed = 0;
  for (const agenda of drafts) {
    if (!visitDiscussionIds(agenda.sections).includes(params.visitLogId)) continue;
    const updated = await updateAgenda(
      params.wardId,
      agenda.id,
      { sections: removeVisitDiscussion(agenda.sections, params.visitLogId) },
      client,
    );
    if (updated !== null) changed += 1;
  }
  return changed;
}
