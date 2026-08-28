"use client";

import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { FormError } from "@/components/ui/FormError";
import { IcsProblemList } from "@/components/youth/IcsProblemList";
import {
  countsFromPreview,
  type IcsImportPreview,
  type PreviewEvent,
} from "@/lib/youth/ics/buildImportPreview";

export type IcsPreviewStepProps = {
  preview: IcsImportPreview;
  problemsTruncated: number;
  activityLabel: string;
  onBack: () => void;
  onConfirm: () => void;
  isBusy: boolean;
  error?: string;
};

// Nothing on this screen is written in the past tense. Copy that reads as though the import has
// already happened is how a user confirms twice (app/(app)/roster/import/PreviewStep.tsx).

function Count({ label, value }: { label: string; value: number }) {
  return (
    <div className="flex items-baseline justify-between gap-4 border-t border-border py-2 first:border-t-0 first:pt-0">
      <span className="text-sm text-muted">{label}</span>
      <span className="text-base font-semibold text-foreground">{value}</span>
    </div>
  );
}

// THE HOUR IS THE POINT. A leader has to be able to read "Fri, 15 Jan 2027, 19:30" before
// confirming, not discover it afterwards — which is why every row here shows the resolved local
// time and not a raw ISO string.
function EventRow({ event, note }: { event: PreviewEvent; note?: string }) {
  return (
    <li className="border-t border-border py-2 first:border-t-0 first:pt-0">
      <div className="flex flex-wrap items-baseline gap-x-2">
        <span className="font-medium text-foreground">{event.title}</span>
        <span className="text-muted">{event.localTime}</span>
      </div>
      {event.location === null ? null : (
        <p className="text-sm text-muted">{event.location}</p>
      )}
      {note === undefined ? null : <p className="text-sm text-muted">{note}</p>}
      {/* Said per event rather than once at the top. A leader who can see WHICH games were
          assumed can tell at a glance whether the assumption was right; a single banner saying
          "some times had no zone" leaves them checking all thirty. */}
      {event.usedWardZone ? (
        <p className="text-sm text-muted">
          This entry carried no time zone, so it is shown in the ward&rsquo;s.
        </p>
      ) : null}
    </li>
  );
}

export function IcsPreviewStep({
  preview,
  problemsTruncated,
  activityLabel,
  onBack,
  onConfirm,
  isBusy,
  error,
}: IcsPreviewStepProps) {
  const counts = countsFromPreview(preview);
  const willWrite = counts.toCreate + counts.toUpdate;

  return (
    <div className="flex flex-col gap-4">
      <Card>
        <h2 className="text-base font-semibold text-foreground">Nothing has been imported yet</h2>
        <p className="mt-2 text-sm text-muted">
          This is what the import will do to <span className="font-medium">{activityLabel}</span>.
          Read it, then confirm at the bottom.
        </p>
        <p className="mt-2 text-sm text-muted">
          Times are shown in the ward&rsquo;s time zone, {preview.wardTimeZone}.
        </p>
        {preview.calendarExists ? (
          <p className="mt-2 text-sm text-muted">
            This activity already has a schedule feed
            {/* `lastSyncedLocal`, NOT `new Date(lastSyncedAt).toLocaleDateString()`. That bare
                call rendered "1/2/2027" beside a dozen dates reading "Sat, 2 Jan 2027", which an
                en-GB reader takes for 1 February — defect youth-b-D1's sibling, youth-b-D2. The
                server formats every date on this screen through one function so they cannot
                disagree. */}
            {preview.lastSyncedLocal === null
              ? "."
              : `, last imported ${preview.lastSyncedLocal}.`}{" "}
            Importing again adds what is new and updates what has moved.
          </p>
        ) : null}
      </Card>

      <Card>
        <h3 className="text-sm font-semibold text-foreground">What this file will do</h3>
        {/* THE SAME FOUR NUMBERS THE RESULT SCREEN SHOWS, under the same labels. roster-c's defect
            was a preview saying "6 to update" and a result saying "3 updated" — both correct, and
            the pairing wrong. Identical labels are the defence, not a cleverer calculation. */}
        <div className="mt-3 flex flex-col">
          <Count label="Events to create" value={counts.toCreate} />
          <Count label="Events to update" value={counts.toUpdate} />
          <Count label="Events already correct" value={counts.unchanged} />
          <Count label="In the app, not in this file" value={counts.notInFile} />
        </div>

        {preview.occurrencesDropped > 0 ? (
          <p className="mt-3 border-t border-border pt-3 text-sm text-muted">
            This file has {preview.occurrencesDropped} more{" "}
            {preview.occurrencesDropped === 1 ? "entry" : "entries"} than one import can take.
            They are not listed above and will not be created.
          </p>
        ) : null}
      </Card>

      {counts.toCreate === 0 ? null : (
        <Card>
          <h3 className="text-sm font-semibold text-foreground">
            {counts.toCreate} to create
          </h3>
          <ul className="mt-3 max-h-96 overflow-y-auto text-sm">
            {preview.toCreate.map((event) => (
              <EventRow key={`${event.uid}-${event.recurrenceId ?? ""}`} event={event} />
            ))}
          </ul>
        </Card>
      )}

      {counts.toUpdate === 0 ? null : (
        <Card>
          <h3 className="text-sm font-semibold text-foreground">{counts.toUpdate} to update</h3>
          <p className="mt-2 text-sm text-muted">
            Only the name, the time, the place and whether it is an all-day event change. Anything
            you cancelled or marked home or away by hand stays as you left it.
          </p>
          <ul className="mt-3 max-h-96 overflow-y-auto text-sm">
            {preview.toUpdate.map((change) => (
              <EventRow
                key={change.existingId}
                event={change.event}
                note={`Was ${change.existingTitle}, ${change.existingLocalTime} — changing ${change.changedFields.join(", ")}`}
              />
            ))}
          </ul>
        </Card>
      )}

      {counts.notInFile === 0 ? null : (
        <Card>
          <h3 className="text-sm font-semibold text-foreground">
            In the app, not in this file
          </h3>
          {/* A STATEMENT, NOT A WARNING. It must not look like an error, and it must not look like
              something the confirm is about to act on: the import performs no deletes and no
              status changes, ever. A feed that briefly publishes a short file cannot cancel a
              season. */}
          <p className="mt-2 text-sm text-muted">
            {counts.notInFile === 1
              ? "1 event is in the app and not in this file. Nothing will change for it."
              : `${counts.notInFile} events are in the app and not in this file. Nothing will change for them.`}
          </p>
          <ul className="mt-3 max-h-60 overflow-y-auto text-sm">
            {preview.notInFile.map((event) => (
              <EventRow key={`${event.uid}-${event.recurrenceId ?? ""}`} event={event} />
            ))}
          </ul>
        </Card>
      )}

      <IcsProblemList
        problems={preview.problems}
        problemsTruncated={problemsTruncated}
        emptyMessage="Every entry in this file can be imported."
      />

      <FormError message={error} />

      <div className="flex flex-col gap-3 md:flex-row">
        {/* Labelled with what it will do, not "Confirm". */}
        <Button onClick={onConfirm} disabled={isBusy || willWrite === 0}>
          {isBusy
            ? "Importing…"
            : willWrite === 0
              ? "Nothing to import"
              : `Import ${willWrite} ${willWrite === 1 ? "event" : "events"}`}
        </Button>
        <Button variant="secondary" onClick={onBack} disabled={isBusy}>
          Choose a different file
        </Button>
      </div>
    </div>
  );
}
