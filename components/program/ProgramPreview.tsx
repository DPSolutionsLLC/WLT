import { speakerSlotLabel } from "@/lib/program/diff";
import type { HymnRef, NameField, ProgramDraft } from "@/lib/program/draft";
import { formatSundayLabelWithYear } from "@/lib/calendar/dates";

// The meeting order, in reading order, as HTML.
//
// IT IS NOT THE BIFOLD LAYOUT AND MUST NOT TRY TO BE. Panel imposition — which half of which
// side of a folded sheet each block lands on — belongs to program-d and its PDF renderer. A
// hand-drawn approximation of it here would be worse than no preview at all: a secretary would
// check the fold against this, print it, and find the panels somewhere else. It is labelled
// "Preview" for that reason, and program-d adds the Generate PDF button beside it.
//
// ---------------------------------------------------------------------------------------------
// THE MEETING ORDER KEEPS ITS SKELETON, EVEN WHERE IT IS EMPTY
// ---------------------------------------------------------------------------------------------
// This file first OMITTED every line that had nobody on it, reading talks-c's "an absence renders
// as an absence" as "delete the row". Walking scenario 031 proved that wrong: with five lines
// gone, the preview read as a program that had FAILED TO LOAD rather than as one still being
// filled in (walkthrough record, judgement 3).
//
// talks-c actually says a missing organist is A BLANK — not the word "Never", not "None
// assigned". A blank is a line with nothing in it, which is a weaker and more literal thing than
// no line at all. Deleting the row was an over-application.
//
// So the NINE FIXED LINES of a sacrament meeting always render, carrying a muted marker where
// they are still empty. A congregation's meeting has an organist slot whether or not anybody is
// named in it, and seeing the shape of the meeting is most of what a preview is for.
//
// The OPTIONAL BLOCKS below — ward business, special notes, a musical number, announcements,
// missionary information, the heading — are still omitted when empty, and that is not the same
// decision. A Sunday with no musical number is not missing one; there is no slot standing open.
// Rendering an empty block for each would put six greyed placeholders on an ordinary program.
//
// The markers are SCREEN-ONLY and never reach the stored draft, which still holds null. No field
// is ever the string "TBD" or "Not yet assigned" — a placeholder baked into the data would be
// printed by program-d exactly as though somebody had typed it (lib/program/assembleDraft.ts).

// What a still-empty line says. Two phrasings rather than one, because "Nobody yet" under
// Sacrament hymn is wrong and "Not chosen yet" under Organist is wrong. Matches the wording the
// speakers list already uses, which scenario 031 kept deliberately (judgement 4).
const NOBODY_YET = "Nobody yet";
const NOT_CHOSEN_YET = "Not chosen yet";

export const PENDING_LINE_NOTE = "Lines still to fill are greyed.";

function nameOf(name: NameField | null): string | null {
  const printed = name?.printedName ?? null;
  return printed === null || printed.trim() === "" ? null : printed;
}

function hymnOf(hymn: HymnRef | null): string | null {
  if (hymn === null) return null;
  return hymn.title.trim() === "" ? `Hymn ${hymn.number}` : `${hymn.number} — ${hymn.title}`;
}

function textOf(value: string | null): string | null {
  return value === null || value.trim() === "" ? null : value.trim();
}

// One of the nine fixed meeting-order lines. ALWAYS renders. `pending` is the words shown when
// the line is still empty, and the row is muted rather than absent.
function Line({
  label,
  value,
  pending,
}: {
  label: string;
  value: string | null;
  pending: string;
}) {
  const isEmpty = value === null;

  return (
    <div className="flex flex-col gap-0.5 sm:flex-row sm:gap-2">
      <dt className="text-sm text-muted sm:w-40 sm:shrink-0">{label}</dt>
      <dd className={isEmpty ? "text-sm italic text-muted" : "text-sm text-foreground"}>
        {value ?? pending}
      </dd>
    </div>
  );
}

function Block({ label, value }: { label: string; value: string | null }) {
  if (value === null) return null;

  return (
    <div className="flex flex-col gap-0.5">
      <dt className="text-sm text-muted">{label}</dt>
      {/* whitespace-pre-line so the paragraphs a secretary typed survive to the screen. */}
      <dd className="whitespace-pre-line text-sm text-foreground">{value}</dd>
    </div>
  );
}

export type ProgramPreviewProps = {
  draft: ProgramDraft;
};

