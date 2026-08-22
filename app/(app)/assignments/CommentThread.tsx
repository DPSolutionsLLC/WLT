"use client";

import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/Button";
import { FormError } from "@/components/ui/FormError";
import type { AssignmentComment } from "@/lib/assignments/queries";
import { createBrowserSupabaseClient } from "@/lib/supabase/browser";

// Both comment levels through one component, because they are one table and one route. A
// month-level thread hangs off a Sunday; an assignment-level one off a slot.
//
// Realtime is the reason this is a client component at all. The subscription is torn down on
// unmount without exception — a leaked channel per navigation is the usual bug here, and it is
// invisible until a bishopric has clicked through twenty Sundays in a planning meeting and the
// browser is holding twenty open sockets.

export type CommentTarget =
  | { level: "assignment"; assignmentId: string }
  | { level: "month"; sundayId: string };

export type CommentThreadProps = {
  wardId: string;
  target: CommentTarget;
  initialComments: AssignmentComment[];
  currentUserName: string;
  canComment: boolean;
};

async function readJson(response: Response): Promise<Record<string, unknown>> {
  try {
    return (await response.json()) as Record<string, unknown>;
  } catch {
    throw new Error("The server sent a response this page could not read.");
  }
}

function belongsToTarget(row: Record<string, unknown>, target: CommentTarget): boolean {
  return target.level === "assignment"
    ? row.assignment_id === target.assignmentId
    : row.sunday_id === target.sundayId && row.level === "month";
}

export function CommentThread({
  wardId,
  target,
  initialComments,
  currentUserName,
  canComment,
}: CommentThreadProps) {
  const [comments, setComments] = useState<AssignmentComment[]>(initialComments);
  const [draft, setDraft] = useState("");
  const [isSending, setIsSending] = useState(false);
  const [formError, setFormError] = useState<string>();

  // Held in a ref rather than in the subscription's dependency list. `target` is an object
  // literal built fresh on every render, so depending on it directly would tear down and rebuild
  // the realtime channel on every keystroke in the box below.
  //
  // Synced in its own effect rather than during render — assigning to a ref while rendering is
  // rejected by react-hooks/refs, and it is the same rule roster-b hit from the other direction
  // with a module-level variable.
  const targetRef = useRef(target);

  useEffect(() => {
    targetRef.current = target;
  }, [target]);

  useEffect(() => {
    const supabase = createBrowserSupabaseClient();

    const channel = supabase
      .channel(`assignment-comments:${wardId}`)
      .on(
        "postgres_changes",
        {
          event: "INSERT",
          schema: "public",
          table: "assignment_comments",
          // Ward-scoped at the subscription, so another ward's inserts never reach this browser
          // even before RLS is consulted.
          filter: `ward_id=eq.${wardId}`,
        },
        (payload) => {
          const row = payload.new as Record<string, unknown>;
          if (!belongsToTarget(row, targetRef.current)) return;

          setComments((existing) => {
            // Reconciles the optimistic append rather than appending a second copy. The
            // optimistic row carries a temporary id, so it is matched on the body and author.
            const withoutOptimistic = existing.filter(
              (comment) => !(comment.id.startsWith("pending:") && comment.comment === row.comment),
            );

            if (withoutOptimistic.some((comment) => comment.id === row.id)) {
              return withoutOptimistic;
            }

            return [
              ...withoutOptimistic,
              {
                id: String(row.id),
                assignmentId: (row.assignment_id as string | null) ?? null,
                sundayId: (row.sunday_id as string | null) ?? null,
                userId: String(row.user_id),
                // Realtime delivers the ROW, and the row has no author name — that is resolved
                // from `users` by the read path. An unknown author reads as "Someone" rather
                // than as a uuid until the next full read fills it in.
                authorName: null,
                comment: String(row.comment),
                level: (row.level as AssignmentComment["level"]) ?? null,
                createdAt: String(row.created_at),
              },
            ];
          });
        },
      )
      .subscribe((status) => {
        if (status === "CHANNEL_ERROR" || status === "TIMED_OUT") {
          // Not surfaced to the user: the thread still works, it simply stops updating on its
          // own. Silently swallowing it would leave nobody able to explain why.
          console.error("The comment thread's realtime channel could not be established", {
            wardId,
            status,
          });
        }
      });

    return () => {
      void supabase.removeChannel(channel);
    };
  }, [wardId]);

  async function handleSend(): Promise<void> {
    const body = draft.trim();

    if (body === "") {
      setFormError("Type a comment first.");
      return;
    }

    setFormError(undefined);
    setIsSending(true);

    const optimisticId = `pending:${body}`;

    setComments((existing) => [
      ...existing,
      {
        id: optimisticId,
        assignmentId: target.level === "assignment" ? target.assignmentId : null,
        sundayId: target.level === "month" ? target.sundayId : null,
        userId: "",
        authorName: currentUserName,
        comment: body,
        level: target.level,
        createdAt: new Date().toISOString(),
      },
    ]);
    setDraft("");

    try {
      const response = await fetch("/api/assignment-comments", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(
          target.level === "assignment"
            ? { level: "assignment", assignmentId: target.assignmentId, comment: body }
            : { level: "month", sundayId: target.sundayId, comment: body },
        ),
      });

      const payload = await readJson(response);

      if (!response.ok) {
        // The draft goes BACK IN THE BOX. Discarding what somebody typed because the network
        // was down is losing their work to save a line of code.
        setComments((existing) => existing.filter((comment) => comment.id !== optimisticId));
        setDraft(body);
        setFormError(
          typeof payload.error === "string"
            ? payload.error
            : "Could not post that comment. Please try again.",
        );
        return;
      }

      const saved = payload.comment as AssignmentComment | undefined;

      if (saved) {
        setComments((existing) => [
          ...existing.filter((comment) => comment.id !== optimisticId && comment.id !== saved.id),
          saved,
        ]);
      }
    } catch (error) {
      console.error("Could not post a comment", error);
      setComments((existing) => existing.filter((comment) => comment.id !== optimisticId));
      setDraft(body);
      setFormError("Could not reach the server. Check your connection and try again.");
    } finally {
      setIsSending(false);
    }
  }

  return (
    <div className="flex flex-col gap-3">
      {comments.length === 0 ? (
        <p className="text-sm text-muted">No comments yet.</p>
      ) : (
        <ul className="flex flex-col gap-2">
          {comments.map((comment) => (
            <li key={comment.id} className="rounded-md border border-border p-3">
              <p className="text-sm font-medium text-foreground">
                {comment.authorName ?? "Someone"}
              </p>
              <p className="mt-1 whitespace-pre-wrap text-sm text-foreground">
                {comment.comment}
              </p>
            </li>
          ))}
        </ul>
      )}

      {canComment && (
        <div className="flex flex-col gap-2">
          <label htmlFor="comment-draft" className="sr-only">
            Add a comment
          </label>
          <textarea
            id="comment-draft"
            rows={3}
            value={draft}
            disabled={isSending}
            onChange={(event) => setDraft(event.target.value)}
            placeholder="Add a comment"
            className="rounded-md border border-border bg-surface-raised px-3 py-2 text-base text-foreground placeholder:text-muted focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
          />
          <div>
            <Button type="button" onClick={() => void handleSend()} disabled={isSending}>
              {isSending ? "Posting…" : "Post comment"}
            </Button>
          </div>
        </div>
      )}

      <FormError message={formError} />
    </div>
  );
}
