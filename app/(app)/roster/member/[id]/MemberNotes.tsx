"use client";

import { useState, type FormEvent } from "react";
import { Button } from "@/components/ui/Button";
import { FormError } from "@/components/ui/FormError";
import type { MemberNote } from "@/lib/roster/memberNotes";
import { createMemberNoteSchema } from "@/lib/validation/roster";

export type MemberNotesProps = {
  memberId: string;
  initialNotes: MemberNote[];
};

// This component is rendered only when the caller holds roster.manage, and the page above does
// not fetch the notes at all otherwise. RLS refuses them regardless (member_notes is in the
// bishopric-only policy loop in migration 019) — the point of not rendering is that the panel
// is absent from the page rather than present and empty, which would say "no notes exist"
// when the truth is "you may not read them".
export function MemberNotes({ memberId, initialNotes }: MemberNotesProps) {
  const [notes, setNotes] = useState(initialNotes);
  const [body, setBody] = useState("");
  const [bodyError, setBodyError] = useState<string>();
  const [formError, setFormError] = useState<string>();
  const [isSubmitting, setIsSubmitting] = useState(false);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setFormError(undefined);
    setBodyError(undefined);

    const parsed = createMemberNoteSchema.safeParse({ body });

    if (!parsed.success) {
      setBodyError(parsed.error.flatten().fieldErrors.body?.[0]);
      return;
    }

    setIsSubmitting(true);

    try {
      const response = await fetch(`/api/members/${memberId}/notes`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(parsed.data),
      });

      const payload: { note?: MemberNote; error?: string } = await response.json();

      if (!response.ok || !payload.note) {
        setFormError(payload.error ?? "Could not save the note. Please try again.");
        return;
      }

      setNotes([payload.note, ...notes]);
      setBody("");
    } catch (error) {
      // The note text is never logged, here or anywhere (CLAUDE.md rule 8).
      console.error("Could not save the member note", error);
      setFormError("Could not reach the server. Check your connection and try again.");
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <div className="flex flex-col gap-4">
      <div>
        <h2 className="text-base font-semibold text-foreground">Notes</h2>
        <p className="mt-1 text-sm text-muted">
          Visible to the bishopric only.
        </p>
      </div>

      {notes.length === 0 ? (
        <p className="text-sm text-muted">No notes yet.</p>
      ) : (
        <ul className="flex flex-col gap-3">
          {notes.map((note) => (
            <li key={note.id} className="border-t border-border pt-3 first:border-t-0 first:pt-0">
              <p className="whitespace-pre-wrap text-sm text-foreground">{note.body}</p>
              <p className="mt-1 text-xs text-muted">
                {new Date(note.createdAt).toLocaleDateString()}
              </p>
            </li>
          ))}
        </ul>
      )}

      <form onSubmit={handleSubmit} className="flex flex-col gap-2" noValidate>
        <label htmlFor="member-note-body" className="text-sm font-medium text-foreground">
          Add a note
        </label>
        <textarea
          id="member-note-body"
          rows={3}
          value={body}
          onChange={(event) => setBody(event.target.value)}
          aria-invalid={bodyError ? true : undefined}
          aria-describedby={bodyError ? "member-note-body-error" : undefined}
          className={`rounded-md border bg-surface-raised px-3 py-2 text-base text-foreground placeholder:text-muted focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary ${
            bodyError ? "border-danger" : "border-border"
          }`}
        />
        <FormError id="member-note-body-error" message={bodyError} />
        <FormError message={formError} />

        <Button type="submit" disabled={isSubmitting}>
          {isSubmitting ? "Saving…" : "Save note"}
        </Button>
      </form>
    </div>
  );
}
