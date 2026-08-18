"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ColumnMappingStep } from "@/app/(app)/roster/import/ColumnMappingStep";
import { PreviewStep } from "@/app/(app)/roster/import/PreviewStep";
import { ImportProblemList } from "@/components/roster/ImportProblemList";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { FormError } from "@/components/ui/FormError";
import type { ImportResult } from "@/lib/roster/csv/applyImport";
import type { ImportPreview } from "@/lib/roster/csv/buildImportPreview";
import { suggestMapping, type ColumnMapping } from "@/lib/roster/csv/columnMapping";
import {
  formatFileSizeLimit,
  hasAcceptedExtension,
  MAX_IMPORT_FILE_BYTES,
  MAX_IMPORT_ROWS,
} from "@/lib/roster/csv/limits";
import { isCsvLimitError, parseCsvText } from "@/lib/roster/csv/parseCsv";

// Holds the File across all three steps, because Decision 2 uploads it twice: once to preview
// and once to confirm. Keeping the file rather than the parsed rows is what makes the confirm
// payload untamperable — there is nothing in it for a client to rewrite.
//
// The file is parsed HERE as well, but only to read the headers and one sample row for the
// mapping step. The server re-parses from scratch and its answer is the one that counts;
// parseCsv.ts imports nothing, which is what lets the same parser run on both sides.

type Step = "file" | "map" | "preview" | "done";

type PreviewResponse = {
  preview?: ImportPreview;
  problemsTruncated?: number;
  headers?: string[];
  mapping?: ColumnMapping;
  sampleRow?: string[];
  error?: string;
};

type ImportResponse = {
  result?: ImportResult;
  problemsTruncated?: number;
  error?: string;
};

const NETWORK_ERROR = "Could not reach the server. Check your connection and try again.";

