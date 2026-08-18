"use client";

import { ImportProblemList } from "@/components/roster/ImportProblemList";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { FormError } from "@/components/ui/FormError";
import type { ImportPreview } from "@/lib/roster/csv/buildImportPreview";

export type PreviewStepProps = {
  preview: ImportPreview;
  problemsTruncated: number;
  onBack: () => void;
  onConfirm: () => void;
  isBusy: boolean;
  error?: string;
};

// Nothing on this screen is written in the past tense. Copy that reads as though the import has
// already happened is how a user confirms twice.

function Count({ label, value }: { label: string; value: number }) {
  return (
    <div className="flex items-baseline justify-between gap-4 border-t border-border py-2 first:border-t-0 first:pt-0">
      <span className="text-sm text-muted">{label}</span>
      <span className="text-base font-semibold text-foreground">{value}</span>
    </div>
  );
}

export function PreviewStep({
  preview,
  problemsTruncated,
  onBack,
  onConfirm,
  isBusy,
  error,
}: PreviewStepProps) {
  const memberCount = preview.newMemberCount + preview.matchedMemberCount;

  return (
    <div className="flex flex-col gap-4">
      <Card>
        <h2 className="text-base font-semibold text-foreground">
          Nothing has been imported yet
        </h2>
        <p className="mt-2 text-sm text-muted">
          This is what the import will do. Read it, then confirm at the bottom.
        </p>
      </Card>

      <Card>
        <h3 className="text-sm font-semibold text-foreground">What this file will do</h3>
        <div className="mt-3 flex flex-col">
          <Count label="Rows read from the file" value={preview.totalRows} />
          <Count label="Households to create" value={preview.newHouseholds.length} />
          <Count label="Households already in the roster" value={preview.matchedHouseholdCount} />
          <Count label="Members to create" value={preview.newMemberCount} />
          <Count label="Members to update" value={preview.matchedMemberCount} />
        </div>

        {/* Decision 5, stated out loud. An import never marks, deactivates, or removes anyone,
            and a user who is not told that will wonder what happened to everybody else. */}
        <p className="mt-3 border-t border-border pt-3 text-sm text-muted">
          {preview.untouchedMemberCount === 0
            ? "Everyone already in your roster appears in this file."
            : `${preview.untouchedMemberCount} ${
                preview.untouchedMemberCount === 1 ? "member is" : "members are"
              } in your roster and not in this file. They will not be changed, moved out, or removed.`}
        </p>
      </Card>

      <ImportProblemList
        problems={preview.problems}
        problemsTruncated={problemsTruncated}
        emptyMessage="Every row in this file can be imported."
      />

      {/* The list, not just the count. A familyName mapped to the last-name column shows up here
          as 400 new households named after individuals rather than 40 named after families —
          and only the names make that visible. */}
      <Card>
        <h3 className="text-sm font-semibold text-foreground">
          {preview.newHouseholds.length === 0
            ? "No new households"
            : `${preview.newHouseholds.length} new ${
                preview.newHouseholds.length === 1 ? "household" : "households"
              }`}
        </h3>

        {preview.newHouseholds.length === 0 ? (
          <p className="mt-2 text-sm text-muted">
            Every household in this file is already in your roster.
          </p>
        ) : (
          <ul className="mt-3 max-h-80 overflow-y-auto text-sm">
            {preview.newHouseholds.map((household) => (
              <li
                key={`${household.familyName}-${household.address ?? ""}`}
                className="border-t border-border py-2 first:border-t-0 first:pt-0"
              >
                <span className="font-medium text-foreground">{household.familyName}</span>
                <span className="text-muted">
                  {household.address ? ` — ${household.address}` : " — no address"} (
                  {household.memberCount}{" "}
                  {household.memberCount === 1 ? "member" : "members"})
                </span>
              </li>
            ))}
          </ul>
        )}
      </Card>

      <FormError message={error} />

      <div className="flex flex-col gap-3 md:flex-row">
        {/* Labelled with what it will do, not "Confirm". */}
        <Button onClick={onConfirm} disabled={isBusy || memberCount === 0}>
          {isBusy
            ? "Importing…"
            : `Import ${memberCount} ${memberCount === 1 ? "member" : "members"}`}
        </Button>
        <Button variant="secondary" onClick={onBack} disabled={isBusy}>
          Back to the columns
        </Button>
      </div>
    </div>
  );
}
