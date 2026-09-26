import { Pill } from "@/components/ui/Pill";
import { askContactLine } from "@/lib/sacrament/talkAsks";
import type { TodoAskSource } from "@/types/domain";

// What a leader needs in hand to extend a talk's invitation: the topic and how to reach the
// speaker. It is shown on the to-do card, in "Schedule this" and on My Appointments, so a hallway
// conversation, a phone call or a scheduled meeting all have it without opening the notes (the
// user's request walking scenario 078). Read live from the talk (lib/todos/askSource.ts).
//
// WHEN THE TALK IS OFF (Sacrament slice f2b) the same details are what the leader needs to tell
// the speaker they are not needed, so they stay, under a "No talk any more" marker. The card and the
// appointment row then offer "Told them" in place of Accepted / Declined.
//
// A phone number is plain selectable text. Phones offer to call a number they recognise, and a
// `tel:` link here would be a second, smaller tap target inside a card full of them.

export function AskDetails({ ask }: { ask: TodoAskSource }) {
  const contact = askContactLine(ask);

  return (
    <dl className="flex flex-col gap-0.5 text-sm">
      {ask.talkOff ? (
        <div className="flex flex-wrap items-center gap-x-1.5 gap-y-0.5">
          <dt className="sr-only">Talk</dt>
          <dd>
            <Pill tone="missing">No talk any more</Pill>
          </dd>
          <dd className="text-foreground">Let them know they&apos;re not needed.</dd>
        </div>
      ) : null}
      <div className="flex flex-wrap gap-x-1.5">
        <dt className="text-muted">Topic</dt>
        <dd className="min-w-0 break-words text-foreground">{ask.topicTitle ?? "No topic yet"}</dd>
      </div>
      {contact === null ? null : (
        <div className="flex flex-wrap gap-x-1.5">
          <dt className="sr-only">Contact</dt>
          <dd className="min-w-0 break-words text-foreground">{contact}</dd>
        </div>
      )}
    </dl>
  );
}
