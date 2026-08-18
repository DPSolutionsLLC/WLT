"use client";

import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { FormError } from "@/components/ui/FormError";
import {
  describeMissingFields,
  FIELD_LABELS,
  IMPORT_FIELDS,
  missingRequiredFields,
  REQUIRED_IMPORT_FIELDS,
  type ColumnMapping,
  type ImportField,
} from "@/lib/roster/csv/columnMapping";

export type ColumnMappingStepProps = {
  headers: string[];
  sampleRow: string[];
  mapping: ColumnMapping;
  onChange: (mapping: ColumnMapping) => void;
  onBack: () => void;
  onContinue: () => void;
  isBusy: boolean;
  error?: string;
};

const SELECT_CLASSES =
  "min-h-11 w-full rounded-md border border-border bg-surface-raised px-3 py-2 text-sm " +
  "text-foreground focus-visible:outline-2 focus-visible:outline-offset-2 " +
  "focus-visible:outline-primary";

const NOT_IMPORTED = "";

export function ColumnMappingStep({
  headers,
  sampleRow,
  mapping,
  onChange,
  onBack,
  onContinue,
  isBusy,
  error,
}: ColumnMappingStepProps) {
  const missing = missingRequiredFields(mapping);
  const blockingMessage = describeMissingFields(missing, headers);

  function handleSelect(field: ImportField, value: string): void {
    const next = { ...mapping };

    if (value === NOT_IMPORTED) {
      delete next[field];
    } else {
      next[field] = Number(value);
    }

    onChange(next);
  }

  return (
    <div className="flex flex-col gap-4">
      <Card>
        <h2 className="text-base font-semibold text-foreground">Match the columns</h2>
        <p className="mt-2 text-sm text-muted">
          These are matched by column name, so the order in your export does not matter. Check
          the sample value beside each one before continuing — it is the fastest way to catch a
          household name that landed in the last-name row.
        </p>
      </Card>

      {/* One stacked block per field, never a table. A table at 375px is a horizontal scroll
          with the label off screen, which is the one thing this step cannot afford. */}
      <Card>
        <ul className="flex flex-col divide-y divide-border">
          {IMPORT_FIELDS.map((field) => {
            const selectId = `import-mapping-${field}`;
            const isRequired = REQUIRED_IMPORT_FIELDS.includes(field);
            const columnIndex = mapping[field];
            const sample = columnIndex === undefined ? "" : (sampleRow[columnIndex] ?? "");

            return (
              <li key={field} className="flex flex-col gap-1.5 py-3 first:pt-0 last:pb-0">
                <label
                  htmlFor={selectId}
                  className="text-sm font-medium text-foreground"
                >
                  {FIELD_LABELS[field]}
                  {isRequired && <span className="ml-1 text-danger">*</span>}
                </label>

                <select
                  id={selectId}
                  className={SELECT_CLASSES}
                  value={columnIndex === undefined ? NOT_IMPORTED : String(columnIndex)}
                  onChange={(event) => handleSelect(field, event.target.value)}
                  disabled={isBusy}
                >
                  <option value={NOT_IMPORTED}>Not imported</option>
                  {headers.map((header, index) => (
                    <option key={`${header}-${index}`} value={String(index)}>
                      {header}
                    </option>
                  ))}
                </select>

                <p className="text-sm text-muted">
                  {columnIndex === undefined
                    ? "No column chosen."
                    : sample === ""
                      ? "First row of this column is empty."
                      : `First row: ${sample}`}
                </p>
              </li>
            );
          })}
        </ul>
      </Card>

      <FormError message={error} />

      {/* Named, not silently greyed. A disabled button with no explanation is a dead end. */}
      {blockingMessage !== "" && (
        <p role="status" className="text-sm text-danger">
          {blockingMessage}
        </p>
      )}

      <div className="flex flex-col gap-3 md:flex-row">
        <Button onClick={onContinue} disabled={isBusy || missing.length > 0}>
          {isBusy ? "Reading the file…" : "Continue to preview"}
        </Button>
        <Button variant="secondary" onClick={onBack} disabled={isBusy}>
          Choose a different file
        </Button>
      </div>
    </div>
  );
}
