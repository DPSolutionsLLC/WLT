"use client";

import { useRouter } from "next/navigation";
import { useRef, useState, type FormEvent } from "react";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { FormError } from "@/components/ui/FormError";
import { Input } from "@/components/ui/Input";
import {
  KNOWLEDGE_TYPE_TAGS,
  KNOWLEDGE_TYPE_TAG_LABELS,
  MAX_UPLOAD_BYTES,
  type KnowledgeTypeTag,
} from "@/types/domain";

// MAX_UPLOAD_BYTES comes from types/domain.ts, which is the SAME constant the route enforces
// (lib/knowledge/parseDocument.ts re-exports it). Two copies of this number is how a client-side
// check starts quietly disagreeing with the server that actually refuses the file.

const SELECT_CLASSES =
  "min-h-11 rounded-md border border-border bg-surface-raised px-3 py-2 text-base text-foreground " +
  "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary";

const MAX_MEGABYTES = MAX_UPLOAD_BYTES / (1024 * 1024);

type UploadSummary = {
  chunkCount: number;
  embeddedCount: number;
  failedChunkIndexes: number[];
  characterCount: number;
};

export function UploadForm() {
  const router = useRouter();
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [title, setTitle] = useState("");
  const [typeTag, setTypeTag] = useState<KnowledgeTypeTag>("general_conference");
  const [uploadError, setUploadError] = useState<string>();
  const [summary, setSummary] = useState<UploadSummary>();
  const [isUploading, setIsUploading] = useState(false);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setUploadError(undefined);
    // Cleared before the call, so a failure never leaves the PREVIOUS document's counts on
    // screen looking like the result of the upload that just failed.
    setSummary(undefined);

    const file = fileInputRef.current?.files?.[0];

    if (!file) {
      setUploadError("Choose a file to upload.");
      return;
    }

    // Checked here so an oversized file is refused BEFORE anything is sent. The route checks it
    // again — a client-side check is a courtesy, never the boundary.
    if (file.size > MAX_UPLOAD_BYTES) {
      const megabytes = (file.size / (1024 * 1024)).toFixed(1);
      setUploadError(
        `That file is ${megabytes} MB. The limit is ${MAX_MEGABYTES} MB — try uploading the text on its own, or split it in two.`,
      );
      return;
    }

    setIsUploading(true);

    try {
      const form = new FormData();
      form.set("file", file);
      form.set("title", title);
      form.set("typeTag", typeTag);

      // No Content-Type header: the browser sets it, with the multipart boundary. Setting it by
      // hand omits the boundary and the server cannot parse the body.
      const response = await fetch("/api/knowledge/upload", { method: "POST", body: form });

      const body: { summary?: UploadSummary; error?: string } = await response.json();

      if (!response.ok || !body.summary) {
        // VERBATIM. The route's refusals are already written for a human — "It may be a scan
        // rather than text" — and re-wording them here would collapse five distinguishable
        // failures into one.
        setUploadError(body.error ?? "Could not add the document. Please try again.");
        return;
      }

      setSummary(body.summary);
      setTitle("");
      if (fileInputRef.current) fileInputRef.current.value = "";

      router.refresh();
    } catch (error) {
      console.error("Could not upload a knowledge document", error);
      setUploadError("Could not reach the server. Check your connection and try again.");
    } finally {
      setIsUploading(false);
    }
  }

  const failedCount = summary?.failedChunkIndexes.length ?? 0;

  return (
    <Card>
      <form onSubmit={handleSubmit} className="flex flex-col gap-4" noValidate>
        <div>
          <h2 className="text-base font-semibold text-foreground">Add a document</h2>
          <p className="mt-1 text-sm text-muted">
            A talk, a letter, or any text worth drawing on. Plain text, Markdown or PDF, up to{" "}
            {MAX_MEGABYTES} MB.
          </p>
        </div>

        <Input
          id="knowledge-title"
          label="Title"
          value={title}
          onChange={(event) => setTitle(event.target.value)}
          placeholder="Elder Holland, April 2024"
          maxLength={200}
        />

        <div className="flex flex-col gap-1.5">
          <label htmlFor="knowledge-type-tag" className="text-sm font-medium text-foreground">
            Kind of document
          </label>
          <select
            id="knowledge-type-tag"
            value={typeTag}
            onChange={(event) => setTypeTag(event.target.value as KnowledgeTypeTag)}
            className={SELECT_CLASSES}
          >
            {KNOWLEDGE_TYPE_TAGS.map((tag) => (
              <option key={tag} value={tag}>
                {KNOWLEDGE_TYPE_TAG_LABELS[tag]}
              </option>
            ))}
          </select>
        </div>

        <div className="flex flex-col gap-1.5">
          <label htmlFor="knowledge-file" className="text-sm font-medium text-foreground">
            File
          </label>
          <input
            ref={fileInputRef}
            id="knowledge-file"
            type="file"
            accept=".txt,.md,.pdf,text/plain,text/markdown,application/pdf"
            className="min-h-11 rounded-md border border-border bg-surface-raised px-3 py-2 text-sm text-foreground file:mr-3 file:min-h-9 file:rounded-md file:border-0 file:bg-primary file:px-3 file:py-1.5 file:text-sm file:font-medium file:text-primary-foreground"
          />
        </div>

        <div>
          <Button type="submit" disabled={isUploading}>
            {isUploading ? "Reading and indexing…" : "Add document"}
          </Button>
        </div>

        <FormError message={uploadError} />

        {summary && (
          <div className="flex flex-col gap-2">
            {/* BOTH COUNTS, always. "412 passages, 410 embedded" is how a partial failure
                reaches a human instead of becoming quietly worse retrieval. */}
            <p className="text-sm text-foreground">
              Added — {summary.chunkCount}{" "}
              {summary.chunkCount === 1 ? "passage" : "passages"}, {summary.embeddedCount}{" "}
              embedded.
            </p>

            {failedCount > 0 && (
              <p
                role="alert"
                className="rounded-md border border-dashed border-border bg-surface p-3 text-sm text-foreground"
              >
                {failedCount} {failedCount === 1 ? "passage" : "passages"} could not be indexed
                for search. The document is saved and the rest of it is usable — uploading it
                again will retry the missing {failedCount === 1 ? "one" : "ones"}.
              </p>
            )}
          </div>
        )}
      </form>
    </Card>
  );
}
