import { formatSundayLabelWithYear } from "@/lib/calendar/dates";
import { speakerSlotLabel } from "@/lib/program/diff";
import type { PublicHymn, PublicProgram } from "@/lib/program/publicProjection";
import type { PublicProgramPage } from "@/lib/program/publicQueries";

// The program a congregation reads on a phone.
//
// ---------------------------------------------------------------------------------------------
// IT RENDERS PublicProgram AND NOTHING ELSE, AND THAT IS THE SAFETY PROPERTY
// ---------------------------------------------------------------------------------------------
// PublicProgram has no leadershipContacts, no missionaries and no printedName — those fields do
// not exist on the type, so leaking one here is a COMPILE ERROR rather than something a reviewer
// has to notice. Do not widen these props to take a ProgramDraft "just to render one more thing";
// that single change would move the privacy boundary out of publicProjection.ts and into a JSX
// file, where nobody would think to look for it.
//
// ---------------------------------------------------------------------------------------------
// AN EMPTY LINE KEEPS ITS PLACE AND SAYS IT IS EMPTY
// ---------------------------------------------------------------------------------------------
// This file first OMITTED every line with nobody on it, so a third speaking slot with no speaker
// simply vanished. Walking scenario 032 with a person reading the real page reversed that, and the
// reason is worth keeping: a slot that disappears LOOKS CORRECT. Nobody can tell the difference
// between "this meeting has two speakers" and "nobody ever filled in the third", so nothing
// prompts anybody to fix it.
//
// A gap that renders is a gap somebody notices. And the right fix for a permanently empty slot is
// NOT to hide it here — it is for the bishopric to set that Sunday's speaking-slot count to two on
// the calendar, so no third slot is expected at all. The page showing the gap is what sends them
// there.
//
// This now matches components/program/ProgramPreview.tsx, which reached the same conclusion
// walking scenario 031 for the same reason: with its empty rows deleted, a half-built program read
// as one that had FAILED TO LOAD.
//
// THE OPTIONAL BLOCKS BELOW ARE STILL OMITTED WHEN EMPTY. That is a different decision, not an
// inconsistency: ward business, a musical number, special notes and announcements have no slot
// standing open — a Sunday with no musical number is not MISSING one. Rendering a greyed
// placeholder for each would put four "nothing here" rows on an ordinary program.
//
// The markers are SCREEN-ONLY. public_data still stores null, and no field is ever the string
// "TBD" — a placeholder baked into the data would be printed by program-d exactly as though
// somebody had typed it.
//
// ---------------------------------------------------------------------------------------------
// NO CLIENT JAVASCRIPT
// ---------------------------------------------------------------------------------------------
// Server Component, no "use client", no images, no icon font. It is read once, standing up, on a
// chapel connection. If something here ever seems to need state, it almost certainly does not.

// Two phrasings rather than one, because "Nobody yet" under Sacrament hymn is wrong and "Not
// chosen yet" under Organist is wrong. The same pair ProgramPreview settled on, so the builder and
// the public page word a gap identically.
const NOBODY_YET = "Nobody yet";
const NOT_CHOSEN_YET = "Not chosen yet";

// One of the nine fixed meeting-order lines. ALWAYS renders; muted and italic where still empty.
function Row({
  label,
  value,
  pending,
}: {
  label: string;
  value: string | null;
  pending: string;
}) {
  return (
    <div className="flex flex-col gap-0.5 sm:flex-row sm:gap-3">
      <dt className="text-sm text-muted sm:w-40 sm:shrink-0">{label}</dt>
      <dd className={value === null ? "text-sm italic text-muted" : "text-sm text-foreground"}>
        {value ?? pending}
      </dd>
    </div>
  );
}

// An optional block. Omitted entirely when empty — no slot stands open for it.
function Block({ label, value }: { label: string; value: string | null }) {
  if (value === null) return null;

  return (
    <div className="flex flex-col gap-1">
      <h2 className="text-sm font-semibold text-foreground">{label}</h2>
      {/* whitespace-pre-line so the paragraphs the secretary typed survive to the page. */}
      <p className="whitespace-pre-line text-sm text-foreground">{value}</p>
    </div>
  );
}

// "19 — We Thank Thee, O God, for a Prophet", or just "Hymn 19" when the hymnbook seed has no
// title for that number yet (42 of 341 until program-e).
function hymnLine(hymn: PublicHymn | null): string | null {
  if (hymn === null) return null;
  const title = hymn.title.trim();
  return title === "" ? `Hymn ${hymn.number}` : `${hymn.number} — ${title}`;
}

