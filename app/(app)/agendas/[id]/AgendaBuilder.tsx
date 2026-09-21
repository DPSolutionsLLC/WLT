"use client";

import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { FormError } from "@/components/ui/FormError";
import { Input } from "@/components/ui/Input";
import {
  compareActionItems,
  describeCarriedFrom,
  type ActionItem,
} from "@/lib/agendas/carryForward";
import type { Agenda } from "@/lib/agendas/queries";
import {
  carryForwardSection,
  newAgendaItem,
  newAgendaSection,
  type AgendaSections,
} from "@/lib/agendas/sections";

// The working screen: edit the sections, keep the action items, publish.
//
// ---------------------------------------------------------------------------------------------
// SECTIONS ARE SAVED AS A WHOLE, ON DEMAND — NOT PER KEYSTROKE
// ---------------------------------------------------------------------------------------------
// `agendas.sections` is one jsonb blob, so there is no such thing as saving one line of it. The
// edit is therefore local state with an explicit Save, which also means a secretary typing during
// a meeting is not issuing a PATCH per character to a hosted database over a phone connection.
//
// The cost is that leaving the page loses unsaved edits, which is why the button says how many
// changes are pending rather than sitting there inert.

type AgendaDetailPayload = { agenda: Agenda; actionItems: ActionItem[] };

async function fetchAgenda(agendaId: string): Promise<AgendaDetailPayload> {
  const response = await fetch(`/api/agendas/${agendaId}`);
  if (!response.ok) {
    const body = (await response.json().catch(() => ({}))) as { error?: string };
    throw new Error(body.error ?? "Could not load the agenda.");
  }
  return (await response.json()) as AgendaDetailPayload;
}

type AgendaBuilderProps = {
  initialAgenda: Agenda;
  initialActionItems: ActionItem[];
  canManage: boolean;
  canPublish: boolean;
};

