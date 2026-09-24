import type { ReferenceKind, ReferencesTalk } from "@/types/domain";

// Shared by ReferencesEditor and its two dialogs, kept here so none of them imports another in a
// circle. Pure, and client-safe.

export type NewReference = {
  assignmentId: string;
  kind: ReferenceKind;
  citation: string;
  source: "search" | "manual";
  documentId?: string;
};

// Resolves to the server's sentence on failure, or null when every reference was added.
export type AddReferences = (inputs: readonly NewReference[]) => Promise<string | null>;

// "Added" is decided on the citation as a person reads it — case and stray spaces do not make it
// a different reference.
export function normalizeCitation(citation: string): string {
  return citation.trim().toLowerCase();
}

export function talkHeading(talk: ReferencesTalk): string {
  return talk.slotNumber === null ? talk.topicTitle : `Talk ${talk.slotNumber}: ${talk.topicTitle}`;
}
