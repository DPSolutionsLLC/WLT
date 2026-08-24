"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { FormError } from "@/components/ui/FormError";
import {
  KNOWLEDGE_STATUS_LABELS,
  KNOWLEDGE_TYPE_TAG_LABELS,
  type KnowledgeDocument,
} from "@/types/domain";

// THIS COMPONENT HOLDS NO COPY OF THE DOCUMENTS. It renders the prop and calls router.refresh()
// after every mutation.
//
// That is deliberate and it is the ai-a lesson: router.refresh() re-renders the server component
// and hands down fresh props, but it PRESERVES CLIENT STATE — so a list seeded into useState from
// `initialDocuments` shows the old counts after a refresh while every server test passes
// (plans/retros/ai-a-client-and-settings.md). Not duplicating the state removes the failure
// rather than remembering to work around it. The cost is no optimistic update, which for an
// action that takes one round trip is not a cost worth engineering around.

export type DocumentListProps = {
  initialDocuments: KnowledgeDocument[];
  canManage: boolean;
};

function formatUploadedAt(value: string): string {
  return new Date(value).toLocaleDateString(undefined, {
    day: "numeric",
    month: "long",
    year: "numeric",
  });
}

export function DocumentList({ initialDocuments, canManage }: DocumentListProps) {
  const router = useRouter();
  const [pendingId, setPendingId] = useState<string>();
  const [listError, setListError] = useState<string>();

  async function send(document: KnowledgeDocument, request: RequestInit): Promise<void> {
    setListError(undefined);
    setPendingId(document.id);

    try {
      const response = await fetch(`/api/knowledge/documents/${document.id}`, request);

      if (!response.ok) {
        const body: { error?: string } = await response.json();
        setListError(body.error ?? "Could not change the document. Please try again.");
        return;
      }

      router.refresh();
    } catch (error) {
      console.error("Could not change a knowledge document", error);
      setListError("Could not reach the server. Check your connection and try again.");
    } finally {
      setPendingId(undefined);
    }
  }

  function handleToggleStatus(document: KnowledgeDocument) {
    return send(document, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        status: document.status === "active" ? "inactive" : "active",
      }),
    });
  }

  function handleDelete(document: KnowledgeDocument) {
    // Worded by CONSEQUENCE, not by action. "Are you sure?" tells somebody nothing they did not
    // already know; naming the passage count and saying what is NOT affected is what lets them
    // answer it (the calendar-b confirm dialog is the precedent).
    const passages =
      document.chunkCount === 1
        ? "its one passage"
        : `all ${document.chunkCount} of its passages`;

    const confirmed = window.confirm(
      `Deleting "${document.title}" removes the document and ${passages}. Drafts already written are not affected.`,
    );

    if (!confirmed) return;

    void send(document, { method: "DELETE" });
  }

  if (initialDocuments.length === 0) {
    return (
      <Card>
        <h2 className="text-base font-semibold text-foreground">Nothing here yet</h2>
        {/* A fresh ward sees this for a while, so it names the TWO ways to fill it rather than
            showing an empty table and leaving the next step to be guessed. */}
        <p className="mt-2 text-sm text-muted">
          There are two ways to fill the knowledge base. Add a document above — a conference
          talk, a letter from the stake, anything worth drawing on. Or load the standard works
          in one go from the command line with{" "}
          <code className="rounded bg-surface px-1 py-0.5 text-xs">npm run knowledge:ingest</code>
          .
        </p>
        <p className="mt-2 text-sm text-muted">
          Until then, drafts are written from the ward&apos;s AI settings alone.
        </p>
      </Card>
    );
  }

  return (
    <Card>
      <h2 className="text-base font-semibold text-foreground">Documents</h2>

      <FormError message={listError} />

      <ul className="mt-3 flex flex-col divide-y divide-border">
        {initialDocuments.map((document) => {
          const isPending = pendingId === document.id;
          const unembedded = document.chunkCount - document.embeddedCount;

          return (
            <li key={document.id} className="flex flex-col gap-2 py-3 first:pt-0 last:pb-0">
              <div className="flex flex-col gap-1">
                <span className="text-sm font-medium text-foreground">{document.title}</span>

                <span className="text-xs text-muted">
                  {document.typeTag
                    ? KNOWLEDGE_TYPE_TAG_LABELS[document.typeTag]
                    : "Untagged"}{" "}
                  · {KNOWLEDGE_STATUS_LABELS[document.status]} ·{" "}
                  {document.uploadedByName ?? "Loaded from the command line"} ·{" "}
                  {formatUploadedAt(document.uploadedAt)}
                </span>

                {/* BOTH COUNTS. The second one is only worth spelling out when it differs — a
                    document where every passage embedded should not make the reader compare two
                    identical numbers to learn nothing. */}
                <span className="text-xs text-muted">
                  {document.chunkCount}{" "}
                  {document.chunkCount === 1 ? "passage" : "passages"}
                  {unembedded > 0
                    ? `, ${document.embeddedCount} embedded — ${unembedded} not searchable`
                    : ", all searchable"}
                </span>
              </div>

              {/* Read-only with NO CONTROLS when canManage is false, rather than disabled ones.
                  A disabled button says "you could do this"; absence says "this is not yours to
                  do", which is the true statement. */}
              {canManage && (
                <div className="flex flex-wrap gap-2">
                  <Button
                    variant="secondary"
                    disabled={isPending}
                    onClick={() => void handleToggleStatus(document)}
                  >
                    {document.status === "active" ? "Deactivate" : "Reactivate"}
                  </Button>
                  <Button
                    variant="danger"
                    disabled={isPending}
                    onClick={() => handleDelete(document)}
                  >
                    Delete
                  </Button>
                </div>
              )}
            </li>
          );
        })}
      </ul>

      {canManage && (
        <p className="mt-3 text-xs text-muted">
          Deactivating takes effect on the very next search. Nothing is rebuilt and nothing is
          lost — reactivating brings the passages straight back.
        </p>
      )}
    </Card>
  );
}