export function AgendaBuilder({
  initialAgenda,
  initialActionItems,
  canManage,
  canPublish,
}: AgendaBuilderProps) {
  const queryClient = useQueryClient();
  const agendaId = initialAgenda.id;
  const queryKey = ["agenda", agendaId];

  const agendaQuery = useQuery({
    queryKey,
    queryFn: () => fetchAgenda(agendaId),
    initialData: { agenda: initialAgenda, actionItems: initialActionItems },
  });

  const agenda = agendaQuery.data?.agenda ?? initialAgenda;
  const actionItems = [...(agendaQuery.data?.actionItems ?? [])].sort(compareActionItems);

  // The local, unsaved copy. Seeded from the server value and reset whenever a save succeeds.
  const [draft, setDraft] = useState<AgendaSections>(agenda.sections);
  const [dirty, setDirty] = useState(false);
  const [error, setError] = useState<string | undefined>(undefined);
  const [newItemText, setNewItemText] = useState<Record<string, string>>({});
  const [newAction, setNewAction] = useState("");

  const actionSectionId = carryForwardSection(draft)?.id ?? null;

  const edit = (next: AgendaSections) => {
    setDraft(next);
    setDirty(true);
  };

  const saveMutation = useMutation({
    mutationFn: async (sections: AgendaSections) => {
      const response = await fetch(`/api/agendas/${agendaId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sections }),
      });
      const body = (await response.json().catch(() => ({}))) as { error?: string };
      if (!response.ok) throw new Error(body.error ?? "Could not save the agenda.");
      return body;
    },
    onSuccess: () => {
      setDirty(false);
      setError(undefined);
      void queryClient.invalidateQueries({ queryKey });
    },
    onError: (mutationError: Error) => setError(mutationError.message),
  });

  const publishMutation = useMutation({
    mutationFn: async () => {
      const response = await fetch(`/api/agendas/${agendaId}/publish`, { method: "POST" });
      const body = (await response.json().catch(() => ({}))) as { error?: string };
      if (!response.ok) throw new Error(body.error ?? "Could not publish the agenda.");
      return body;
    },
    onSuccess: () => {
      setError(undefined);
      void queryClient.invalidateQueries({ queryKey });
    },
    onError: (mutationError: Error) => setError(mutationError.message),
  });

  const addActionMutation = useMutation({
    mutationFn: async (description: string) => {
      const response = await fetch(`/api/agendas/${agendaId}/action-items`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ description }),
      });
      const body = (await response.json().catch(() => ({}))) as { error?: string };
      if (!response.ok) throw new Error(body.error ?? "Could not add the action item.");
      return body;
    },
    onSuccess: () => {
      setNewAction("");
      setError(undefined);
      void queryClient.invalidateQueries({ queryKey });
    },
    onError: (mutationError: Error) => setError(mutationError.message),
  });

  const actionStatusMutation = useMutation({
    mutationFn: async (input: { id: string; complete: boolean }) => {
      const response = await fetch(`/api/action-items/${input.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ complete: input.complete }),
      });
      const body = (await response.json().catch(() => ({}))) as { error?: string };
      if (!response.ok) throw new Error(body.error ?? "Could not update the action item.");
      return body;
    },
    onSuccess: () => void queryClient.invalidateQueries({ queryKey }),
    onError: (mutationError: Error) => setError(mutationError.message),
  });

  const removeActionMutation = useMutation({
    mutationFn: async (id: string) => {
      const response = await fetch(`/api/action-items/${id}`, { method: "DELETE" });
      const body = (await response.json().catch(() => ({}))) as { error?: string };
      if (!response.ok) throw new Error(body.error ?? "Could not remove the action item.");
      return body;
    },
    onSuccess: () => void queryClient.invalidateQueries({ queryKey }),
    onError: (mutationError: Error) => setError(mutationError.message),
  });

  // PUBLISHED, THEN EDITED — the one state the screen has to explain rather than just render.
  // Publishing renders the PDF from the sections as they were; an edit afterwards leaves that file
  // behind. Saying so is the whole reason the route allows a re-publish.
  const pdfIsStale = agenda.status === "published" && dirty;

  return (
    <div className="flex flex-col gap-4">
      <Card>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="min-w-0">
            <p className="text-sm font-medium text-foreground">
              {agenda.status === "published" ? "Published" : "Draft"}
            </p>
            <p className="mt-1 text-sm text-muted">
              {agenda.status === "published"
                ? agenda.pdfUrl === null
                  ? "Published, but the PDF is not available."
                  : "The PDF below is the agenda as it was published."
                : "Nothing has been published yet."}
            </p>
          </div>

          <div className="flex flex-wrap gap-2">
            {agenda.pdfUrl === null ? null : (
              <a
                href={agenda.pdfUrl}
                target="_blank"
                rel="noreferrer"
                className="inline-flex min-h-11 items-center justify-center rounded-md border border-border bg-surface px-4 py-2 text-sm font-medium text-foreground hover:bg-surface-raised"
              >
                Open the PDF
              </a>
            )}
            {canPublish ? (
              <Button
                onClick={() => publishMutation.mutate()}
                disabled={publishMutation.isPending}
              >
                {publishMutation.isPending
                  ? "Publishing…"
                  : agenda.status === "published"
                    ? "Publish again"
                    : "Publish"}
              </Button>
            ) : null}
          </div>
        </div>

        {pdfIsStale ? (
          <p className="mt-3 rounded-md border border-border bg-surface-raised p-3 text-sm text-foreground">
            You have unsaved changes. Save them, then publish again to update the PDF.
          </p>
        ) : null}

        <FormError message={error} />
      </Card>

      {draft.map((section) => (
        <Card key={section.id}>
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <h2 className="text-base font-semibold text-foreground">{section.title}</h2>
            {canManage ? (
              <Button
                variant="secondary"
                onClick={() => edit(draft.filter((entry) => entry.id !== section.id))}
              >
                Remove section
              </Button>
            ) : null}
          </div>

          {/* THE ACTION-ITEM SECTION RENDERS ROWS, NOT TEXT LINES. They are `action_items` rows
              with their own lifecycle, which is what lets them carry forward — putting them in
              the jsonb would make "still open next fortnight" unanswerable. */}
          {section.id === actionSectionId ? (
            <div className="mt-3 flex flex-col gap-2">
              {actionItems.length === 0 ? (
                <p className="text-sm text-muted">No action items yet.</p>
              ) : (
                <ul className="flex flex-col gap-2">
                  {actionItems.map((item) => {
                    const carried = describeCarriedFrom(
                      item.carriedFromAgendaId === null ? null : "a previous meeting",
                    );
                    return (
                      <li
                        key={item.id}
                        className="flex flex-wrap items-start justify-between gap-2 rounded-md border border-border p-3"
                      >
                        <div className="min-w-0">
                          <p
                            className={`text-sm ${
                              item.status === "complete"
                                ? "text-muted line-through"
                                : "text-foreground"
                            }`}
                          >
                            {item.description}
                          </p>
                          {carried === null ? null : (
                            <p className="mt-1 text-xs text-muted">{carried}</p>
                          )}
                        </div>

                        {canManage ? (
                          <div className="flex flex-wrap gap-2">
                            <Button
                              variant="secondary"
                              onClick={() =>
                                actionStatusMutation.mutate({
                                  id: item.id,
                                  complete: item.status !== "complete",
                                })
                              }
                            >
                              {item.status === "complete" ? "Reopen" : "Mark done"}
                            </Button>
                            <Button
                              variant="secondary"
                              onClick={() => removeActionMutation.mutate(item.id)}
                            >
                              Remove
                            </Button>
                          </div>
                        ) : null}
                      </li>
                    );
                  })}
                </ul>
              )}

              {canManage ? (
                <form
                  className="flex flex-wrap items-end gap-2"
                  onSubmit={(event) => {
                    event.preventDefault();
                    if (newAction.trim().length > 0) addActionMutation.mutate(newAction.trim());
                  }}
                >
                  <div className="min-w-0 flex-1">
                    <Input
                      id={`new-action-${section.id}`}
                      label="Add an action item"
                      value={newAction}
                      onChange={(event) => setNewAction(event.target.value)}
                      placeholder="What needs doing, and by whom"
                    />
                  </div>
                  <Button type="submit" disabled={addActionMutation.isPending}>
                    Add
                  </Button>
                </form>
              ) : null}
            </div>
          ) : (
            <div className="mt-3 flex flex-col gap-2">
              {section.items.length === 0 ? (
                <p className="text-sm text-muted">Nothing recorded.</p>
              ) : (
                <ul className="flex flex-col gap-2">
                  {section.items.map((item) => (
                    <li
                      key={item.id}
                      className="flex flex-wrap items-start justify-between gap-2 rounded-md border border-border p-3"
                    >
                      <div className="min-w-0">
                        <p className="text-sm text-foreground">{item.text}</p>
                        {/* Where the line came from, said out loud. A flagged item was put here
                            by the app, and a secretary deleting it is deciding the ward council
                            will not discuss it — worth knowing before they do. */}
                        {item.source === "flag" ? (
                          <p className="mt-1 text-xs text-muted">Flagged for the ward council</p>
                        ) : null}
                      </div>
                      {canManage ? (
                        <Button
                          variant="secondary"
                          onClick={() =>
                            edit(
                              draft.map((entry) =>
                                entry.id === section.id
                                  ? {
                                      ...entry,
                                      items: entry.items.filter((line) => line.id !== item.id),
                                    }
                                  : entry,
                              ),
                            )
                          }
                        >
                          Remove
                        </Button>
                      ) : null}
                    </li>
                  ))}
                </ul>
              )}

              {canManage ? (
                <form
                  className="flex flex-wrap items-end gap-2"
                  onSubmit={(event) => {
                    event.preventDefault();
                    const text = (newItemText[section.id] ?? "").trim();
                    if (text.length === 0) return;
                    edit(
                      draft.map((entry) =>
                        entry.id === section.id
                          ? { ...entry, items: [...entry.items, newAgendaItem(text)] }
                          : entry,
                      ),
                    );
                    setNewItemText({ ...newItemText, [section.id]: "" });
                  }}
                >
                  <div className="min-w-0 flex-1">
                    <Input
                      id={`new-item-${section.id}`}
                      label="Add a line"
                      value={newItemText[section.id] ?? ""}
                      onChange={(event) =>
                        setNewItemText({ ...newItemText, [section.id]: event.target.value })
                      }
                    />
                  </div>
                  <Button type="submit">Add</Button>
                </form>
              ) : null}
            </div>
          )}
        </Card>
      ))}

      {canManage ? (
        <Card>
          <div className="flex flex-wrap items-center justify-between gap-3">
            <Button
              variant="secondary"
              onClick={() => edit([...draft, newAgendaSection("New section")])}
            >
              Add a section
            </Button>

            <Button
              onClick={() => saveMutation.mutate(draft)}
              disabled={!dirty || saveMutation.isPending}
            >
              {saveMutation.isPending
                ? "Saving…"
                : dirty
                  ? "Save changes"
                  : "Saved"}
            </Button>
          </div>
        </Card>
      ) : null}
    </div>
  );
}
