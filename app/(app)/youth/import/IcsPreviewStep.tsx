"use client";

import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { FormError } from "@/components/ui/FormError";
import { IcsProblemList } from "@/components/youth/IcsProblemList";
import {
  countsFromPreview,
  type IcsImportPreview,
  type PreviewEvent,
  type PreviewEventChange,
} from "@/lib/youth/ics/buildImportPreview";
import { EVENT_TYPE_LABELS, type EventType } from "@/types/domain";

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
// `eventType` IS A SEPARATE PARAMETER RATHER THAN READ OFF `event`, and that is not tidiness.
//
// On a row about to be UPDATED, `change.event` is what the FILE says — including a classification
// this import is forbidden from writing. Printing that would have the row read "Home" above a
// sentence saying the setting is being left alone, which is exactly the kind of screen that
// contradicts itself one line apart (youth-b shipped three such copy defects with a green suite).
// The caller passes what will actually be true afterwards.
function EventRow({
  event,
  eventType,
  note,
}: {
  event: PreviewEvent;
  eventType?: EventType;
  note?: string;
}) {
  return (
    <li className="border-t border-border py-2 first:border-t-0 first:pt-0">
      <div className="flex flex-wrap items-baseline gap-x-2">
        <span className="font-medium text-foreground">{event.title}</span>
        <span className="text-muted">{event.localTime}</span>
      </div>
      {event.location === null ? null : (
        <p className="text-sm text-muted">{event.location}</p>
      )}
      {/* HOME OR AWAY, READ BEFORE CONFIRMING RATHER THAN DISCOVERED AFTERWARDS — the same promise
          the resolved hour above makes, and the reason the venue editor had to ship in the same
          slice. On a row about to be created this is what the ward's venue list decided; on one
          that already exists it is what is staying. An unmatched location shows "Not yet known"
          and never "Away" (lib/youth/classifyLocation.ts). */}
      <p className="text-sm text-muted">
        {EVENT_TYPE_LABELS[eventType ?? event.eventType]}
      </p>
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

// ---------------------------------------------------------------------------
// SAYING WHAT THE FILE WOULD HAVE DONE IS WHAT MAKES THE GUARANTEE MEAN SOMETHING
// ---------------------------------------------------------------------------
// "Home or away is left as it is" was the whole note, and walking scenario 054 on 2026-08-28
// found it unreadable: left as it is *instead of what*? Nothing on the screen suggested anything
// had been overridden, so the sentence read as filler rather than as a promise being kept.
//
// The preview already holds both answers — `existingEventType` is what is stored, and
// `change.event.eventType` is what this file's location would classify to — so where they differ
// it can state the comparison. That is a FACT DERIVED FROM DATA, not a guess about who typed it.
//
// IT DOES NOT CLAIM A PERSON SET IT, because nothing records that. `activity_events` has no
// column saying who last wrote `event_type`, and inferring one from a disagreement would be a
// second, weaker meaning for a field that does not exist — the kind of thing `assigned_by` is a
// real column precisely to avoid. "This file would have set it to Home" is true either way, and
// it is the half a leader can act on.
// THE `tbd` LABEL IS NEVER DROPPED INTO THIS SENTENCE, and that is why the two halves are built
// separately rather than by interpolating EVENT_TYPE_LABELS twice.
//
// "Home or away not set" is the right words on a chip standing alone, and nonsense inside a
// clause: the first attempt at this note read "this file would have set it to Home or away not
// set". A label that reads correctly in one place and not another needs the sentence rewritten
// around it, not the label bent to fit — the chip is the harder constraint and it wins.
export function leftAloneNote(change: PreviewEventChange): string {
  const stored = change.existingEventType;
  const classified = change.event.eventType;

  if (stored === classified) return "Home or away is left as it is.";

  const stays =
    stored === "tbd"
      ? "Home or away is still not set"
      : `Home or away stays ${EVENT_TYPE_LABELS[stored]}`;

  const would =
    classified === "tbd"
      ? "this file would have left it for somebody to set"
      : `this file would have set it to ${EVENT_TYPE_LABELS[classified]}`;

  return `${stays} — ${would}.`;
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
                // WHAT IT STAYS AS, not what the file would have made it. A leader who corrected a
                // classification last month otherwise has no way to see that the correction
                // survived, and youth-b's guarantee — written about this slice, in advance —
                // stays theoretical.
                eventType={change.existingEventType}
                note={`Was ${change.existingTitle}, ${change.existingLocalTime} — changing ${change.changedFields.join(", ")}. ${leftAloneNote(change)}`}
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