export function ImportWizard() {
  const router = useRouter();

  const [step, setStep] = useState<Step>("file");
  const [file, setFile] = useState<File | null>(null);
  const [headers, setHeaders] = useState<string[]>([]);
  const [sampleRow, setSampleRow] = useState<string[]>([]);
  const [mapping, setMapping] = useState<ColumnMapping>({});
  const [preview, setPreview] = useState<ImportPreview | null>(null);
  const [result, setResult] = useState<ImportResult | null>(null);
  const [problemsTruncated, setProblemsTruncated] = useState(0);
  const [formError, setFormError] = useState<string>();
  const [isBusy, setIsBusy] = useState(false);

  function restart(): void {
    setStep("file");
    setFile(null);
    setHeaders([]);
    setSampleRow([]);
    setMapping({});
    setPreview(null);
    setResult(null);
    setProblemsTruncated(0);
    setFormError(undefined);
  }

  // The client check is a courtesy; assertAcceptableFile() on the server is the boundary. Doing
  // it here saves the user a 5MB upload before being told the file is a .png.
  async function handleFileChosen(chosen: File): Promise<void> {
    setFormError(undefined);

    if (!hasAcceptedExtension(chosen.name)) {
      setFormError("That file is not a .csv. Export your roster from LCR as CSV and try again.");
      return;
    }

    if (chosen.size > MAX_IMPORT_FILE_BYTES) {
      setFormError(
        `That file is larger than ${formatFileSizeLimit()}. Split the export and import it in parts.`,
      );
      return;
    }

    setIsBusy(true);

    try {
      const parsed = parseCsvText(await chosen.text(), { maxRows: MAX_IMPORT_ROWS });

      if (parsed.headers.length === 0) {
        setFormError(
          "That file has no header row. The first line of an LCR export names the columns.",
        );
        return;
      }

      setFile(chosen);
      setHeaders(parsed.headers);
      setSampleRow(parsed.rows[0] ?? []);
      setMapping(suggestMapping(parsed.headers));
      setStep("map");
    } catch (error) {
      if (isCsvLimitError(error)) {
        setFormError(
          `This file has more than ${MAX_IMPORT_ROWS} rows. Split the export and import it in parts.`,
        );
        return;
      }

      console.error("Could not read the chosen file", error);
      setFormError("That file could not be read. Choose it again, or re-save it as CSV.");
    } finally {
      setIsBusy(false);
    }
  }

  async function handlePreview(): Promise<void> {
    if (!file) return;

    setFormError(undefined);
    setIsBusy(true);

    const body = new FormData();
    body.set("file", file);
    body.set("mapping", JSON.stringify(mapping));

    try {
      const response = await fetch("/api/roster/import/preview", { method: "POST", body });
      const payload: PreviewResponse = await response.json();

      if (!response.ok || !payload.preview) {
        setFormError(payload.error ?? "Could not read that file. Please try again.");
        return;
      }

      setPreview(payload.preview);
      setProblemsTruncated(payload.problemsTruncated ?? 0);
      if (payload.mapping) setMapping(payload.mapping);
      if (payload.sampleRow) setSampleRow(payload.sampleRow);
      setStep("preview");
    } catch (error) {
      console.error("Could not build the import preview", error);
      setFormError(NETWORK_ERROR);
    } finally {
      setIsBusy(false);
    }
  }

  async function handleConfirm(): Promise<void> {
    if (!file || !preview) return;

    setFormError(undefined);
    setIsBusy(true);

    const body = new FormData();
    body.set("file", file);
    body.set("mapping", JSON.stringify(mapping));
    // Decision 2: the hash the preview computed. A file edited in between comes back as a 400
    // telling the user to preview again, rather than a silent import of different data.
    body.set("fileHash", preview.fileHash);

    try {
      const response = await fetch("/api/roster/import", { method: "POST", body });
      const payload: ImportResponse = await response.json();

      if (!response.ok || !payload.result) {
        setFormError(payload.error ?? "Could not import that file. Please try again.");
        return;
      }

      setResult(payload.result);
      setProblemsTruncated(payload.problemsTruncated ?? 0);
      setStep("done");
      router.refresh();
    } catch (error) {
      console.error("Could not import the roster", error);
      setFormError(NETWORK_ERROR);
    } finally {
      setIsBusy(false);
    }
  }

  if (step === "map") {
    return (
      <ColumnMappingStep
        headers={headers}
        sampleRow={sampleRow}
        mapping={mapping}
        onChange={setMapping}
        onBack={restart}
        onContinue={handlePreview}
        isBusy={isBusy}
        error={formError}
      />
    );
  }

  if (step === "preview" && preview) {
    return (
      <PreviewStep
        preview={preview}
        problemsTruncated={problemsTruncated}
        onBack={() => {
          setFormError(undefined);
          setStep("map");
        }}
        onConfirm={handleConfirm}
        isBusy={isBusy}
        error={formError}
      />
    );
  }

  if (step === "done" && result) {
    const created = result.membersCreated;
    const updated = result.membersUpdated;

    return (
      <div className="flex flex-col gap-4">
        <Card>
          <h2 className="text-base font-semibold text-foreground">Import finished</h2>
          {/* The counts the SERVER returned, never the ones the preview estimated. A write
              refused by policy is a zero-row success, and reporting the estimate would call
              that a success too. */}
          <ul className="mt-3 text-sm text-muted">
            <li>
              {result.householdsCreated} households created, {result.householdsUpdated} updated
            </li>
            <li>
              {created} {created === 1 ? "member" : "members"} created, {updated}{" "}
              {updated === 1 ? "member" : "members"} updated
            </li>
          </ul>
          <Link
            href="/roster"
            className="mt-4 inline-block text-sm text-primary underline underline-offset-4"
          >
            Go to the roster
          </Link>
        </Card>

        <ImportProblemList
          problems={result.problems}
          problemsTruncated={problemsTruncated}
          emptyMessage="Every row in the file imported."
        />

        <div>
          <Button variant="secondary" onClick={restart}>
            Import another file
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      <Card>
        <h2 className="text-base font-semibold text-foreground">Choose your export</h2>
        <p className="mt-2 text-sm text-muted">
          Export your ward roster from LCR as a CSV file, then choose it here. Up to{" "}
          {MAX_IMPORT_ROWS} rows and {formatFileSizeLimit()}.
        </p>
        <p className="mt-2 text-sm text-muted">
          Nothing is written until you have seen the preview and confirmed it. This import never
          marks anyone moved out and never deletes anyone.
        </p>

        <label
          htmlFor="roster-import-file"
          className="mt-4 block text-sm font-medium text-foreground"
        >
          CSV file
        </label>
        <input
          id="roster-import-file"
          type="file"
          accept=".csv,text/csv"
          disabled={isBusy}
          className="mt-1.5 block w-full min-h-11 rounded-md border border-border bg-surface-raised px-3 py-2 text-sm text-foreground file:mr-3 file:min-h-9 file:rounded-md file:border-0 file:bg-primary file:px-3 file:py-1.5 file:text-sm file:font-medium file:text-primary-foreground focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
          onChange={(event) => {
            const chosen = event.target.files?.[0];
            if (chosen) void handleFileChosen(chosen);
          }}
        />

        <FormError message={formError} />
      </Card>
    </div>
  );
}
