"use client";

import { useId } from "react";
import { Input } from "@/components/ui/Input";
import { speakerSlotLabel } from "@/lib/program/diff";
import type {
  ContactField,
  HymnRef,
  MusicalNumberField,
  NameField,
  ProgramDraft,
  ProgramSpeaker,
} from "@/lib/program/draft";
import { formatSundayLabelWithYear } from "@/lib/calendar/dates";
import { SUNDAY_TYPE_LABELS } from "@/types/domain";

// The field-by-field editor.
//
// ---------------------------------------------------------------------------------------------
// EDITING THE PROGRAM DOES NOT EDIT THE WARD
// ---------------------------------------------------------------------------------------------
// The draft is a SNAPSHOT (lib/program/draft.ts). Correcting a speaker's name here changes what
// is printed on this Sunday's program and nothing else — not the roster, not the assignment, not
// the prayer. That is said once in the UI, near the save control, rather than repeated per field.
//
// ---------------------------------------------------------------------------------------------
// EVERY NAME IS A PAIR, AND BOTH HALVES ARE EDITABLE
// ---------------------------------------------------------------------------------------------
// `printedName` goes on the paper handed round a chapel; `publicName` may reach the open internet
// on /public/[slug]. lib/program/draft.ts makes them independently nullable precisely so this
// screen can edit one without the other. Two inputs per person, and the public one says what it
// is for — a single input that silently derived the other would make the privacy rule invisible
// at the one place somebody could get it wrong.
//
// ---------------------------------------------------------------------------------------------
// THREE FIELDS ARE READ-ONLY, ON PURPOSE
// ---------------------------------------------------------------------------------------------
// `date` and `sundayType` identify WHICH MEETING this is. They come from the calendar, and a
// program that disagreed with its Sunday about either would be a program for a meeting that does
// not exist. They are shown, so nothing is hidden, and changed on the calendar. `version` is
// machinery and is never shown at all.
//
// An empty text box means NULL, never the empty string and never "TBD". A placeholder baked into
// the data would be printed by program-d exactly as though somebody had typed it.

const TEXTAREA_CLASSES =
  "min-h-24 rounded-md border border-border bg-surface-raised px-3 py-2 text-base " +
  "text-foreground placeholder:text-muted focus-visible:outline-2 " +
  "focus-visible:outline-offset-2 focus-visible:outline-primary";

export const SNAPSHOT_NOTE =
  "This program is a copy. Changing a name here changes what is printed on this Sunday's " +
  "program — it does not change the roster, the speaking assignment or the prayer it came from.";

export const PUBLIC_NAME_HINT = "Shown on the public page";

function toNull(value: string): string | null {
  return value.trim() === "" ? null : value;
}

// A person is null when BOTH halves are blank. One half filled is a real state — a draft can
// know a printed name and have had its public half cleared — so it must not collapse to null.
function nameOrNull(name: NameField): NameField | null {
  return name.printedName === null && name.publicName === null ? null : name;
}

function Section({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <section className="flex flex-col gap-3 border-t border-border pt-4 first:border-t-0 first:pt-0">
      <h3 className="text-sm font-semibold text-foreground">{title}</h3>
      {children}
    </section>
  );
}

function TextArea({
  id,
  label,
  value,
  onChange,
  disabled,
}: {
  id: string;
  label: string;
  value: string | null;
  onChange: (next: string | null) => void;
  disabled: boolean;
}) {
  return (
    <div className="flex flex-col gap-1.5">
      <label htmlFor={id} className="text-sm font-medium text-foreground">
        {label}
      </label>
      <textarea
        id={id}
        value={value ?? ""}
        disabled={disabled}
        onChange={(event) => onChange(toNull(event.target.value))}
        className={TEXTAREA_CLASSES}
      />
    </div>
  );
}

