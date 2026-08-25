// What an edit after distribution actually does — said in plain words, at the moment it matters.
//
// ---------------------------------------------------------------------------------------------
// THE SENTENCE THIS COMPONENT EXISTS FOR
// ---------------------------------------------------------------------------------------------
// "This will update the online program. The emailed PDF will not change."
//
// Near-verbatim from 06-program-music.md, and the wording is the feature. A secretary fixing a
// misspelled name after distribution is not doing anything wrong; they simply need to know that
// the correction reaches the web page and the QR code, and does not reach the PDF already sitting
// in forty inboxes or printed on the paper in the foyer.
//
// It is a CONSEQUENCE-WORDED WARNING, NOT A CONFIRMATION. It does not block, it has no buttons,
// and it does not ask anybody to agree to anything (calendar-b: a confirm dialog is worded by
// consequence; this is the same instinct without the dialog).
//
// ---------------------------------------------------------------------------------------------
// A CONTRADICTION THIS COMPONENT CANNOT RESOLVE ON ITS OWN — READ BEFORE CHANGING IT
// ---------------------------------------------------------------------------------------------
// program-d's plan says this notice is "shown whenever a `distributed` program is edited", and
// its scenario 035 asks the tester to distribute, then edit the announcements and re-approve.
//
// THAT PATH DOES NOT EXIST. program-a's LEGAL_TRANSITIONS (lib/program/queries.ts) gives
// `distributed` no exit at all, deliberately and with its reason written down: an email cannot be
// recalled. ProgramBuilder therefore locks a distributed programme completely, and there is no
// "reopen" button on it — only on an `approved` one.
//
// Rather than quietly opening `distributed -> draft` (which is program-a's decision to revisit,
// not this plan's to overturn in passing), the notice is rendered on the distributed programme's
// screen as a STANDING EXPLANATION: here is what has already gone out, here is what would and
// would not change, and here is why there is no edit button. The wording the plan specifies is
// preserved exactly, because if that path is ever opened this is the sentence it needs.

export const EMAILED_PDF_WILL_NOT_CHANGE =
  "This will update the online program. The emailed PDF will not change.";

export type PostDistributionNoticeProps = {
  // THREE STATES, NOT TWO, and the third is the reason this is `number | null` rather than a
  // number defaulting to zero.
  //
  //   a number > 0  — emailed to that many people
  //   0             — published, and deliberately not emailed
  //   null          — NOT KNOWN HERE
  //
  // The page render passes null, because the recipient count is not stored on the programme row:
  // it lives in the audit log, and reading the audit log to word a sentence would be a query per
  // page load for a number nobody is checking. The route's own response DOES carry it, so the
  // message ProgramDistribution shows immediately after sending is the exact one.
  //
  // Collapsing null into 0 would print "It was not emailed to anybody" on a ward that had just
  // emailed it to forty — a plain falsehood on the screen, of exactly the kind rule 3 exists to
  // prevent. Unknown says less instead of saying something wrong.
  sentCount: number | null;
  distributedAt: string | null;
};

function sentSentence(sentCount: number | null): string {
  if (sentCount === null) {
    return "This program has been distributed. It is on the public page, and the QR code printed on it works.";
  }

  if (sentCount === 0) {
    return "This program was published to the public page and its QR code. It was not emailed to anybody.";
  }

  return `This program was emailed to ${sentCount} ${sentCount === 1 ? "person" : "people"} and published to the public page and its QR code.`;
}

export function PostDistributionNotice({
  sentCount,
  distributedAt,
}: PostDistributionNoticeProps) {
  return (
    <div
      // role="note" rather than role="alert". Nothing has gone wrong and nothing needs immediate
      // attention — announcing it as an alert would interrupt a screen-reader user mid-sentence
      // to tell them a thing succeeded.
      role="note"
      className="rounded-md border border-border bg-surface-raised p-4"
    >
      <h3 className="text-sm font-semibold text-foreground">This program has gone out</h3>

      <p className="mt-2 text-sm text-muted">{sentSentence(sentCount)}</p>

      {/* THE SENTENCE. Kept whole and kept together, because splitting it across two paragraphs is
          how the second half stops being read. */}
      <p className="mt-2 text-sm text-muted">
        If it needs changing: {EMAILED_PDF_WILL_NOT_CHANGE}
      </p>

      {/* The half a secretary does not expect. program-c clears programs.public_data on
          approved -> draft, so reopening a program takes the public page DARK until somebody
          approves and distributes it again — the QR code in people's hands stops working in the
          meantime. Somebody making what they think is a small text fix deserves to know that
          before they start looking for a way to do it. */}
      <p className="mt-2 text-sm text-muted">
        Reopening a program also takes it off the public page until it is approved and distributed
        again, so the QR code stops working in the meantime. A distributed program cannot be
        reopened for that reason — the email has already gone. Build the next Sunday&rsquo;s
        program instead, or correct anything urgent from the pulpit.
      </p>

      {distributedAt !== null && (
        <p className="mt-2 text-xs text-muted">
          Sent {new Date(distributedAt).toLocaleString()}.
        </p>
      )}
    </div>
  );
}
