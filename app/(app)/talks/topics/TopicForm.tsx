"use client";

import { useState } from "react";
import { Button } from "@/components/ui/Button";
import { FormError } from "@/components/ui/FormError";
import { Input } from "@/components/ui/Input";
import type { Topic } from "@/lib/topics/queries";
import { MAX_TOPIC_TITLE } from "@/lib/validation/topic";
import { TOPIC_CATEGORIES, TOPIC_CATEGORY_LABELS, type TopicCategory } from "@/types/domain";

// The MANUAL add path — and the same form an accepted AI candidate goes through, which is why it
// takes an optional `initial`. Phase 5 reuses this rather than growing a second create screen,
// so there is exactly one shape of thing a person fills in before a topic exists.

const TEXTAREA_CLASSES =
  "w-full rounded-md border border-border bg-surface-raised px-3 py-2 text-base text-foreground " +
  "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary";

export type TopicFormValues = {
  title: string;
  category: TopicCategory;
  description: string | null;
  suggestedScriptures: string[] | null;
  suggestedTalks: string[] | null;
};

export type TopicFormProps = {
  initial?: Topic | null;
  // Every field id is prefixed, so the add form and an inline edit form can be on the page at
  // once without two labels pointing at the same input.
  idPrefix: string;
  submitLabel: string;
  onSubmit: (values: TopicFormValues) => Promise<string | null>;
  onCancel?: () => void;
};

// One reference per line. A comma-separated box is ambiguous the moment somebody types
// "Doctrine and Covenants 4:2, 121:7" and means one entry, not two.
export function parseSuggestionLines(value: string): string[] | null {
  const entries = value
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line !== "");

  return entries.length > 0 ? entries : null;
}

export function formatSuggestionLines(value: readonly string[] | null): string {
  return (value ?? []).join("\n");
}

export function TopicForm({
  initial,
  idPrefix,
  submitLabel,
  onSubmit,
  onCancel,
}: TopicFormProps) {
  const [title, setTitle] = useState(initial?.title ?? "");
  const [category, setCategory] = useState<TopicCategory>(initial?.category ?? "doctrinal");
  const [description, setDescription] = useState(initial?.description ?? "");
  const [scriptures, setScriptures] = useState(
    formatSuggestionLines(initial?.suggestedScriptures ?? null),
  );
  const [talks, setTalks] = useState(formatSuggestionLines(initial?.suggestedTalks ?? null));

  const [errorMessage, setErrorMessage] = useState<string | undefined>(undefined);
  const [isSaving, setIsSaving] = useState(false);

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    setErrorMessage(undefined);

    if (title.trim() === "") {
      setErrorMessage("Give the topic a title.");
      return;
    }

    setIsSaving(true);

    // onSubmit returns a MESSAGE on failure and null on success, rather than throwing. A caller
    // that forgets a try/catch would otherwise leave this form spinning with no explanation
    // (CLAUDE.md rule 7).
    const failure = await onSubmit({
      title: title.trim(),
      category,
      description: description.trim() === "" ? null : description.trim(),
      suggestedScriptures: parseSuggestionLines(scriptures),
      suggestedTalks: parseSuggestionLines(talks),
    });

    setIsSaving(false);

    if (failure !== null) {
      setErrorMessage(failure);
      return;
    }

    if (initial == null) {
      setTitle("");
      setDescription("");
      setScriptures("");
      setTalks("");
    }
  }

  return (
    <form onSubmit={handleSubmit} className="flex flex-col gap-3">
      <Input
        id={`${idPrefix}-title`}
        label="Title"
        value={title}
        maxLength={MAX_TOPIC_TITLE}
        onChange={(event) => setTitle(event.target.value)}
        required
      />

      <label
        htmlFor={`${idPrefix}-category`}
        className="flex flex-col gap-1 text-sm font-medium text-foreground"
      >
        Category
        <select
          id={`${idPrefix}-category`}
          value={category}
          onChange={(event) => setCategory(event.target.value as TopicCategory)}
          className="min-h-11 rounded-md border border-border bg-surface-raised px-3 text-base text-foreground focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
        >
          {TOPIC_CATEGORIES.map((value) => (
            <option key={value} value={value}>
              {TOPIC_CATEGORY_LABELS[value]}
            </option>
          ))}
        </select>
      </label>

      <label
        htmlFor={`${idPrefix}-description`}
        className="flex flex-col gap-1 text-sm font-medium text-foreground"
      >
        Description
        <textarea
          id={`${idPrefix}-description`}
          value={description}
          rows={3}
          onChange={(event) => setDescription(event.target.value)}
          className={TEXTAREA_CLASSES}
        />
      </label>

      <label
        htmlFor={`${idPrefix}-scriptures`}
        className="flex flex-col gap-1 text-sm font-medium text-foreground"
      >
        Suggested scriptures
        <span className="text-xs font-normal text-muted">
          One reference per line. These go into the speaker&apos;s confirmation message.
        </span>
        <textarea
          id={`${idPrefix}-scriptures`}
          value={scriptures}
          rows={3}
          onChange={(event) => setScriptures(event.target.value)}
          className={TEXTAREA_CLASSES}
        />
      </label>

      <label
        htmlFor={`${idPrefix}-talks`}
        className="flex flex-col gap-1 text-sm font-medium text-foreground"
      >
        Suggested talks
        <span className="text-xs font-normal text-muted">One title per line.</span>
        <textarea
          id={`${idPrefix}-talks`}
          value={talks}
          rows={3}
          onChange={(event) => setTalks(event.target.value)}
          className={TEXTAREA_CLASSES}
        />
      </label>

      <FormError message={errorMessage} />

      <div className="flex flex-wrap gap-2">
        <Button type="submit" disabled={isSaving}>
          {submitLabel}
        </Button>
        {onCancel && (
          <Button type="button" variant="secondary" onClick={onCancel} disabled={isSaving}>
            Cancel
          </Button>
        )}
      </div>
    </form>
  );
}