// One person: the printed name and the public name, side by side from sm up and stacked on a
// phone. `onChange` receives the whole pair, so the caller decides whether a blank pair is null.
function NameFields({
  idPrefix,
  label,
  value,
  onChange,
  disabled,
}: {
  idPrefix: string;
  label: string;
  value: NameField;
  onChange: (next: NameField) => void;
  disabled: boolean;
}) {
  return (
    <div className="grid gap-3 sm:grid-cols-2">
      <Input
        id={`${idPrefix}-printed`}
        label={label}
        value={value.printedName ?? ""}
        disabled={disabled}
        onChange={(event) =>
          onChange({ ...value, printedName: toNull(event.target.value) })
        }
      />
      <Input
        id={`${idPrefix}-public`}
        label={`${label} — ${PUBLIC_NAME_HINT}`}
        value={value.publicName ?? ""}
        disabled={disabled}
        onChange={(event) => onChange({ ...value, publicName: toNull(event.target.value) })}
      />
    </div>
  );
}

// The number AND the title, always both. The hymnbook is only partially seeded until program-e,
// so "a number whose title cannot be resolved" is a state that WILL occur rather than a
// hypothetical — which is why the title is typed rather than looked up here.
//
// A blank number means no hymn. program-e replaces these two inputs with a picker.
function HymnFields({
  idPrefix,
  label,
  value,
  onChange,
  disabled,
}: {
  idPrefix: string;
  label: string;
  value: HymnRef | null;
  onChange: (next: HymnRef | null) => void;
  disabled: boolean;
}) {
  function update(next: { number?: string; title?: string }): void {
    const rawNumber = next.number ?? (value === null ? "" : String(value.number));
    const title = next.title ?? value?.title ?? "";
    const parsedNumber = Number.parseInt(rawNumber, 10);

    if (!Number.isInteger(parsedNumber) || parsedNumber <= 0) {
      onChange(null);
      return;
    }

    onChange({ number: parsedNumber, title });
  }

  return (
    <div className="grid gap-3 sm:grid-cols-[8rem_1fr]">
      <Input
        id={`${idPrefix}-number`}
        label={`${label} number`}
        type="number"
        min={1}
        inputMode="numeric"
        value={value === null ? "" : String(value.number)}
        disabled={disabled}
        onChange={(event) => update({ number: event.target.value })}
      />
      {/* Disabled until there IS a number. A hymn is identified by its number, so a title with
          no number cannot be stored — and an input that accepted keystrokes and discarded them
          would be worse than one that plainly cannot be typed in yet. */}
      <Input
        id={`${idPrefix}-title`}
        label={`${label} title`}
        value={value?.title ?? ""}
        disabled={disabled || value === null}
        placeholder={value === null ? "Enter a hymn number first" : undefined}
        onChange={(event) => update({ title: event.target.value })}
      />
    </div>
  );
}

export type MeetingOrderFormProps = {
  draft: ProgramDraft;
  onChange: (next: ProgramDraft) => void;
  // False once the program is approved or distributed. Every input is disabled rather than the
  // form being replaced by a read-only rendering: the same layout, plainly not editable, is
  // easier to trust than a second view of the same fields.
  disabled: boolean;
};