export function ProgramPreview({ draft }: ProgramPreviewProps) {
  const musical = draft.musicalNumber;
  const musicalPerformer = nameOf(musical?.performer ?? null);

  return (
    <section aria-label="Program preview" className="flex flex-col gap-4">
      <header className="flex flex-col gap-1 border-b border-border pb-3 text-center">
        {/* null on an ordinary Sunday, and then NOTHING is rendered — not an empty element. */}
        {textOf(draft.heading) !== null && (
          <p className="text-sm font-semibold uppercase tracking-wide text-muted">
            {draft.heading}
          </p>
        )}
        <h3 className="text-base font-semibold text-foreground">Sacrament Meeting</h3>
        <p className="text-sm text-muted">{formatSundayLabelWithYear(draft.date)}</p>
      </header>

      <dl className="flex flex-col gap-2">
        <Line label="Presiding" value={nameOf(draft.presiding)} pending={NOBODY_YET} />
        <Line label="Conducting" value={nameOf(draft.conducting)} pending={NOBODY_YET} />
        <Line label="Organist" value={nameOf(draft.organist)} pending={NOBODY_YET} />
        <Line label="Chorister" value={nameOf(draft.chorister)} pending={NOBODY_YET} />
        <Line
          label="Opening hymn"
          value={hymnOf(draft.openingHymn)}
          pending={NOT_CHOSEN_YET}
        />
        <Line label="Invocation" value={nameOf(draft.invocation)} pending={NOBODY_YET} />
        <Block label="Ward business" value={textOf(draft.wardBusiness)} />
        <Line
          label="Sacrament hymn"
          value={hymnOf(draft.sacramentHymn)}
          pending={NOT_CHOSEN_YET}
        />
        <Block label="Special notes" value={textOf(draft.specialNotes)} />
        {/* OPTIONAL, so still omitted when empty. A Sunday with no musical number is not missing
            one — there is no slot standing open for it. */}
        <Block
          label="Musical number"
          value={
            musical === null
              ? null
              : [textOf(musical.pieceTitle), musicalPerformer]
                  .filter((part): part is string => part !== null)
                  .join(" — ") || null
          }
        />
      </dl>

      {/* Rendered straight from the snapshot. NOT re-derived from member_id and never through
          the roster — program-a resolved both names when it assembled the draft, which is what
          keeps an external speaker's typed title intact (talks-b, ITER-004). */}
      <div className="flex flex-col gap-2 border-t border-border pt-3">
        <h4 className="text-sm font-semibold text-foreground">Speakers</h4>
        <dl className="flex flex-col gap-2">
          {draft.speakers.map((speaker) => {
            const printed =
              speaker.printedName === null || speaker.printedName.trim() === ""
                ? null
                : speaker.printedName;
            const topic = textOf(speaker.topic);

            return (
              <div key={speaker.slotNumber} className="flex flex-col gap-0.5">
                <dt className="text-sm text-muted">{speakerSlotLabel(speaker.slotNumber)}</dt>
                {/* An open slot keeps its line and says so. The same treatment the nine fixed
                    lines above use, and the wording scenario 031 kept deliberately. */}
                <dd className="text-sm text-foreground">
                  {printed ?? <span className="italic text-muted">{NOBODY_YET}</span>}
                  {topic !== null && <span className="text-muted"> — {topic}</span>}
                </dd>
              </div>
            );
          })}
        </dl>
      </div>

      <dl className="flex flex-col gap-2 border-t border-border pt-3">
        <Line
          label="Closing hymn"
          value={hymnOf(draft.closingHymn)}
          pending={NOT_CHOSEN_YET}
        />
        <Line label="Benediction" value={nameOf(draft.benediction)} pending={NOBODY_YET} />
        {/* Optional blocks, omitted when empty — see the note at the top of this file. */}
        <Block label="Announcements" value={textOf(draft.announcements)} />
        <Block label="Missionaries" value={textOf(draft.missionaries)} />
      </dl>

      {/* The contacts carry PHONE NUMBERS. They belong on the paper program handed round a
          chapel and must never reach /public/[slug] — program-c's toPublicProgram() omits the
          array entirely rather than redacting inside it. */}
      {draft.leadershipContacts.length > 0 && (
        <div className="flex flex-col gap-2 border-t border-border pt-3">
          <h4 className="text-sm font-semibold text-foreground">Ward leadership</h4>
          <ul className="flex flex-col gap-1">
            {draft.leadershipContacts.map((contact, index) => (
              <li key={`${contact.role}-${index}`} className="text-sm text-foreground">
                <span className="text-muted">{contact.role} — </span>
                {contact.name}
                {contact.phone !== null && contact.phone.trim() !== "" && (
                  <span className="text-muted"> · {contact.phone}</span>
                )}
              </li>
            ))}
          </ul>
        </div>
      )}
    </section>
  );
}
