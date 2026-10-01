import { Pill } from "@/components/ui/Pill";
import { askContactLine } from "@/lib/sacrament/talkAsks";
import { formatAppointmentInstant } from "@/lib/visits/visitDates";
import type { AskTimeElsewhere, TodoAskSource } from "@/types/domain";

// What a leader needs in hand to extend a talk's invitation: the topic and how to reach the
// speaker. It is shown on the to-do card, in "Schedule this" and on My Appointments, so a hallway
// conversation, a phone call or a scheduled meeting all have it without opening the notes (the
// user's request walking scenario 078). Read live from the talk (lib/todos/askSource.ts), and so are
// its references (ITER-036, D5): one added after the ask was sent still shows.
//
// WHEN THE TALK IS OFF OR CANCELLED (Sacrament slices f2b and f2c) the same details are what the
// leader needs to tell the speaker they are not needed, so they stay, under a "Cancelled" marker.
// The card and the appointment row then offer "Told them" in place of Accepted / Declined.
//
// A phone number is plain selectable text. Phones offer to call a number they recognise, and a
// `tel:` link here would be a second, smaller tap target inside a card full of them.
//
// ANOTHER LEADER'S TIME (Sacrament slice f3a) is a line, never an appointment: an assistant, or a
// conductor who took the Sunday over, reads who has a time set so they can fit it in or reach out
// to reschedule. In the WARD's zone (rule 12) — it is a time somebody turns up at.

export function describeTimeElsewhere(time: AskTimeElsewhere, wardZone: string): string {
  const when = formatAppointmentInstant(time.scheduledFor, wardZone);
  const withWhom = time.withName === null ? "" : ` with ${time.withName}`;
  return `${time.holderName} ${time.stillHeld ? "has" : "had"} this set for ${when}${withWhom}.`;
}

export function AskDetails({ ask, wardZone }: { ask: TodoAskSource; wardZone: string }) {
  const contact = askContactLine(ask);

  return (
    <dl className="flex flex-col gap-0.5 text-sm">
      {ask.talkOff ? (
        <div className="flex flex-wrap items-center gap-x-1.5 gap-y-0.5">
          <dt className="sr-only">Talk</dt>
          <dd>
            <CancelledNotice />
          </dd>
        </div>
      ) : null}
      <div className="flex flex-wrap gap-x-1.5">
        <dt className="text-muted">Topic</dt>
        <dd className="min-w-0 break-words text-foreground">{ask.topicTitle ?? "No topic yet"}</dd>
      </div>
      {ask.references.length === 0 ? null : (
        <div className="flex flex-wrap gap-x-1.5">
          <dt className="text-muted">References</dt>
          <dd className="min-w-0 break-words text-foreground">{ask.references.join("; ")}</dd>
        </div>
      )}
      {contact === null ? null : (
        <div className="flex flex-wrap gap-x-1.5">
          <dt className="sr-only">Contact</dt>
          <dd className="min-w-0 break-words text-foreground">{contact}</dd>
        </div>
      )}
      {ask.timeElsewhere === null ? null : (
        <div className="flex flex-wrap gap-x-1.5">
          <dt className="sr-only">Already scheduled</dt>
          <dd className="min-w-0 break-words text-muted">
            {describeTimeElsewhere(ask.timeElsewhere, wardZone)}
          </dd>
        </div>
      )}
    </dl>
  );
}

// The marker a "let them know it's cancelled" to-do carries — a talk ask above, or on its own for a
// cancelled prayer or musical number, which has no talk to describe (Sacrament slice f2c).
export function CancelledNotice() {
  return (
    <span className="flex flex-wrap items-center gap-x-1.5 gap-y-0.5 text-sm">
      <Pill tone="missing">Cancelled</Pill>
      <span className="text-foreground">Let them know they&apos;re not needed.</span>
    </span>
  );
}