export function MeetingOrderForm({ draft, onChange, disabled }: MeetingOrderFormProps) {
  // useId so two forms on one page cannot collide, and so every label's htmlFor is real.
  const formId = useId();
  const fieldId = (name: string) => `${formId}-${name}`;

  function set<Key extends keyof ProgramDraft>(key: Key, value: ProgramDraft[Key]): void {
    onChange({ ...draft, [key]: value });
  }

  function setSpeaker(slotNumber: number, patch: Partial<ProgramSpeaker>): void {
    set(
      "speakers",
      draft.speakers.map((speaker) =>
        speaker.slotNumber === slotNumber ? { ...speaker, ...patch } : speaker,
      ),
    );
  }

  function setContact(index: number, patch: Partial<ContactField>): void {
    set(
      "leadershipContacts",
      draft.leadershipContacts.map((contact, contactIndex) =>
        contactIndex === index ? { ...contact, ...patch } : contact,
      ),
    );
  }

  function setMusical(patch: Partial<MusicalNumberField>): void {
    const current: MusicalNumberField = draft.musicalNumber ?? {
      performer: { printedName: null, publicName: null },
      pieceTitle: "",
      notes: null,
    };

    const next: MusicalNumberField = { ...current, ...patch };

    // No performer and no piece is no musical number. Storing an object of nulls would make
    // program-d render an empty musical-number line on a Sunday that has none.
    const isEmpty =
      next.pieceTitle.trim() === "" &&
      next.performer.printedName === null &&
      next.performer.publicName === null &&
      next.notes === null;

    set("musicalNumber", isEmpty ? null : next);
  }

  return (
    <div className="flex flex-col gap-6">
      <Section title="This meeting">
        {/* Shown, not hidden — and not editable. Both come from the calendar, and a program that
            disagreed with its Sunday about which meeting it is would be a program for a meeting
            that does not exist. */}
        <dl className="flex flex-col gap-1 text-sm">
          <div className="flex gap-2">
            <dt className="text-muted">Date</dt>
            <dd className="text-foreground">{formatSundayLabelWithYear(draft.date)}</dd>
          </div>
          <div className="flex gap-2">
            <dt className="text-muted">Kind of Sunday</dt>
            <dd className="text-foreground">{SUNDAY_TYPE_LABELS[draft.sundayType]}</dd>
          </div>
        </dl>
        <p className="text-sm text-muted">
          The date and the kind of Sunday come from the calendar. Change them there.
        </p>

        <Input
          id={fieldId("heading")}
          label="Heading"
          value={draft.heading ?? ""}
          disabled={disabled}
          placeholder="Left blank on an ordinary Sunday"
          onChange={(event) => set("heading", toNull(event.target.value))}
        />
      </Section>

      <Section title="Presiding and conducting">
        <NameFields
          idPrefix={fieldId("presiding")}
          label="Presiding"
          value={draft.presiding}
          disabled={disabled}
          onChange={(next) => set("presiding", next)}
        />
        <NameFields
          idPrefix={fieldId("conducting")}
          label="Conducting"
          value={draft.conducting}
          disabled={disabled}
          onChange={(next) => set("conducting", next)}
        />
      </Section>

      <Section title="Music">
        <NameFields
          idPrefix={fieldId("organist")}
          label="Organist"
          value={draft.organist ?? { printedName: null, publicName: null }}
          disabled={disabled}
          onChange={(next) => set("organist", nameOrNull(next))}
        />
        <NameFields
          idPrefix={fieldId("chorister")}
          label="Chorister"
          value={draft.chorister ?? { printedName: null, publicName: null }}
          disabled={disabled}
          onChange={(next) => set("chorister", nameOrNull(next))}
        />
        <HymnFields
          idPrefix={fieldId("opening-hymn")}
          label="Opening hymn"
          value={draft.openingHymn}
          disabled={disabled}
          onChange={(next) => set("openingHymn", next)}
        />
        <HymnFields
          idPrefix={fieldId("sacrament-hymn")}
          label="Sacrament hymn"
          value={draft.sacramentHymn}
          disabled={disabled}
          onChange={(next) => set("sacramentHymn", next)}
        />
        <HymnFields
          idPrefix={fieldId("closing-hymn")}
          label="Closing hymn"
          value={draft.closingHymn}
          disabled={disabled}
          onChange={(next) => set("closingHymn", next)}
        />
      </Section>

      <Section title="Musical number">
        <NameFields
          idPrefix={fieldId("musical-performer")}
          label="Performer"
          value={
            draft.musicalNumber?.performer ?? { printedName: null, publicName: null }
          }
          disabled={disabled}
          onChange={(performer) => setMusical({ performer })}
        />
        <Input
          id={fieldId("musical-piece")}
          label="Piece"
          value={draft.musicalNumber?.pieceTitle ?? ""}
          disabled={disabled}
          onChange={(event) => setMusical({ pieceTitle: event.target.value })}
        />
        <Input
          id={fieldId("musical-notes")}
          label="Musical number notes"
          value={draft.musicalNumber?.notes ?? ""}
          disabled={disabled}
          onChange={(event) => setMusical({ notes: toNull(event.target.value) })}
        />
      </Section>

      <Section title="Prayers">
        <NameFields
          idPrefix={fieldId("invocation")}
          label="Invocation"
          value={draft.invocation ?? { printedName: null, publicName: null }}
          disabled={disabled}
          onChange={(next) => set("invocation", nameOrNull(next))}
        />
        <NameFields
          idPrefix={fieldId("benediction")}
          label="Benediction"
          value={draft.benediction ?? { printedName: null, publicName: null }}
          disabled={disabled}
          onChange={(next) => set("benediction", nameOrNull(next))}
        />
      </Section>

      {/* Rendered from the SNAPSHOT — printedName and publicName as program-a resolved them, never
          re-derived from a member id and never through the roster. An external speaker's typed
          title lives inside printedName and would be lost the moment anything re-derived it
          (plans/retros/talks-b-planner-and-pipeline.md, ITER-004). */}
      <Section title="Speakers">
        {draft.speakers.length === 0 ? (
          <p className="text-sm text-muted">This Sunday has no speaking slots.</p>
        ) : (
          draft.speakers.map((speaker) => (
            <div
              key={speaker.slotNumber}
              className="flex flex-col gap-3 rounded-md border border-border p-3"
            >
              <NameFields
                idPrefix={fieldId(`speaker-${speaker.slotNumber}`)}
                label={speakerSlotLabel(speaker.slotNumber)}
                value={{
                  printedName: speaker.printedName,
                  publicName: speaker.publicName,
                }}
                disabled={disabled}
                onChange={(next) =>
                  setSpeaker(speaker.slotNumber, {
                    printedName: next.printedName,
                    publicName: next.publicName,
                    // `kind` follows the name rather than being a third control. A slot with
                    // nobody in it is `empty`, and a slot somebody typed a name into is a person
                    // the bishopric named in order to print — which is the external rule
                    // (lib/program/assembleDraft.ts). A slot whose member came from the roster
                    // keeps `member` because its name is unchanged and this branch is not
                    // reached.
                    kind:
                      next.printedName === null && next.publicName === null
                        ? "empty"
                        : speaker.kind === "empty"
                          ? "external"
                          : speaker.kind,
                  })
                }
              />
              <Input
                id={fieldId(`speaker-${speaker.slotNumber}-topic`)}
                label={`${speakerSlotLabel(speaker.slotNumber)}'s topic`}
                value={speaker.topic ?? ""}
                disabled={disabled}
                onChange={(event) =>
                  setSpeaker(speaker.slotNumber, { topic: toNull(event.target.value) })
                }
              />
            </div>
          ))
        )}
      </Section>

      <Section title="Business and announcements">
        <TextArea
          id={fieldId("ward-business")}
          label="Ward business"
          value={draft.wardBusiness}
          disabled={disabled}
          onChange={(next) => set("wardBusiness", next)}
        />
        <TextArea
          id={fieldId("special-notes")}
          label="Special notes"
          value={draft.specialNotes}
          disabled={disabled}
          onChange={(next) => set("specialNotes", next)}
        />
        <TextArea
          id={fieldId("announcements")}
          label="Announcements"
          value={draft.announcements}
          disabled={disabled}
          onChange={(next) => set("announcements", next)}
        />
        <TextArea
          id={fieldId("missionaries")}
          label="Missionary information"
          value={draft.missionaries}
          disabled={disabled}
          onChange={(next) => set("missionaries", next)}
        />
      </Section>

      {/* These carry PHONE NUMBERS. They belong on the paper program and program-c's public
          projection omits the array entirely rather than redacting inside it. */}
      <Section title="Ward leadership contacts">
        {draft.leadershipContacts.length === 0 ? (
          <p className="text-sm text-muted">
            No leadership contacts are set. They come from the ward settings.
          </p>
        ) : (
          draft.leadershipContacts.map((contact, index) => (
            <div
              key={`${contact.role}-${index}`}
              className="grid gap-3 rounded-md border border-border p-3 sm:grid-cols-3"
            >
              <Input
                id={fieldId(`contact-${index}-role`)}
                label={`Contact ${index + 1} role`}
                value={contact.role}
                disabled={disabled}
                onChange={(event) => setContact(index, { role: event.target.value })}
              />
              <Input
                id={fieldId(`contact-${index}-name`)}
                label={`Contact ${index + 1} name`}
                value={contact.name}
                disabled={disabled}
                onChange={(event) => setContact(index, { name: event.target.value })}
              />
              <Input
                id={fieldId(`contact-${index}-phone`)}
                label={`Contact ${index + 1} phone`}
                type="tel"
                value={contact.phone ?? ""}
                disabled={disabled}
                onChange={(event) =>
                  setContact(index, { phone: toNull(event.target.value) })
                }
              />
            </div>
          ))
        )}
      </Section>
    </div>
  );
}