function musicalLine(program: PublicProgram): string | null {
  const musical = program.musicalNumber;
  if (musical === null) return null;

  const parts = [musical.pieceTitle, musical.performer].filter(
    (part): part is string => part !== null,
  );

  return parts.length === 0 ? null : parts.join(" — ");
}

export function ProgramPanel({ page }: { page: PublicProgramPage }) {
  const program = page.program;
  const musical = musicalLine(program);

  // EVERY slot the Sunday holds, filled or not — see the note at the top of this file.
  const speakers = program.speakers;

  return (
    <main className="flex flex-col gap-6">
      <header className="flex flex-col gap-1 border-b border-border pb-4 text-center">
        {page.wardName !== "" && <p className="text-sm text-muted">{page.wardName}</p>}
        {/* null on an ordinary Sunday, and then nothing renders — not an empty element. */}
        {program.heading !== null && (
          <p className="text-sm font-semibold uppercase tracking-wide text-muted">
            {program.heading}
          </p>
        )}
        <h1 className="text-xl font-semibold text-foreground">Sacrament Meeting</h1>
        <p className="text-sm text-muted">{formatSundayLabelWithYear(program.date)}</p>
      </header>

      {/* Reading order — the order the meeting happens in. NOT the bifold panel order, which is
          program-d's PDF and a different problem entirely. */}
      <dl className="flex flex-col gap-2">
        <Row label="Presiding" value={program.presiding} pending={NOBODY_YET} />
        <Row label="Conducting" value={program.conducting} pending={NOBODY_YET} />
        <Row label="Organist" value={program.organist} pending={NOBODY_YET} />
        <Row label="Chorister" value={program.chorister} pending={NOBODY_YET} />
        <Row
          label="Opening hymn"
          value={hymnLine(program.openingHymn)}
          pending={NOT_CHOSEN_YET}
        />
        <Row label="Invocation" value={program.invocation} pending={NOBODY_YET} />
        <Row
          label="Sacrament hymn"
          value={hymnLine(program.sacramentHymn)}
          pending={NOT_CHOSEN_YET}
        />
        <Row
          label="Closing hymn"
          value={hymnLine(program.closingHymn)}
          pending={NOT_CHOSEN_YET}
        />
        <Row label="Benediction" value={program.benediction} pending={NOBODY_YET} />
      </dl>

      {speakers.length > 0 && (
        <section className="flex flex-col gap-2 border-t border-border pt-4">
          <h2 className="text-sm font-semibold text-foreground">Speakers</h2>
          <dl className="flex flex-col gap-2">
            {speakers.map((speaker) => (
              <div key={speaker.slotNumber} className="flex flex-col gap-0.5">
                <dt className="text-sm text-muted">{speakerSlotLabel(speaker.slotNumber)}</dt>
                {/* Everybody is named in full — the ward member and the visiting speaker alike
                    (lib/program/publicProjection.ts). An open slot keeps its line and says so, in
                    the same words the builder uses. */}
                <dd className="text-sm text-foreground">
                  {speaker.name ?? <span className="italic text-muted">{NOBODY_YET}</span>}
                  {speaker.topic !== null && (
                    <span className="text-muted"> — {speaker.topic}</span>
                  )}
                </dd>
              </div>
            ))}
          </dl>
        </section>
      )}

      {/* OPTIONAL blocks. Omitted when empty, unlike the fixed lines above — nothing stands open
          waiting for them. */}
      {(program.wardBusiness !== null ||
        musical !== null ||
        program.specialNotes !== null ||
        program.announcements !== null) && (
        <section className="flex flex-col gap-4 border-t border-border pt-4">
          <Block label="Ward business" value={program.wardBusiness} />
          <Block label="Musical number" value={musical} />
          <Block label="Notes" value={program.specialNotes} />
          <Block label="Announcements" value={program.announcements} />
        </section>
      )}

      {/* program-d fills pdf_url in. Labelled as the printed program so it is obvious that the
          link is the same document in another shape, not more of it. */}
      {page.pdfUrl !== null && (
        <footer className="border-t border-border pt-4">
          <a
            className="text-sm font-medium text-primary underline underline-offset-2"
            href={page.pdfUrl}
          >
            Open the printed program (PDF)
          </a>
        </footer>
      )}
    </main>
  );
}
