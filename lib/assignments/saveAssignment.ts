import type { AssignmentType } from "@/types/domain";

// The one request that creates or edits a talk from the browser — the month planner's modal and
// the Topics screen's windows and Clear buttons all send it through here, so there is one reading
// of the server's answer. Client-safe: it only calls fetch.
//
// A talk that does not exist yet (an open slot) is CREATED with its slot; one that does is PATCHed
// with only the fields given, so a window that edits the topic never resends the speaker.

export type AssignmentFields = {
  assignmentType?: AssignmentType;
  slotNumber?: number;
  slotLengthMinutes?: number | null;
  memberId?: string | null;
  externalSpeaker?: { name: string; title: string | null } | null;
  topicTitle?: string | null;
};

export type SaveAssignmentRequest =
  | { kind: "update"; assignmentId: string; fields: AssignmentFields }
  | {
      kind: "create";
      sundayId: string;
      slotNumber: number;
      assignmentType: AssignmentType;
      fields: AssignmentFields;
    };

export type SaveAssignmentResult = { ok: true } | { ok: false; message: string };

const FALLBACK = "Could not save that talk. Please try again.";

async function readError(response: Response): Promise<string> {
  try {
    const payload = (await response.json()) as { error?: unknown };
    return typeof payload.error === "string" ? payload.error : FALLBACK;
  } catch {
    return "The server sent a response this page could not read.";
  }
}

export async function saveAssignment(request: SaveAssignmentRequest): Promise<SaveAssignmentResult> {
  try {
    const response =
      request.kind === "update"
        ? await fetch(`/api/assignments/${request.assignmentId}`, {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ action: "update", fields: request.fields }),
          })
        : await fetch("/api/assignments", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              sundayId: request.sundayId,
              slotNumber: request.slotNumber,
              assignmentType: request.assignmentType,
              ...request.fields,
            }),
          });

    if (response.ok) return { ok: true };
    return { ok: false, message: await readError(response) };
  } catch (error) {
    console.error("Could not save a talk", error);
    return { ok: false, message: "Could not reach the server. Check your connection and try again." };
  }
}
