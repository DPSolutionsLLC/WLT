import type { TodoAskSource } from "@/types/domain";

// WHAT AN ASK TO-DO SHOWS ABOUT ITS TALK, read LIVE from the talk (Sacrament slice f1, the user's
// request walking scenario 078). A leader who catches a speaker in the hallway, calls them, or
// meets them at a scheduled time needs the topic and the contact details on the card itself, not
// only in the notes typed when the ask was sent. Read from the talk, a topic changed afterwards
// shows correctly.
//
// ONE MAPPER FOR TWO READS. lib/todos/queries.ts (To Do) and lib/appointments/queries.ts (My
// Appointments) embed the same columns, and each select list must stay ONE string literal
// (plans/retros/calendar-a-rules-and-api.md), so the embed text is written in both places and this
// is the one place its rows become a TodoAskSource. Pure: no server imports.
//
// The embed both files carry, verbatim:
//   ask:assignments!todos_ask_assignment_id_fkey (id, member_id, external_speaker_name,
//     sundays!assignments_sunday_id_ward_id_fkey (date),
//     members!assignments_member_id_ward_id_fkey (first_name, last_name, phone),
//     topics!assignments_topic_id_ward_id_fkey (title))

export type AskSourceRow = {
  id: string;
  member_id: string | null;
  external_speaker_name: string | null;
  sundays: { date: string } | null;
  members: { first_name: string | null; last_name: string | null; phone: string | null } | null;
  topics: { title: string } | null;
} | null;

function memberName(row: { first_name: string | null; last_name: string | null } | null): string | null {
  if (row === null) return null;
  const name = [row.first_name, row.last_name].filter((part) => part !== null && part !== "").join(" ");
  return name === "" ? null : name;
}

// `completedAt` is the TO-DO's, so `isOpen` says whether the ask still waits for an answer.
export function mapAskSource(row: AskSourceRow, completedAt: string | null): TodoAskSource | null {
  if (row === null) return null;
  const external = row.external_speaker_name?.trim() ?? "";
  const phone = row.members?.phone?.trim() ?? "";
  return {
    assignmentId: row.id,
    sundayDate: row.sundays?.date ?? null,
    speakerName: memberName(row.members) ?? (external === "" ? null : external),
    speakerMemberId: row.member_id,
    onRoster: row.member_id !== null,
    phone: phone === "" ? null : phone,
    topicTitle: row.topics?.title ?? null,
    isOpen: completedAt === null,
  };
}
